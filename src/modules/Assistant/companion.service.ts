import mongoose from "mongoose";
import { openai } from "../../utils/openAIClient";
import { logger } from "../../logger/logger";
import { sendSocketAssistantStream } from "../../utils/socket";
import { AssistantChats } from "./assistantChat.model";
import {
  buildCompanionMessages,
  PROMPT_VERSION,
  RECENT_TURNS,
  TChatTurn,
} from "./companion.prompt";
import { CompanionWindow, TStoredTurn } from "./companion.window";
import { AssistantMemoryService } from "./assistantMemory.service";
import { extractMemories } from "./assistantMemory.extraction";
import { AssistantStyleService } from "./assistantStyle.service";
import { logCompanionRequest, logMemoryExtraction } from "./companion.trace";

export const COMPANION_MODEL = process.env.COMPANION_MODEL || "gpt-4o";
export const SUMMARY_MODEL =
  process.env.COMPANION_SUMMARY_MODEL || "gpt-4o-mini";

/** Re-summarise older turns only after this many new turns have accumulated. */
const SUMMARY_REFRESH_EVERY = 10;

/**
 * The Companion is one continuous conversation per user (spec section 12): the
 * identifier is derived server-side from the authenticated user and is never
 * accepted from the client, so a client cannot address another user's
 * conversation (spec section 8.1).
 */
export const companionConversationId = (userId: string) =>
  `companion:${userId}`;

const toTurns = (stored: TStoredTurn[]): TChatTurn[] =>
  stored.map((turn) => ({ role: turn.role, content: turn.content }));

/**
 * Rebuilds the rolling summary of turns that have fallen out of the live
 * window (spec section 10, CONVERSATION_SUMMARY). Runs after the reply so it
 * never delays the user, and only every `SUMMARY_REFRESH_EVERY` turns.
 */
const refreshConversationSummary = async (userId: string) => {
  try {
    const total = await CompanionWindow.countTurns(userId);
    if (total <= RECENT_TURNS) return;

    const existing = await CompanionWindow.getSummary(userId);
    if (
      existing &&
      total - existing.covered_turn_count < SUMMARY_REFRESH_EVERY
    ) {
      return;
    }

    const older = await CompanionWindow.getOlderTurns({ userId });
    if (!older.length) return;

    const transcript = older
      .map(
        (turn) =>
          `${turn.role === "user" ? "User" : "Companion"}: ${turn.content}`,
      )
      .join("\n");

    const response = await openai.chat.completions.create({
      model: SUMMARY_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Summarise the earlier part of an ongoing conversation so it can be used as background context. Write 4-8 plain sentences covering what the user shared, decisions or plans made, unresolved threads, and the emotional tone. Refer to the participants as 'the user' and 'the companion'. State only what appears in the transcript - never infer or invent. No markdown, no headings, no lists.",
        },
        { role: "user", content: transcript },
      ],
    });

    const text = response?.choices?.[0]?.message?.content?.trim();
    if (!text) return;

    await CompanionWindow.setSummary(userId, {
      text,
      covered_turn_count: total,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`refreshConversationSummary failed for user ${userId}`, err);
  }
};

/**
 * Asynchronous memory-extraction pass (spec sections 7.3 and 11 step 10).
 * Everything here happens after the user already has their reply.
 */
const runPostResponseWork = async ({
  userId,
  conversationId,
  recent,
  currentMessage,
  assistantReply,
  suppliedMemories,
}: {
  userId: string;
  conversationId: string;
  recent: TChatTurn[];
  currentMessage: string;
  assistantReply: string;
  suppliedMemories: Parameters<typeof extractMemories>[0]["existingMemories"];
}) => {
  try {
    const extraction = await extractMemories({
      recent,
      currentMessage,
      assistantReply,
      existingMemories: suppliedMemories,
    });

    if (extraction.save && extraction.memories.length) {
      const outcomes = await AssistantMemoryService.upsertMemories({
        userId,
        sourceType: "companion_chat",
        sourceId: conversationId,
        candidates: extraction.memories,
      });
      logMemoryExtraction(
        userId,
        conversationId,
        outcomes.map((o) => ({ id: o.id, action: o.action })),
      );
    }
  } catch (err) {
    logger.error(`memory extraction failed for user ${userId}`, err);
  }

  await refreshConversationSummary(userId);
};

/**
 * Generates and streams one Companion reply.
 *
 * Implements the backend request flow of spec section 11. The user's message
 * must already be saved (`userMessageId` identifies it) so it can be excluded
 * from the recent-turn block and appended exactly once.
 */
const companionReply = async ({
  userId,
  userName,
  textPrompt,
  userMessageId,
}: {
  userId: string;
  userName: string;
  textPrompt: string;
  userMessageId?: mongoose.Types.ObjectId;
}) => {
  const startedAt = Date.now();
  const conversationId = companionConversationId(userId);

  // 3. Recent turns of this conversation, in order, excluding the current one.
  const { turns: storedTurns, source: windowSource } =
    await CompanionWindow.getRecentTurns({
      userId,
      excludeId: userMessageId,
    });
  const recent = toTurns(storedTurns);

  // 4-6. Summary, memories scoped to this user, and the learned style profile.
  const [summary, retrieved, styleProfile] = await Promise.all([
    CompanionWindow.getSummary(userId),
    AssistantMemoryService.retrieveMemories({
      userId,
      queryText: textPrompt,
    }),
    AssistantStyleService.getCompactProfile(userId),
  ]);

  const trace = {
    userId,
    conversationId,
    promptVersion: PROMPT_VERSION,
    model: COMPANION_MODEL,
    recentTurnCount: recent.length,
    summaryUsed: Boolean(summary?.text),
    summaryUpdatedAt: summary?.updated_at ?? null,
    memoryIds: retrieved.memories.map((m) => m.id),
    journalMemoryIds: retrieved.journal.map((m) => m.id),
    startedAt,
    windowSource,
  };

  let fullResponse = "";

  try {
    // 7. Assemble in the priority order of section 6.1.
    const messages = buildCompanionMessages({
      userName,
      styleJson: JSON.stringify(styleProfile),
      recent,
      summary: summary?.text ?? null,
      memories: retrieved.memories,
      journalMemories: retrieved.journal,
      currentMessage: textPrompt,
    });

    // 8. Model call, server-side only.
    const stream = await openai.chat.completions.create({
      model: COMPANION_MODEL,
      stream: true,
      temperature: 0.85,
      max_tokens: 400,
      // Mild penalties discourage the recycled phrasing and repeated
      // questions called out in spec sections 5 and 16.
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
      messages,
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        sendSocketAssistantStream(userId, content);
      }
    }

    logCompanionRequest(trace, {
      status: "ok",
      responseChars: fullResponse.length,
    });
  } catch (err) {
    logCompanionRequest(trace, { status: "error", error: err });
    // The user's message is already in Mongo but never made it into the cached
    // window. Drop the cache so the next turn rebuilds a complete window.
    await CompanionWindow.invalidate(userId);
    throw err;
  }

  if (!fullResponse.trim()) {
    logger.warn(`companion produced an empty reply for user ${userId}`);
    return "";
  }

  // 9. Persist the reply, then keep the short-term window in step with it.
  const assistantMessage = await AssistantChats.create({
    user: new mongoose.Types.ObjectId(userId),
    type: "assistant",
    message: fullResponse,
  });

  await CompanionWindow.appendTurns(userId, [
    {
      role: "user",
      content: textPrompt,
      time: new Date(startedAt).toISOString(),
    },
    {
      role: "assistant",
      content: fullResponse,
      time: new Date(assistantMessage?.createdAt || Date.now()).toISOString(),
    },
  ]);

  // 10. Memory extraction and summary refresh, off the response path.
  void runPostResponseWork({
    userId,
    conversationId,
    recent,
    currentMessage: textPrompt,
    assistantReply: fullResponse,
    suppliedMemories: [...retrieved.memories, ...retrieved.journal],
  });

  return fullResponse;
};

export const CompanionService = {
  companionReply,
  refreshConversationSummary,
  companionConversationId,
};
