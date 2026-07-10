import type {
  Deck,
  GenerateDeckInput,
  GroundingFact,
  PedagogicalProfile,
  PresentationIntent,
  PresentationPlan,
  SlideBrief,
} from "@slidespeech/types";

import type {
  PresentationPlanner,
  PresentationQualityReviewer,
} from "../planners";
import {
  buildDeckSemanticReviewAssessment,
  evaluateDeckCandidateForRetry,
  mergeDeckCandidateAssessments,
  type DeckCandidateAssessment,
} from "../session-deck-quality";

export type PresentationDeckGenerationRequest = {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | undefined;
  groundingSummary?: string | undefined;
  groundingHighlights?: string[] | undefined;
  groundingExcerpts?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
  groundingFacts?: GroundingFact[] | undefined;
  slideBriefs?: SlideBrief[] | undefined;
  groundingSourceType?: "topic" | "document" | "pptx" | "mixed" | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
};

export type PresentationDeckGenerationResult = {
  deck: Deck;
  generationInput: GenerateDeckInput;
};

export class PresentationDeckGenerationQualityError extends Error {
  readonly topic: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly reasons: string[];
  readonly failingCoreChecks: string[];
  readonly fatal: boolean;

  constructor(input: {
    topic: string;
    attempt: number;
    maxAttempts: number;
    assessment: DeckCandidateAssessment;
  }) {
    const failingChecks =
      input.assessment.failingCoreChecks.length > 0
        ? ` Failing checks: ${input.assessment.failingCoreChecks.join(", ")}.`
        : "";
    super(
      `Presentation generation failed quality gate for "${input.topic}" on attempt ${input.attempt}/${input.maxAttempts}: ${input.assessment.reasons.join(" | ")}.${failingChecks}`,
    );
    this.name = "PresentationDeckGenerationQualityError";
    this.topic = input.topic;
    this.attempt = input.attempt;
    this.maxAttempts = input.maxAttempts;
    this.reasons = input.assessment.reasons;
    this.failingCoreChecks = input.assessment.failingCoreChecks;
    this.fatal = input.assessment.fatal;
  }
}

const buildGenerationInput = (input: {
  request: PresentationDeckGenerationRequest;
  plan: PresentationPlan;
  pedagogicalProfile: PedagogicalProfile;
}): GenerateDeckInput => ({
  topic: input.request.topic,
  ...(input.request.presentationBrief
    ? { presentationBrief: input.request.presentationBrief }
    : {}),
  ...(input.request.intent ? { intent: input.request.intent } : {}),
  plan: input.plan,
  pedagogicalProfile: input.pedagogicalProfile,
  ...(input.request.groundingSummary
    ? { groundingSummary: input.request.groundingSummary }
    : {}),
  ...(input.request.groundingHighlights?.length
    ? { groundingHighlights: input.request.groundingHighlights }
    : {}),
  ...(input.request.groundingExcerpts?.length
    ? { groundingExcerpts: input.request.groundingExcerpts }
    : {}),
  ...(input.request.groundingCoverageGoals?.length
    ? { groundingCoverageGoals: input.request.groundingCoverageGoals }
    : {}),
  ...(input.request.groundingSourceIds
    ? { groundingSourceIds: input.request.groundingSourceIds }
    : {}),
  ...(input.request.groundingFacts?.length
    ? { groundingFacts: input.request.groundingFacts }
    : {}),
  ...(input.request.slideBriefs?.length ? { slideBriefs: input.request.slideBriefs } : {}),
  ...(input.request.groundingSourceType
    ? { groundingSourceType: input.request.groundingSourceType }
    : {}),
  ...(input.request.targetDurationMinutes
    ? { targetDurationMinutes: input.request.targetDurationMinutes }
    : {}),
  ...(input.request.targetSlideCount
    ? { targetSlideCount: input.request.targetSlideCount }
    : {}),
});

const normalizeDeckCandidateForReview = (deck: Deck): Deck => deck;

const reviewDeckSemantics = async (input: {
  qualityReviewer: PresentationQualityReviewer;
  deck: Deck;
  generationInput: GenerateDeckInput;
  pedagogicalProfile: PedagogicalProfile;
  topic: string;
}): Promise<DeckCandidateAssessment | null> => {
  try {
    const review = await input.qualityReviewer.reviewDeckSemantics({
      deck: input.deck,
      generationInput: input.generationInput,
      pedagogicalProfile: input.pedagogicalProfile,
    });

    const assessment = buildDeckSemanticReviewAssessment(review);
    if (assessment.retryable) {
      console.warn(
        `[slidespeech] semantic deck review for topic "${input.topic}" requested revision: ${assessment.reasons.join(" | ")}`,
      );
    }
    return assessment;
  } catch (error) {
    console.warn(
      `[slidespeech] semantic deck review unavailable for topic "${input.topic}": ${(error as Error).message}`,
    );
    return {
      retryable: true,
      fatal: true,
      score: 12,
      reasons: [
        `Semantic deck review failed or was unavailable: ${(error as Error).message}`,
      ],
      revisionNotes: [
        "Do not accept the generated deck until semantic review completes successfully.",
      ],
      failingCoreChecks: ["semantic_review_unavailable"],
    };
  }
};

const assessDeckCandidate = async (input: {
  deck: Deck;
  generationInput: GenerateDeckInput;
  qualityReviewer: PresentationQualityReviewer;
  pedagogicalProfile: PedagogicalProfile;
  topic: string;
}): Promise<DeckCandidateAssessment> => {
  const deterministicAssessment = evaluateDeckCandidateForRetry(
    input.deck,
    input.generationInput,
  );
  const semanticAssessment = await reviewDeckSemantics({
    qualityReviewer: input.qualityReviewer,
    deck: input.deck,
    generationInput: input.generationInput,
    pedagogicalProfile: input.pedagogicalProfile,
    topic: input.topic,
  });

  return semanticAssessment
    ? mergeDeckCandidateAssessments(deterministicAssessment, semanticAssessment)
    : deterministicAssessment;
};

const shouldRegenerateForAssessment = (
  assessment: DeckCandidateAssessment,
): boolean => assessment.fatal || assessment.failingCoreChecks.length > 0;

const formatFailingChecks = (assessment: DeckCandidateAssessment): string =>
  assessment.failingCoreChecks.length > 0
    ? ` | failing checks: ${assessment.failingCoreChecks.join(", ")}`
    : "";

const compactFeedbackLine = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, 360);

const buildAttemptRevisionGuidance = (input: {
  topic: string;
  previousAssessment?: DeckCandidateAssessment | undefined;
  previousError?: Error | undefined;
}): string => {
  const lines = [
    `The previous generated deck for "${input.topic}" failed quality review. Generate a new deck; do not reuse weak template language from the failed attempt.`,
    ...(input.previousAssessment?.reasons ?? []).map(
      (reason) => `Quality issue: ${compactFeedbackLine(reason)}`,
    ),
    ...(input.previousAssessment?.revisionNotes ?? []).map(
      (note) => `Required revision: ${compactFeedbackLine(note)}`,
    ),
    ...(input.previousAssessment?.failingCoreChecks.length
      ? [
          `Failed quality checks: ${input.previousAssessment.failingCoreChecks.join(", ")}`,
        ]
      : []),
    input.previousError && !input.previousAssessment
      ? `Generation error to avoid repeating: ${compactFeedbackLine(input.previousError.message)}`
      : null,
    "Regenerate with concrete, subject-specific claims, distinct slide roles, a real opening, and a clear closing. If the topic is procedural, use concrete materials, actions, checks, and outcomes instead of abstract process labels.",
  ].filter((line): line is string => Boolean(line));

  return lines.slice(0, 10).join("\n");
};

const MAX_DECK_GENERATION_ATTEMPTS = 2;

export const generatePresentationDeck = async (input: {
  planner: PresentationPlanner;
  qualityReviewer: PresentationQualityReviewer;
  request: PresentationDeckGenerationRequest;
  pedagogicalProfile: PedagogicalProfile;
  plan: PresentationPlan;
}): Promise<PresentationDeckGenerationResult> => {
  const generationInput = buildGenerationInput({
    request: input.request,
    plan: input.plan,
    pedagogicalProfile: input.pedagogicalProfile,
  });

  let lastError: Error | null = null;
  let lastAssessment: DeckCandidateAssessment | null = null;

  for (let attemptIndex = 0; attemptIndex < MAX_DECK_GENERATION_ATTEMPTS; attemptIndex += 1) {
    const attempt = attemptIndex + 1;
    const attemptGenerationInput: GenerateDeckInput =
      attemptIndex === 0
        ? generationInput
        : {
            ...generationInput,
            revisionGuidance: buildAttemptRevisionGuidance({
              topic: input.request.topic,
              ...(lastAssessment ? { previousAssessment: lastAssessment } : {}),
              ...(lastError ? { previousError: lastError } : {}),
            }),
          };

    try {
      const candidateDeck = await input.planner.generateDeck(attemptGenerationInput);
      const deckForAssessment = normalizeDeckCandidateForReview(candidateDeck);
      const candidateAssessment = await assessDeckCandidate({
        deck: deckForAssessment,
        generationInput: attemptGenerationInput,
        qualityReviewer: input.qualityReviewer,
        pedagogicalProfile: input.pedagogicalProfile,
        topic: input.request.topic,
      });

      if (!candidateAssessment.retryable) {
        return {
          deck: deckForAssessment,
          generationInput: attemptGenerationInput,
        };
      }

      if (!shouldRegenerateForAssessment(candidateAssessment)) {
        console.warn(
          `[slidespeech] generated deck for "${input.request.topic}" has non-blocking quality warnings; keeping generated deck: ${candidateAssessment.reasons.join(" | ")}${formatFailingChecks(candidateAssessment)}`,
        );
        return {
          deck: deckForAssessment,
          generationInput: attemptGenerationInput,
        };
      }

      lastAssessment = candidateAssessment;
      lastError = new PresentationDeckGenerationQualityError({
        topic: input.request.topic,
        attempt,
        maxAttempts: MAX_DECK_GENERATION_ATTEMPTS,
        assessment: candidateAssessment,
      });
      console.warn(
        `[slidespeech] generated deck for "${input.request.topic}" failed quality gate on attempt ${attempt}/${MAX_DECK_GENERATION_ATTEMPTS}; retrying the failed generation stage: ${candidateAssessment.reasons.join(" | ")}${formatFailingChecks(candidateAssessment)}`,
      );
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `[slidespeech] deck generation attempt ${attempt}/${MAX_DECK_GENERATION_ATTEMPTS} failed for "${input.request.topic}": ${lastError.message}`,
      );
    }
  }

  throw lastError ??
    new Error(`Presentation generation failed for "${input.request.topic}".`);
};
