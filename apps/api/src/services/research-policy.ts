import { sanitizeResearchQuery } from "@slidespeech/providers";
import type { PresentationIntent, ResearchPlanningSuggestion } from "@slidespeech/types";

export {
  derivePresentationIntent,
  extractCoverageRequirements,
  extractExplicitSourceUrls,
  extractPresentationBrief,
  extractPresentationSubject,
  stripInstructionalSuffixes,
  subjectIsGenericEntityReference,
  stripExplicitSourceUrls,
} from "./presentation-intent";
import {
  derivePresentationIntent,
  extractExplicitSourceUrls,
  extractPresentationBrief,
  extractPresentationSubject,
  stripInstructionalSuffixes,
  subjectIsGenericEntityReference,
  stripExplicitSourceUrls,
} from "./presentation-intent";

export const topicLooksTimeSensitive = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /\b(current|latest|recent|today|this week|this month|this year)\b/i,
    /\b(news|update|updates|trend|trends|market|markets|price|prices)\b/i,
    /\b202[4-9]\b/,
    /\bpresident|prime minister|ceo|earnings|release\b/i,
  ].some((pattern) => pattern.test(normalized));
};

export const topicLooksEntitySpecific = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();
  const subject = extractPresentationSubject(topic);
  const subjectLooksLikeNamedEntity =
    !!subject &&
    !/^(?:how|what|why|when|where|who|using|make|build|create|explain|teach)\b/i.test(subject) &&
    /^[A-Z][A-Za-z0-9&+-]*(?:\s+(?:[A-Z][A-Za-z0-9&+-]*|of|the|and|for|in|on|to|a|an)){0,7}$/.test(
      subject,
    );

  if (!normalized) {
    return false;
  }

  return [
    /\b(company|organization|organisation|firm|startup|vendor|employer|client)\b/i,
    /\b(brand|business|corporation|manufacturer|automaker|car maker|car company)\b/i,
    /\babout us|about the company|company presentation|company overview\b/i,
    /\boverview of\b/i,
    /\bwho is\b.+\b(company|organization|organisation)\b/i,
    /\bwork at\b|\bour company\b|\bmy company\b/i,
  ].some((pattern) => pattern.test(normalized)) || subjectLooksLikeNamedEntity;
};

export const topicLooksResearchSpecific = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /\b(incident|outbreak|plague|pandemic|contagion|epidemi\w*)\b/i,
    /\b(research(?:er|ers)?|stud(?:y|ied|ies))\b/i,
    /\b(disease spread|infection spread|case study|historical|history|origins?)\b/i,
    /\b(real[- ]world|scientific|academic)\b/i,
  ].some((pattern) => pattern.test(normalized));
};

export const topicRequiresGroundedFacts = (topic: string): boolean =>
  topicLooksTimeSensitive(topic) ||
  topicLooksEntitySpecific(topic) ||
  topicLooksResearchSpecific(topic);

export type ResearchPlan = {
  subject: string;
  explicitSourceUrls: string[];
  directUrls: string[];
  searchQueries: string[];
  coverageGoals: string[];
  maxResults: number;
  freshnessSensitive: boolean;
  requiresGroundedFacts: boolean;
  rationale: string[];
  planningMode: "heuristic" | "llm-assisted";
};

const RESEARCH_QUERY_META_PATTERN =
  /\b(?:slide|slides|presentation|deck|speaker|narration|template|layout|design)\b/i;

const tokenizeResearchText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const uniqueStrings = (values: string[]): string[] =>
  values.filter((value, index, array) => array.indexOf(value) === index);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const replaceSubjectReference = (
  value: string,
  fromSubject: string,
  toSubject: string,
): string => {
  if (!fromSubject.trim() || !toSubject.trim()) {
    return value;
  }

  return value.replace(new RegExp(escapeRegExp(fromSubject), "ig"), toSubject);
};

const normalizeResearchQueryCandidate = (value: string): string | null => {
  const normalized = value
    .replace(/^[\-\u2022*]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^search\s+for\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (
    normalized.length < 3 ||
    normalized.length > 120 ||
    RESEARCH_QUERY_META_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
};

const normalizeResearchSubjectCandidate = (value: string): string | null => {
  const normalized = value
    .replace(/^[\-\u2022*]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(?:subject|topic)\s*[:\-]\s*/i, "")
    .replace(
      /\b(?:company profile(?: and service portfolio)?|service portfolio|company overview|corporate|profile|overview|presentation|deck|talk)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  return normalized.length >= 2 ? normalized : null;
};

const normalizeCoverageGoal = (value: string): string | null => {
  const normalized = value
    .replace(/^[\-\u2022*]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (
    normalized.length < 8 ||
    normalized.length > 160 ||
    RESEARCH_QUERY_META_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
};

const normalizeSubjectKey = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const subjectTokenCount = (value: string): number =>
  tokenizeResearchText(value).length;

const deriveHostnameResearchAnchor = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0]?.trim() ?? "";
    if (root.length < 3) {
      return null;
    }

    const normalized = root.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return null;
    }

    return normalized.replace(/\b\p{L}/gu, (value) => value.toLocaleUpperCase());
  } catch {
    return null;
  }
};

const resolveResearchSubject = (input: {
  subject: string;
  explicitSourceUrls: string[];
  intent: PresentationIntent;
}): string => {
  if (
    input.intent.presentationFrame !== "organization" ||
    !subjectIsGenericEntityReference(input.subject)
  ) {
    return input.subject;
  }

  for (const url of input.explicitSourceUrls) {
    const anchor = deriveHostnameResearchAnchor(url);
    if (anchor && !subjectIsGenericEntityReference(anchor)) {
      return anchor;
    }
  }

  return input.subject;
};

const queryLooksRelevantToTopic = (
  query: string,
  subject: string,
  topic: string,
): boolean => {
  const queryTokens = new Set(tokenizeResearchText(query));
  const subjectTokens = tokenizeResearchText(subject);
  const topicTokens = tokenizeResearchText(topic);

  return [...queryTokens].some(
    (token) => subjectTokens.includes(token) || topicTokens.includes(token),
  );
};

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
  "beginner",
  "beginners",
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
  "should",
  "could",
  "would",
]);

const TITLE_CASE_PHRASE_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;

const extractQuotedFocusPhrases = (input: {
  topic: string;
  subject: string;
}): string[] => {
  const subjectLower = input.subject.toLowerCase();
  const phrases = Array.from(input.topic.matchAll(TITLE_CASE_PHRASE_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .filter((phrase) => phrase.toLowerCase() !== subjectLower)
    .filter((phrase) => !RESEARCH_FOCUS_STOPWORDS.has(phrase.toLowerCase()))
    .filter((phrase) => phrase.split(/\s+/).length <= 4);

  return uniqueStrings(phrases);
};

const buildSpecializedFocusQuery = (input: {
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

  if (focusTokens.length < 2 && quotedPhrases.length === 0) {
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

const extractRequestedCoverageGoals = (value: string): string[] => {
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

const buildSpecializedCoverageGoal = (input: {
  topic: string;
  subject: string;
}): string | null => {
  const focusQuery = buildSpecializedFocusQuery(input);

  if (!focusQuery) {
    return null;
  }

  const specializedPortion = focusQuery
    .replace(new RegExp(`^${escapeRegExp(input.subject)}\\s*`, "i"), "")
    .trim();

  if (!specializedPortion) {
    return null;
  }

  return `The specific case study or research angle requested in the prompt: ${specializedPortion}.`;
};

const buildSubjectAnchoredSpecializedQuery = (input: {
  subject: string;
  focusQuery: string | null;
}): string | null => {
  if (!input.focusQuery) {
    return null;
  }

  const specializedPortion = input.focusQuery
    .replace(/"/g, "")
    .replace(new RegExp(escapeRegExp(input.subject), "ig"), " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!specializedPortion) {
    return null;
  }

  return `${input.subject} ${specializedPortion}`.trim();
};

const buildHeuristicCoverageGoals = (input: {
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
            `What ${input.subject} is and why it matters`,
            ...input.requestedCoverageGoals,
            input.specializedCoverageGoal ?? null,
            ...(input.requestedCoverageGoals.length === 0
              ? [
                  `One concrete incident, case study, or experiment within ${input.subject}`,
                  `What that case reveals about behavior, systems, or real-world consequences`,
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
              "Essential ingredients",
              "Key preparation steps",
              "Taste, texture, and adjustment",
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

const buildIntentCoverageGoals = (intent: PresentationIntent, subject: string): string[] => {
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

const buildGuessedOfficialUrls = (query: string): string[] => {
  const subject = sanitizeResearchQuery(query);
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (slug.length < 3 || slug.length > 24) {
    return [];
  }

  const urls = [`https://www.${slug}.com/`, `https://${slug}.com/`];

  if (/\b(car|cars|vehicle|vehicles|automotive|truck|trucks)\b/i.test(query)) {
    if (/cars?$/.test(slug)) {
      urls.push(`https://www.${slug}.com/intl/`);
    } else {
      urls.push(`https://www.${slug}cars.com/`);
      urls.push(`https://www.${slug}cars.com/intl/`);
    }
  }

  return [...new Set(urls)];
};

export const buildResearchPlan = (input: {
  topic: string;
  requestedUseWebResearch?: boolean | undefined;
  intent?: PresentationIntent | undefined;
}): ResearchPlan => {
  const intent = input.intent ?? derivePresentationIntent(input.topic);
  const explicitSourceUrls = intent.explicitSourceUrls;
  const strippedTopic = stripExplicitSourceUrls(input.topic) || input.topic.trim();
  const cleanedTopic = stripInstructionalSuffixes(strippedTopic) || strippedTopic;
  const extractedSubject =
    intent.subject || extractPresentationSubject(cleanedTopic) || cleanedTopic;
  const subject = resolveResearchSubject({
    subject: extractedSubject,
    explicitSourceUrls,
    intent,
  });
  const freshnessSensitive = topicLooksTimeSensitive(cleanedTopic);
  const entitySpecific =
    intent.presentationFrame === "organization" || topicLooksEntitySpecific(cleanedTopic);
  const researchSpecific = topicLooksResearchSpecific(cleanedTopic);
  const requiresGroundedFacts =
    explicitSourceUrls.length > 0 ||
    input.requestedUseWebResearch === true ||
    (input.requestedUseWebResearch !== false &&
      topicRequiresGroundedFacts(cleanedTopic));
  const searchQueries: string[] = [];
  const rationale: string[] = [];

  if (explicitSourceUrls.length > 0) {
    rationale.push("Prompt included explicit source URLs.");
  }

  if (
    subject !== extractedSubject &&
    subjectIsGenericEntityReference(extractedSubject) &&
    !subjectIsGenericEntityReference(subject)
  ) {
    rationale.push("Derived a provisional entity subject from the explicit source URL.");
  }

  if (freshnessSensitive) {
    rationale.push("Topic looks time-sensitive.");
    searchQueries.push(`${subject} latest`);
  }

  if (entitySpecific) {
    rationale.push("Topic looks company/entity-specific.");
    if (!researchSpecific) {
      searchQueries.push(`${subject} official`);
    }
  }

  if (researchSpecific) {
    rationale.push("Topic asks for a specific event, case study, or research angle.");
  }

  const specializedFocusQuery = buildSpecializedFocusQuery({
    topic: cleanedTopic,
    subject,
  });
  const subjectAnchoredSpecializedQuery = buildSubjectAnchoredSpecializedQuery({
    subject,
    focusQuery: specializedFocusQuery,
  });

  if (specializedFocusQuery && researchSpecific) {
    searchQueries.push(specializedFocusQuery);
    if (subjectAnchoredSpecializedQuery) {
      searchQueries.push(subjectAnchoredSpecializedQuery);
    }
  }

  if (!researchSpecific) {
    searchQueries.push(subject);
  }

  if (specializedFocusQuery && !researchSpecific) {
    searchQueries.push(specializedFocusQuery);
  }

  const directUrls = [
    ...explicitSourceUrls,
    ...(entitySpecific && !researchSpecific ? buildGuessedOfficialUrls(subject) : []),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const requestedCoverageGoals = (() => {
    const intentCoverageGoals = buildIntentCoverageGoals(intent, subject);
    if (intentCoverageGoals.length > 0) {
      return intentCoverageGoals;
    }

    return extractRequestedCoverageGoals(strippedTopic);
  })();
  const coverageGoals = buildHeuristicCoverageGoals({
    subject,
    freshnessSensitive,
    entitySpecific,
    researchSpecific,
    intent,
    explicitSourceUrls,
    requestedCoverageGoals,
    specializedCoverageGoal:
      requestedCoverageGoals.length > 0
          ? null
          : buildSpecializedCoverageGoal({
            topic: cleanedTopic,
            subject,
          }),
  });

  return {
    subject,
    explicitSourceUrls,
    directUrls,
    searchQueries: [...new Set(searchQueries)].slice(0, 4),
    coverageGoals,
    maxResults: freshnessSensitive ? 4 : 3,
    freshnessSensitive,
    requiresGroundedFacts,
    rationale,
    planningMode: "heuristic",
  };
};

export const mergeResearchPlanWithSuggestion = (input: {
  basePlan: ResearchPlan;
  topic: string;
  suggestion: ResearchPlanningSuggestion;
}): ResearchPlan => {
  const normalizedSuggestedSubject = input.suggestion.subject
    ? normalizeResearchSubjectCandidate(input.suggestion.subject)
    : null;
  const explicitSourceHostnameAnchorMatch =
    normalizedSuggestedSubject &&
    input.basePlan.explicitSourceUrls.length > 0 &&
    normalizeSubjectKey(normalizedSuggestedSubject) ===
      normalizeSubjectKey(input.basePlan.subject) &&
    (
      subjectTokenCount(normalizedSuggestedSubject) >
        subjectTokenCount(input.basePlan.subject) ||
      normalizedSuggestedSubject.length > input.basePlan.subject.length + 1
    );
  const suggestedSubjectMatchesProvisionalAnchor =
    normalizedSuggestedSubject &&
    normalizedSuggestedSubject !== input.basePlan.subject &&
    normalizeSubjectKey(normalizedSuggestedSubject) ===
      normalizeSubjectKey(input.basePlan.subject) &&
    input.basePlan.rationale.includes(
      "Derived a provisional entity subject from the explicit source URL.",
    );
  const subject =
    normalizedSuggestedSubject &&
    !subjectIsGenericEntityReference(normalizedSuggestedSubject) &&
    (subjectIsGenericEntityReference(input.basePlan.subject) ||
      suggestedSubjectMatchesProvisionalAnchor ||
      explicitSourceHostnameAnchorMatch)
      ? normalizedSuggestedSubject
      : input.basePlan.subject;
  const upgradedGenericSubject =
    subject !== input.basePlan.subject &&
    subjectIsGenericEntityReference(input.basePlan.subject);
  const inheritedQueries = upgradedGenericSubject
    ? input.basePlan.searchQueries.map((query) =>
        replaceSubjectReference(query, input.basePlan.subject, subject),
      )
    : input.basePlan.searchQueries;
  const inheritedCoverageGoals = upgradedGenericSubject
    ? input.basePlan.coverageGoals.map((goal) =>
        replaceSubjectReference(goal, input.basePlan.subject, subject),
      )
    : input.basePlan.coverageGoals;

  const llmQueries = input.suggestion.searchQueries
    .map((value) => normalizeResearchQueryCandidate(value))
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      upgradedGenericSubject
        ? replaceSubjectReference(value, input.basePlan.subject, subject)
        : value,
    )
    .filter((value) => queryLooksRelevantToTopic(value, subject, input.topic));

  const llmCoverageGoals = input.suggestion.coverageGoals
    .map((value) => normalizeCoverageGoal(value))
    .filter((value): value is string => Boolean(value));

  const rationale = uniqueStrings([
    ...input.basePlan.rationale,
    ...input.suggestion.rationale
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 8),
  ]).slice(0, 8);

  const searchQueries = uniqueStrings([
    ...inheritedQueries,
    ...llmQueries,
  ]).slice(0, 5);

  const coverageGoals = uniqueStrings([
    ...inheritedCoverageGoals,
    ...llmCoverageGoals,
  ]).slice(0, 5);

  const llmAssisted =
    subject !== input.basePlan.subject ||
    llmQueries.length > 0 ||
    llmCoverageGoals.length > 0;

  const directUrls =
    subject !== input.basePlan.subject && input.basePlan.directUrls.length > 0
      ? uniqueStrings([
          ...input.basePlan.explicitSourceUrls,
          ...buildGuessedOfficialUrls(subject),
        ])
      : input.basePlan.directUrls;

  return {
    ...input.basePlan,
    subject,
    directUrls,
    searchQueries,
    coverageGoals,
    rationale,
    planningMode: llmAssisted ? "llm-assisted" : input.basePlan.planningMode,
  };
};

export const shouldUseWebResearchForTopic = (input: {
  topic: string;
  requestedUseWebResearch?: boolean | undefined;
}): boolean => {
  if (input.requestedUseWebResearch === true) {
    return true;
  }

  if (input.requestedUseWebResearch === false) {
    return false;
  }

  return topicRequiresGroundedFacts(input.topic);
};
