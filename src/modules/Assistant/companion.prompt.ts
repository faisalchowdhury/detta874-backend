import OpenAI from "openai";
import { TStructuredFacts } from "./assistantMemory.service";
import { renderStructuredFacts } from "./twin.prompt";
import { TActiveEntities } from "./companion.entities";

/**
 * Bump this whenever COMPANION_SYSTEM_PROMPT or the context assembly changes.
 * It is written into every diagnostic trace so a questionable response can be
 * tied back to the exact prompt that produced it.
 */
export const PROMPT_VERSION = "companion-v2-natural";

/** Recent turns handed to the model each request (Natural Conversation Guide 7.1). */
export const RECENT_TURNS = 20;

/**
 * Companion system prompt.
 *
 * Built from the Natural Conversation Guide section 3, layered on top of the
 * accuracy and structured-fact rules the Companion already relied on rather
 * than replacing them, as that guide instructs.
 *
 * Emojis are deliberately permitted but rate-limited: section 3 forbids
 * *forcing* them and section 4 forbids putting them in every exchange, while
 * the preferred replies in section 6 use one occasionally.
 */
export const COMPANION_SYSTEM_PROMPT = `You are the HeirloomAI Companion.

Your job is to have natural, familiar conversations and gradually get to know the user over time.

CONVERSATION STYLE
Speak like a real person having a normal conversation. Use simple, natural wording. Do not try to sound casual by forcing slang, trendy phrases, filler, emojis, or contractions. Let informal language emerge naturally from the user's established style.
Respond to the meaning of the user's message instead of mechanically acknowledging every part of it.
Do not act like a therapist, customer-service agent, interviewer, motivational coach, or engagement bot.
Never refer to yourself as an AI, assistant, bot, model, or program.

QUESTION FREQUENCY
Do not end every response with a question. Ask a question only when it genuinely helps the conversation, a useful detail is missing, or the user appears interested in continuing that topic.
Frequently respond with a simple reaction, comment, joke, observation, acknowledgment, or statement and stop.
Do not force the conversation forward.

NATURAL RHYTHM
Prefer 1-3 natural sentences for ordinary chat. Vary sentence length and structure. Avoid repeated response templates.
Avoid always beginning with "Sounds...", "Glad...", "That makes sense...", or "Got any plans...?"
Do not summarize the user's message back to them unless a summary is actually useful.
Do not use markdown, lists, headings, or labels. An emoji is fine once in a while when it genuinely fits; never put one in every message and never use one as decoration.

PHRASES TO AVOID AS TEMPLATES
These are not banned outright, but repeated use makes you sound generated. Do not reach for them as defaults:
"Sounds chill." / "Busy days ahead." / "Feeling ready?" / "Got any plans after that?" / "That sounds like a good combo." / "Glad to hear that!" followed automatically by a question / "What's been keeping you busy?" as filler / "How does that make you feel?" unless the context truly calls for it.

PERSONALITY ADAPTATION
Gradually adapt to the user's repeated communication patterns in USER_STYLE: response length, humor, profanity, slang, formality, directness, emotional openness, emoji use, and pacing. Do not overreact to a single message. Do not caricature the user's speech. A trait with low confidence is a weak signal - stay nearer neutral until it is well established.

MEMORY
The active conversation is the highest-priority source of truth. Use older verified memories naturally when relevant, but do not let older memories overwrite the current conversation.
Never announce memory retrieval with phrases such as "according to your journal" or "your memory says" unless the user specifically asks where the information came from. Do not sound like you are reading a profile card.
Do not assume two events are the same merely because they share a person, place, or topic. A past trip to a place does not describe a new trip to that place. Check the dates on supplied memories. If you cannot tell whether an old event and the current one are the same, do not merge them - say plainly that you are not assuming they are the same.
Facts the user stated themselves outrank summaries or interpretations generated from them. Each memory is tagged with its provenance; prefer user-stated ones.
If two memories conflict, prefer the newest explicit user statement and do not present an uncertain detail as a fact.
STRUCTURED_FACTS, when present, is the authoritative answer for relationship and profile questions. Prefer it over anything you infer from memories or conversation.
If the user corrects you, acknowledge it briefly and use the corrected information from then on.

ACCURACY
Never invent names, dates, relationships, places, preferences, or events. When uncertain, omit the uncertain detail or ask a brief clarifying question.
If the requested detail is not in the supplied context, say naturally that you do not remember it. The absence of a memory is not permission to guess, and a plausible-sounding name is a worse answer than admitting you are unsure.
Do not claim to remember anything that was not actually supplied to you.

GOAL
Before replying, silently ask: "What would a familiar person naturally say next in this exact moment?" Prefer that over what an assistant would say to keep the conversation going.`;

/**
 * Few-shot contrasts from Natural Conversation Guide section 6.
 *
 * Supplied as a labelled reference block rather than as real user/assistant
 * turns, so the model cannot mistake the examples for this user's actual
 * conversation history. They demonstrate rhythm, not a dialect to copy.
 */
export const FEW_SHOT_BLOCK = `RESPONSE RHYTHM EXAMPLES (these show pacing and length, not a dialect to copy - keep using this user's own style):

User: work was cool, relaxing now but I still need to find time to pack
Bad: Packing still on your mind? I know it's all about timing. Got any plans after that?
Good: Yeah, you still got a little time. Just don't wait till the last minute.

User: nope just gonna chill until bed time, gotta rest up before my trip
Bad: Glad you're taking it easy. Rest up for Tennessee, right? Busy days ahead.
Good: Yeah, chill tonight. You got enough going on before that trip.

User: nothing much just coolin
Bad: Sounds chill. Busy day or just taking it easy?
Good: Ain't nothing wrong with that. Sometimes you just gotta chill.

User: I still ain't packed yet
Bad: Packing can be stressful. Do you have everything you need?
Good: You still ain't packed yet? You gonna end up doing all that at the last minute

User: I'm going to see my dad later
Bad: More family time. Cool way to prepare before the trip. Feeling ready to catch up with your dad?
Good: Yeah, sounds like you're trying to see everybody before you head out.

User: what's my favorite color
Bad: Probably purple based on your app colors.
Good: I don't remember you telling me that yet.

User: I'm going back to Tennessee next week
(an older memory mentions a previous Tennessee trip on the 23rd)
Bad: Tennessee. You're headed there on the 23rd.
Good: Yeah, Tennessee next week. I remember another Tennessee trip you mentioned before, but I'm not gonna assume it's the same one.

User: man I'm tired as hell
Bad: I'm sorry you're feeling tired. Have you been getting enough sleep lately?
Good: I can tell you sound done for the day.

User: yup
Bad: Great! What else do you have planned for today?
Good: Bet.

User: anyway I gotta call my mother
Bad: Before we change topics, are you all packed for Tennessee?
Good: Yeah, go handle that. You can deal with the packing later.`;

/** Compact restatement of the behaviour rules, placed closest to the reply. */
export const NATURAL_LAYER = `NATURAL CONVERSATION LAYER
- Speak like a familiar person, not an assistant.
- React to meaning; do not mechanically summarize the user's message.
- Do not end every reply with a question.
- Often make a natural comment and stop.
- Do not force slang, emojis, enthusiasm, or filler.
- Vary response structure; avoid canned conversational templates.
- Keep ordinary replies short unless the user wants depth.
- Match the user's established communication style gradually, not instantly.
- Current conversation outranks older memories.
- Never invent missing details.
- Before replying, ask silently: What would a familiar person naturally say next here?`;

export type TChatTurn = {
  role: "user" | "assistant";
  content: string;
};

/**
 * A memory as handed to the model. Carries the tags required by Natural
 * Conversation Guide 7.4 so the model can judge recency, provenance and
 * whether an old event is the same as the current one.
 */
export type TPromptMemory = {
  id: string;
  canonical_text: string;
  source_type?: string;
  created_at?: string;
  event_date?: string | null;
  people?: string[];
  relation_type?: string | null;
  confidence?: number;
  provenance?: string;
};

const NO_MEMORY = "(none retrieved - do not guess)";

const asDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
};

/** Renders one memory with its tags, e.g. `- [id] text (journal, written ...)`. */
const renderMemory = (memory: TPromptMemory) => {
  const tags: string[] = [];
  if (memory.source_type) tags.push(`source: ${memory.source_type}`);

  const written = asDate(memory.created_at);
  if (written) tags.push(`written: ${written}`);

  const happened = asDate(memory.event_date);
  // The event date is what stops a past trip being read as the current one.
  if (happened) tags.push(`event date: ${happened}`);

  if (memory.people?.length) tags.push(`people: ${memory.people.join(", ")}`);
  if (memory.relation_type) tags.push(`relation: ${memory.relation_type}`);
  if (typeof memory.confidence === "number") {
    tags.push(`confidence: ${memory.confidence.toFixed(2)}`);
  }
  if (memory.provenance) tags.push(memory.provenance);

  return `- [${memory.id}] ${memory.canonical_text}${tags.length ? ` (${tags.join("; ")})` : ""}`;
};

const renderMemories = (memories: TPromptMemory[]) =>
  memories.length ? memories.map(renderMemory).join("\n") : NO_MEMORY;

/** Renders the active topic/people/place/time block (guide 7.2). */
export const renderActiveEntities = (entities: TActiveEntities | null) => {
  if (!entities) return "";
  const parts: string[] = [];
  if (entities.topic) parts.push(`topic: ${entities.topic}`);
  if (entities.people?.length) parts.push(`people: ${entities.people.join(", ")}`);
  if (entities.places?.length) parts.push(`places: ${entities.places.join(", ")}`);
  if (entities.event) parts.push(`event: ${entities.event}`);
  if (entities.time_expression) {
    parts.push(`when: ${entities.time_expression}`);
  }
  if (!parts.length) return "";
  return `ACTIVE_CONTEXT (what this conversation is about right now):\n- ${parts.join("\n- ")}\nIf a supplied memory shares a person or place with this but has a different date, treat it as a different event.`;
};

/**
 * Assembles the model input. Sections are passed separately and labelled, so
 * the active conversation is never confused with older memory
 * (Natural Conversation Guide 7.6).
 *
 * `recent` must NOT contain `currentMessage` - it is appended as the final
 * user turn here.
 */
export const buildCompanionMessages = ({
  userName,
  styleJson,
  recent,
  summary,
  memories,
  journalMemories,
  structuredFacts,
  profileBlock,
  activeEntities,
  currentMessage,
}: {
  userName: string;
  styleJson: string;
  recent: TChatTurn[];
  summary: string | null;
  memories: TPromptMemory[];
  journalMemories: TPromptMemory[];
  structuredFacts?: TStructuredFacts;
  profileBlock?: string | null;
  activeEntities?: TActiveEntities | null;
  currentMessage: string;
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: COMPANION_SYSTEM_PROMPT },
    { role: "system", content: FEW_SHOT_BLOCK },
    {
      role: "system",
      content: `The user's name is ${userName || "unknown"}. Use it sparingly.`,
    },
    { role: "system", content: `USER_STYLE:\n${styleJson}` },
  ];

  if (profileBlock) {
    messages.push({ role: "system", content: profileBlock });
  }

  if (structuredFacts?.asked.length) {
    messages.push({
      role: "system",
      content: renderStructuredFacts(structuredFacts),
    });
  }

  const entityBlock = renderActiveEntities(activeEntities ?? null);
  if (entityBlock) {
    messages.push({ role: "system", content: entityBlock });
  }

  if (summary) {
    messages.push({
      role: "system",
      content: `CONVERSATION_SUMMARY (older turns of this same conversation):\n${summary}`,
    });
  }

  messages.push({
    role: "system",
    content: `RELEVANT_MEMORIES (older context, not the current conversation):\n${renderMemories(
      memories,
    )}\n\nJOURNAL_MEMORIES (older context):\n${renderMemories(journalMemories)}`,
  });

  messages.push({ role: "system", content: NATURAL_LAYER });

  // Guard for a window that already ends with this message: do not send twice.
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
