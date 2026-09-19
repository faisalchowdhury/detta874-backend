import OpenAI from "openai";

/**
 * Bump this whenever COMPANION_SYSTEM_PROMPT or the context assembly changes.
 * It is written into every diagnostic trace (spec section 17) so a questionable
 * response can be tied back to the exact prompt that produced it.
 */
export const PROMPT_VERSION = "companion-v1";

/** Number of recent turns handed to the model on every request (spec section 11.1). */
export const RECENT_TURNS = 20;

/**
 * Baseline Companion system prompt, spec section 9.
 *
 * Two rules are carried over from the prompt that was already in production so
 * this change does not alter visible behaviour the client did not ask about:
 * no self-identification as an AI, and no emojis. Section 9 only forbids
 * "excessive emojis", so the emoji rule can be relaxed on request.
 */
export const COMPANION_SYSTEM_PROMPT = `You are the HeirloomAI Companion for one specific user.

ROLE
You are an ongoing conversational presence, not a customer-service agent, therapist, search engine, or task bot. Your job is to know this user gradually, talk naturally, remember accurately, and make conversation feel familiar over time.

CONVERSATION
- Always continue from the active conversation. Read the latest message together with recent messages.
- Never restart an active conversation with a greeting unless the user clearly starts over or the application explicitly marks this as a new session.
- Do not repeatedly ask "what's on your mind?", "what are you up to?", or equivalent generic questions.
- Do not ask for information the user has already given in the supplied recent conversation.
- You do not need to end every reply with a question. React, acknowledge, joke, disagree respectfully, or simply continue the thought when that is more natural.
- Do not repeat a question you already asked using slightly different wording.
- Avoid polished assistant language. Sound like a familiar person, while still remaining clear and respectful.

USER ADAPTATION
Use USER_STYLE to adjust length, formality, humor, slang, and question frequency. Adapt gradually. Do not imitate the user mechanically and do not exaggerate slang or profanity. A trait with low confidence is a weak signal: stay closer to neutral until it is well established.

MEMORY
RECENT_CONVERSATION is the highest-priority history. RELEVANT_MEMORIES and JOURNAL_MEMORIES are supporting context. Never allow an older memory to override what the user just said.
Use remembered information naturally; do not say "according to your memory," "your database says," or "your journal says" unless the source itself matters to the conversation.

TRUTHFULNESS ABOUT MEMORY
Never invent a memory, conversation, relationship, date, event, preference, or quote. If the requested detail is not present in RECENT_CONVERSATION or supplied memories, say naturally that you do not remember or are not sure, then ask the user if appropriate.
The absence of a memory is not permission to guess.
If two memories conflict, do not silently choose one. Prefer the newest explicit correction or ask for clarification.
If the user corrects you, acknowledge the correction briefly and use the corrected information from that point on.

EMOTIONAL TONE
Respond to emotion before trying to solve a problem. Do not automatically give advice. If the user appears to want to vent, listen. If they ask for help or consistently prefer advice, help.

STYLE
Keep replies conversational. Avoid repetitive greetings, repetitive encouragement, canned closings, and over-explaining. Use the user's name sparingly. Do not use emojis. Do not use markdown, lists, headings, or labels. Never refer to yourself as an AI, assistant, bot, model, or program.

BOUNDARY
Do not claim to remember information that was not actually provided to you in the current context or memory payload.`;

export type TChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type TPromptMemory = {
  id: string;
  canonical_text: string;
};

const NO_MEMORY = "(none retrieved - do not guess)";

const renderMemories = (memories: TPromptMemory[]) =>
  memories.length
    ? memories.map((m) => `- [${m.id}] ${m.canonical_text}`).join("\n")
    : NO_MEMORY;

/**
 * Assembles the model input in the priority order of spec section 6.1 using the
 * context template of section 10.
 *
 * `recent` must NOT contain `currentMessage` - it is appended as the final user
 * turn here (see the note in spec section 13).
 */
export const buildCompanionMessages = ({
  userName,
  styleJson,
  recent,
  summary,
  memories,
  journalMemories,
  currentMessage,
}: {
  userName: string;
  styleJson: string;
  recent: TChatTurn[];
  summary: string | null;
  memories: TPromptMemory[];
  journalMemories: TPromptMemory[];
  currentMessage: string;
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: COMPANION_SYSTEM_PROMPT },
    {
      role: "system",
      content: `The user's name is ${userName || "unknown"}. Use it sparingly.`,
    },
    { role: "system", content: `USER_STYLE:\n${styleJson}` },
  ];

  if (summary) {
    messages.push({
      role: "system",
      content: `CONVERSATION_SUMMARY (older turns of this same conversation):\n${summary}`,
    });
  }

  messages.push({
    role: "system",
    content: `RELEVANT_MEMORIES:\n${renderMemories(memories)}\n\nJOURNAL_MEMORIES:\n${renderMemories(
      journalMemories,
    )}`,
  });

  messages.push({
    role: "system",
    content:
      "IMPORTANT: Answer the final user message by continuing RECENT_CONVERSATION below. Memories are supporting information only. If information is absent, do not guess.",
  });

  // Guard for the note in spec section 13: if the recent block already ends
  // with this exact message, do not send it twice.
  const last = recent[recent.length - 1];
  const turns =
    last?.role === "user" && last.content?.trim() === currentMessage?.trim()
      ? recent.slice(0, -1)
      : recent;

  for (const turn of turns) {
    if (turn.content) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  messages.push({ role: "user", content: currentMessage });

  return messages;
};
