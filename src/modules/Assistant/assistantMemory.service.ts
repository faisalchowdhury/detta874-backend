import mongoose from "mongoose";
import { PineconeCollections, TVectorMatch } from "../../DB/pinecone";
import { embedding } from "../../utils/openAIClient";
import { logger } from "../../logger/logger";
import {
  AssistantMemories,
  MEMORY_TYPES,
  TMemorySource,
  TMemoryType,
} from "./assistantMemory.model";

const num = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Retrieval floor. Cosine scores from `text-embedding-3-small` on short
 * memory statements land around 0.10 for unrelated text and 0.20+ for related
 * text, so anything below this is treated as "nothing relevant exists" and no
 * memory block is sent at all (spec section 8, rule 5).
 */
export const MIN_SCORE = num(process.env.COMPANION_MEMORY_MIN_SCORE, 0.18);
/** Similarity at which two extracted facts are considered the same memory. */
export const DEDUP_SCORE = num(process.env.COMPANION_MEMORY_DEDUP_SCORE, 0.86);
export const MIN_IMPORTANCE = num(
  process.env.COMPANION_MEMORY_MIN_IMPORTANCE,
  0.5,
);
export const MIN_CONFIDENCE = num(
  process.env.COMPANION_MEMORY_MIN_CONFIDENCE,
  0.6,
);
/** Spec section 11.1 retrieves at most 8 memories per request. */
export const MEMORY_LIMIT = num(process.env.COMPANION_MEMORY_LIMIT, 8);

export type TRetrievedMemory = {
  id: string;
  canonical_text: string;
  source_type: TMemorySource;
  score: number;
  created_at: string;
};

const normalise = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Legacy records in the `assistantchat` index (written before the unified
 * memory store existed) hold their text in `summaries` and have no
 * `source_type`. They were written with the same OpenAI embedding model, so
 * they stay searchable and are simply treated as companion-chat memories.
 */
const fromUnifiedMatch = (match: TVectorMatch): TRetrievedMemory | null => {
  const text = match.metadata?.canonical_text || match.metadata?.summaries;
  if (!text || typeof text !== "string") return null;
  return {
    id: match.id,
    canonical_text: text,
    source_type: (match.metadata?.source_type as TMemorySource) || "companion_chat",
    score: match.score,
    created_at: match.metadata?.createdAt || "",
  };
};

const fromJournalMatch = (match: TVectorMatch): TRetrievedMemory | null => {
  const content = match.metadata?.content;
  if (!content || typeof content !== "string") return null;
  const title = match.metadata?.title;
  return {
    id: match.id,
    canonical_text: title ? `${title}: ${content}` : content,
    source_type: "journal",
    score: match.score,
    created_at: match.metadata?.createdAt || "",
  };
};

/**
 * Records that a set of memories was used, so stale memories can be identified
 * later. Fire-and-forget: never allowed to delay or fail a reply.
 */
const touchMemories = (ids: string[]) => {
  const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!valid.length) return;
  AssistantMemories.updateMany(
    { _id: { $in: valid } },
    { $set: { last_used_at: new Date() } },
  ).catch((err) => logger.warn("touchMemories failed", err));
};

/**
 * Retrieves the memories relevant to `queryText` for one user.
 *
 * Every query is scoped to the authenticated user id before it reaches the
 * model (spec section 8.1). Reads both the unified memory index and the legacy
 * `journalindex` so journals written before this change remain retrievable.
 */
const retrieveMemories = async ({
  userId,
  queryText,
  limit = MEMORY_LIMIT,
}: {
  userId: string;
  queryText: string;
  limit?: number;
}): Promise<{ memories: TRetrievedMemory[]; journal: TRetrievedMemory[] }> => {
  const empty = { memories: [], journal: [] };
  if (!queryText?.trim() || !userId) return empty;

  try {
    const vector = await embedding(queryText);

    const [unifiedMatches, journalMatches] = await Promise.all([
      PineconeCollections.queryByVector(PineconeCollections.memoryCollection, {
        vector,
        topK: limit * 2,
        filter: { user: userId.toString() },
      }).catch((err) => {
        logger.error("unified memory query failed", err);
        return [] as TVectorMatch[];
      }),
      PineconeCollections.queryByVector(PineconeCollections.journalCollection, {
        vector,
        topK: limit,
        filter: { userId: userId.toString() },
      }).catch((err) => {
        logger.error("journal memory query failed", err);
        return [] as TVectorMatch[];
      }),
    ]);

    const candidates = [
      ...unifiedMatches.map(fromUnifiedMatch),
      ...journalMatches.map(fromJournalMatch),
    ].filter((m): m is TRetrievedMemory => m !== null);

    // Drop anything the model would only be able to guess from, then collapse
    // duplicates that exist in both the unified store and a legacy index.
    const seen = new Set<string>();
    const ranked = candidates
      .filter((m) => m.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .filter((m) => {
        const key = normalise(m.canonical_text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    touchMemories(ranked.map((m) => m.id));

    return {
      memories: ranked.filter((m) => m.source_type !== "journal"),
      journal: ranked.filter((m) => m.source_type === "journal"),
    };
  } catch (err) {
    logger.error("retrieveMemories failed", err);
    return empty;
  }
};

export type TMemoryCandidate = {
  type?: string;
  canonical_text?: string;
  importance?: number;
  confidence?: number;
  entities?: string[];
  event_date?: string | null;
  is_correction?: boolean;
  corrects_memory_id?: string | null;
};

const clamp01 = (value: number | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const asMemoryType = (raw: string | undefined): TMemoryType =>
  MEMORY_TYPES.includes(raw as TMemoryType) ? (raw as TMemoryType) : "other";

/** Marks `oldId` superseded by `newId` and removes its vector (spec section 14). */
const supersede = async (oldId: string, newId: mongoose.Types.ObjectId) => {
  if (!mongoose.Types.ObjectId.isValid(oldId)) return;
  await AssistantMemories.findByIdAndUpdate(oldId, {
    $set: { superseded_by_memory_id: newId, isActive: false },
  });
  // Keep the Mongo row for history, but stop it being retrieved.
  await PineconeCollections.deleteMemory(oldId).catch((err) =>
    logger.warn(`failed to remove superseded vector ${oldId}`, err),
  );
};

export type TUpsertOutcome = {
  id: string;
  action: "inserted" | "merged" | "superseded" | "skipped";
  canonical_text: string;
};

/**
 * Persists extracted facts into the unified memory store.
 *
 * Applies the rules of spec sections 7.3 and 14: threshold gate, semantic
 * de-duplication before insert, merge-with-new-detail instead of a second copy,
 * and supersede-on-correction.
 */
const upsertMemories = async ({
  userId,
  sourceType,
  sourceId,
  candidates,
}: {
  userId: string;
  sourceType: TMemorySource;
  sourceId: string;
  candidates: TMemoryCandidate[];
}): Promise<TUpsertOutcome[]> => {
  const outcomes: TUpsertOutcome[] = [];
  if (!candidates?.length || !userId) return outcomes;

  for (const candidate of candidates) {
    const canonicalText = candidate?.canonical_text?.trim();
    if (!canonicalText) continue;

    const importance = clamp01(candidate.importance, 0.5);
    const confidence = clamp01(candidate.confidence, 0.5);

    // Corrections always persist - they overwrite something already believed.
    const isCorrection = candidate.is_correction === true;
    if (
      !isCorrection &&
      (importance < MIN_IMPORTANCE || confidence < MIN_CONFIDENCE)
    ) {
      outcomes.push({
        id: "",
        action: "skipped",
        canonical_text: canonicalText,
      });
      continue;
    }

    try {
      const vector = await embedding(canonicalText);
      const memoryType = asMemoryType(candidate.type);
      const entities = Array.isArray(candidate.entities)
        ? candidate.entities.filter((e) => typeof e === "string").slice(0, 12)
        : [];
      const eventDate = candidate.event_date
        ? new Date(candidate.event_date)
        : null;
      const validEventDate =
        eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : null;

      // Semantic duplicate / correction target lookup.
      const nearest = await PineconeCollections.queryByVector(
        PineconeCollections.memoryCollection,
        { vector, topK: 5, filter: { user: userId.toString() } },
      ).catch(() => [] as TVectorMatch[]);

      const duplicate = nearest.find(
        (match) =>
          match.score >= DEDUP_SCORE &&
          mongoose.Types.ObjectId.isValid(match.id),
      );

      const correctionTargetId =
        candidate.corrects_memory_id &&
        mongoose.Types.ObjectId.isValid(candidate.corrects_memory_id)
          ? candidate.corrects_memory_id
          : isCorrection && duplicate
            ? duplicate.id
            : null;

      // A correction replaces the old fact rather than merging into it.
      if (correctionTargetId) {
        const created = await AssistantMemories.create({
          user: new mongoose.Types.ObjectId(userId),
          source_type: sourceType,
          source_id: sourceId,
          memory_type: memoryType,
          canonical_text: canonicalText,
          entities,
          event_date: validEventDate,
          importance: Math.max(importance, 0.6),
          confidence: Math.max(confidence, 0.7),
          supersedes_memory_id: new mongoose.Types.ObjectId(correctionTargetId),
        });
        await PineconeCollections.saveMemory({
          id: created._id.toString(),
          vector,
          userId,
          canonicalText,
          sourceType,
          sourceId,
          memoryType,
          importance: created.importance,
          confidence: created.confidence,
          privacyLevel: created.privacy_level,
          entities,
          eventDate: validEventDate ? validEventDate.toISOString() : null,
        });
        await supersede(correctionTargetId, created._id);
        outcomes.push({
          id: created._id.toString(),
          action: "superseded",
          canonical_text: canonicalText,
        });
        continue;
      }

      // Same fact already known: merge new detail in, do not create a copy.
      if (duplicate) {
        const existing = await AssistantMemories.findOne({
          _id: duplicate.id,
          user: new mongoose.Types.ObjectId(userId),
          isActive: true,
        });

        if (existing) {
          const keepsNewText =
            canonicalText.length > existing.canonical_text.length;
          const mergedText = keepsNewText
            ? canonicalText
            : existing.canonical_text;
          const mergedEntities = Array.from(
            new Set([...(existing.entities || []), ...entities]),
          ).slice(0, 12);

          existing.canonical_text = mergedText;
          existing.entities = mergedEntities;
          existing.importance = Math.max(existing.importance, importance);
          existing.confidence = Math.max(existing.confidence, confidence);
          existing.event_date = existing.event_date || validEventDate;
          await existing.save();

          if (keepsNewText) {
            await PineconeCollections.saveMemory({
              id: existing._id.toString(),
              vector,
              userId,
              canonicalText: mergedText,
              sourceType: existing.source_type,
              sourceId: existing.source_id,
              memoryType: existing.memory_type,
              importance: existing.importance,
              confidence: existing.confidence,
              privacyLevel: existing.privacy_level,
              entities: mergedEntities,
              eventDate: existing.event_date
                ? existing.event_date.toISOString()
                : null,
            });
          }

          outcomes.push({
            id: existing._id.toString(),
            action: "merged",
            canonical_text: mergedText,
          });
          continue;
        }

        // Vector exists but the Mongo row does not - a legacy summary record.
        // Treat it as already known and skip, rather than storing a near copy.
        outcomes.push({
          id: duplicate.id,
          action: "skipped",
          canonical_text: canonicalText,
        });
        continue;
      }

      const created = await AssistantMemories.create({
        user: new mongoose.Types.ObjectId(userId),
        source_type: sourceType,
        source_id: sourceId,
        memory_type: memoryType,
        canonical_text: canonicalText,
        entities,
        event_date: validEventDate,
        importance,
        confidence,
      });

      await PineconeCollections.saveMemory({
        id: created._id.toString(),
        vector,
        userId,
        canonicalText,
        sourceType,
        sourceId,
        memoryType,
        importance,
        confidence,
        privacyLevel: created.privacy_level,
        entities,
        eventDate: validEventDate ? validEventDate.toISOString() : null,
      });

      outcomes.push({
        id: created._id.toString(),
        action: "inserted",
        canonical_text: canonicalText,
      });
    } catch (err) {
      logger.error("upsertMemories candidate failed", err);
    }
  }

  return outcomes;
};

export const AssistantMemoryService = {
  retrieveMemories,
  upsertMemories,
  supersede,
};
