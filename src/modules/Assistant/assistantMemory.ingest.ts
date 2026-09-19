import { logger } from "../../logger/logger";
import { AssistantMemoryService } from "./assistantMemory.service";
import { extractJournalMemories } from "./assistantMemory.extraction";
import { logMemoryExtraction } from "./companion.trace";

/**
 * Turns a journal entry into unified memory records (spec sections 7 and 20),
 * so a fact the user wrote in their journal is retrievable by the Companion
 * and vice versa, each carrying its `source_type`.
 *
 * Runs in the background - a journal is saved and returned to the client
 * regardless of whether extraction succeeds. The existing chunked writes to the
 * `journalindex` are untouched, so journals created before this change stay
 * searchable.
 */
const ingestJournalEntry = async ({
  userId,
  journalId,
  title,
  content,
}: {
  userId: string;
  journalId: string;
  title: string;
  content: string;
}) => {
  if (!content?.trim() || !userId) return;

  try {
    // Pull what is already known so the model can merge or correct instead of
    // creating a near-duplicate.
    const { memories, journal } = await AssistantMemoryService.retrieveMemories(
      {
        userId,
        queryText: `${title || ""} ${content}`.slice(0, 2000),
      },
    );

    const extraction = await extractJournalMemories({
      title,
      content,
      existingMemories: [...memories, ...journal],
    });

    if (!extraction.save || !extraction.memories.length) return;

    const outcomes = await AssistantMemoryService.upsertMemories({
      userId,
      sourceType: "journal",
      sourceId: journalId,
      candidates: extraction.memories,
    });

    logMemoryExtraction(
      userId,
      `journal:${journalId}`,
      outcomes.map((o) => ({ id: o.id, action: o.action })),
    );
  } catch (err) {
    logger.error(`ingestJournalEntry failed for journal ${journalId}`, err);
  }
};

export const AssistantMemoryIngest = {
  ingestJournalEntry,
};
