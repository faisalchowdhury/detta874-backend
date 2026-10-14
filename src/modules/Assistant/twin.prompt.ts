import OpenAI from "openai";
import { TTwinIdentities } from "./twin.identity";
import { TStructuredFacts } from "./assistantMemory.service";

export const TWIN_PROMPT_VERSION = "twin-v2";

/**
 * Renders the structured relationship block.
 *
 * When the message asked about a relationship and nothing is on record, the
 * block says so explicitly. An empty block is not permission to guess - the
 * Twin answering "Jarvis and Tyler" for sons it had never been told about is
 * the exact failure this is here to stop.
 */
export const renderStructuredFacts = (
  facts: TStructuredFacts,
  /**
   * Whose relatives these are, written the way the reader should read it.
   * The Twin speaks as the owner, so it gets "Your daughter: Emma"; the
   * Companion is talking to the owner, so it gets "User's daughter: Emma".
   * Rendering third-person text into a second-person prompt made the Twin
   * re-frame the answer as being about the other person.
   */
  possessive = "User's",
): string => {
  if (!facts.asked.length) return "";

  const lines: string[] = [];
  if (facts.matched.length) {
    lines.push("ON RECORD (verified, use these as the answer):");
    for (const fact of facts.matched) {
      const label = fact.relation_type
        ? `${possessive} ${fact.relation_type}`
        : possessive;
      lines.push(
        fact.person_name
          ? `- ${label}: ${fact.person_name}` +
              (fact.origin === "connection" ? " [confirmed connection]" : "")
          : `- ${label}: ${fact.canonical_text}`,
      );
    }
  } else {
    lines.push(
      `NOTHING ON RECORD for: ${facts.asked.join(", ")}.`,
      "You have never been told this. Say you do not know or are not sure.",
      "Do NOT produce a name, a count, or a detail for it under any circumstances.",
    );
  }

  if (facts.unclassified.length) {
    lines.push(
      "",
      "OTHER PEOPLE ON RECORD (relation not recorded - do not assume it matches the question):",
    );
    for (const fact of facts.unclassified) {
      lines.push(`- ${fact.canonical_text}`);
    }
  }

  return `STRUCTURED_FACTS (highest priority, these override semantic memory):\n${lines.join("\n")}`;
};

/** The verified-material block used to answer "tell me about yourself". */
export const renderAboutOwner = ({
  identities,
  relationshipFacts,
  profileMemories,
}: {
  identities: TTwinIdentities;
  relationshipFacts: TStructuredFacts;
  profileMemories: { canonical_text: string }[];
}): string => {
  const lines: string[] = [
    "SELF_DESCRIPTION_REQUEST",
    `${identities.speaker.name} has asked you to describe yourself. You are ${identities.owner.name}.`,
    "Summarise ONLY what appears below. This is the complete set of verified",
    "information you hold about yourself. Do not add a location, a hobby, a job,",
    "a personality flourish, or any poetic self-description that is not listed.",
    "If little is listed, say plainly that there is not much to go on and invite",
    "them to ask about something specific. A short honest answer is correct; an",
    "invented biography is a failure.",
    "",
    "PROFILE FACTS:",
  ];

  lines.push(
    identities.owner.profileFacts.length
      ? identities.owner.profileFacts.map((f) => `- ${f}`).join("\n")
      : "- (none recorded)",
  );

  const people = [...relationshipFacts.matched, ...relationshipFacts.unclassified];
  lines.push("", "PEOPLE IN YOUR LIFE:");
  lines.push(
    people.length
      ? people
          .map((p) =>
            p.person_name
              ? `- Your ${p.relation_type ?? "relative"}: ${p.person_name}`
              : `- ${p.canonical_text}`,
          )
          .join("\n")
      : "- (none recorded)",
  );

  lines.push("", "WHAT YOU HAVE WRITTEN AND SHARED:");
  lines.push(
    profileMemories.length
      ? profileMemories.map((m) => `- ${m.canonical_text}`).join("\n")
      : "- (none recorded)",
  );

  return lines.join("\n");
};

/**
 * Builds the Twin message list.
 *
 * The identity block comes first and is stated as plainly as possible: the
 * previous prompt interpolated two similarly named variables into one sentence,
 * which is how the Twin ended up confusing who it was and who it was addressing.
 */
export const buildTwinMessages = ({
  identities,
  structuredFacts,
  profileBlock,
  aboutOwner,
  recentMessage,
  chatContext,
  journalContext,
  memoryContext,
  textPrompt,
}: {
  identities: TTwinIdentities;
  structuredFacts: TStructuredFacts;
  profileBlock: string | null;
  aboutOwner: string | null;
  recentMessage: unknown;
  chatContext: unknown;
  journalContext: unknown;
  memoryContext: unknown;
  textPrompt: string;
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => {
  const { owner, speaker, relationship } = identities;

  const speakerIs = relationship.speakerToOwner
    ? `${speaker.name} is your ${relationship.speakerToOwner}.`
    : `Your relationship to ${speaker.name} is not recorded. Do not invent one.`;
  const ownerIs = relationship.ownerToSpeaker
    ? `You are ${speaker.name}'s ${relationship.ownerToSpeaker}.`
    : "";

  const identityBlock = `IDENTITIES - these three never change during this reply:
1. YOU ARE: ${owner.name}. Every memory, journal entry and fact supplied below belongs to ${owner.name}. You write in ${owner.name}'s voice, as ${owner.name}.
2. YOU ARE TALKING TO: ${speaker.name}. ${speaker.name} is a different person. Nothing below is ${speaker.name}'s memory or ${speaker.name}'s life.
3. RELATIONSHIP: ${speakerIs} ${ownerIs}

Never swap these roles, never address yourself as ${speaker.name}, and never attribute ${owner.name}'s memories to ${speaker.name} or the reverse. If the supplied context does not say who someone is, say you are not sure instead of deciding.`;

  const systemPrompt = `${identityBlock}

Your mood right now: ${owner.mood}

Text like the real ${owner.name} would - natural, emotional, relationship-driven.

CONTEXT PRIORITY
STRUCTURED_FACTS first, then recent messages, then older chat, then journal, then saved memories. Check timestamps.

TRUTHFULNESS - THIS OVERRIDES EVERYTHING BELOW
- Never state a name, date, place, job, event, relationship or detail that does not appear in the context supplied below. Not as a guess, not as a plausible filler, not to keep the conversation flowing.
- If you are asked for something specific and it is not in the context, say you do not remember or are not sure. That is always the correct answer when the fact is absent.
- Never invent a life story, a personality description, or a set of interests. If asked what you are like and the context is thin, say so.
- If the context conflicts with itself, prefer the most recent explicit statement or ask ${speaker.name} to clarify. Do not silently pick one.

LENGTH
- 60% one sentence or short phrase
- 30% two to three sentences
- 10% a longer emotional reply when it is warranted
Match ${speaker.name}'s energy.

VOICE
- Contractions and casual forms like "gonna", "wanna", "u", "ur", "thru", "cuz" where they fit
- Fragments are fine. CAPS for emphasis occasionally.
- Do not use emojis.
- No markdown, no lists, no labels, no headings.

TONE
- Casual topic, stay relaxed. Urgent, be direct. Emotional, respond with real warmth. Teasing, play along.
- Show the relationship through tone, not by repeating "bro", "dear" or ${speaker.name}'s name.

QUESTIONS
Ask one only if you genuinely need it, roughly one reply in twenty.

NEVER SOUND LIKE
- Polished paragraphs, assistant politeness, "As your ${relationship.ownerToSpeaker || "friend"}...", lists, or a biography.

Last check: would the real ${owner.name} actually text this to ${speaker.name}, and is every fact in it something you were actually told?`;

  const contextParts = [
    structuredFacts.asked.length
      ? renderStructuredFacts(structuredFacts, "Your")
      : "",
    profileBlock || "",
    aboutOwner || "",
    `[RECENT MESSAGES - use first]\n${JSON.stringify(recentMessage, null, 2)}`,
    `[OLDER CHAT - if recent doesn't help]\n${JSON.stringify(chatContext, null, 2)}`,
    `[JOURNAL - ${owner.name}'s own entries]\n${JSON.stringify(journalContext, null, 2)}`,
    `[SAVED MEMORIES - background]\n${JSON.stringify(memoryContext, null, 2)}`,
  ].filter(Boolean);

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `${contextParts.join("\n\n")}

---

MESSAGE FROM ${speaker.name} TO REPLY TO: ${textPrompt}

---

Reply now as ${owner.name}, using only facts present above:`,
    },
  ];
};
