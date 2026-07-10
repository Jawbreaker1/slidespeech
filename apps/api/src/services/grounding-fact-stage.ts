import type { CreatePresentationSessionInput } from "@slidespeech/core";
import type {
  GroundingClassificationResult,
  PresentationIntent,
} from "@slidespeech/types";

import { appContext } from "../lib/context";
import { buildGroundingBundle } from "./grounding-selection";
import type { GroundingFindingSource } from "./research-source-stage";
import type { ResearchPlan } from "./research-policy";

export type GroundingFactStage = Pick<
  CreatePresentationSessionInput,
  | "groundingSummary"
  | "groundingHighlights"
  | "groundingExcerpts"
  | "groundingCoverageGoals"
  | "groundingSourceIds"
  | "groundingFacts"
  | "groundingSourceType"
>;

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const groundingClassificationHasContent = (
  classification: GroundingClassificationResult,
): boolean =>
  (classification.facts?.length ?? 0) > 0 ||
  (classification.highlights?.length ?? 0) > 0 ||
  (classification.excerpts?.length ?? 0) > 0 ||
  (classification.sourceAssessments?.length ?? 0) > 0 ||
  (classification.relevantSourceUrls?.length ?? 0) > 0;

export const buildGroundingFactStage = async (input: {
  allGroundingFindings: GroundingFindingSource[];
  effectiveIntent: PresentationIntent;
  presentationBrief?: string | undefined;
  presentationSubject: string;
  researchPlan: ResearchPlan;
  researchSummary: string;
  successfulGroundingUrls: string[];
}): Promise<GroundingFactStage> => {
  let groundingClassification: GroundingClassificationResult | undefined;

  if (input.allGroundingFindings.length > 0) {
    try {
      groundingClassification = await appContext.llmProvider.classifyGrounding({
        topic: input.presentationSubject,
        ...(input.presentationBrief
          ? { presentationBrief: input.presentationBrief }
          : {}),
        intent: {
          ...input.effectiveIntent,
          subject: input.presentationSubject,
          framing: input.presentationBrief ?? input.effectiveIntent.framing,
        },
        coverageGoals: input.researchPlan.coverageGoals,
        findings: input.allGroundingFindings,
      });
    } catch (error) {
      console.warn(
        `[slidespeech] grounding classification failed for "${input.presentationSubject}": ${(error as Error).message}`,
      );
    }
  }

  const effectiveGroundingClassification =
    groundingClassification && groundingClassificationHasContent(groundingClassification)
      ? groundingClassification
      : undefined;

  if (groundingClassification && !effectiveGroundingClassification) {
    console.warn(
      `[slidespeech] grounding classification returned no usable content for "${input.presentationSubject}"; using source-supported excerpts only.`,
    );
  }

  const {
    groundingHighlights,
    groundingExcerpts,
    groundingCoverageGoals,
    groundingSourceIds,
    groundingFacts,
  } = buildGroundingBundle({
    subject: input.presentationSubject,
    coverageGoals: input.researchPlan.coverageGoals,
    findings: input.allGroundingFindings,
    ...(effectiveGroundingClassification
      ? { classification: effectiveGroundingClassification }
      : {}),
  });

  if (input.researchPlan.requiresGroundedFacts && groundingSourceIds.length === 0) {
    throw new Error(
      `Fetched sources did not contain trustworthy grounding for "${input.presentationSubject}". Refusing to generate a deck from adjacent generic material.`,
    );
  }

  if (input.researchPlan.requiresGroundedFacts && groundingFacts.length === 0) {
    throw new Error(
      `Fetched sources did not yield classified grounding facts for "${input.presentationSubject}". Refusing to generate a deck from weak heuristic source excerpts.`,
    );
  }

  const groundingSummary =
    effectiveGroundingClassification?.highlights.length
      ? uniqueNonEmptyStrings([
          ...groundingHighlights,
          ...groundingExcerpts.slice(0, 4),
        ]).join("\n")
      : input.researchSummary;
  const hasGroundingContext = Boolean(
    groundingSummary ||
      groundingHighlights.length > 0 ||
      groundingExcerpts.length > 0 ||
      groundingCoverageGoals.length > 0 ||
      groundingFacts.length > 0 ||
      groundingSourceIds.length > 0,
  );

  return hasGroundingContext
    ? {
        ...(groundingSummary ? { groundingSummary } : {}),
        ...(groundingHighlights.length > 0 ? { groundingHighlights } : {}),
        ...(groundingExcerpts.length > 0 ? { groundingExcerpts } : {}),
        ...(groundingCoverageGoals.length > 0 ? { groundingCoverageGoals } : {}),
        ...(groundingFacts.length > 0 ? { groundingFacts } : {}),
        groundingSourceIds:
          groundingSourceIds.length > 0
            ? groundingSourceIds
            : input.successfulGroundingUrls,
        groundingSourceType: "mixed",
      }
    : {};
};
