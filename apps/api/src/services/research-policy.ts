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
export {
  topicLooksEntitySpecific,
  topicLooksResearchSpecific,
  topicLooksTimeSensitive,
  topicRequiresGroundedFacts,
} from "./research-topic-classification";
import {
  topicLooksEntitySpecific,
  topicLooksResearchSpecific,
  topicLooksTimeSensitive,
  topicRequiresGroundedFacts,
} from "./research-topic-classification";
import {
  normalizeResearchSubjectKey,
  resolveResearchSubject,
  researchSubjectTokenCount,
} from "./research-plan-subject";
import {
  buildHeuristicCoverageGoals,
  buildIntentCoverageGoals,
  buildSpecializedCoverageGoal,
  buildSpecializedFocusQuery,
  buildSubjectAnchoredSpecializedQuery,
  extractRequestedCoverageGoals,
} from "./research-plan-coverage";
import { replaceLiteralCaseInsensitive } from "./research-text-utils";

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

const uniqueStrings = (values: string[]): string[] =>
  values.filter((value, index, array) => array.indexOf(value) === index);

const replaceSubjectReference = (
  value: string,
  fromSubject: string,
  toSubject: string,
): string => {
  return replaceLiteralCaseInsensitive(value, fromSubject, toSubject);
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

  if (researchSpecific && !specializedFocusQuery) {
    searchQueries.push(subject);
  }

  if (specializedFocusQuery && !researchSpecific) {
    searchQueries.push(subjectAnchoredSpecializedQuery ?? specializedFocusQuery);
  }

  if (!researchSpecific) {
    searchQueries.push(subject);
  }

  const directUrls = [...explicitSourceUrls].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
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
    normalizeResearchSubjectKey(normalizedSuggestedSubject) ===
      normalizeResearchSubjectKey(input.basePlan.subject) &&
    (
      researchSubjectTokenCount(normalizedSuggestedSubject) >
        researchSubjectTokenCount(input.basePlan.subject) ||
      normalizedSuggestedSubject.length > input.basePlan.subject.length + 1
    );
  const suggestedSubjectMatchesProvisionalAnchor =
    normalizedSuggestedSubject &&
    normalizedSuggestedSubject !== input.basePlan.subject &&
    normalizeResearchSubjectKey(normalizedSuggestedSubject) ===
      normalizeResearchSubjectKey(input.basePlan.subject) &&
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
    );

  const llmCoverageGoals = input.suggestion.coverageGoals
    .map((value) => normalizeCoverageGoal(value))
    .filter((value): value is string => Boolean(value));

  const rationale = uniqueStrings([
    ...input.basePlan.rationale,
    ...input.suggestion.rationale
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 8),
  ]).slice(0, 8);

  const searchQueries = uniqueStrings(
    llmQueries.length > 0 ? llmQueries : inheritedQueries,
  ).slice(0, 5);

  const coverageGoals = uniqueStrings(
    llmCoverageGoals.length > 0 ? llmCoverageGoals : inheritedCoverageGoals,
  ).slice(0, 5);

  const llmAssisted =
    subject !== input.basePlan.subject ||
    llmQueries.length > 0 ||
    llmCoverageGoals.length > 0;

  return {
    ...input.basePlan,
    subject,
    directUrls: input.basePlan.directUrls,
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
