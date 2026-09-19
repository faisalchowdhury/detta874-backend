import mongoose from "mongoose";
import redisClient from "../../utils/Redis";
import { logger } from "../../logger/logger";
import { AssistantChats } from "./assistantChat.model";
import { RECENT_TURNS, TChatTurn } from "./companion.prompt";

/**
 * Short-term conversational memory for the Companion (spec section 6).
 *
 * Redis is only a cache here - `assistantChats` in Mongo is the source of
 * truth. If Redis is flushed, restarted or evicted, the window is rebuilt from
 * Mongo, so continuity survives a restart or a re-login.
 *
 * The window is a Redis list, not a JSON blob: RPUSH is atomic, so two messages
 * arriving close together cannot silently drop one the way a
 * read-parse-modify-write of a single string can.
 *
 * Keys are namespaced. The previous implementation used the bare user id as a
 * Redis key, which shares a keyspace with every other consumer of this Redis
 * instance.
 */
const WINDOW_KEY = (userId: string) => `companion:window:${userId}`;
const SUMMARY_KEY = (userId: string) => `companion:summary:${userId}`;

/** Cache more turns than we send, so summarisation has material to work with. */
const WINDOW_STORE = 40;
/** 30 days. Long-lived, but not immortal like the previous window. */
const WINDOW_TTL_SECONDS = 60 * 60 * 24 * 30;

export type TStoredTurn = TChatTurn & { time: string };

export type TConversationSummary = {
  text: string;
  covered_turn_count: number;
  updated_at: string;
};

type TLeanChat = {
  _id: mongoose.Types.ObjectId;
  type: string;
  message?: string;
  createdAt: Date;
};

const toRole = (type: string): "user" | "assistant" =>
  type === "assistant" ? "assistant" : "user";

const isTurn = (value: unknown): value is TStoredTurn => {
  const turn = value as TStoredTurn;
  return Boolean(
    turn &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string",
  );
};

/** Discards a key whose stored type no longer matches this implementation. */
const dropKey = async (key: string) => {
  try {
    await redisClient.del(key);
  } catch (err) {
    logger.warn(`Failed to drop Redis key ${key}`, err);
  }
};

const readWindow = async (
  userId: string,
  limit: number,
): Promise<TStoredTurn[] | null> => {
  const key = WINDOW_KEY(userId);
  try {
    const raw = await redisClient.lrange(key, -limit, -1);
    if (!raw?.length) return null;

    const turns: TStoredTurn[] = [];
    for (const entry of raw) {
      try {
        const parsed = JSON.parse(entry);
        if (isTurn(parsed)) turns.push(parsed);
      } catch {
        // One unreadable entry should not discard the whole window.
      }
    }
    return turns.length ? turns : null;
  } catch (err) {
    if (err instanceof Error && err.message.includes("WRONGTYPE")) {
      logger.warn(`Redis key ${key} had an unexpected type, discarding it.`);
      await dropKey(key);
      return null;
    }
    logger.warn(`Failed to read companion window for user ${userId}`, err);
    return null;
  }
};

/** Atomically appends turns, trims to the cap and refreshes the TTL. */
const appendTurns = async (userId: string, turns: TStoredTurn[]) => {
  const valid = turns.filter((turn) => turn.content?.trim());
  if (!valid.length) return;

  const key = WINDOW_KEY(userId);
  try {
    await redisClient
      .multi()
      .rpush(key, ...valid.map((turn) => JSON.stringify(turn)))
      .ltrim(key, -WINDOW_STORE, -1)
      .expire(key, WINDOW_TTL_SECONDS)
      .exec();
  } catch (err) {
    logger.warn(`Failed to append companion turns for user ${userId}`, err);
  }
};

/**
 * Drops the cached window so the next request rebuilds it from Mongo. Used when
 * a reply fails part-way through, which would otherwise leave the cache missing
 * a message that Mongo already has.
 */
const invalidate = (userId: string) => dropKey(WINDOW_KEY(userId));

/**
 * Rebuilds the window from Mongo, newest `limit` turns in chronological order.
 * `excludeId` drops the message currently being answered so it is not sent
 * twice (see the note in spec section 13).
 */
const rebuildFromMongo = async (
  userId: string,
  limit: number,
  excludeId?: mongoose.Types.ObjectId,
): Promise<TStoredTurn[]> => {
  const docs = await AssistantChats.find({ user: userId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<TLeanChat[]>();

  return docs
    .filter((doc) => !excludeId || !doc._id.equals(excludeId))
    .slice(0, limit)
    .reverse()
    .map((doc) => ({
      role: toRole(doc.type),
      content: doc.message || "",
      time: new Date(doc.createdAt).toISOString(),
    }));
};

/**
 * Returns the recent conversation turns to send to the model, excluding the
 * message currently being answered.
 */
const getRecentTurns = async ({
  userId,
  excludeId,
  limit = RECENT_TURNS,
}: {
  userId: string;
  excludeId?: mongoose.Types.ObjectId;
  limit?: number;
}): Promise<{ turns: TStoredTurn[]; source: "redis" | "mongo" }> => {
  const cached = await readWindow(userId, limit);
  if (cached) {
    return { turns: cached, source: "redis" };
  }

  try {
    const rebuilt = await rebuildFromMongo(userId, WINDOW_STORE, excludeId);
    if (rebuilt.length) {
      // Replace rather than append: this is a full, ordered rebuild.
      await dropKey(WINDOW_KEY(userId));
      await appendTurns(userId, rebuilt);
    }
    return { turns: rebuilt.slice(-limit), source: "mongo" };
  } catch (err) {
    logger.error(`Failed to rebuild companion window for user ${userId}`, err);
    return { turns: [], source: "mongo" };
  }
};

const getSummary = async (
  userId: string,
): Promise<TConversationSummary | null> => {
  try {
    const raw = await redisClient.get(SUMMARY_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.text === "string" ? parsed : null;
  } catch (err) {
    logger.warn(`Failed to read companion summary for user ${userId}`, err);
    return null;
  }
};

const setSummary = async (userId: string, summary: TConversationSummary) => {
  try {
    await redisClient.set(
      SUMMARY_KEY(userId),
      JSON.stringify(summary),
      "EX",
      WINDOW_TTL_SECONDS,
    );
  } catch (err) {
    logger.warn(`Failed to write companion summary for user ${userId}`, err);
  }
};

/** Turns older than the live window, used to refresh the rolling summary. */
const getOlderTurns = async ({
  userId,
  skip = RECENT_TURNS,
  limit = 60,
}: {
  userId: string;
  skip?: number;
  limit?: number;
}): Promise<TStoredTurn[]> => {
  const docs = await AssistantChats.find({ user: userId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean<TLeanChat[]>();

  return docs.reverse().map((doc) => ({
    role: toRole(doc.type),
    content: doc.message || "",
    time: new Date(doc.createdAt).toISOString(),
  }));
};

const countTurns = (userId: string) =>
  AssistantChats.countDocuments({ user: userId });

export const CompanionWindow = {
  getRecentTurns,
  appendTurns,
  invalidate,
  getSummary,
  setSummary,
  getOlderTurns,
  countTurns,
  WINDOW_KEY,
  SUMMARY_KEY,
};
