import mongoose from "mongoose";
import { logger } from "../../logger/logger";
import { UserModel } from "../user/user.model";
import { Friends } from "../friends/friends.model";

/**
 * The three identities a Twin request must keep apart:
 *
 *   1. the owner  - the person whose Twin is being represented, whose memories
 *                   and journals are in scope, and whose voice is being spoken
 *   2. the speaker - the person currently talking to the Twin
 *   3. the relationship between them
 *
 * These were previously passed as `sender_name` and `receiver_name`, which were
 * inverted relative to their meaning: `sender_name` held the owner (the message
 * *receiver*) and `receiver_name` held the speaker. That naming invited the role
 * confusion this module exists to prevent.
 */
export type TTwinIdentities = {
  owner: {
    id: string;
    name: string;
    /** Verified profile fields only - never inferred. */
    profileFacts: string[];
    mood: string;
  };
  speaker: {
    id: string;
    name: string;
  };
  relationship: {
    /** What the speaker is to the owner, e.g. "daughter". */
    speakerToOwner: string | null;
    /** What the owner is to the speaker, e.g. "father". */
    ownerToSpeaker: string | null;
  };
};

const UNKNOWN = "Unknown";

/**
 * In the `friends` collection `relation` describes what `sendBy` is to
 * `reciveBy`, and accepting a request leaves one row per direction.
 *
 * `checkMessage` matches either row with `$or` and no direction filter, so the
 * relation it returns for a pair is whichever document Mongo happens to hand
 * back - "father" on one request and "daughter" on the next. Each direction is
 * therefore resolved explicitly here.
 */
const resolveRelationship = async (ownerId: string, speakerId: string) => {
  try {
    const owner = new mongoose.Types.ObjectId(ownerId);
    const speaker = new mongoose.Types.ObjectId(speakerId);

    const [speakerRow, ownerRow] = await Promise.all([
      Friends.findOne({
        sendBy: speaker,
        reciveBy: owner,
        status: "accepted",
      }).lean(),
      Friends.findOne({
        sendBy: owner,
        reciveBy: speaker,
        status: "accepted",
      }).lean(),
    ]);

    return {
      speakerToOwner: (speakerRow as any)?.relation ?? null,
      ownerToSpeaker: (ownerRow as any)?.relation ?? null,
    };
  } catch (err) {
    logger.error("resolveRelationship failed", err);
    return { speakerToOwner: null, ownerToSpeaker: null };
  }
};

/**
 * Collects the owner's stored profile fields. Only fields actually present on
 * the account are returned - an absent field must stay absent rather than being
 * filled in by the model.
 */
const buildProfileFacts = (user: any): string[] => {
  const facts: string[] = [];
  if (!user) return facts;
  if (user.name) facts.push(`Name: ${user.name}`);
  if (user.gender) facts.push(`Gender: ${user.gender}`);
  if (user.ageRange) facts.push(`Age range: ${user.ageRange}`);
  if (user.address) facts.push(`Location: ${user.address}`);
  if (user.user_mood) facts.push(`Current mood: ${user.user_mood}`);
  return facts;
};

export const resolveTwinIdentities = async ({
  ownerId,
  speakerId,
  ownerNameHint,
  speakerNameHint,
}: {
  ownerId: string;
  speakerId: string;
  ownerNameHint?: string;
  speakerNameHint?: string;
}): Promise<TTwinIdentities> => {
  const [ownerUser, speakerUser, relationship] = await Promise.all([
    (UserModel as any)
      .findById(ownerId)
      .select("name gender ageRange address user_mood")
      .lean()
      .catch(() => null),
    (UserModel as any)
      .findById(speakerId)
      .select("name")
      .lean()
      .catch(() => null),
    resolveRelationship(ownerId, speakerId),
  ]);

  return {
    owner: {
      id: ownerId,
      name: ownerUser?.name || ownerNameHint || UNKNOWN,
      profileFacts: buildProfileFacts(ownerUser),
      mood: ownerUser?.user_mood || UNKNOWN,
    },
    speaker: {
      id: speakerId,
      name: speakerUser?.name || speakerNameHint || UNKNOWN,
    },
    relationship,
  };
};

/**
 * Loads one user's stored profile fields. Used by the Companion, which has no
 * Twin identity to resolve but still needs to answer a direct question about
 * the account's own facts.
 */
const getProfileFacts = async (userId: string): Promise<string[]> => {
  try {
    const user = await (UserModel as any)
      .findById(userId)
      .select("name gender ageRange address user_mood")
      .lean();
    return buildProfileFacts(user);
  } catch (err) {
    logger.warn(`getProfileFacts failed for user ${userId}`, err);
    return [];
  }
};

/** Renders the profile block handed to the model. */
export const renderProfileFacts = (
  facts: string[],
  possessive = "User's",
): string => {
  const owner = possessive === "Your" ? "your own" : "the user's";
  return facts.length
    ? `PROFILE_FACTS (from ${owner} account, authoritative - use these directly):\n${facts
        .map((f) => `- ${f}`)
        .join("\n")}`
    : `PROFILE_FACTS: nothing recorded on ${owner} account for this. Say you are not sure rather than guessing.`;
};

export const TwinIdentity = {
  resolveTwinIdentities,
  buildProfileFacts,
  getProfileFacts,
};
