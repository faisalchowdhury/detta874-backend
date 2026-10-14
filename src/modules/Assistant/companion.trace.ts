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
  structuredAsked: string[];
  structuredMatched: string[];
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
    structured_asked: trace.structuredAsked,
    structured_matched: trace.structuredMatched,
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

/**
 * Diagnostic trace for one Twin reply.
 *
 * Records the three identities and which structured facts were supplied, so a
 * reply that names the wrong person can be traced to the exact relationship row
 * and memory ids the model was given.
 */
export const logTwinRequest = (trace: {
  ownerId: string;
  speakerId: string;
  promptVersion: string;
  relationship: { speakerToOwner: string | null; ownerToSpeaker: string | null };
  structuredAsked: string[];
  structuredMatched: string[];
  profileAsked: string[];
  selfDescription: boolean;
  memoryIds: string[];
  journalMemoryIds: string[];
}) => {
  logger.info(
    `twin.request ${JSON.stringify({
      event: "twin.request",
      owner_id: trace.ownerId,
      speaker_id: trace.speakerId,
      prompt_version: trace.promptVersion,
      speaker_to_owner: trace.relationship.speakerToOwner,
      owner_to_speaker: trace.relationship.ownerToSpeaker,
      structured_asked: trace.structuredAsked,
      structured_matched: trace.structuredMatched,
      profile_asked: trace.profileAsked,
      self_description: trace.selfDescription,
      memory_ids: trace.memoryIds,
      journal_memory_ids: trace.journalMemoryIds,
    })}`,
  );
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
