import { logger } from "../logger/logger";

/**
 * Parses JSON returned by a model without throwing.
 *
 * Even with `response_format: { type: "json_object" }` a response can arrive
 * empty (truncation, refusal, transport error), and older calls without that
 * option sometimes wrap the object in a ```json fence. An unguarded
 * `JSON.parse` on either aborts the whole request, so every model-produced JSON
 * payload goes through here.
 */
export const safeJsonParse = <T>(raw: unknown, context: string): T | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1)) as T;
      } catch {
        /* fall through to the warning below */
      }
    }
    logger.warn(
      `safeJsonParse: could not parse model JSON in ${context}: ${text.slice(0, 200)}`,
    );
    return null;
  }
};
