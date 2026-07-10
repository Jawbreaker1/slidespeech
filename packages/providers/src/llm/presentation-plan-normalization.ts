import type { GenerateDeckInput, GroundingFact } from "@slidespeech/types";

import {
  inferContentLanguageFromInput,
  textAppearsOutsideContentLanguage,
} from "./content-language";
import { semanticTextSimilarity } from "./deck-shape-text";
import { normalizeAudienceLevel } from "./pedagogical-profile-normalization";
import { deriveSlideArcPolicy } from "./slide-arc-policy";
import type { ArcPolicyInput } from "./slide-arc-policy";
import { toStringArray } from "./structured-normalization";

const normalizePlanText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");

const uniqueCleanStoryline = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const factSupportedSlideCount = (
  facts: GroundingFact[] | undefined,
): number | null => {
  if (!facts?.length) {
    return null;
  }

  const concreteFacts = facts.filter(
    (fact) => fact.role !== "background" && fact.role !== "reference",
  );
  const usableFactCount = concreteFacts.length || facts.length;
  const concreteRoleCount = new Set(concreteFacts.map((fact) => fact.role)).size;
  if (usableFactCount > 2 && concreteRoleCount <= 2) {
    return Math.min(4, usableFactCount + 1);
  }
  return Math.max(3, Math.min(7, usableFactCount + 1));
};

export const normalizePresentationPlan = (
  value: unknown,
  overrides?: {
    targetSlideCount?: number | undefined;
    topic?: string | undefined;
    subject?: string | undefined;
    intent?: ArcPolicyInput["intent"];
    groundingHighlights?: string[] | undefined;
    groundingCoverageGoals?: string[] | undefined;
    groundingSourceIds?: string[] | undefined;
    groundingFacts?: GroundingFact[] | undefined;
  },
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const topic = overrides?.topic ?? "the topic";
  const subject = overrides?.subject ?? topic;
  const requestedSlideCount =
    overrides?.targetSlideCount ??
    (typeof candidate.recommendedSlideCount === "number"
      ? candidate.recommendedSlideCount
      : 4);
  const sourceBackedFactCap =
    deriveSlideArcPolicy({
      intent: overrides?.intent,
      groundingHighlights: overrides?.groundingHighlights,
      groundingCoverageGoals: overrides?.groundingCoverageGoals,
      groundingSourceIds: overrides?.groundingSourceIds,
      groundingFacts: overrides?.groundingFacts,
    }) === "source-backed-subject"
      ? factSupportedSlideCount(overrides?.groundingFacts)
      : null;
  const cappedRequestedSlideCount =
    sourceBackedFactCap === null
      ? requestedSlideCount
      : Math.min(requestedSlideCount, sourceBackedFactCap);
  const arcInput: ArcPolicyInput = {
    intent: overrides?.intent,
    groundingHighlights: overrides?.groundingHighlights,
    groundingCoverageGoals: overrides?.groundingCoverageGoals,
    groundingSourceIds: overrides?.groundingSourceIds,
    groundingFacts: overrides?.groundingFacts,
  };
  const language = inferContentLanguageFromInput({
    topic,
    presentationBrief: undefined,
    intent: overrides?.intent,
    plan: typeof candidate === "object" && candidate !== null
      ? {
          title: typeof candidate.title === "string" ? candidate.title : "",
          learningObjectives: toStringArray(candidate.learningObjectives),
          storyline: toStringArray(candidate.storyline),
          recommendedSlideCount: Math.max(1, Math.round(cappedRequestedSlideCount)),
          audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
        }
      : undefined,
  });
  const storyline: string[] = [];
  for (const step of uniqueCleanStoryline(
    toStringArray(candidate.storyline).map(normalizePlanText),
  )) {
    const wrongLanguage = textAppearsOutsideContentLanguage(step, language);
    const tooSimilar = storyline.some(
      (previousStep) => semanticTextSimilarity(step, previousStep) >= 0.72,
    );

    if (!wrongLanguage && !tooSimilar) {
      storyline.push(step);
    }
  }

  if (storyline.length === 0) {
    throw new Error("Generated presentation plan has no usable storyline beats.");
  }

  const recommendedSlideCount = Math.max(
    1,
    Math.min(Math.round(cappedRequestedSlideCount), storyline.length),
  );
  const normalizedTitle =
    typeof candidate.title === "string"
      ? normalizePlanText(candidate.title)
      : "";
  if (
    !normalizedTitle ||
    textAppearsOutsideContentLanguage(normalizedTitle, language)
  ) {
    throw new Error("Generated presentation plan has no usable title.");
  }

  const learningObjectives = toStringArray(candidate.learningObjectives)
    .map(normalizePlanText)
    .filter(
      (objective) =>
        objective.length > 0 &&
        !textAppearsOutsideContentLanguage(objective, language),
    );

  if (learningObjectives.length === 0) {
    throw new Error("Generated presentation plan has no usable learning objectives.");
  }

  return {
    ...candidate,
    title: normalizedTitle,
    learningObjectives,
    storyline: storyline.slice(0, recommendedSlideCount),
    recommendedSlideCount,
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
  };
};
