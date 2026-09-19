import mongoose, { model, Schema } from "mongoose";

/** Spec section 7.2 - source of a memory record. */
export type TMemorySource = "companion_chat" | "journal" | "profile" | "import";

/** Spec section 7.2 - memory_type. */
export type TMemoryType =
  | "person"
  | "relationship"
  | "event"
  | "preference"
  | "goal"
  | "place"
  | "project"
  | "belief"
  | "other";

export const MEMORY_TYPES: TMemoryType[] = [
  "person",
  "relationship",
  "event",
  "preference",
  "goal",
  "place",
  "project",
  "belief",
  "other",
];

export type TAssistantMemory = {
  user: mongoose.Types.ObjectId;
  source_type: TMemorySource;
  source_id: string;
  memory_type: TMemoryType;
  canonical_text: string;
  entities: string[];
  event_date: Date | null;
  importance: number;
  confidence: number;
  privacy_level: "private" | "shared" | "public";
  last_used_at: Date | null;
  supersedes_memory_id: mongoose.Types.ObjectId | null;
  superseded_by_memory_id: mongoose.Types.ObjectId | null;
  isActive: boolean;
};

/**
 * Unified memory knowledge base shared by the Companion and the Journal
 * (spec section 7). Mongo is the source of truth; the Pinecone `assistantchat`
 * index holds the vector for each record under the same id as `_id`.
 *
 * Records are never hard-deleted when a preference changes - a correction marks
 * the old record superseded and inactive instead (spec section 14).
 */
const assistantMemorySchema = new Schema<TAssistantMemory>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    source_type: {
      type: String,
      enum: ["companion_chat", "journal", "profile", "import"],
      required: true,
    },
    source_id: {
      type: String,
      default: "",
    },
    memory_type: {
      type: String,
      enum: MEMORY_TYPES,
      default: "other",
    },
    canonical_text: {
      type: String,
      required: true,
      trim: true,
    },
    entities: {
      type: [String],
      default: [],
    },
    event_date: {
      type: Date,
      default: null,
    },
    importance: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    confidence: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    privacy_level: {
      type: String,
      enum: ["private", "shared", "public"],
      default: "private",
    },
    last_used_at: {
      type: Date,
      default: null,
    },
    supersedes_memory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "assistantMemories",
      default: null,
    },
    superseded_by_memory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "assistantMemories",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

assistantMemorySchema.index({ user: 1, isActive: 1, source_type: 1 });

export const AssistantMemories = model<TAssistantMemory>(
  "assistantMemories",
  assistantMemorySchema,
);
