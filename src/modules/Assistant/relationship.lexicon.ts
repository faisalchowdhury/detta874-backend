/**
 * Relationship vocabulary for structured fact lookup.
 *
 * Family relationships and other stable profile facts must not depend on
 * semantic similarity alone: a question like "what are my sons' names" has to
 * resolve against stored relationship records deterministically, not by cosine
 * distance, which is what made recall inconsistent between requests.
 */

export const RELATION_TYPES = [
  "mother",
  "father",
  "parent",
  "son",
  "daughter",
  "child",
  "brother",
  "sister",
  "sibling",
  "spouse",
  "partner",
  "grandmother",
  "grandfather",
  "grandparent",
  "grandson",
  "granddaughter",
  "grandchild",
  "aunt",
  "uncle",
  "cousin",
  "nephew",
  "niece",
  "mother-in-law",
  "father-in-law",
  "brother-in-law",
  "sister-in-law",
  "stepmother",
  "stepfather",
  "stepbrother",
  "stepsister",
  "stepson",
  "stepdaughter",
  "friend",
  "pet",
  "other",
] as const;

export type TRelationType = (typeof RELATION_TYPES)[number];

const FAMILY: TRelationType[] = [
  "mother",
  "father",
  "parent",
  "son",
  "daughter",
  "child",
  "brother",
  "sister",
  "sibling",
  "spouse",
  "partner",
  "grandmother",
  "grandfather",
  "grandparent",
  "grandson",
  "granddaughter",
  "grandchild",
  "aunt",
  "uncle",
  "cousin",
  "nephew",
  "niece",
  "mother-in-law",
  "father-in-law",
  "brother-in-law",
  "sister-in-law",
  "stepmother",
  "stepfather",
  "stepbrother",
  "stepsister",
  "stepson",
  "stepdaughter",
];

/**
 * Maps the words a question can use to the relation types worth looking up.
 * Longer phrases come first so "mother-in-law" wins over "mother".
 */
const QUESTION_TERMS: { term: string; types: TRelationType[] }[] = [
  { term: "mother-in-law", types: ["mother-in-law"] },
  { term: "father-in-law", types: ["father-in-law"] },
  { term: "brother-in-law", types: ["brother-in-law"] },
  { term: "sister-in-law", types: ["sister-in-law"] },
  { term: "mother in law", types: ["mother-in-law"] },
  { term: "father in law", types: ["father-in-law"] },
  { term: "brother in law", types: ["brother-in-law"] },
  { term: "sister in law", types: ["sister-in-law"] },
  { term: "in-laws", types: ["mother-in-law", "father-in-law", "brother-in-law", "sister-in-law"] },

  { term: "grandmother", types: ["grandmother", "grandparent"] },
  { term: "grandmothers", types: ["grandmother", "grandparent"] },
  { term: "grandma", types: ["grandmother", "grandparent"] },
  { term: "grandman", types: ["grandmother", "grandparent"] },
  { term: "granny", types: ["grandmother", "grandparent"] },
  { term: "nan", types: ["grandmother", "grandparent"] },
  { term: "grandfather", types: ["grandfather", "grandparent"] },
  { term: "grandfathers", types: ["grandfather", "grandparent"] },
  { term: "grandpa", types: ["grandfather", "grandparent"] },
  { term: "granddad", types: ["grandfather", "grandparent"] },
  { term: "grandad", types: ["grandfather", "grandparent"] },
  { term: "grandparent", types: ["grandmother", "grandfather", "grandparent"] },
  { term: "grandparents", types: ["grandmother", "grandfather", "grandparent"] },
  { term: "granddaughter", types: ["granddaughter", "grandchild"] },
  { term: "granddaughters", types: ["granddaughter", "grandchild"] },
  { term: "grandson", types: ["grandson", "grandchild"] },
  { term: "grandsons", types: ["grandson", "grandchild"] },
  { term: "grandchild", types: ["grandson", "granddaughter", "grandchild"] },
  { term: "grandchildren", types: ["grandson", "granddaughter", "grandchild"] },
  { term: "grandkid", types: ["grandson", "granddaughter", "grandchild"] },
  { term: "grandkids", types: ["grandson", "granddaughter", "grandchild"] },

  { term: "stepmother", types: ["stepmother"] },
  { term: "stepfather", types: ["stepfather"] },
  { term: "stepmom", types: ["stepmother"] },
  { term: "stepdad", types: ["stepfather"] },
  { term: "stepbrother", types: ["stepbrother"] },
  { term: "stepsister", types: ["stepsister"] },
  { term: "stepson", types: ["stepson"] },
  { term: "stepdaughter", types: ["stepdaughter"] },

  { term: "son", types: ["son", "child"] },
  { term: "sons", types: ["son", "child"] },
  { term: "daughter", types: ["daughter", "child"] },
  { term: "daughters", types: ["daughter", "child"] },
  { term: "child", types: ["son", "daughter", "child"] },
  { term: "children", types: ["son", "daughter", "child"] },
  { term: "kid", types: ["son", "daughter", "child"] },
  { term: "kids", types: ["son", "daughter", "child"] },
  { term: "boys", types: ["son", "child"] },
  { term: "girls", types: ["daughter", "child"] },

  { term: "mother", types: ["mother", "parent"] },
  { term: "mom", types: ["mother", "parent"] },
  { term: "mum", types: ["mother", "parent"] },
  { term: "momma", types: ["mother", "parent"] },
  { term: "father", types: ["father", "parent"] },
  { term: "dad", types: ["father", "parent"] },
  { term: "papa", types: ["father", "parent"] },
  { term: "parent", types: ["mother", "father", "parent"] },
  { term: "parents", types: ["mother", "father", "parent"] },

  { term: "brother", types: ["brother", "sibling"] },
  { term: "brothers", types: ["brother", "sibling"] },
  { term: "sister", types: ["sister", "sibling"] },
  { term: "sisters", types: ["sister", "sibling"] },
  { term: "sibling", types: ["brother", "sister", "sibling"] },
  { term: "siblings", types: ["brother", "sister", "sibling"] },

  { term: "wife", types: ["spouse", "partner"] },
  { term: "husband", types: ["spouse", "partner"] },
  { term: "spouse", types: ["spouse", "partner"] },
  { term: "partner", types: ["spouse", "partner"] },
  { term: "fiance", types: ["spouse", "partner"] },
  { term: "fiancee", types: ["spouse", "partner"] },

  { term: "aunt", types: ["aunt"] },
  { term: "aunts", types: ["aunt"] },
  { term: "auntie", types: ["aunt"] },
  { term: "uncle", types: ["uncle"] },
  { term: "uncles", types: ["uncle"] },
  { term: "cousin", types: ["cousin"] },
  { term: "cousins", types: ["cousin"] },
  { term: "nephew", types: ["nephew"] },
  { term: "nephews", types: ["nephew"] },
  { term: "niece", types: ["niece"] },
  { term: "nieces", types: ["niece"] },

  { term: "family", types: FAMILY },
  { term: "relatives", types: FAMILY },
  { term: "immediate family", types: FAMILY },

  { term: "pet", types: ["pet"] },
  { term: "pets", types: ["pet"] },
  { term: "dog", types: ["pet"] },
  { term: "cat", types: ["pet"] },

  { term: "friend", types: ["friend"] },
  { term: "friends", types: ["friend"] },
  { term: "best friend", types: ["friend"] },
];

/** Synonyms seen in extracted memories, normalised onto the canonical set. */
const SYNONYMS: Record<string, TRelationType> = {
  mom: "mother",
  mum: "mother",
  momma: "mother",
  mommy: "mother",
  dad: "father",
  papa: "father",
  daddy: "father",
  wife: "spouse",
  husband: "spouse",
  fiance: "spouse",
  fiancee: "spouse",
  grandma: "grandmother",
  granny: "grandmother",
  nan: "grandmother",
  grandpa: "grandfather",
  granddad: "grandfather",
  grandad: "grandfather",
  stepmom: "stepmother",
  stepdad: "stepfather",
  "step-mother": "stepmother",
  "step-father": "stepfather",
  "step-son": "stepson",
  "step-daughter": "stepdaughter",
  "mother in law": "mother-in-law",
  "father in law": "father-in-law",
  "brother in law": "brother-in-law",
  "sister in law": "sister-in-law",
  kid: "child",
  boy: "son",
  girl: "daughter",
};

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches a term and its bare plural, so "moms" still hits the term "mom" when
 * the question was typed without an apostrophe.
 */
const termPattern = (term: string) =>
  new RegExp(
    term.endsWith("s") ? `\\b${escape(term)}\\b` : `\\b${escape(term)}s?\\b`,
  );

/**
 * Normalises a question before term matching.
 *
 * Possessives must be removed, not just stripped of their apostrophe: deleting
 * the apostrophe in "my mom's name" leaves "moms", which no longer matches the
 * term "mom". Plural possessives ("my sons' names") collapse back to "sons".
 */
const normaliseQuestion = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/s[’']/g, "s")
    .replace(/[’']/g, "")} `;

/** Normalises a free-text relation label onto the canonical set. */
export const normaliseRelationType = (
  raw: string | undefined | null,
): TRelationType => {
  if (!raw) return "other";
  const key = raw.toLowerCase().trim().replace(/\s+/g, " ");
  if ((RELATION_TYPES as readonly string[]).includes(key)) {
    return key as TRelationType;
  }
  if (SYNONYMS[key]) return SYNONYMS[key];
  const singular = key.replace(/s$/, "");
  if ((RELATION_TYPES as readonly string[]).includes(singular)) {
    return singular as TRelationType;
  }
  if (SYNONYMS[singular]) return SYNONYMS[singular];
  return "other";
};

/**
 * Returns the relation types a question is asking about, or an empty array if
 * the question is not about a relationship at all.
 */
export const detectRelationQuery = (text: string): TRelationType[] => {
  if (!text?.trim()) return [];
  const lower = normaliseQuestion(text);
  const found = new Set<TRelationType>();

  for (const { term, types } of QUESTION_TERMS) {
    if (termPattern(term).test(lower)) {
      types.forEach((t) => found.add(t));
    }
  }
  return [...found];
};

/** Terms actually present in the question, for the "nothing stored" notice. */
export const matchedRelationTerms = (text: string): string[] => {
  if (!text?.trim()) return [];
  const lower = normaliseQuestion(text);
  return QUESTION_TERMS.filter(({ term }) => termPattern(term).test(lower)).map(
    ({ term }) => term,
  );
};

/** Stable profile attributes held on the account itself. */
export const PROFILE_ATTRIBUTES = [
  "name",
  "location",
  "age",
  "gender",
  "mood",
] as const;

export type TProfileAttribute = (typeof PROFILE_ATTRIBUTES)[number];

const PROFILE_PATTERNS: { attribute: TProfileAttribute; patterns: RegExp[] }[] =
  [
    {
      attribute: "location",
      patterns: [
        /where\b.{0,16}\b(live|living|from|based|staying)\b/,
        /what (city|town|state|country)/,
        /(your|my) (address|city|hometown|location)/,
        /where (you|i) at\b/,
      ],
    },
    {
      attribute: "age",
      // "how old" in any word order - "how old are you", "how old am i",
      // "remind me how old i am". Supplying the profile block on a false
      // positive is harmless; withholding it makes the model refuse a fact it
      // actually holds.
      patterns: [/how old\b/, /(your|my) age\b/, /what age (are|am)/],
    },
    {
      attribute: "name",
      patterns: [
        /what(s| is| was) (your|my) name/,
        /remind me (of )?(your|my) name/,
        /who am i\b/,
      ],
    },
    {
      attribute: "gender",
      patterns: [/(your|my) gender/],
    },
    {
      attribute: "mood",
      patterns: [
        /how (are|r) (you|i) feeling/,
        /(your|my) mood\b/,
        /how(s| is) (your|my) mood/,
      ],
    },
  ];

/**
 * Returns the profile attributes a question is asking about.
 *
 * These live on the account, not in the memory store, so a direct question
 * about them must be answered from the profile rather than from semantic
 * recall. Without this the strict no-guess rule makes the model say it is not
 * sure about a location it actually has on file.
 */
export const detectProfileQuery = (text: string): TProfileAttribute[] => {
  if (!text?.trim()) return [];
  const lower = normaliseQuestion(text);
  return PROFILE_PATTERNS.filter(({ patterns }) =>
    patterns.some((pattern) => pattern.test(lower)),
  ).map(({ attribute }) => attribute);
};

/**
 * True when the message is asking the Twin to describe the person it
 * represents, which must be answered from verified material only.
 */
export const isSelfDescriptionQuery = (text: string): boolean => {
  if (!text?.trim()) return false;
  const lower = text.toLowerCase().replace(/[’']/g, "");
  return [
    /tell me (a little |a bit |something |more )?about (yourself|you)\b/,
    /\bwho are you\b/,
    /\bdescribe yourself\b/,
    /\bintroduce yourself\b/,
    /what (are|r) you like\b/,
    /tell me about your ?self/,
    /\ba (little|bit) about (yourself|you)\b/,
  ].some((pattern) => pattern.test(lower));
};
