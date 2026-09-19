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

  const profile: TCompactStyleProfile = {
    user_id: userId,
    messages_observed: doc?.messages_observed || 0,
  };

  for (const key of STYLE_TRAITS) {
    const t = readTrait(doc, key);
    profile[key] = { value: round(t.value), confidence: round(t.confidence) };
  }

  return profile;
};

export const AssistantStyleService = {
  observeUserMessage,
  getCompactProfile,
  readStyleSignals,
};
