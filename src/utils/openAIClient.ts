import OpenAI from "openai";

/**
 * Shared OpenAI client. Lives in its own module so the memory / style /
 * companion modules can use it without importing `openAI.ts`, which would
 * create an import cycle.
 *
 * The key is read from the server environment only (spec section 18).
 */
export const openai = new OpenAI({
  apiKey: process.env.GPT_KEY,
});

/**
 * Embedding model used for every vector written to and read from Pinecone.
 *
 * `dimensions: 1024` is required: all three Pinecone indexes are 1024-d. Both
 * the write path and the read path must use this exact model + dimension, or
 * similarity search compares vectors from unrelated spaces.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1024;

export const embedding = async (text: string) => {
  const createEmbeddings = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return createEmbeddings.data[0].embedding;
};
