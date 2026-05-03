import type {
  Deck,
  DeckSemanticReviewResult,
  PedagogicalProfile,
  PresentationIntent,
  PresentationTheme,
  SlideNarration,
} from "@slidespeech/types";
import { pickPresentationTheme } from "@slidespeech/types";

import { evaluateDeckQuality } from "./evaluation";
import {
  findTextQualityGuardHit,
  getActiveDeckInstructionalPatterns,
  PROMPT_CONTAMINATION_PATTERNS,
} from "./text-quality-guards";
import { validateAndRepairDeck } from "./validation";

export type ValidationIssue = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  slideId?: string | undefined;
};

export type DeckCandidateAssessment = {
  retryable: boolean;
  fatal: boolean;
  score: number;
  reasons: string[];
  revisionNotes: string[];
  failingCoreChecks: string[];
};

export type BackgroundEnrichmentInput = {
  deck: Deck;
  sessionId: string;
  pedagogicalProfile: PedagogicalProfile;
  initialNarrations: SlideNarration[];
  topic: string;
};

export const MAX_DECK_GENERATION_ATTEMPTS = 3;

export const REVIEW_NARRATION_REPAIR_CODE_PATTERN =
  /(?:VERBATIM|CONTENT_DRIFT|GROUNDING_WEAK|GROUNDING_MISMATCH|SEGMENT_COUNT_VIOLATION|NARR_VERBATIM)/i;

const CORE_DECK_QUALITY_FAILURE_CODES = new Set([
  "meta_slide_language",
  "topic_alignment",
  "intro_slide_substance",
  "source_noise_contamination",
  "cross_slide_distinctness",
  "language_quality",
  "prompt_contamination",
]);

export const ensureDeckTheme = (
  deck: Deck,
  preferredTheme?: PresentationTheme,
): Deck => ({
  ...deck,
  metadata: {
    ...deck.metadata,
    theme:
      preferredTheme ??
      deck.metadata.theme ??
      pickPresentationTheme(`${deck.id}:${deck.topic}`),
  },
});

const splitNarrationIntoSegments = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceLikeSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const splitLongSegment = (segment: string, maxLength = 260): string[] => {
    if (segment.length <= maxLength) {
      return [segment];
    }

    const clausePieces = segment
      .split(/(?<=[,;:])\s+/)
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (clausePieces.length > 1) {
      const grouped: string[] = [];
      let current = "";

      for (const piece of clausePieces) {
        const next = current ? `${current} ${piece}` : piece;
        if (current && next.length > maxLength) {
          grouped.push(current);
          current = piece;
        } else {
          current = next;
        }
      }

      if (current) {
        grouped.push(current);
      }

      if (grouped.every((piece) => piece.length < segment.length)) {
        return grouped.flatMap((piece) => splitLongSegment(piece, maxLength));
      }
    }

    const words = segment.split(/\s+/).filter(Boolean);
    if (words.length < 8) {
      return [segment];
    }

    const midpoint = Math.max(1, Math.floor(words.length / 2));
    return [
      words.slice(0, midpoint).join(" "),
      words.slice(midpoint).join(" "),
    ].flatMap((piece) => splitLongSegment(piece, maxLength));
  };

  const rebalanceSegments = (segments: string[]): string[] =>
    segments
      .flatMap((segment) => splitLongSegment(segment))
      .map((segment) => segment.trim())
      .filter(Boolean);

  if (sentenceLikeSegments.length > 1) {
    return rebalanceSegments(sentenceLikeSegments);
  }

  const clauseSegments = normalized
    .split(/,\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return clauseSegments.length > 1
    ? rebalanceSegments(clauseSegments)
    : rebalanceSegments([normalized]);
};

export const evaluateDeckCandidateForRetry = (
  deck: Deck,
  intent?: PresentationIntent,
): DeckCandidateAssessment => {
  const reasons: string[] = [];
  const revisionNotes: string[] = [];
  const validationProbe = validateAndRepairDeck(deck);
  const evaluation = evaluateDeckQuality(deck, []);
  const activeInstructionalPatterns = getActiveDeckInstructionalPatterns(intent);
  const metaRepairCount = validationProbe.issues.filter(
    (issue) => issue.code === "meta_presentation_slide_repaired",
  ).length;

  if (
    validationProbe.issues.some(
      (issue) => issue.code === "deck_wide_meta_presentation_repaired",
    ) ||
    metaRepairCount >= 2
  ) {
    reasons.push(
      "The draft drifted into presentation-making or instructional language on multiple slides.",
    );
  }

  for (const issue of validationProbe.issues.filter(
    (candidateIssue) => candidateIssue.code === "meta_presentation_slide_repaired",
  )) {
    const offendingSlide = deck.slides.find((slide) => slide.id === issue.slideId);
    if (offendingSlide) {
      revisionNotes.push(
        `Replace slide "${offendingSlide.title}" with concrete subject content about ${deck.topic}. Do not summarize the presentation or tell the presenter what to do.`,
      );
    }
  }

  const promptContaminationCheck = evaluation.checks.find(
    (check) => check.code === "prompt_contamination",
  );
  if (promptContaminationCheck && promptContaminationCheck.status !== "pass") {
    const promptHit = findTextQualityGuardHit(
      [
        { label: "deck topic", value: deck.topic },
        { label: "deck title", value: deck.title },
        ...deck.slides.flatMap((slide) => [
          { label: `slide "${slide.title}" title`, value: slide.title },
          {
            label: `slide "${slide.title}" learning goal`,
            value: slide.learningGoal,
          },
          {
            label: `slide "${slide.title}" beginner explanation`,
            value: slide.beginnerExplanation,
          },
          {
            label: `slide "${slide.title}" advanced explanation`,
            value: slide.advancedExplanation,
          },
          ...slide.keyPoints.map((point, index) => ({
            label: `slide "${slide.title}" key point ${index + 1}`,
            value: point,
          })),
          ...slide.examples.map((example, index) => ({
            label: `slide "${slide.title}" example ${index + 1}`,
            value: example,
          })),
        ]),
      ],
      PROMPT_CONTAMINATION_PATTERNS,
    );
    reasons.push(
      promptHit
        ? `Titles or learning goals still contain prompt/instruction leakage instead of a clean subject framing (${promptHit.label}: "${promptHit.value}").`
        : "Titles or learning goals still contain prompt/instruction leakage instead of a clean subject framing.",
    );
  }

  const introSlide = deck.slides[0];
  if (introSlide) {
    const abstractIntro =
      /\b(critical need|foundations|why this matters|importance of|introduction to)\b/i.test(
        introSlide.title,
      ) && !introSlide.title.toLowerCase().includes(deck.topic.toLowerCase());
    const thinIntro =
      introSlide.keyPoints.length < 3 ||
      (introSlide.beginnerExplanation.trim().length < 90 &&
        introSlide.learningGoal.trim().length < 70);

    if (abstractIntro || thinIntro) {
      reasons.push(
        "The opening slide needs to introduce the subject more concretely with a stronger title and more substance.",
      );
      revisionNotes.push(
        `Rewrite slide "${introSlide.title}" into a concrete opening to ${deck.topic}. Name the subject directly and state one memorable fact or responsibility in plain language.`,
      );
    }
  }

  const contaminatedSlides = deck.slides.filter((slide) =>
    [slide.title, slide.learningGoal, ...slide.keyPoints].some((value) =>
      PROMPT_CONTAMINATION_PATTERNS.some((pattern) => pattern.test(value)),
    ),
  );
  if (contaminatedSlides.length > 0) {
    const contaminationHit = findTextQualityGuardHit(
      contaminatedSlides.flatMap((slide) => [
        { label: `slide "${slide.title}" title`, value: slide.title },
        {
          label: `slide "${slide.title}" learning goal`,
          value: slide.learningGoal,
        },
        ...slide.keyPoints.map((point, index) => ({
          label: `slide "${slide.title}" key point ${index + 1}`,
          value: point,
        })),
      ]),
      PROMPT_CONTAMINATION_PATTERNS,
    );
    reasons.push(
      contaminationHit
        ? `At least one slide still leaks prompt text such as creation instructions or external-information hints (${contaminationHit.label}: "${contaminationHit.value}").`
        : "At least one slide still leaks prompt text such as creation instructions or external-information hints.",
    );
    for (const slide of contaminatedSlides) {
      revisionNotes.push(
        `Remove prompt leakage from slide "${slide.title}". Do not mention creation instructions, external-information hints, or brief text in titles or learning goals.`,
      );
    }
  }

  const instructionalSlides = deck.slides.filter((slide) =>
    slide.keyPoints.some((point) =>
      activeInstructionalPatterns.some((pattern) => pattern.test(point)),
    ),
  );
  if (instructionalSlides.length > 0) {
    reasons.push(
      "At least one slide still uses imperative or instructional bullet points instead of audience-facing claims.",
    );
    for (const slide of instructionalSlides) {
      revisionNotes.push(
        `Rewrite the bullet points on slide "${slide.title}" as complete declarative claims about ${deck.topic}.`,
      );
    }
  }

  const severeEvaluationWarnings = evaluation.checks.filter(
    (check) =>
      (check.code === "meta_slide_language" ||
        check.code === "topic_alignment" ||
        check.code === "intro_slide_substance" ||
        check.code === "source_noise_contamination" ||
        check.code === "cross_slide_distinctness" ||
        check.code === "language_quality") &&
      check.status === "fail",
  );
  const failingCoreChecks = severeEvaluationWarnings.map((check) => check.code);
  if (severeEvaluationWarnings.length > 0) {
    reasons.push(
      "The generated deck still fails one or more core quality checks for topic focus or opening quality.",
    );
  }

  const fatal =
    promptContaminationCheck?.status !== "pass" ||
    contaminatedSlides.length > 0 ||
    instructionalSlides.length > 0;

  return {
    retryable: reasons.length > 0,
    fatal,
    score: reasons.length + (fatal ? 10 : 0),
    reasons,
    revisionNotes: [...new Set(revisionNotes)],
    failingCoreChecks,
  };
};

export const buildDeckRevisionGuidance = (
  topic: string,
  assessment: DeckCandidateAssessment,
  intent?: PresentationIntent,
): string => {
  const procedural = intent?.contentMode === "procedural";
  return [
    `Revise the deck so it becomes a clean audience-facing presentation about ${topic}.`,
    ...assessment.reasons,
    ...assessment.revisionNotes,
    "Every slide must teach the subject itself through concrete, complete claims.",
    procedural
      ? "For procedural decks, concrete how-to guidance is allowed when it is specific, safe, and useful; avoid generic process-template phrasing."
      : "Use declarative sentences, not presenter instructions.",
    "Make slide 1 a strong introduction to the actual subject, not an abstract framing slide.",
  ].join(" ");
};

export const buildDeckSemanticReviewAssessment = (
  review: DeckSemanticReviewResult,
): DeckCandidateAssessment => {
  const blockingIssues = review.issues.filter((issue) => issue.severity !== "info");
  const errorIssues = review.issues.filter((issue) => issue.severity === "error");
  const retryable =
    !review.approved || review.score < 0.78 || errorIssues.length > 0;

  return {
    retryable,
    fatal: errorIssues.length > 0 || review.score < 0.62,
    score:
      (1 - Math.max(0, Math.min(1, review.score))) * 6 +
      errorIssues.length * 4 +
      blockingIssues.length,
    reasons: retryable
      ? [
          `Semantic deck review did not approve the draft: ${review.summary}`,
          ...blockingIssues.map((issue) => issue.message),
        ]
      : [],
    revisionNotes: [
      ...new Set(
        blockingIssues
          .map((issue) => issue.revisionInstruction)
          .filter(Boolean),
      ),
    ],
    failingCoreChecks: blockingIssues.map((issue) => `semantic_${issue.code}`),
  };
};

export const mergeDeckCandidateAssessments = (
  left: DeckCandidateAssessment,
  right: DeckCandidateAssessment,
): DeckCandidateAssessment => ({
  retryable: left.retryable || right.retryable,
  fatal: left.fatal || right.fatal,
  score: left.score + right.score,
  reasons: [...new Set([...left.reasons, ...right.reasons])],
  revisionNotes: [...new Set([...left.revisionNotes, ...right.revisionNotes])],
  failingCoreChecks: [
    ...new Set([...left.failingCoreChecks, ...right.failingCoreChecks]),
  ],
});

export const tryAcceptDeckAfterLocalRepair = (
  deck: Deck,
): Deck | null => {
  const validation = validateAndRepairDeck(deck);
  if (!validation.repaired) {
    return null;
  }

  const heavyRepairIssueCount = validation.issues.filter(
    (issue) =>
      issue.code === "deck_wide_meta_presentation_repaired" ||
      issue.code === "meta_presentation_slide_repaired" ||
      issue.code === "slide_language_repaired",
  ).length;

  if (
    validation.issues.some((issue) => issue.code === "deck_wide_meta_presentation_repaired") ||
    heavyRepairIssueCount > Math.ceil(validation.value.slides.length / 2)
  ) {
    return null;
  }

  const repairedEvaluation = evaluateDeckQuality(validation.value, []);
  const stillFailsCoreChecks = repairedEvaluation.checks.some(
    (check) =>
      check.status === "fail" && CORE_DECK_QUALITY_FAILURE_CODES.has(check.code),
  );

  return stillFailsCoreChecks ? null : validation.value;
};

export const ensureNarrationSegments = (narration: SlideNarration): SlideNarration => ({
  ...narration,
  segments: (
    narration.segments.length > 0
      ? narration.segments
      : splitNarrationIntoSegments(narration.narration)
  )
    .flatMap((segment) =>
      segment.length > 260 ? splitNarrationIntoSegments(segment) : [segment.trim()],
    )
    .filter(Boolean),
});
