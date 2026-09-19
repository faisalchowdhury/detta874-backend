import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { v4 as uuidv4 } from "uuid";
const pinecone = new Pinecone({
  apiKey:
    process.env.PINECONE_API ??
    (() => {
      throw new Error("PINECONE_API environment variable is not set");
    })(),
});

const journalCollection = pinecone.Index("journalindex");
const chatCollection = pinecone.Index("chatindex");
const assistantchatCollection = pinecone.Index("assistantchat");

/**
 * Unified memory vector index (spec section 7). Reuses the existing
 * `assistantchat` index so no re-indexing is needed: legacy records there carry
 * a `summaries` field, unified records carry `canonical_text` + `source_type`.
 */
const memoryCollection = assistantchatCollection;

/**
 * IMPORTANT - all three indexes are Pinecone *integrated embedding* indexes
 * (llama-text-embed-v2, 1024 dims, cosine). This codebase computes its own
 * vectors with OpenAI `text-embedding-3-small` and writes them with `upsert()`.
 *
 * Therefore reads MUST use `query({ vector })` with a vector from the same
 * OpenAI model. Never use `searchRecords({ inputs: { text } })` here: that asks
 * Pinecone to embed the query with llama-text-embed-v2, which produces a vector
 * in a completely different space from the stored ones. Because both happen to
 * be 1024-dimensional it does not error - it silently returns noise.
 */
type TQueryByVector = {
  vector: number[];
  topK: number;
  filter?: Record<string, unknown>;
};

export type TVectorMatch = {
  id: string;
  score: number;
  metadata: Record<string, any>;
};

const queryByVector = async (
  index: typeof journalCollection,
  { vector, topK, filter }: TQueryByVector,
): Promise<TVectorMatch[]> => {
  const response = await index.query({
    topK,
    vector,
    filter,
    includeMetadata: true,
  });
  return (response?.matches ?? []).map((match) => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: (match.metadata ?? {}) as Record<string, any>,
  }));
};

type ChatData = {
  vector: number[];
  senderId: string;
  conversationId: string;
  chat: string | "";
  relation: string;
  id?: string;
};
const saveChat = async ({
  vector,
  senderId,
  conversationId,
  chat,
  relation,
  id,
}: ChatData) => {
  await chatCollection.upsert([
    {
      id: id ? id : uuidv4(),
      values: vector,
      metadata: {
        senderId: senderId?.toString(), // ensure string
        chat: chat,
        conversationId,
        relation: relation,
        createdAt: new Date().toISOString(),
      },
    },
  ]);
};
type JournalData = {
  vector: number[];
  userId: string;
  text: string;
  title: string;
  id?: string;
};
const saveJournal = async ({
  vector,
  userId,
  text,
  title,
  id,
}: JournalData) => {
  await journalCollection.upsert([
    {
      id: id ? id : uuidv4(),
      values: vector,
      metadata: {
        userId: userId,
        content: text,
        title: title,
        createdAt: new Date().toISOString(),
      },
    },
  ]);
};

type TSaveAssistantChat = {
  vector: number[];
  userId: string;
  summaries: string;
  id?: string;
};
const saveAssistantChat = async ({
  vector,
  userId,
  summaries,
  id,
}: TSaveAssistantChat) => {
  await assistantchatCollection.upsert([
    {
      id: id ? id : uuidv4(),
      values: vector,
      metadata: {
        user: userId?.toString(), // ensure string
        summaries,
        createdAt: new Date().toISOString(),
      },
    },
  ]);
};

type TSaveMemory = {
  id: string;
  vector: number[];
  userId: string;
  canonicalText: string;
  sourceType: string;
  sourceId: string;
  memoryType: string;
  importance: number;
  confidence: number;
  privacyLevel: string;
  entities: string[];
  eventDate?: string | null;
  createdAt?: string;
};

/**
 * Upserts one unified memory record (spec section 7.2). `id` is the Mongo
 * `_id` of the record in `assistantMemories`, so the two stores stay in sync.
 */
const saveMemory = async ({
  id,
  vector,
  userId,
  canonicalText,
  sourceType,
  sourceId,
  memoryType,
  importance,
  confidence,
  privacyLevel,
  entities,
  eventDate,
  createdAt,
}: TSaveMemory) => {
  const metadata: RecordMetadata = {
    user: userId?.toString(),
    canonical_text: canonicalText,
    source_type: sourceType,
    source_id: sourceId || "",
    memory_type: memoryType,
    importance,
    confidence,
    privacy_level: privacyLevel,
    createdAt: createdAt || new Date().toISOString(),
  };
  // Pinecone metadata rejects null and empty arrays - only set when present.
  if (entities?.length) {
    metadata.entities = entities;
  }
  if (eventDate) {
    metadata.event_date = eventDate;
  }

  await memoryCollection.upsert([{ id, values: vector, metadata }]);
};

const deleteMemory = async (id: string) => {
  await memoryCollection.deleteOne(id);
};

export const PineconeCollections = {
  journalCollection,
  chatCollection,
  saveChat,
  saveJournal,
  assistantchatCollection,
  saveAssistantChat,
  memoryCollection,
  queryByVector,
  saveMemory,
  deleteMemory,
};
