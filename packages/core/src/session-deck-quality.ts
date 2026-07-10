import type {
  Deck,
  DeckSemanticIssue,
  DeckSemanticReviewResult,
  GenerateDeckInput,
  PedagogicalProfile,
  PresentationIntent,
  PresentationTheme,
  SlideNarration,
} from "@slidespeech/types";
import { pickPresentationTheme } from "@slidespeech/types";

import { validateDeck } from "./validation";

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
  generationInput: GenerateDeckInput;
  pedagogicalProfile: PedagogicalProfile;
  initialNarrations: SlideNarration[];
  topic: string;
};

type DeckCandidateQualityContext =
  | PresentationIntent
  | Pick<
      GenerateDeckInput,
      | "intent"
      | "targetSlideCount"
      | "plan"
      | "groundingFacts"
      | "groundingSourceIds"
      | "groundingSourceType"
    >;

const looksLikePresentationIntent = (
  context: DeckCandidateQualityContext | undefined,
): context is PresentationIntent =>
  Boolean(
    context &&
      ("presentationFrame" in context ||
        "deliveryFormat" in context ||
        "activityRequirement" in context ||
        "audienceCues" in context ||
        "coverageRequirements" in context),
  );

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

const tokenizeQualityText = (value: string): string[] =>
  Array.from(value.normalize("NFKC").matchAll(WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.toLowerCase().replace(/['’]s$/u, "") ?? "")
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const textContainsCue = (textTokens: Set<string>, cue: string): boolean => {
  const cueTokens = tokenizeQualityText(cue);
  return cueTokens.length > 0 && cueTokens.every((token) => textTokens.has(token));
};

const resolveExpectedSlideCount = (
  context: DeckCandidateQualityContext | undefined,
): number | undefined => {
  if (!context || looksLikePresentationIntent(context)) {
    return undefined;
  }

  const requestedCount = context.targetSlideCount ?? context.plan?.recommendedSlideCount;

  if (
    typeof requestedCount !== "number" ||
    !Number.isFinite(requestedCount) ||
    requestedCount <= 2 ||
    !context.groundingFacts?.length ||
    context.intent?.presentationFrame === "organization" ||
    (context.intent?.presentationFrame === "mixed" && Boolean(context.intent.organization))
  ) {
    return requestedCount;
  }

  const concreteFactCount = context.groundingFacts.filter(
    (fact) => fact.role !== "background" && fact.role !== "reference",
  ).length;
  const usableFactCount = concreteFactCount || context.groundingFacts.length;
  const concreteRoleCount = new Set(
    context.groundingFacts
      .filter((fact) => fact.role !== "background" && fact.role !== "reference")
      .map((fact) => fact.role),
  ).size;

  if (usableFactCount <= 2) {
    return Math.min(requestedCount, 3);
  }

  if (concreteRoleCount <= 2) {
    return Math.min(requestedCount, Math.min(4, usableFactCount + 1));
  }

  return Math.min(requestedCount, Math.max(3, Math.min(7, usableFactCount + 1)));
};

const NARRATION_REPAIR_CODE_FRAGMENTS = [
  "verbatim",
  "content_drift",
  "grounding_weak",
  "grounding_mismatch",
  "segment_count_violation",
  "narr_verbatim",
];

export const reviewIssueCodeRequiresNarrationRepair = (code: string): boolean => {
  const normalized = code.toLowerCase();
  return NARRATION_REPAIR_CODE_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
};

const TARGET_SEMANTIC_REVIEW_SCORE = 0.78;
const MINIMUM_PUBLISHABLE_SEMANTIC_REVIEW_SCORE = 0.62;

const SOFT_SEMANTIC_REVIEW_CODES = new Set<DeckSemanticIssue["code"]>([
  "weak_opening",
  "weak_closing",
  "role_drift",
  "other",
]);

const HARD_WARNING_SEMANTIC_REVIEW_CODES = new Set<DeckSemanticIssue["code"]>([
  "prompt_leakage",
  "source_noise",
  "fragmentary_copy",
]);

const isHardSemanticReviewIssue = (issue: DeckSemanticIssue): boolean => {
  if (issue.severity === "error") {
    return !SOFT_SEMANTIC_REVIEW_CODES.has(issue.code);
  }

  if (issue.severity === "warning") {
    return HARD_WARNING_SEMANTIC_REVIEW_CODES.has(issue.code);
  }

  return false;
};

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
  context?: DeckCandidateQualityContext,
): DeckCandidateAssessment => {
  const reasons: string[] = [];
  const revisionNotes: string[] = [];
  const validationProbe = validateDeck(deck);
  const intent = looksLikePresentationIntent(context) ? context : context?.intent;
  const expectedSlideCount = resolveExpectedSlideCount(context);
  const sourceBackedGroundedDeck = Boolean(
    context &&
      !looksLikePresentationIntent(context) &&
      context.groundingFacts?.length &&
      (
        context.groundingSourceIds?.length ||
        (context.groundingSourceType && context.groundingSourceType !== "topic")
      ),
  );
  const minimumIntroKeyPoints = sourceBackedGroundedDeck ? 1 : 3;
  const visibleDeckText = [
    deck.title,
    deck.summary,
    ...deck.slides.flatMap((slide) => [
      slide.title,
      slide.learningGoal,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...slide.keyPoints,
      ...slide.examples,
    ]),
  ].join(" ");

  const repeatedSurfaceIssues = validationProbe.issues.filter(
    (issue) => issue.code === "repeated_slide_surface",
  );
  if (repeatedSurfaceIssues.length > 0) {
    reasons.push(
      "At least one slide repeats the same visible claim across multiple fields instead of developing distinct points.",
    );
    for (const issue of repeatedSurfaceIssues) {
      const offendingSlide = deck.slides.find((slide) => slide.id === issue.slideId);
      revisionNotes.push(
        offendingSlide
          ? `Regenerate slide "${offendingSlide.title}" with distinct learning goal, bullets, explanations, and visual card copy.`
          : "Regenerate repeated slide surfaces with distinct learning goal, bullets, explanations, and visual card copy.",
      );
    }
  }

  const duplicateVisiblePointIssues = validationProbe.issues.filter(
    (issue) => issue.code === "duplicate_visible_points",
  );
  let introOpeningIssue = false;
  if (duplicateVisiblePointIssues.length > 0) {
    reasons.push(
      "At least one slide repeats visible bullet or card content and needs regenerated distinct claims.",
    );
    for (const issue of duplicateVisiblePointIssues) {
      const offendingSlide = deck.slides.find((slide) => slide.id === issue.slideId);
      revisionNotes.push(
        offendingSlide
          ? `Regenerate slide "${offendingSlide.title}" with three distinct non-overlapping claims instead of local deduplication.`
          : "Regenerate slides with duplicate visible points instead of relying on local deduplication.",
      );
    }
  }

  const normalizedExpectedSlideCount =
    typeof expectedSlideCount === "number" && Number.isFinite(expectedSlideCount)
      ? Math.max(1, Math.round(expectedSlideCount))
      : null;
  const slideCountMismatch =
    normalizedExpectedSlideCount !== null &&
    deck.slides.length !== normalizedExpectedSlideCount;
  if (slideCountMismatch) {
    reasons.push(
      `The generated deck returned ${deck.slides.length} slides, but the plan requested ${normalizedExpectedSlideCount}.`,
    );
    revisionNotes.push(
      `Return exactly ${normalizedExpectedSlideCount} slides with no missing outline roles.`,
    );
  }

  const introSlide = deck.slides[0];
  if (introSlide) {
    const thinIntro =
      introSlide.keyPoints.length < minimumIntroKeyPoints ||
      (introSlide.beginnerExplanation.trim().length < 90 &&
        introSlide.learningGoal.trim().length < 70);

    if (thinIntro) {
      introOpeningIssue = true;
      reasons.push(
        "The opening slide needs enough visible substance to start the presentation.",
      );
      revisionNotes.push(
        `Regenerate slide "${introSlide.title}" with enough opening material for the requested topic.`,
      );
    }
  }

  const workshopRequiresExercise =
    intent?.deliveryFormat === "workshop" || Boolean(intent?.activityRequirement);
  const workshopExercisePattern =
    /\b(?:exercise|workshop task|assignment|participants|audience task|prompt|checklist|artifact|scenario|practice)\b/i;
  const visibleDeckTokens = new Set(tokenizeQualityText(visibleDeckText));
  const workshopAudienceCoverageCount = (intent?.audienceCues ?? []).filter((cue) =>
    textContainsCue(visibleDeckTokens, cue),
  ).length;
  const workshopCoverageFatal =
    workshopRequiresExercise &&
    (
      !workshopExercisePattern.test(visibleDeckText) ||
      ((intent?.audienceCues?.length ?? 0) > 0 &&
        workshopAudienceCoverageCount < Math.min(2, intent?.audienceCues?.length ?? 0))
    );
  if (workshopCoverageFatal) {
    reasons.push(
      "Workshop decks must preserve the requested participant exercise and role-specific audience coverage.",
    );
    revisionNotes.push(
      "Include a concrete participant exercise with steps or a reusable prompt/checklist, and explicitly cover the requested audience roles.",
    );
  }

  const validationCoreChecks = validationProbe.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const failingCoreChecks = [
    ...validationCoreChecks,
    ...(slideCountMismatch ? ["slide_count"] : []),
    ...(repeatedSurfaceIssues.length > 0 ? ["repeated_slide_surface"] : []),
    ...(duplicateVisiblePointIssues.length > 0
      ? ["duplicate_visible_points"]
      : []),
  ];
  if (validationCoreChecks.length > 0) {
    reasons.push(
      "The generated deck still fails one or more local structural validation contracts.",
    );
  }

  const fatal =
    validationCoreChecks.length > 0 ||
    workshopCoverageFatal;

  return {
    retryable: reasons.length > 0,
    fatal,
    score: reasons.length + (fatal ? 10 : 0),
    reasons,
    revisionNotes: [...new Set(revisionNotes)],
    failingCoreChecks,
  };
};

export const buildDeckSemanticReviewAssessment = (
  review: DeckSemanticReviewResult,
): DeckCandidateAssessment => {
  const actionableIssues = review.issues.filter((issue) => issue.severity !== "info");
  const hardIssues = actionableIssues.filter(isHardSemanticReviewIssue);
  const normalizedScore = Math.max(0, Math.min(1, review.score));
  const reviewerRejected = !review.approved;
  const unpublishableScore =
    normalizedScore < MINIMUM_PUBLISHABLE_SEMANTIC_REVIEW_SCORE;
  const syntheticFailingChecks = [
    ...(reviewerRejected ? ["semantic_rejected"] : []),
    ...(unpublishableScore ? ["semantic_low_score"] : []),
  ];
  const retryable =
    reviewerRejected ||
    normalizedScore < TARGET_SEMANTIC_REVIEW_SCORE ||
    actionableIssues.length > 0;

  return {
    retryable,
    fatal:
      reviewerRejected ||
      hardIssues.some((issue) => issue.severity === "error") ||
      unpublishableScore,
    score:
      (1 - normalizedScore) * 6 +
      hardIssues.length * 4 +
      actionableIssues.length +
      syntheticFailingChecks.length,
    reasons: retryable
      ? [
          `Semantic deck review did not approve the draft: ${review.summary}`,
          ...actionableIssues.map((issue) => issue.message),
        ]
      : [],
    revisionNotes: [
      ...new Set(
        [
          ...actionableIssues
            .map((issue) => issue.revisionInstruction)
            .filter(Boolean),
          ...(reviewerRejected
            ? ["Regenerate the deck; an explicit semantic reviewer rejection is publication-blocking even when the reviewer did not emit structured hard issues."]
            : []),
          ...(normalizedScore < TARGET_SEMANTIC_REVIEW_SCORE
            ? ["Improve the deck toward the target semantic quality score, but only block publication when the deck is below the minimum publishable score or has hard semantic issues."]
            : []),
        ],
      ),
    ],
    failingCoreChecks: [
      ...new Set([
        ...hardIssues.map((issue) => `semantic_${issue.code}`),
        ...syntheticFailingChecks,
      ]),
    ],
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
