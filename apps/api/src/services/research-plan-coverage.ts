import type { PresentationIntent } from "@slidespeech/types";

import {
  removeLiteralPrefixCaseInsensitive,
  replaceLiteralCaseInsensitive,
} from "./research-text-utils";

const tokenizeResearchText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const uniqueStrings = (values: string[]): string[] =>
  values.filter((value, index, array) => array.indexOf(value) === index);

const RESEARCH_FOCUS_STOPWORDS = new Set([
  "create",
  "make",
  "build",
  "generate",
  "write",
  "prepare",
  "presentation",
  "presentations",
  "deck",
  "slides",
  "slide",
  "short",
  "long",
  "include",
  "including",
  "least",
  "about",
  "regarding",
  "explain",
  "found",
  "show",
  "teach",
  "describe",
  "understand",
  "want",
  "need",
  "with",
  "from",
  "into",
  "using",
  "through",
  "audience",
  "available",
  "beginner",
  "beginners",
  "brand",
  "brands",
  "can",
  "children",
  "child",
  "students",
  "simple",
  "simply",
  "clearly",
  "what",
  "why",
  "how",
  "when",
  "where",
  "that",
  "this",
  "these",
  "those",
  "they",
  "them",
  "their",
  "there",
  "one",
  "ones",
  "were",
  "was",
  "are",
  "is",
  "and",
  "for",
  "into",
  "than",
  "then",
  "that",
  "this",
  "it",
  "its",
  "the",
  "model",
  "interested",
  "interest",
  "information",
  "should",
  "could",
  "would",
]);

const TITLE_CASE_PHRASE_PATTERN =
  /\b(\p{Lu}[\p{Ll}\p{M}]+(?:\s+\p{Lu}[\p{Ll}\p{M}]+){1,3})\b/gu;

const extractQuotedFocusPhrases = (input: {
  topic: string;
  subject: string;
}): string[] => {
  const subjectLower = input.subject.toLowerCase();
  const subjectTokens = new Set(tokenizeResearchText(input.subject));
  const phrases = Array.from(input.topic.matchAll(TITLE_CASE_PHRASE_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .filter((phrase) => phrase.toLowerCase() !== subjectLower)
    .filter((phrase) => !RESEARCH_FOCUS_STOPWORDS.has(phrase.toLowerCase()))
    .filter((phrase) =>
      tokenizeResearchText(phrase).some(
        (token) => !subjectTokens.has(token) && !RESEARCH_FOCUS_STOPWORDS.has(token),
      ),
    )
    .filter((phrase) => phrase.split(/\s+/).length <= 4);

  return uniqueStrings(phrases);
};

export const buildSpecializedFocusQuery = (input: {
  topic: string;
  subject: string;
}): string | null => {
  const subjectTokens = new Set(tokenizeResearchText(input.subject));
  const quotedPhrases = extractQuotedFocusPhrases(input);
  const quotedPhraseTokens = new Set(
    quotedPhrases.flatMap((phrase) => tokenizeResearchText(phrase)),
  );
  const focusTokens = uniqueStrings(
    tokenizeResearchText(input.topic).filter(
      (token) =>
        !subjectTokens.has(token) &&
        !quotedPhraseTokens.has(token) &&
        !RESEARCH_FOCUS_STOPWORDS.has(token),
    ),
  );

  if (focusTokens.length < 1 && quotedPhrases.length === 0) {
    return null;
  }

  const parts = [
    ...quotedPhrases.slice(0, 2).map((phrase) => `"${phrase}"`),
    focusTokens.slice(0, 8).join(" "),
    input.subject,
  ].filter(Boolean);

  return parts.join(" ").trim();
};

const splitRequestedCoverageGoal = (value: string): string[] => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
  if (!normalized) {
    return [];
  }

  const explainWhyMatch = normalized.match(/^(.*?)\s+and\s+explain why\s+(.+)$/i);
  if (explainWhyMatch?.[1] && explainWhyMatch[2]) {
    const subject = explainWhyMatch[1].trim();
    const whyClause = explainWhyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  const whyMatch = normalized.match(/^(.*?)\s+and why\s+(.+)$/i);
  if (whyMatch?.[1] && whyMatch[2]) {
    const subject = whyMatch[1].trim();
    const whyClause = whyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  return [normalized];
};

export const extractRequestedCoverageGoals = (value: string): string[] => {
  const patterns = [
    /\binclude at least one slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\binclude a slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bfocus on\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bcover\s+([^.!?]+)(?:[.!?]|$)/gi,
  ];

  const results: string[] = [];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const captured = match[1]?.replace(/\s+/g, " ").trim();
      if (captured && captured.length > 8) {
        results.push(...splitRequestedCoverageGoal(captured));
      }
    }
  }

  return uniqueStrings(results).slice(0, 4);
};

export const buildSpecializedCoverageGoal = (input: {
  topic: string;
  subject: string;
}): string | null => {
  const focusQuery = buildSpecializedFocusQuery(input);

  if (!focusQuery) {
    return null;
  }

  const specializedPortion = removeLiteralPrefixCaseInsensitive(
    focusQuery,
    input.subject,
  ).trim();

  if (!specializedPortion) {
    return null;
  }

  return `The specific source-backed focus requested in the prompt: ${specializedPortion}.`;
};

export const buildSubjectAnchoredSpecializedQuery = (input: {
  subject: string;
  focusQuery: string | null;
}): string | null => {
  if (!input.focusQuery) {
    return null;
  }

  const focusWithoutQuotes = input.focusQuery.replace(/"/g, "");
  const specializedPortion = replaceLiteralCaseInsensitive(
    focusWithoutQuotes,
    input.subject,
    " ",
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!specializedPortion) {
    return null;
  }

  return `${input.subject} ${specializedPortion}`.trim();
};

export const buildHeuristicCoverageGoals = (input: {
  subject: string;
  freshnessSensitive: boolean;
  entitySpecific: boolean;
  researchSpecific: boolean;
  intent?: PresentationIntent | undefined;
  explicitSourceUrls: string[];
  requestedCoverageGoals: string[];
  specializedCoverageGoal?: string | null;
}): string[] =>
  uniqueStrings(
    (
      input.researchSpecific
        ? [
            `What ${input.subject} is, using direct source evidence`,
            ...input.requestedCoverageGoals,
            input.specializedCoverageGoal ?? null,
            ...(input.requestedCoverageGoals.length === 0
              ? [
                  `The exact identity, date, location, and context for ${input.subject}`,
                  `The concrete people, roles, sequence, or evidence directly tied to ${input.subject}`,
                ]
              : []),
          ]
        : input.requestedCoverageGoals.length > 0
          ? [
              ...(input.intent?.deliveryFormat === "workshop" ||
              Boolean(input.intent?.presentationGoal) ||
              input.intent?.audienceCues.length
                ? []
                : [`What ${input.subject} is and why it matters`]),
              ...input.requestedCoverageGoals,
              input.specializedCoverageGoal ?? null,
            ]
        : input.intent?.presentationFrame === "organization"
          ? [
              `What ${input.subject} does and why it matters`,
              `The main services, capabilities, or focus areas connected to ${input.subject}`,
              `How ${input.subject} works in practice for customers, teams, or delivery`,
              input.specializedCoverageGoal ?? null,
            ]
        : input.intent?.contentMode === "procedural"
          ? [
              "Starting inputs",
              "Key sequence",
              "Quality cues and adjustment",
              input.specializedCoverageGoal ?? null,
            ]
        : [
            `What ${input.subject} is and why it matters`,
            input.entitySpecific
              ? `The main systems, parts, or focus areas that define ${input.subject}`
              : `The core mechanisms, characteristics, or defining ideas behind ${input.subject}`,
            input.freshnessSensitive
              ? `The most recent important developments or current state of ${input.subject}`
              : `A concrete example, consequence, or real-world application of ${input.subject}`,
            input.specializedCoverageGoal ?? null,
          ]
    )
      .concat(
        input.explicitSourceUrls.length > 0
          ? ["Use the explicitly provided sources as the primary grounding."]
          : [],
      )
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 4);

const compactAudienceCoverageSubject = (subject: string): string =>
  subject
    .replace(/^using\s+/i, "")
    .replace(/\btheir\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

export const buildIntentCoverageGoals = (intent: PresentationIntent, subject: string): string[] => {
  const compactSubject = compactAudienceCoverageSubject(subject) || subject;
  const organizationCoverageGoals =
    intent.presentationFrame === "organization"
      ? [
          `What ${compactSubject} does and where it creates value`,
          `The main services, capabilities, or focus areas connected to ${compactSubject}`,
          `How ${compactSubject} works in practice for customers, teams, or delivery`,
        ]
      : [];
  const audienceGoal =
    intent.audienceCues.length > 0
      ? `${compactSubject.charAt(0).toUpperCase() + compactSubject.slice(1)} for ${intent.audienceCues.join(", ")}`
      : null;
  const organizationGoal = intent.organization
    ? `${intent.organization} policies, constraints, or working context for ${compactSubject}`
    : null;

  return uniqueStrings(
    [
      ...organizationCoverageGoals,
      intent.presentationGoal ?? null,
      ...intent.coverageRequirements,
      audienceGoal,
      organizationGoal,
      intent.activityRequirement ?? null,
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 4);
};
