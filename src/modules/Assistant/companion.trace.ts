import { logger } from "../../logger/logger";

/**
 * Diagnostic trace for one Companion request (spec section 17).
 *
 * Deliberately records identifiers and counts only - never message bodies,
 * API keys or auth tokens (spec section 18). It exists to answer: "what exact
 * conversation turns and memory IDs did the model receive for this response?"
 */
export type TCompanionTrace = {
  userId: string;
  conversationId: string;
  promptVersion: string;
  model: string;
  recentTurnCount: number;
  summaryUsed: boolean;
  summaryUpdatedAt: string | null;
  memoryIds: string[];
  journalMemoryIds: string[];
  startedAt: number;
  windowSource: "redis" | "mongo";
};

export const logCompanionRequest = (
  trace: TCompanionTrace,
  outcome: {
    status: "ok" | "error";
    responseChars?: number;
    error?: unknown;
  },
) => {
  const payload = {
    event: "companion.request",
    user_id: trace.userId,
    conversation_id: trace.conversationId,
    prompt_version: trace.promptVersion,
    model: trace.model,
    recent_turns: trace.recentTurnCount,
    window_source: trace.windowSource,
    summary_used: trace.summaryUsed,
    summary_updated_at: trace.summaryUpdatedAt,
    memory_ids: trace.memoryIds,
    journal_memory_ids: trace.journalMemoryIds,
    latency_ms: Date.now() - trace.startedAt,
    status: outcome.status,
    response_chars: outcome.responseChars ?? 0,
  };

  if (outcome.status === "ok") {
    logger.info(`companion.request ${JSON.stringify(payload)}`);
  } else {
    logger.error(
      `companion.request ${JSON.stringify(payload)}`,
      outcome.error,
    );
  }
};

/** Logged after the asynchronous memory-extraction pass (spec section 17). */
export const logMemoryExtraction = (
  userId: string,
  conversationId: string,
  outcomes: { id: string; action: string }[],
) => {
  logger.info(
    `companion.memory ${JSON.stringify({
      event: "companion.memory_extraction",
      user_id: userId,
      conversation_id: conversationId,
      results: outcomes,
    })}`,
  );
};
