import type {
  Deck,
  GenerateDeckInput,
  PedagogicalProfile,
  PresentationReview,
  SlideNarration,
} from "@slidespeech/types";

import { evaluateDeckQuality } from "./evaluation";
import type { PresentationQualityReviewer } from "./planners";
import {
  buildDeckSemanticReviewAssessment,
  type ValidationIssue,
} from "./session-deck-quality";
import {
  buildLocalBaselinePresentationReview,
  collectNarrationRevisionIssuesFromReview,
} from "./session-review-helpers";
import { validateNarrations } from "./validation";

const MINIMUM_PUBLISHABLE_PRESENTATION_REVIEW_SCORE = 0.4;

const BLOCKING_PRESENTATION_REVIEW_CODE_FRAGMENTS = [
  "review_unavailable",
  "prompt_leakage",
  "prompt_contamination",
  "instruction_leak",
  "source_noise",
  "meta_slide",
  "language_quality",
  "wrong_language",
  "mixed_language",
  "unsupported",
  "repeated",
  "duplicate",
  "validation",
  "repair_failed",
];

const BLOCKING_PRESENTATION_REVIEW_CODE_PREFIXES = [
  "narration_alignment",
  "narration_missing",
  "narration_failed",
  "narration_unavailable",
];

const BLOCKING_GROUNDING_MESSAGE_TERMS = [
  "unsupported",
  "wrong",
  "missing",
  "unavailable",
];

const presentationReviewCodeIsBlocking = (code: string): boolean => {
  const normalized = code.toLowerCase();
  return (
    BLOCKING_PRESENTATION_REVIEW_CODE_FRAGMENTS.some((fragment) =>
      normalized.includes(fragment),
    ) ||
    BLOCKING_PRESENTATION_REVIEW_CODE_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  );
};

const groundingMessageIsBlocking = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return BLOCKING_GROUNDING_MESSAGE_TERMS.some((term) =>
    normalized.includes(term),
  );
};

const presentationReviewIssueIsBlocking = (
  issue: PresentationReview["issues"][number],
): boolean =>
  issue.severity === "error" &&
  (
    presentationReviewCodeIsBlocking(issue.code) ||
    (issue.dimension === "grounding" && groundingMessageIsBlocking(issue.message))
  );

export const reviewHasBlockingDeckIssues = (review: PresentationReview): boolean =>
  !review.approved ||
  review.overallScore < MINIMUM_PUBLISHABLE_PRESENTATION_REVIEW_SCORE ||
  review.issues.some(presentationReviewIssueIsBlocking);

export const formatBlockingReviewIssues = (review: PresentationReview): string =>
  review.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message)
    .join(" | ") ||
  review.summary ||
  "The generated presentation failed final quality review.";

const BLOCKING_DECK_VALIDATION_CODES = new Set([
  "duplicate_visible_points",
  "repeated_slide_surface",
]);

export const isBlockingDeckValidationIssue = (issue: ValidationIssue): boolean =>
  issue.severity === "error" || BLOCKING_DECK_VALIDATION_CODES.has(issue.code);

export const formatBlockingDeckValidationIssues = (
  issues: ValidationIssue[],
): string =>
  issues
    .filter(isBlockingDeckValidationIssue)
    .map((issue) => issue.message)
    .join(" | ") ||
  "The generated presentation failed quality validation.";

const formatBlockingDeckSemanticAssessment = (
  summary: string,
  reasons: string[],
): string =>
  reasons.length > 0
    ? reasons.join(" | ")
    : summary || "The generated presentation failed semantic deck review.";

export const reviewPresentationWithLocalBaseline = async (input: {
  qualityReviewer: PresentationQualityReviewer;
  deck: Deck;
  narrations: SlideNarration[];
  pedagogicalProfile: PedagogicalProfile;
  validationIssues: ValidationIssue[];
  baselineNote: string;
  topic: string;
}): Promise<PresentationReview> => {
  const localBaselineReview = buildLocalBaselinePresentationReview(
    input.validationIssues,
    input.baselineNote,
  );

  try {
    const llmReview = await input.qualityReviewer.review({
      deck: input.deck,
      narrations: input.narrations,
      pedagogicalProfile: input.pedagogicalProfile,
    });

    const localEvaluation = evaluateDeckQuality(input.deck, input.narrations, {
      includeNarration: input.narrations.length >= input.deck.slides.length,
    });
    const localBlockingIssues: PresentationReview["issues"] = [
      ...localBaselineReview.issues,
      ...localEvaluation.checks
        .filter((check) => check.status === "fail")
        .map((check) => ({
          code: check.code,
          message: check.message,
          dimension: "deck" as const,
          severity: "error" as const,
        })),
    ].filter((issue) => issue.severity === "error");

    if (localBlockingIssues.length === 0) {
      return llmReview;
    }

    const issueKeys = new Set(
      llmReview.issues.map((issue) => `${issue.severity}:${issue.message}`),
    );
    const mergedIssues = [...llmReview.issues];
    for (const issue of localBlockingIssues) {
      const key = `${issue.severity}:${issue.message}`;
      if (issueKeys.has(key)) {
        continue;
      }
      issueKeys.add(key);
      mergedIssues.push(issue);
    }

    if (mergedIssues.some((issue) => issue.severity === "error")) {
      console.warn(
        `[slidespeech] local review baseline added blocking quality issues for topic "${input.topic}": ${mergedIssues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)
          .join(", ")}`,
      );
    }

    return {
      ...llmReview,
      approved:
        llmReview.approved &&
        !mergedIssues.some((issue) => issue.severity === "error"),
      overallScore: Math.min(
        llmReview.overallScore,
        localBaselineReview.overallScore,
        localEvaluation.overallScore,
      ),
      issues: mergedIssues,
    };
  } catch (error) {
    const message = (error as Error).message;
    console.warn(
      `[slidespeech] presentation LLM review unavailable for topic "${input.topic}"; rejecting presentation: ${message}`,
    );
    return {
      ...localBaselineReview,
      approved: false,
      overallScore: 0,
      summary: `Presentation LLM review unavailable: ${message}`,
      issues: [
        {
          code: "presentation_review_unavailable",
          message: `Presentation LLM review unavailable: ${message}`,
          dimension: "coherence",
          severity: "error",
        },
        ...localBaselineReview.issues,
      ],
      repairedNarrations: [],
    };
  }
};

export const reviewDeckBeforePublishing = async (input: {
  qualityReviewer: PresentationQualityReviewer;
  deck: Deck;
  generationInput: GenerateDeckInput;
  pedagogicalProfile: PedagogicalProfile;
  topic: string;
}): Promise<void> => {
  const review = await input.qualityReviewer.reviewDeckSemantics({
    deck: input.deck,
    generationInput: input.generationInput,
    pedagogicalProfile: input.pedagogicalProfile,
  });
  const assessment = buildDeckSemanticReviewAssessment(review);

  if (assessment.fatal || assessment.failingCoreChecks.length > 0) {
    throw new Error(
      `Presentation generation failed pre-publish deck review for "${input.topic}": ${formatBlockingDeckSemanticAssessment(review.summary, assessment.reasons)}`,
    );
  }

  if (assessment.retryable) {
    console.warn(
      `[slidespeech] pre-publish deck review for "${input.topic}" reported non-blocking warnings: ${assessment.reasons.join(" | ")}`,
    );
  }
};

export const validateReviewedNarrationsForPublication = (input: {
  deck: Deck;
  narrations: SlideNarration[];
  review: PresentationReview;
  priorValidationIssues?: ValidationIssue[];
}): { narrations: SlideNarration[]; issues: ValidationIssue[] } => {
  const reviewedNarrationValidation = validateNarrations(
    input.deck,
    input.narrations,
    { generateMissing: false },
  );
  const narrationRevisionIssues = collectNarrationRevisionIssuesFromReview(
    input.deck,
    input.review,
  );

  return {
    narrations: reviewedNarrationValidation.value,
    issues: [
      ...(input.priorValidationIssues ?? []),
      ...reviewedNarrationValidation.issues,
      ...narrationRevisionIssues,
    ],
  };
};
