import { PineconeCollections } from "../DB/pinecone";
import redisClient from "./Redis";
import { logger } from "../logger/logger";
import mongoose from "mongoose";
import { openai, embedding } from "./openAIClient";
import { safeJsonParse } from "./safeJson";
import { CompanionService } from "../modules/Assistant/companion.service";
import {
  TwinIdentity,
  renderProfileFacts,
} from "../modules/Assistant/twin.identity";
import { AssistantMemoryService } from "../modules/Assistant/assistantMemory.service";
import {
  detectProfileQuery,
  isSelfDescriptionQuery,
} from "../modules/Assistant/relationship.lexicon";
import {
  buildTwinMessages,
  renderAboutOwner,
  TWIN_PROMPT_VERSION,
} from "../modules/Assistant/twin.prompt";
import { logTwinRequest } from "../modules/Assistant/companion.trace";

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
/**
 * Generates one Twin reply: the AI answering in the voice of the Twin owner.
 *
 * The owner is the person whose AI mode is on (the message receiver); the
 * speaker is whoever sent the message. See twin.identity.ts for why those are
 * resolved explicitly rather than passed as pre-paired names.
 */
const genarateAiResponses = async ({
  chatQuery,
  journalQuery,
  textPrompt,
  recentMessage,
  userId,
  speakerId,
  owner_name,
  speaker_name,
}: {
  chatQuery: any;
  journalQuery: any;
  recentMessage: any;
  textPrompt: string;
  /** The Twin owner - whose memories are in scope and whose voice is used. */
  userId: string;
  /** The person currently talking to the Twin. */
  speakerId: string;
  owner_name?: string;
  speaker_name?: string;
}) => {
  const ownerId = userId?.toString();

  // Identities and structured facts are resolved before any semantic lookup:
  // stable relationship facts must not depend on cosine similarity.
  const [identities, structuredFacts] = await Promise.all([
    TwinIdentity.resolveTwinIdentities({
      ownerId,
      speakerId: speakerId?.toString(),
      ownerNameHint: owner_name,
      speakerNameHint: speaker_name,
    }),
    AssistantMemoryService.retrieveStructuredFacts({
      userId: ownerId,
      queryText: textPrompt,
    }),
  ]);

  // A direct question about a stored profile field is answered from the
  // account, not from semantic recall.
  const profileAsked = detectProfileQuery(textPrompt);
  const profileBlock = profileAsked.length
    ? renderProfileFacts(identities.owner.profileFacts, "Your")
    : null;

  // "Tell me about yourself" is answered from verified material only.
  let aboutOwner: string | null = null;
  if (isSelfDescriptionQuery(textPrompt)) {
    const [allRelationships, profileMemories] = await Promise.all([
      AssistantMemoryService.getRelationshipFacts({
        userId: ownerId,
        types: null,
      }),
      AssistantMemoryService.getProfileMemories({ userId: ownerId }),
    ]);
    aboutOwner = renderAboutOwner({
      identities,
      relationshipFacts: allRelationships,
      profileMemories,
    });
  }

  // One embedding of the incoming message drives all three lookups. It must
  // come from the same model that wrote the stored vectors - see the warning in
  // src/DB/pinecone.ts.
  const queryVector = await embedding(textPrompt);

  const [assistantHits, chatHits, journalHits] = await Promise.all([
    PineconeCollections.queryByVector(PineconeCollections.memoryCollection, {
      vector: queryVector,
      topK: 10,
      filter: { user: ownerId },
    }).catch((err) => {
      logger.error("assistant memory lookup failed", err);
      return [];
    }),
    PineconeCollections.queryByVector(PineconeCollections.chatCollection, {
      vector: queryVector,
      topK: 10,
      filter: chatQuery,
    }).catch((err) => {
      logger.error("chat memory lookup failed", err);
      return [];
    }),
    PineconeCollections.queryByVector(PineconeCollections.journalCollection, {
      vector: queryVector,
      topK: 5,
      filter: journalQuery,
    }).catch((err) => {
      logger.error("journal memory lookup failed", err);
      return [];
    }),
  ]);

  const memoryContext = assistantHits.map((res) => ({
    memory: res.metadata?.canonical_text || res.metadata?.summaries || "",
    time: res.metadata?.createdAt,
  }));

  // Label each past message with who actually said it.
  const chatContext = chatHits.map((res) => {
    const fromOwner = res.metadata?.senderId === ownerId;
    return {
      [fromOwner ? identities.owner.name : identities.speaker.name]:
        res.metadata?.chat || res.metadata?.message || "",
      time: res.metadata?.createdAt,
    };
  });

  const journalContext = journalHits.map((res) => ({
    journalTitle: res.metadata?.title,
    content: res.metadata?.content,
    createdAt: res.metadata?.createdAt,
  }));

  logTwinRequest({
    ownerId,
    speakerId: speakerId?.toString(),
    promptVersion: TWIN_PROMPT_VERSION,
    relationship: identities.relationship,
    structuredAsked: structuredFacts.asked,
    structuredMatched: structuredFacts.matched.map((f) => f.id),
    profileAsked,
    selfDescription: Boolean(aboutOwner),
    memoryIds: assistantHits.map((h) => h.id),
    journalMemoryIds: journalHits.map((h) => h.id),
  });

  const response = await openai.chat.completions.create({
    model: process.env.TWIN_MODEL || "gpt-4o",
    temperature: 0.8,
    presence_penalty: 0.3,
    frequency_penalty: 0.3,
    messages: buildTwinMessages({
      identities,
      structuredFacts,
      profileBlock,
      aboutOwner,
      recentMessage,
      chatContext,
      journalContext,
      memoryContext,
      textPrompt,
    }),
  });

  return response?.choices[0]?.message?.content;
};

/**
 * @deprecated Kept as a thin delegate so existing callers keep working.
 * The Companion flow now lives in `CompanionService.companionReply`, which
 * implements the request flow of the Companion specification (section 11).
 * `chatQuery` and `journalQuery` are no longer needed - retrieval is scoped to
 * the authenticated user inside the memory service.
 */
const genarateAssistantResponses = async ({
  textPrompt,
  userId,
  user_name,
}: {
  chatQuery?: any;
  journalQuery?: any;
  textPrompt: string;
  userId: string;
  user_name: string;
}) => {
  await CompanionService.companionReply({
    userId,
    userName: user_name,
    textPrompt,
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
    response_format: { type: "json_object" },
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
    response_format: { type: "json_object" },
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
    const summaries = safeJsonParse<any>(summariesString, "chatBehavior");
    if (!summaries) return;
    console.log("Is chat complete:" + summaries?.isCompleted);
    if (summaries?.isCompleted === true) {
      const userData = summaries?.summarise?.find(
        (user: any) => user?.id === userId?.toString(),
      );
      if (!userData?.content) return;
      const vector = await embedding(userData.content);
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
