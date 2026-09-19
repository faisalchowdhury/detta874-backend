import { openai } from "../../utils/openAIClient";
import { safeJsonParse } from "../../utils/safeJson";
import { logger } from "../../logger/logger";
import { TChatTurn } from "./companion.prompt";
import {
  TMemoryCandidate,
  TRetrievedMemory,
} from "./assistantMemory.service";

export const EXTRACTION_MODEL =
  process.env.COMPANION_EXTRACTION_MODEL || "gpt-4o";

const EXTRACTION_SYSTEM_PROMPT = `You extract durable personal memories from a conversation so a companion can remember this user accurately later.

Return exactly one valid JSON object and nothing else. It must be parseable by JSON.parse and must match this schema:

{
  "save": boolean,
  "memories": [
    {
      "type": "person" | "relationship" | "event" | "preference" | "goal" | "place" | "project" | "belief" | "other",
      "canonical_text": "one concise third-person statement of the fact",
      "importance": 0.0-1.0,
      "confidence": 0.0-1.0,
      "entities": ["..."],
      "event_date": null or "YYYY-MM-DD",
      "is_correction": boolean,
      "corrects_memory_id": null or an id from EXISTING_MEMORIES
    }
  ]
}

WHAT TO SAVE
- Stable personal facts: family, close friends, occupation, important places, significant dates, recurring goals.
- Meaningful events and stories the user is intentionally sharing.
- Long-running projects, ambitions, accomplishments, major setbacks.
- Preferences that would make future conversation more natural.
- Corrections to something in EXISTING_MEMORIES.
- Emotionally meaningful memories that clearly matter beyond this conversation.

WHAT NOT TO SAVE
- Passing states: "I'm hungry", "traffic is bad", "I'm watching TV", "I'm tired right now".
- Anything the assistant said about itself, or instructions about how to talk.
- Anything already stated in EXISTING_MEMORIES with no new detail. If the user adds detail to an existing memory, restate the fuller fact and keep a high confidence.
- Speculation. Only record what the user actually said. Never infer a relationship, name, date, or event that was not stated.

RULES
- canonical_text must be self-contained and understandable years later, written about the user in the third person. Resolve pronouns using the conversation. Example: "User is writing a novel about twelve young men on a mission from God."
- If the user contradicts or corrects something in EXISTING_MEMORIES, set is_correction to true and set corrects_memory_id to that memory's id.
- importance reflects how much this matters to the user's life, not how recent it is.
- confidence reflects how clearly the user stated it.
- If nothing durable was shared, return {"save": false, "memories": []}.
- Never return more than 4 memories for one exchange.`;

export type TExtractionResult = {
  save: boolean;
  memories: TMemoryCandidate[];
};

/**
 * Structured memory extraction (spec section 7.3).
 *
 * Runs after the reply has already been streamed to the user, so it never adds
 * latency to the response path. `existingMemories` is the set that was supplied
 * to the reply, which is what lets the model emit `corrects_memory_id`.
 */
export const extractMemories = async ({
  recent,
  currentMessage,
  assistantReply,
  existingMemories,
}: {
  recent: TChatTurn[];
  currentMessage: string;
  assistantReply: string;
  existingMemories: TRetrievedMemory[];
}): Promise<TExtractionResult> => {
  const nothing: TExtractionResult = { save: false, memories: [] };
  if (!currentMessage?.trim()) return nothing;

  const existing = existingMemories.length
    ? existingMemories
        .map((m) => `- [${m.id}] ${m.canonical_text}`)
        .join("\n")
    : "(none)";

  const transcript = [
    ...recent.slice(-8),
    { role: "user" as const, content: currentMessage },
    ...(assistantReply
      ? [{ role: "assistant" as const, content: assistantReply }]
      : []),
  ]
    .map((turn) => `${turn.role === "user" ? "User" : "Companion"}: ${turn.content}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: EXTRACTION_MODEL,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `EXISTING_MEMORIES:\n${existing}\n\nCONVERSATION:\n${transcript}\n\nExtract durable memories from the latest User turn, using the earlier turns only to resolve references. Return only the JSON object.`,
        },
      ],
    });

    const parsed = safeJsonParse<TExtractionResult>(
      response?.choices?.[0]?.message?.content,
      "memory extraction",
    );

    if (!parsed || parsed.save !== true || !Array.isArray(parsed.memories)) {
      return nothing;
    }

    return { save: true, memories: parsed.memories.slice(0, 4) };
  } catch (err) {
    logger.error("extractMemories failed", err);
    return nothing;
  }
};

/**
 * Same extraction pass, applied to a journal entry so journal-derived facts
 * land in the unified memory store alongside companion-derived ones
 * (spec sections 7 and 20).
 */
export const extractJournalMemories = async ({
  title,
  content,
  existingMemories,
}: {
  title: string;
  content: string;
  existingMemories: TRetrievedMemory[];
}): Promise<TExtractionResult> => {
  const nothing: TExtractionResult = { save: false, memories: [] };
  if (!content?.trim()) return nothing;

  const existing = existingMemories.length
    ? existingMemories
        .map((m) => `- [${m.id}] ${m.canonical_text}`)
        .join("\n")
    : "(none)";

  try {
    const response = await openai.chat.completions.create({
      model: EXTRACTION_MODEL,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `EXISTING_MEMORIES:
${existing}

JOURNAL_ENTRY
Title: ${title || "(untitled)"}
Body:
${content}

Extract durable memories the user wrote about themselves in this journal entry. Return only the JSON object.`,
        },
      ],
    });

    const parsed = safeJsonParse<TExtractionResult>(
      response?.choices?.[0]?.message?.content,
      "journal memory extraction",
    );

    if (!parsed || parsed.save !== true || !Array.isArray(parsed.memories)) {
      return nothing;
    }

    return { save: true, memories: parsed.memories.slice(0, 6) };
  } catch (err) {
    logger.error("extractJournalMemories failed", err);
    return nothing;
  }
};
