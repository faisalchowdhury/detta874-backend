import mongoose from "mongoose";
import { logger } from "../../logger/logger";
import {
  AssistantStyleProfiles,
  DEFAULT_TRAIT_VALUES,
  STYLE_TRAITS,
  TStyleTrait,
  TStyleTraitKey,
} from "./assistantStyle.model";

/**
 * Adaptation rate. Deliberately small: spec section 4 requires gradual,
 * evidence-based adaptation, and "one unusual conversation should not
 * permanently redefine the user".
 */
const ALPHA = Number(process.env.COMPANION_STYLE_ALPHA) || 0.12;
/** Samples needed before a trait is treated as well established. */
const CONFIDENCE_HALFLIFE = 8;

const SLANG = [
  "u", "ur", "gonna", "wanna", "cuz", "coz", "aint", "ain't", "nah", "yo",
  "bruh", "finna", "tryna", "lemme", "gimme", "yall", "y'all", "dunno",
  "kinda", "sorta", "tbh", "idk", "imma", "tho", "thru", "ya",
];
const PROFANITY = [
  "fuck", "fucking", "fuckin", "shit", "bullshit", "bitch", "ass", "asshole",
  "damn", "goddamn", "piss", "pissed", "crap",
];
const HUMOR = ["lol", "lmao", "lmfao", "haha", "hahaha", "hehe", "rofl", "jk"];
const ADVICE = [
  "what should i", "any advice", "should i", "how do i", "how should i",
  "help me", "what would you do", "what do you think i should", "any idea",
];
const EMOTION = [
  "i feel", "i felt", "im sad", "i'm sad", "i miss", "i love", "i hate",
  "hurts", "hurting", "depressed", "anxious", "angry", "upset", "grieving",
  "lonely", "scared", "proud", "excited", "overwhelmed", "exhausted",
];

const HEDGES = [
  "maybe",
  "i think",
  "i guess",
  "sort of",
  "kind of",
  "perhaps",
  "probably",
  "not sure",
  "i suppose",
  "possibly",
  "might",
];

/** Common emoji planes plus the misc-symbol and dingbat ranges. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const countHits = (haystack: string, needles: string[]) =>
  needles.reduce((total, needle) => {
    const pattern = needle.includes(" ")
      ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : new RegExp(`\\b${needle.replace(/'/g, "'")}\\b`, "g");
    return total + (haystack.match(pattern)?.length || 0);
  }, 0);

/**
 * Derives style evidence from one raw user message.
 *
 * Deterministic on purpose: it adds no model call and therefore no latency or
 * cost to the reply path. A trait is omitted when the message carries no
 * evidence for it, so a serious message does not drag `humor` toward zero.
 */
export const readStyleSignals = (
  text: string,
): Partial<Record<TStyleTraitKey, number>> => {
  const trimmed = (text || "").trim();
  if (!trimmed) return {};

  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const substantial = wordCount >= 10;

  const slangHits = countHits(lower, SLANG);
  const profanityHits = countHits(lower, PROFANITY);
  const humorHits = countHits(lower, HUMOR) + (/(ha){2,}/.test(lower) ? 1 : 0);
  const adviceHits = countHits(lower, ADVICE);
  const emotionHits = countHits(lower, EMOTION);

  const signals: Partial<Record<TStyleTraitKey, number>> = {
    response_length: clamp01(trimmed.length / 350),
    storytelling_preference:
      wordCount >= 40 ? 1 : wordCount <= 6 ? 0 : clamp01(wordCount / 60),
  };

  if (wordCount >= 3) {
    let formality = 0.5;
    if (/^[a-z]/.test(trimmed)) formality -= 0.2;
    if (!/[.!?]$/.test(trimmed)) formality -= 0.1;
    if (slangHits > 0) formality -= 0.2;
    if (/^[A-Z]/.test(trimmed) && /[.!?]$/.test(trimmed) && slangHits === 0) {
      formality += 0.25;
    }
    signals.formality = clamp01(formality);
    signals.question_frequency = trimmed.includes("?") ? 1 : 0;
  }

  if (wordCount >= 4) {
    signals.slang = clamp01(slangHits / 3);
  }

  if (humorHits > 0) signals.humor = 1;
  else if (substantial) signals.humor = 0;

  if (profanityHits > 0) signals.profanity_tolerance = clamp01(profanityHits / 2);
  else if (substantial) signals.profanity_tolerance = 0;

  if (adviceHits > 0) signals.advice_preference = 1;
  else if (substantial) signals.advice_preference = 0;

  if (emotionHits > 0) signals.emotional_directness = 1;
  else if (substantial) signals.emotional_directness = 0;

  // Emoji use, so the Companion can mirror a user who never uses them
  // (Natural Conversation Guide 8).
  const emojiHits = (trimmed.match(EMOJI) || []).length;
  signals.emoji_frequency = clamp01(emojiHits / 2);

  // Directness: short, declarative, hedge-free messages read as blunt.
  if (wordCount >= 3) {
    const hedges = countHits(lower, HEDGES);
    let directness = 0.5;
    if (hedges > 0) directness -= 0.25;
    if (wordCount <= 8) directness += 0.2;
    if (/^(no|yes|yep|nope|nah|yeah|stop|do it|just )/.test(lower)) {
      directness += 0.2;
    }
    if (wordCount > 40) directness -= 0.1;
    signals.directness = clamp01(directness);
  }

  return signals;
};

const defaultTrait = (key: TStyleTraitKey): TStyleTrait => ({
  value: DEFAULT_TRAIT_VALUES[key],
  confidence: 0,
  samples: 0,
});

export type TCompactStyleProfile = Record<string, unknown>;

type TLeanStyleDoc = Partial<Record<TStyleTraitKey, Partial<TStyleTrait>>> & {
  messages_observed?: number;
};

const readTrait = (
  doc: TLeanStyleDoc | null,
  key: TStyleTraitKey,
): TStyleTrait => {
  const raw = doc?.[key];
  if (!raw || typeof raw.value !== "number") return defaultTrait(key);
  return {
    value: raw.value,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    samples: typeof raw.samples === "number" ? raw.samples : 0,
  };
};

/**
 * Applies one message of evidence with an exponential moving average
 * (spec section 4.1).
 */
const observeUserMessage = async (userId: string, text: string) => {
  try {
    const signals = readStyleSignals(text);
    if (!Object.keys(signals).length) return;

    const doc = await AssistantStyleProfiles.findOne({
      user: new mongoose.Types.ObjectId(userId),
    });

    const update: Record<string, unknown> = {};
    for (const key of STYLE_TRAITS) {
      const signal = signals[key];
      if (typeof signal !== "number") continue;

      const current = readTrait(doc, key);
      const samples = current.samples + 1;
      update[key] = {
        value: clamp01(current.value * (1 - ALPHA) + signal * ALPHA),
        confidence: Math.min(0.98, samples / (samples + CONFIDENCE_HALFLIFE)),
        samples,
      };
    }

    await AssistantStyleProfiles.updateOne(
      { user: new mongoose.Types.ObjectId(userId) },
      { $set: update, $inc: { messages_observed: 1 } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn(`observeUserMessage failed for user ${userId}`, err);
  }
};

const round = (n: number) => Math.round(n * 100) / 100;

const LOW_HIGH: [string, string, string] = ["low", "medium", "high"];

/** Buckets a 0-1 trait into the three labels the guide uses. */
const band = (value: number, labels: [string, string, string]) =>
  value < 0.34 ? labels[0] : value < 0.67 ? labels[1] : labels[2];

/** The compact profile block sent to the model (spec section 4.1 / 10). */
const getCompactProfile = async (userId: string) => {
  let doc: TLeanStyleDoc | null = null;
  try {
    doc = await AssistantStyleProfiles.findOne({
      user: new mongoose.Types.ObjectId(userId),
    }).lean<TLeanStyleDoc>();
  } catch (err) {
    logger.warn(`getCompactProfile failed for user ${userId}`, err);
  }

  const traits = Object.fromEntries(
    STYLE_TRAITS.map((key) => [key, readTrait(doc, key)]),
  ) as Record<TStyleTraitKey, TStyleTrait>;

  const confidences = STYLE_TRAITS.map((key) => traits[key].confidence);
  const overallConfidence =
    confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

  // Shape follows Natural Conversation Guide section 8: categorical labels
  // where a band is more useful to the model than a decimal, numbers where the
  // guide shows numbers.
  const profile: TCompactStyleProfile = {
    response_length: band(traits.response_length.value, [
      "short",
      "medium",
      "long",
    ]),
    formality: band(traits.formality.value, ["casual", "neutral", "formal"]),
    slang_level: round(traits.slang.value),
    profanity_comfort: round(traits.profanity_tolerance.value),
    humor: round(traits.humor.value),
    question_frequency_preference: band(traits.question_frequency.value, LOW_HIGH),
    emoji_frequency: band(traits.emoji_frequency.value, LOW_HIGH),
    directness: band(traits.directness.value, LOW_HIGH),
    confidence: round(overallConfidence),
    samples_observed: doc?.messages_observed || 0,
    // Retained alongside the guide's fields - still useful to the model.
    advice_preference: round(traits.advice_preference.value),
    emotional_openness: round(traits.emotional_directness.value),
    storytelling: round(traits.storytelling_preference.value),
  };

  return profile;
};

export const AssistantStyleService = {
  observeUserMessage,
  getCompactProfile,
  readStyleSignals,
};
