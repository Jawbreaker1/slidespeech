import type {
  Deck,
  PresentationReview,
  SlideNarration,
} from "@slidespeech/types";

import { buildDeterministicReview } from "./deterministic-generation";
import { evaluateDeckQuality } from "./evaluation";
import {
  ensureDeckTheme,
  ensureNarrationSegments,
  REVIEW_NARRATION_REPAIR_CODE_PATTERN,
  type ValidationIssue,
} from "./session-deck-quality";
import { nowIso } from "./utils";
import { rebuildNarrationFromSlideAnchors } from "./validation";

export const countReadySlides = (
  deck: Deck,
  narrationBySlideId: Record<string, SlideNarration>,
): number =>
  deck.slides.reduce(
    (count, slide) => count + (narrationBySlideId[slide.id] ? 1 : 0),
    0,
  );

export const buildGenerationStatus = (
  deck: Deck,
  narrationReadySlides: number,
  backgroundEnrichmentPending: boolean,
  lastCompletedAt?: string,
): NonNullable<Deck["metadata"]["generation"]> => ({
  narrationReadySlides,
  totalSlides: deck.slides.length,
  backgroundEnrichmentPending,
  ...(lastCompletedAt ? { lastCompletedAt } : {}),
});

const dedupeValidationIssues = (
  issues: ValidationIssue[],
): ValidationIssue[] => {
  const seen = new Set<string>();
  const deduped: ValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}:${issue.slideId ?? ""}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
};

export const mergeValidationMetadata = (
  deck: Deck,
  additionalIssues: ValidationIssue[],
  summary?: string,
  overallScore?: number,
): NonNullable<Deck["metadata"]["validation"]> => {
  const combinedIssues = dedupeValidationIssues([
    ...(deck.metadata.validation?.issues ?? []),
    ...additionalIssues,
  ]);

  return {
    passed: !combinedIssues.some((issue) => issue.severity === "error"),
    repaired:
      Boolean(deck.metadata.validation?.repaired) || additionalIssues.length > 0,
    validatedAt: nowIso(),
    ...((summary ?? deck.metadata.validation?.summary) !== undefined
      ? { summary: summary ?? deck.metadata.validation?.summary }
      : {}),
    ...((overallScore ?? deck.metadata.validation?.overallScore) !== undefined
      ? {
          overallScore:
            overallScore ?? deck.metadata.validation?.overallScore,
        }
      : {}),
    issues: combinedIssues,
  };
};

export const buildDeterministicPresentationReview = (
  deck: Deck,
  validationIssues: ValidationIssue[],
  repairedNarrations: SlideNarration[],
  note?: string,
): PresentationReview =>
  buildDeterministicReview({
    deck,
    validationIssues: validationIssues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      ...(issue.slideId ? { slideId: issue.slideId } : {}),
    })),
    repairedNarrations,
    ...(note ? { note } : {}),
  });

export const shouldPreferDeterministicReview = (
  llmReview: PresentationReview,
  deterministicReview: PresentationReview,
): boolean => {
  if (llmReview.repairedNarrations.length > 0) {
    return false;
  }

  const scoreGap = deterministicReview.overallScore - llmReview.overallScore;
  const issueGap = llmReview.issues.length - deterministicReview.issues.length;
  const llmIsMuchHarsher =
    deterministicReview.approved &&
    !llmReview.approved &&
    scoreGap >= 0.15;

  return (
    llmIsMuchHarsher ||
    scoreGap >= 0.25 ||
    (scoreGap >= 0.15 && issueGap >= 2)
  );
};

export const mergeReviewedNarrations = (
  narrations: SlideNarration[],
  repairedNarrations: SlideNarration[],
): SlideNarration[] => {
  const repairedBySlideId = new Map(
    repairedNarrations.map((narration) => [
      narration.slideId,
      ensureNarrationSegments(narration),
    ]),
  );

  return narrations.map((narration) =>
    repairedBySlideId.get(narration.slideId) ??
    ensureNarrationSegments(narration),
  );
};

export const mergeNewNarrationsPreservingExisting = (
  existingBySlideId: Record<string, SlideNarration>,
  candidateNarrations: SlideNarration[],
): Record<string, SlideNarration> => {
  const candidateBySlideId = Object.fromEntries(
    candidateNarrations.map((narration) => [
      narration.slideId,
      ensureNarrationSegments(narration),
    ]),
  );

  return {
    ...candidateBySlideId,
    ...existingBySlideId,
  };
};

const resolveSlideIdFromReviewIssue = (
  deck: Deck,
  issue: PresentationReview["issues"][number],
): string | null => {
  if (issue.slideId && deck.slides.some((slide) => slide.id === issue.slideId)) {
    return issue.slideId;
  }

  const slideIdNumberMatch = issue.slideId?.match(/\bSlide\s+(\d+)\b/i);
  if (slideIdNumberMatch) {
    const slideIndex = Number(slideIdNumberMatch[1]) - 1;
    return deck.slides[slideIndex]?.id ?? null;
  }

  const slideNumberMatch = issue.message.match(/\bSlide\s+(\d+)\b/i);
  if (!slideNumberMatch) {
    return null;
  }

  const slideIndex = Number(slideNumberMatch[1]) - 1;
  return deck.slides[slideIndex]?.id ?? null;
};

export const applyLocalNarrationRepairsFromReview = (
  deck: Deck,
  narrations: SlideNarration[],
  review: PresentationReview,
): { narrations: SlideNarration[]; issues: ValidationIssue[] } => {
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, ensureNarrationSegments(narration)]),
  );
  const issues: ValidationIssue[] = [];

  for (const reviewIssue of review.issues) {
    if (!REVIEW_NARRATION_REPAIR_CODE_PATTERN.test(reviewIssue.code)) {
      continue;
    }

    const slideId = resolveSlideIdFromReviewIssue(deck, reviewIssue);
    if (!slideId) {
      continue;
    }

    const slide = deck.slides.find((candidate) => candidate.id === slideId);
    if (!slide) {
      continue;
    }

    narrationBySlideId.set(
      slide.id,
      rebuildNarrationFromSlideAnchors(deck, slide, narrationBySlideId.get(slide.id)),
    );
    issues.push({
      code: "narration_review_repaired",
      message: `Narration for "${slide.title}" was rebuilt locally after review flagged ${reviewIssue.code.toLowerCase()}.`,
      severity: "warning",
      slideId: slide.id,
    });
  }

  return {
    narrations: deck.slides
      .map((slide) => narrationBySlideId.get(slide.id))
      .filter((narration): narration is SlideNarration => Boolean(narration)),
    issues,
  };
};

export const finalizeDeckMetadata = (
  deck: Deck,
  narrations: SlideNarration[],
  review: PresentationReview,
  additionalValidationIssues: ValidationIssue[] = [],
): Deck => {
  const evaluation = evaluateDeckQuality(deck, narrations);
  const reviewIssues: ValidationIssue[] = review.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
    ...(issue.slideId ? { slideId: issue.slideId } : {}),
  }));
  const validation = mergeValidationMetadata(
    deck,
    [...additionalValidationIssues, ...reviewIssues],
    review.summary,
    review.overallScore,
  );

  return ensureDeckTheme({
    ...deck,
    updatedAt: nowIso(),
    metadata: {
      ...deck.metadata,
      validation: {
        ...validation,
        passed: validation.passed && review.approved,
      },
      evaluation,
      generation: buildGenerationStatus(
        deck,
        narrations.length,
        false,
        nowIso(),
      ),
    },
  });
};
