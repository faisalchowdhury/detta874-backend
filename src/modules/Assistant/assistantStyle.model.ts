import mongoose, { model, Schema } from "mongoose";

/** One learned trait: current value, how sure we are, and the evidence count. */
export type TStyleTrait = {
  value: number;
  confidence: number;
  samples: number;
};

export const STYLE_TRAITS = [
  "response_length",
  "formality",
  "humor",
  "slang",
  "profanity_tolerance",
  "question_frequency",
  "advice_preference",
  "emotional_directness",
  "storytelling_preference",
] as const;

export type TStyleTraitKey = (typeof STYLE_TRAITS)[number];

/**
 * Neutral starting point (spec section 4: "begin with a neutral conversational
 * style"). Confidence starts at 0, and the Companion prompt is told to stay
 * close to neutral while confidence is low.
 */
export const DEFAULT_TRAIT_VALUES: Record<TStyleTraitKey, number> = {
  response_length: 0.5,
  formality: 0.5,
  humor: 0.4,
  slang: 0.3,
  profanity_tolerance: 0.15,
  question_frequency: 0.4,
  advice_preference: 0.4,
  emotional_directness: 0.4,
  storytelling_preference: 0.4,
};

export type TAssistantStyleProfile = {
  user: mongoose.Types.ObjectId;
  response_length: TStyleTrait;
  formality: TStyleTrait;
  humor: TStyleTrait;
  slang: TStyleTrait;
  profanity_tolerance: TStyleTrait;
  question_frequency: TStyleTrait;
  advice_preference: TStyleTrait;
  emotional_directness: TStyleTrait;
  storytelling_preference: TStyleTrait;
  messages_observed: number;
};

const trait = (defaultValue: number) => ({
  type: new Schema<TStyleTrait>(
    {
      value: { type: Number, default: defaultValue, min: 0, max: 1 },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      samples: { type: Number, default: 0, min: 0 },
    },
    { _id: false },
  ),
  default: () => ({ value: defaultValue, confidence: 0, samples: 0 }),
});

const assistantStyleSchema = new Schema<TAssistantStyleProfile>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },
    response_length: trait(DEFAULT_TRAIT_VALUES.response_length),
    formality: trait(DEFAULT_TRAIT_VALUES.formality),
    humor: trait(DEFAULT_TRAIT_VALUES.humor),
    slang: trait(DEFAULT_TRAIT_VALUES.slang),
    profanity_tolerance: trait(DEFAULT_TRAIT_VALUES.profanity_tolerance),
    question_frequency: trait(DEFAULT_TRAIT_VALUES.question_frequency),
    advice_preference: trait(DEFAULT_TRAIT_VALUES.advice_preference),
    emotional_directness: trait(DEFAULT_TRAIT_VALUES.emotional_directness),
    storytelling_preference: trait(
      DEFAULT_TRAIT_VALUES.storytelling_preference,
    ),
    messages_observed: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

export const AssistantStyleProfiles = model<TAssistantStyleProfile>(
  "assistantStyleProfiles",
  assistantStyleSchema,
);
