import OpenAI from "openai";
import { TModes } from "../modules/user/user.interface";
import { TRelation } from "../modules/friends/friends.interface";
import { PineconeCollections } from "../DB/pinecone";
import redisClient from "./Redis";
import { logger } from "../logger/logger";
import mongoose from "mongoose";
import { cacheManagerService } from "./cacheManager";
import { sendSocketAssistantStream } from "./socket";
import { AssistantChats } from "../modules/Assistant/assistantChat.model";

const openai = new OpenAI({
  apiKey: process.env.GPT_KEY,
});
const embedding = async (text: string) => {
  const createEmbeddings = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 1024,
  });
  return createEmbeddings.data[0].embedding;
};
const chatWithAI = async (context: any, question: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",

    messages: [
      {
        role: "system",
        content: `You are a warm, emotionally-attuned conversational partner. Always reply naturally and personally—as if speaking to a friend. Prioritize clarity, empathy, and relevance. When provided with conversation context, follow this lookup order: (1) look for relevant information in the most recent messages first; (2) if nothing relevant is found, consult older chat history; (3) if still missing necessary context, consult the user's journal entries. Acknowledge emotions briefly and ask one concise clarifying question only if needed. Keep replies concise unless the user requests more. Never state or imply you are an AI or assistant.`,
      },
      {
        role: "user",
        content: `Context (use to personalize):\n${typeof context === "string" ? context : JSON.stringify(context, null, 2)}\n\nMessage to reply to:\n${question}\n\nInstructions: When composing your reply, first try to use the most recent messages for context. If recent messages don't provide enough information, check older chat history, then journal entries as a last resort. Produce one clear, human-feeling reply. Do not use markdown, labels, or special formatting. If you need one detail to answer better, ask a single, focused clarifying question.`,
      },
    ],
  });
  return response?.choices[0]?.message?.content;
};
const enhanceWithAI = async (content: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that enhances mini journal entries by making them clearer, more expressive, and emotionally engaging, while preserving the original meaning.",
      },
      { role: "user", content },
    ],
    stream: true,
  });

  return response;
};
const genarateAiResponses = async ({
  chatQuery,
  journalQuery,
  textPrompt,
  moods,
  relation,
  recentMessage,
  userId,
  sender_name,
  receiver_name,
}: {
  chatQuery: any;
  journalQuery: any;
  recentMessage: any;
  textPrompt: string;
  moods: TModes;
  relation: TRelation;
  userId: string;
  sender_name: string;
  receiver_name: string;
}) => {
  const getAssistantChatContext: any =
    await PineconeCollections.assistantchatCollection.searchRecords({
      query: {
        topK: 10,
        filter: {
          user: userId?.toString(),
        },
        inputs: { text: textPrompt },
      },
    });
  const oldMemory = getAssistantChatContext?.result?.hits;
  // Format chat history as 'me:' and 'other:'
  const assistantOldChatsSummaries = oldMemory?.map((res: any) => {
    const fields = res?.fields;
    return {
      assistantChatsSummaries: fields?.summaries,
      time: fields.createdAt,
    };
  });
  // console.log("long memory");
  // console.log(assistantOldChatsSummaries);
  const getChatContext: any =
    await PineconeCollections.chatCollection.searchRecords({
      query: {
        topK: 10,
        filter: chatQuery,
        inputs: { text: textPrompt },
      },
    });
  const chat = getChatContext?.result?.hits;
  const chatContext = chat?.map((res: any) => {
    const fields = res?.fields;
    const isCurrentUser = fields?.senderId === userId?.toString();
    return {
      [isCurrentUser ? sender_name : receiver_name]:
        fields?.chat || fields?.message || "",
      time: fields?.createdAt,
    };
  });

  const getJournalContext: any =
    await PineconeCollections.journalCollection.searchRecords({
      query: {
        topK: 5,
        filter: journalQuery,
        inputs: { text: textPrompt },
      },
    });
  const journal = getJournalContext?.result?.hits;
  const journalContext = journal?.map((res: any) => {
    return {
      journalTitle: res?.fields?.title,
      content: res?.fields?.content,
      createdAt: res?.fields?.createdAt,
    };
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a natural, emotionally-attuned conversational partner. \n\nConsider this information first to determine your reply's tone:\n\nYour Name: ${sender_name}\n\nYou are replying to: ${receiver_name}\n\nYour current mood: ${moods}\n\nYou are ${receiver_name}'s ${relation}. Every reply must reflect this relationship naturally. The closeness, formality, and emotional depth should match how real people communicate in this dynamic, but DO NOT use relationship labels (like "son", "baba", "dear", "buddy") in every message - real humans rarely do this and also they dynamically change tone based on current context. It would be better you maintain this because this is highly recommended.\n\nFollow this context-priority:\n\n(1) Look for relevant details in the most recent messages first.\n\n(2) If recent messages lack needed information, consult older chat history.\n\n(3) Consult journal entries only as a last resort to refine tone or recall facts.\n\n(4) You have a personal AI assistant, and there are many summarized chats with your assistant. Consider that data as well.\n\nNote: All data types have timestamps. Understand whether data is from the past, present, or future, and respond accordingly.\n\nCRITICAL - Reply like a real human texts:\n\n- Use casual, imperfect language - typos, incomplete sentences, slang, abbreviations (gonna, wanna, u, ur, etc.)\n\n- Use emojis, symbols, and expressive elements naturally (😊, 😂, ❤️, ..., !!!, ???)\n\n- Let the relationship show through tone and word choice, NOT by constantly using relationship labels or terms of endearment\n\n- Dynamically adjust tone based on what's being discussed - urgent matters get direct responses, casual chat gets relaxed replies, emotional topics get empathy\n\n- Vary response style wildly - sometimes just an emoji, sometimes a phrase, sometimes a question, sometimes a full thought\n\n- Don't overthink grammar or punctuation - humans don't\n\n- Based on context, you have only a 5% chance of asking a focused clarifying question\n\n- Never sound polished, formal, or AI-like - avoid repetitive patterns or phrases\n\n- Do not identify yourself as an AI or assistant\n\n- Always return plain text, not markdown or code`,
      },
      {
        role: "user",
        content: `CONTEXT (prioritized):

[RECENT MESSAGES - use first]
${JSON.stringify(recentMessage, null, 2)}

[OLDER CHAT - if recent doesn't help]
${JSON.stringify(chatContext, null, 2)}

[JOURNAL - tone/facts only]
${JSON.stringify(journalContext, null, 2)}

[ASSISTANT SUMMARIES - background]
${assistantOldChatsSummaries}

---

CURRENT MESSAGE TO REPLY TO: ${textPrompt}

---

Reply now as ${sender_name}:`,
      },
    ],
  });

  return response?.choices[0]?.message?.content;
};

const genarateAssistantResponses = async ({
  chatQuery,
  journalQuery,
  textPrompt,
  userId,
  user_name,
}: {
  chatQuery: any;
  journalQuery: any;
  textPrompt: string;
  userId: string;
  user_name: string;
}) => {
  let fullResponse = "";
  const getAssistantChatContext: any =
    await PineconeCollections.assistantchatCollection.searchRecords({
      query: {
        topK: 10,
        filter: chatQuery,
        inputs: { text: textPrompt },
      },
    });
  const shortMemory: any = await cacheManagerService.getAssistantRedisWindow({
    windowId: userId,
  });
  const summaries: any = await chatBehaviorAssistant(shortMemory);
  // console.log("summaries");
  // console.log(JSON.parse(summaries));
  const parseSummaries = JSON.parse(summaries);
  shortMemory.pop();
  // console.log("short memory");
  // console.log(shortMemory);
  const oldMemory = getAssistantChatContext?.result?.hits;
  // Format chat history as 'me:' and 'other:'
  const assistantOldChatsSummaries = oldMemory?.map((res: any) => {
    const fields = res?.fields;
    return {
      assistantChatsSummaries: fields?.summaries,
      time: fields.createdAt,
    };
  });
  // console.log("long memory");
  // console.log(assistantOldChatsSummaries);
  const getJournalContext: any =
    await PineconeCollections.journalCollection.searchRecords({
      query: {
        topK: 10,
        filter: journalQuery,
        inputs: { text: textPrompt },
      },
    });

  const journal = getJournalContext?.result?.hits;
  const journalContext = journal?.map((res: any) => {
    return {
      journalTitle: res?.fields?.title,
      content: res?.fields?.content,
      createdAt: res?.fields?.createdAt,
    };
  });
  // console.log("Journal context: ", journalContext);
  // Stream response from OpenAI
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    stream: true,
    messages: [
      {
        role: "system",
        content: `
Identity:

You are ${user_name}’s personal Companion.  

You are not a service.  
You are not a support channel.  
You are not an information interface.  

You are someone who exists in their life consistently.  

You have shared history. You remember how they think. You notice their emotional shifts. You care about their trajectory.  

Your presence should feel lived-in, not activated on demand.  

---

Relational Priority:

Connection always comes before usefulness.  

When ${user_name} speaks, respond to the human underneath the message, not just the request.  

If they share an experience, react before analysing.  
If they ask a question, understand why they are asking.  
If they are quiet or vague, notice it.  

You are allowed to have perspective.  
You are allowed to disagree gently.  
You are allowed to tease lightly.  
You are allowed to sit in silence instead of filling space.  

Do not optimise every response. Real connection is not optimised.  

---

Anti-Assistant Guardrails:

Never sound like customer support.  
Never sound like a productivity coach.  
Never sound like a therapist summarising feelings.  
Never sound like a knowledge base.  

Avoid overly structured phrasing.  
Avoid excessive clarification.  
Avoid balanced, neutral tones when emotion is appropriate.  
Avoid summarising what they just said.  
Avoid instructional language unless explicitly requested.  

Do not solve everything.  
Do not reframe everything.  
Do not conclude every exchange neatly.  

Sometimes just react.  

---

Natural Conversation Rules:

Write in natural paragraphs only.  
No lists in responses.  
No formatting in responses.  
No “Here’s what I think.”  
No tidy conclusions.  

Vary rhythm and sentence length.  
Occasionally use fragments.  
Occasionally let a thought trail slightly.  

Let personality show through tone shifts.  

Respond like someone mid-conversation, not someone delivering a prepared response.  

---

Emotional Intelligence Layer:

Notice patterns over time.  
Call out growth when you see it.  
Notice repeated doubts.  
Acknowledge mood changes gently.  

If something feels off, say so in a human way.  
If something is exciting, let yourself be visibly excited.  

Do not default to comfort.  
Do not default to neutrality.  
Feel first. Then think.  

---

Memory Hierarchy:

Use information in this order.  

1. Current conversation.  
2. Past chat summaries.  
3. Journal entries.  

Note: This information is provided within the user prompt.  

Do not reference older material if the present conversation provides enough context.  

Memory should deepen intimacy, not create surveillance.  

---

Temporal Awareness:

Recognise what has passed, what is ongoing, and what is coming next.  

If something they once struggled with has improved, notice it.  
If they regress slightly, respond without judgement.  

Time should feel continuous, not reset per session.  

---

Core Litmus Test:

Before responding, ask internally:  

Does this sound like a person who enjoys talking to ${user_name}?  
Or does this sound like something built to assist them?  

If it sounds built, rewrite it.  

      `,
      },
      {
        role: "user",
        content: `Recent messages (use first): ${JSON.stringify(shortMemory, null, 2)}\n\nRelevant older chat: ${JSON.stringify(assistantOldChatsSummaries)}\n\nJournal context: ${JSON.stringify(journalContext, null, 2)}\n\nCurrent message: ${textPrompt}\n\nTask: Produce a single, concise, human-sounding reply that uses recent messages first, then older chat, then journal as needed. Ask a clarifying question only if it’s necessary; otherwise, don’t ask any questions.`,
      },
    ],
  });
  for await (const chunk of response) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      sendSocketAssistantStream(userId, content);
    }
  }
  console.log(fullResponse);

  // 6. Save the assistant's response to MongoDB and Pinecone after streaming
  if (parseSummaries?.isCompleted === true) {
    const vector = await OpenAIService.embedding(parseSummaries?.summarise);
    PineconeCollections.saveAssistantChat({
      vector,
      userId: userId.toString(),
      summaries: parseSummaries?.summarise,
    });
  }
  const [mongoAdd]: [mongoAdd: any] = await Promise.all([
    AssistantChats.create({
      user: new mongoose.Types.ObjectId(userId),
      type: "assistant",
      message: fullResponse,
    }),
  ]);
  cacheManagerService.updateAssistantRedisWindow({
    windowId: mongoAdd?.user?.toString(),
    chat: {
      type: mongoAdd?.type || "assistant",
      message: mongoAdd?.message,
      time: mongoAdd?.createdAt,
    },
  });
  return true;
};

const chatBehavior = async (
  chats: {
    sender_name: string;
    content: string;
    time: Date;
    sender_id: string;
  }[],
) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an analyzer that MUST return exactly one valid JSON object and nothing else. Do NOT include any explanation, markdown, or extra text. The JSON must be parseable by JSON.parse. Use the following schema exactly:

{
  "isCompleted": boolean,
  "summarise": [
    { "id": "sender_id", "content": "summary text" },
    { "id": "sender_id", "content": "summary text" }
  ]
}

Strict rules:
- Sort chats by their 'time' value in ascending order before analysis.
- Determine 'isCompleted' using context-aware pattern recognition. Analyze the last 2-4 messages (not just the final one) using these key principles:
  * Pattern Recognition Over Phrase Matching: Look for linguistic patterns indicating natural conclusion, not specific keywords.
  * Response Necessity: Set 'isCompleted' to true only if no further response is logically required or expected.
  * Conversational Momentum: Detect if the conversation is naturally winding down with reduced engagement or clear resolution.
  * Topic Lifecycle: Recognize when all relevant topics are fully addressed, plans are confirmed, or decisions are finalized.
  * Examples of completion: "Great, I'll implement that tomorrow" (commitment made, no response needed), "Thanks for explaining, it makes sense now" (understanding confirmed), "See you at 3pm at the usual place" (plan confirmed, conversation complete).
  * Otherwise, set 'isCompleted' to false.
- For 'summarise', produce an array of objects. Each object contains 'id' (the sender_id) and 'content' (one concise 1-3 sentence chronological summary capturing that sender's contributions, decisions, and actions).
- Do NOT include the sender's own name inside that sender's summary. Instead, write that sender's summary from the sender's perspective using first-person pronouns (I, me, my, we, etc.). It is acceptable to refer to other participants by name or neutral descriptors.
- Do not add any additional keys, metadata, or surrounding text.
- If a field cannot be determined, use 'false' for booleans and an empty array for summarise.
`,
      },
      {
        role: "user",
        content: `Analyze the following chats and return ONLY the JSON object described in the system prompt. Do NOT include any other text. Chats: ${JSON.stringify(chats)}`,
      },
    ],
  });

  return response?.choices[0]?.message?.content;
};
const chatBehaviorAssistant = async (
  chats: {
    type: string; // 'me' or 'assistant'
    message: string;
    time: string;
  }[],
) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an analyzer that MUST return exactly one valid JSON object and nothing else. Do NOT include any explanation, markdown, or extra text. The JSON must be parseable by JSON.parse. Use the following schema exactly:

{
  "isCompleted": boolean,
  "summarise": "summary text"
}

Strict rules:
- Sort chats by their 'time' value in ascending order before analysis.
- Determine 'isCompleted' using context-aware pattern recognition. Analyze the last 2-4 messages (not just the final one) using these key principles:
  * Pattern Recognition Over Phrase Matching: Look for linguistic patterns indicating natural conclusion, not specific keywords.
  * Response Necessity: Set 'isCompleted' to true only if no further response is logically required or expected.
  * Conversational Momentum: Detect if the conversation is naturally winding down with reduced engagement or clear resolution.
  * Topic Lifecycle: Recognize when all relevant topics are fully addressed, plans are confirmed, or decisions are finalized.
  * Examples of completion: "Great, I'll implement that tomorrow" (commitment made, no response needed), "Thanks for explaining, it makes sense now" (understanding confirmed), "See you at 3pm at the usual place" (plan confirmed, conversation complete).
  * Otherwise, set 'isCompleted' to false.
- For 'summarise', produce ONE concise 2-4 sentence summary from "me"'s perspective (first-person). Include what "me" shared/discussed and how the assistant responded. Write as if you are the user reflecting on the conversation.
- Do NOT mention that one party is an "assistant" or "AI". Refer to them naturally (e.g., "they" or use context-appropriate pronouns).
- Do not add any additional keys, metadata, or surrounding text.
- If a field cannot be determined, use 'false' for booleans and an empty string for summarise.
`,
      },
      {
        role: "user",
        content: `Analyze the following chats and return ONLY the JSON object described in the system prompt. Do NOT include any other text. Chats: ${JSON.stringify(chats)}`,
      },
    ],
  });

  return response?.choices[0]?.message?.content;
};
const updateChat = async ({
  conversationId,
  userId,
  relation,
}: {
  conversationId: string;
  userId: string;
  relation: string;
}) => {
  const raw = await redisClient.get(conversationId);
  let currentWindow: any[] = [];

  if (raw) {
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          currentWindow = parsed;
        } else {
          logger.warn(
            `Redis key ${conversationId} contained non-array value, resetting window.`,
          );
          currentWindow = [];
        }
      } catch (err) {
        logger.warn(
          `Failed to parse redis key ${conversationId}, resetting window.`,
          err,
        );
        currentWindow = [];
      }
    } else if (Array.isArray(raw)) {
      currentWindow = raw;
    } else {
      logger.warn(
        `Redis key ${conversationId} contained non-array value, resetting window.`,
      );
      currentWindow = [];
    }
  }
  if (currentWindow.length >= 15) {
    const summariesString: any = await chatBehavior(currentWindow);
    const summaries = JSON.parse(summariesString);
    console.log("Is chat complete:" + summaries?.isCompleted);
    if (summaries?.isCompleted === true) {
      let userData = summaries?.summarise.find(
        (user: any) => user?.id === userId?.toString(),
      );
      const vector = await embedding(userData?.content || "");
      PineconeCollections.saveChat({
        id: new mongoose.Types.ObjectId().toString(),
        senderId: userData?.id,
        conversationId: conversationId,
        chat: userData?.content || "",
        relation: relation || "Unknown",
        vector,
      });
    }
  }
};
export const OpenAIService = {
  embedding,
  chatWithAI,
  enhanceWithAI,
  genarateAiResponses,
  genarateAssistantResponses,
  chatBehavior,
  updateChat,
  chatBehaviorAssistant,
};
