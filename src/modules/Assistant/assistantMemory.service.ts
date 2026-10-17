import mongoose from "mongoose";
import { PineconeCollections, TVectorMatch } from "../../DB/pinecone";
import { embedding } from "../../utils/openAIClient";
import { Friends } from "../friends/friends.model";
import { logger } from "../../logger/logger";
import {
  detectRelationQuery,
  normaliseRelationType,
  TRelationType,
} from "./relationship.lexicon";
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
export const MEMORY_LIMIT = num(process.env.COMPANION_MEMORY_LIMIT, 6);

export type TRetrievedMemory = {
  id: string;
  canonical_text: string;
  source_type: TMemorySource;
  score: number;
  created_at: string;
  /** Tags required by Natural Conversation Guide 7.4. */
  event_date?: string | null;
  people?: string[];
  relation_type?: string | null;
  confidence?: number;
  provenance?: string;
};

/** First token of a name, for matching "Olivia" against "Olivia Carter". */
const firstName = (name: string) =>
  name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

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
  const isLegacySummary = !match.metadata?.canonical_text;
  return {
    id: match.id,
    canonical_text: text,
    source_type:
      (match.metadata?.source_type as TMemorySource) || "companion_chat",
    score: match.score,
    created_at: match.metadata?.createdAt || "",
    event_date: match.metadata?.event_date ?? null,
    people: Array.isArray(match.metadata?.entities)
      ? match.metadata?.entities
      : undefined,
    relation_type: match.metadata?.relation_type ?? null,
    confidence:
      typeof match.metadata?.confidence === "number"
        ? match.metadata.confidence
        : undefined,
    // Records written before the unified store existed are AI summaries.
    provenance:
      match.metadata?.provenance || (isLegacySummary ? "ai_summary" : undefined),
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
    event_date: match.metadata?.event_date ?? null,
    provenance: "user_stated",
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
  relation_type?: string | null;
  person_name?: string | null;
  provenance?: string | null;
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
      // Only relationship/person memories carry a relation; anything else
      // would pollute the deterministic family-fact lookup.
      const isPersonMemory =
        memoryType === "relationship" || memoryType === "person";
      const rawName = candidate.person_name?.trim() || "";
      // A relation word is not a name. The extractor sometimes returns "Dad",
      // "Grandma" or "father" as person_name, which would make the structured
      // lookup answer "who are your sons" with the word "son".
      const nameIsRelationWord =
        Boolean(rawName) && normaliseRelationType(rawName) !== "other";
      const hasRealName = Boolean(rawName) && !nameIsRelationWord;

      const relationType =
        isPersonMemory && candidate.relation_type && hasRealName
          ? normaliseRelationType(candidate.relation_type)
          : null;
      const personName = relationType && hasRealName ? rawName : null;

      const provenance =
        candidate.provenance === "ai_inferred" ? "ai_inferred" : "user_stated";

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
          relation_type: relationType,
          person_name: personName,
          provenance,
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
          relationType,
          personName,
          provenance,
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
          // Backfill structured fields onto rows stored before they existed.
          existing.relation_type = existing.relation_type || relationType;
          existing.person_name = existing.person_name || personName;
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
        relation_type: relationType,
        person_name: personName,
        provenance,
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
        relationType,
        personName,
        provenance,
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

export type TStructuredFact = {
  id: string;
  relation_type: string | null;
  person_name: string | null;
  canonical_text: string;
  origin: "memory" | "connection";
  confidence: number;
};

export type TStructuredFacts = {
  /** Relation types the question asked about; empty when it asked about none. */
  asked: TRelationType[];
  /** Records whose stored relation matches what was asked. */
  matched: TStructuredFact[];
  /**
   * People known to be related to the user whose relation was never recorded.
   * Surfaced separately so the model can use them without mistaking them for a
   * confirmed answer to the question.
   */
  unclassified: TStructuredFact[];
};

const EMPTY_FACTS: TStructuredFacts = { asked: [], matched: [], unclassified: [] };

/**
 * Deterministic lookup of relationship facts for one user.
 *
 * This is a direct MongoDB query by relation, never a vector search. Semantic
 * similarity returned family facts inconsistently between identical requests -
 * a question about sons would surface a grief memory one time and the right
 * record the next - so stable relationship facts are resolved structurally and
 * the semantic store is only additional context.
 *
 * Two sources are merged: relationship memories extracted from journals and
 * conversations, and accepted connections in the `friends` collection, where
 * `relation` is what `sendBy` is to `reciveBy`.
 *
 * Pass `types: null` for every relationship fact on record, which is what the
 * "tell me about yourself" path needs.
 */
const getRelationshipFacts = async ({
  userId,
  types,
}: {
  userId: string;
  types?: TRelationType[] | null;
}): Promise<TStructuredFacts> => {
  if (!userId) return EMPTY_FACTS;
  const asked = types === null ? [] : (types ?? []);
  if (types !== null && !asked.length) return EMPTY_FACTS;

  try {
    const owner = new mongoose.Types.ObjectId(userId);
    const relationFilter =
      types === null ? {} : { relation_type: { $in: asked } };

    const [matchedRows, unclassifiedRows, connections] = await Promise.all([
      AssistantMemories.find({
        user: owner,
        isActive: true,
        ...relationFilter,
        ...(types === null ? { relation_type: { $ne: null } } : {}),
      })
        .sort({ confidence: -1, importance: -1 })
        .limit(40)
        .lean(),
      AssistantMemories.find({
        user: owner,
        isActive: true,
        relation_type: null,
        memory_type: { $in: ["relationship", "person"] },
      })
        .sort({ confidence: -1, importance: -1 })
        .limit(20)
        .lean(),
      Friends.find({ reciveBy: owner, status: "accepted" })
        .populate("sendBy", "name")
        .lean(),
    ]);

    const matched: TStructuredFact[] = matchedRows.map((row: any) => ({
      id: row._id.toString(),
      relation_type: row.relation_type ?? null,
      person_name: row.person_name ?? null,
      canonical_text: row.canonical_text,
      origin: "memory",
      confidence: row.confidence ?? 0.5,
    }));

    const connectionFacts: TStructuredFact[] = [];
    /** First name -> relation, for resolving conflicts with extracted guesses. */
    const connectionByName = new Map<string, TRelationType>();

    for (const row of connections as any[]) {
      const relation = normaliseRelationType(row?.relation);
      const name = row?.sendBy?.name;
      if (!name) continue;
      connectionByName.set(firstName(name), relation);
      if (types !== null && !asked.includes(relation)) continue;
      connectionFacts.push({
        id: row._id.toString(),
        relation_type: relation,
        person_name: name,
        canonical_text: `${name} is the user's ${row.relation}.`,
        origin: "connection",
        // A confirmed in-app connection is the strongest evidence available.
        confidence: 1,
      });
    }

    /**
     * A confirmed connection outranks an extracted guess for the same person.
     * The extractor sometimes labels a relative it was never told about as a
     * "friend" - Olivia is Emma's sister in the friends collection, but a
     * journal entry that only names her produced a "friend" memory. Without
     * this the model would be handed both and could answer either.
     */
    const deduped = matched.filter((fact) => {
      if (!fact.person_name) return true;
      // Any person with a confirmed connection is already covered by it, under
      // their full name and correct relation. Dropping the extracted row avoids
      // both the wrong relation and listing the same person twice.
      return !connectionByName.has(firstName(fact.person_name));
    });

    return {
      asked,
      matched: [...connectionFacts, ...deduped],
      unclassified: unclassifiedRows.map((row: any) => ({
        id: row._id.toString(),
        relation_type: null,
        person_name: row.person_name ?? null,
        canonical_text: row.canonical_text,
        origin: "memory",
        confidence: row.confidence ?? 0.5,
      })),
    };
  } catch (err) {
    logger.error("getRelationshipFacts failed", err);
    return { asked, matched: [], unclassified: [] };
  }
};

/** Convenience wrapper: detect the relation terms in a question, then look them up. */
const retrieveStructuredFacts = async ({
  userId,
  queryText,
}: {
  userId: string;
  queryText: string;
}): Promise<TStructuredFacts> =>
  getRelationshipFacts({ userId, types: detectRelationQuery(queryText) });

/** Highest-value memories regardless of the question, for self-description. */
const getProfileMemories = async ({
  userId,
  limit = 12,
}: {
  userId: string;
  limit?: number;
}): Promise<TRetrievedMemory[]> => {
  try {
    const rows = await AssistantMemories.find({
      user: new mongoose.Types.ObjectId(userId),
      isActive: true,
    })
      .sort({ importance: -1, confidence: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    return rows.map((row: any) => ({
      id: row._id.toString(),
      canonical_text: row.canonical_text,
      source_type: row.source_type,
      score: 1,
      created_at: row.createdAt ? new Date(row.createdAt).toISOString() : "",
    }));
  } catch (err) {
    logger.error("getProfileMemories failed", err);
    return [];
  }
};

export const AssistantMemoryService = {
  retrieveMemories,
  upsertMemories,
  supersede,
  getRelationshipFacts,
  retrieveStructuredFacts,
  getProfileMemories,
};
