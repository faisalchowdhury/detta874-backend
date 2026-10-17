import { openai } from "../../utils/openAIClient";
import { safeJsonParse } from "../../utils/safeJson";
import { logger } from "../../logger/logger";
import { TChatTurn } from "./companion.prompt";

/**
 * Active context for the current turn (Natural Conversation Guide 7.2):
 * what is being talked about right now, who and where it involves, and how the
 * user referred to its timing.
 *
 * The time expression matters most. "next week" against a stored memory dated
 * the 23rd is what lets the Companion say "I'm not gonna assume it's the same
 * one" instead of merging two trips to the same place.
 */
export type TActiveEntities = {
  topic: string | null;
  people: string[];
  places: string[];
  event: string | null;
  time_expression: string | null;
};

export const ENTITY_MODEL = process.env.COMPANION_ENTITY_MODEL || "gpt-4o-mini";

/** Set COMPANION_ENTITIES=off to skip this call entirely. */
const ENABLED = (process.env.COMPANION_ENTITIES || "on").toLowerCase() !== "off";

const SYSTEM_PROMPT = `You label what a conversation is currently about. Return exactly one JSON object and nothing else:

{
  "topic": "a few words, or null",
  "people": ["names actually mentioned"],
  "places": ["places actually mentioned"],
  "event": "the specific thing happening, or null",
  "time_expression": "how the user referred to the timing, verbatim (e.g. 'next week', 'later', 'the 23rd'), or null"
}

Rules:
- Use only what appears in the messages. Never infer a name, place or date that was not said.
- Base it on the latest user message, using earlier turns only to resolve references like "it", "there" or "him".
- time_expression must be the user's own words, not a calculated date.
- Use null and empty arrays when something is not present. Do not pad the answer.`;

const asStringArray = (value: unknown, cap = 8): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, cap)
    : [];

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * Extracts the active entities for this turn.
 *
 * Runs on a small model and is called in parallel with memory retrieval, so it
 * adds little to the time before the first streamed token. Any failure returns
 * empty entities rather than blocking the reply.
 */
export const detectActiveEntities = async ({
  recent,
  currentMessage,
}: {
  recent: TChatTurn[];
  currentMessage: string;
}): Promise<TActiveEntities | null> => {
  if (!ENABLED || !currentMessage?.trim()) return null;

  const transcript = [...recent.slice(-6), { role: "user" as const, content: currentMessage }]
    .map((turn) => `${turn.role === "user" ? "User" : "Companion"}: ${turn.content}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: ENTITY_MODEL,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    });

    const parsed = safeJsonParse<Record<string, unknown>>(
      response?.choices?.[0]?.message?.content,
      "active entities",
    );
    if (!parsed) return null;

    const entities: TActiveEntities = {
      topic: asString(parsed.topic),
      people: asStringArray(parsed.people),
      places: asStringArray(parsed.places),
      event: asString(parsed.event),
      time_expression: asString(parsed.time_expression),
    };

    const empty =
      !entities.topic &&
      !entities.event &&
      !entities.time_expression &&
      !entities.people.length &&
      !entities.places.length;

    return empty ? null : entities;
  } catch (err) {
    logger.warn("detectActiveEntities failed", err);
    return null;
  }
};
