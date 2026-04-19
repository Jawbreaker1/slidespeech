import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  DeckRepository,
  Deck,
  LLMProvider,
  PedagogicalProfile,
  PresentationIntent,
  PresentationPlan,
  PresentationReview,
  ResumePlan,
  ResumePlanner,
  Session,
  SessionRepository,
  SlideNarration,
  Slide,
  TranscriptRepository,
  TranscriptTurn,
  UserInterruption,
  WebResearchProvider,
} from "@slidespeech/types";
import { pickPresentationTheme } from "@slidespeech/types";

import { DEFAULT_PEDAGOGICAL_PROFILE } from "./defaults";
import {
  buildDeterministicPresentationPlan,
  buildDeterministicReview,
} from "./deterministic-generation";
import { evaluateDeckQuality } from "./evaluation";
import { RuleBasedConversationTurnEngine } from "./conversation-turn-engine";
import {
  NarrationEngine,
  PresentationPlanner,
  PresentationQualityReviewer,
} from "./planners";
import { QuestionAnswerService } from "./question-answer-service";
import { SimpleResumePlanner } from "./resume-planner";
import { transitionSessionState } from "./state-machine";
import { createId, nowIso } from "./utils";
import {
  rebuildNarrationFromSlideAnchors,
  validateAndRepairDeck,
  validateAndRepairNarrations,
} from "./validation";

export interface CreatePresentationSessionInput {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | undefined;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
  groundingSummary?: string | undefined;
  groundingHighlights?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
  groundingSourceType?: "topic" | "document" | "pptx" | "mixed" | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
}

export interface CreatePresentationSessionResult {
  session: Session;
  narrations: SlideNarration[];
}

export interface SessionInteractionResult {
  deck: Deck;
  session: Session;
  interruption: UserInterruption;
  turnDecision: ConversationTurnDecision;
  resumePlan: ResumePlan;
  assistantMessage: string;
  narration?: SlideNarration | undefined;
}

export interface SelectSlideResult {
  deck: Deck;
  session: Session;
  narration?: SlideNarration | undefined;
}

export interface SessionSnapshotResult {
  deck: Deck;
  session: Session;
  narration?: SlideNarration | undefined;
  transcripts: TranscriptTurn[];
}

const ensureDeckTheme = (deck: Deck): Deck => ({
  ...deck,
  metadata: {
    ...deck.metadata,
    theme:
      deck.metadata.theme ??
      pickPresentationTheme(`${deck.id}:${deck.topic}`),
  },
});

type ValidationIssue = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  slideId?: string | undefined;
};

type DeckCandidateAssessment = {
  retryable: boolean;
  fatal: boolean;
  score: number;
  reasons: string[];
  revisionNotes: string[];
  failingCoreChecks: string[];
};

const REVIEW_NARRATION_REPAIR_CODE_PATTERN =
  /(?:VERBATIM|CONTENT_DRIFT|GROUNDING_WEAK|GROUNDING_MISMATCH|SEGMENT_COUNT_VIOLATION|NARR_VERBATIM)/i;

const DECK_PROMPT_CONTAMINATION_PATTERNS = [
  /\bcreate (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/i,
  /\bmore information is available at\b/i,
  /\buse google\b/i,
];

const DECK_INSTRUCTIONAL_PATTERNS = [
  /^\s*(walk through|review|direct new hires|show the audience|tell the audience|emphasize|map out|validate that|highlight)\b/i,
  /\binternal portal\b/i,
  /\bcore messaging\b/i,
  /^\s*how do i\b/i,
  /\bslides?\b/i,
  /\bdeck\b/i,
];

const DECK_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS = new Set([
  /^\s*use\b/i.source,
]);

const getDeckInstructionalPatterns = (
  intent?: PresentationIntent,
): RegExp[] => {
  const allowsParticipantActionLanguage =
    intent?.deliveryFormat === "workshop" || Boolean(intent?.activityRequirement);

  if (!allowsParticipantActionLanguage) {
    return DECK_INSTRUCTIONAL_PATTERNS;
  }

  return DECK_INSTRUCTIONAL_PATTERNS.filter(
    (pattern) => !DECK_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS.has(pattern.source),
  );
};

type BackgroundEnrichmentInput = {
  deck: Deck;
  sessionId: string;
  pedagogicalProfile: PedagogicalProfile;
  initialNarrations: SlideNarration[];
  topic: string;
};

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

const evaluateDeckCandidateForRetry = (
  deck: Deck,
  intent?: PresentationIntent,
): DeckCandidateAssessment => {
  const reasons: string[] = [];
  const revisionNotes: string[] = [];
  const validationProbe = validateAndRepairDeck(deck);
  const evaluation = evaluateDeckQuality(deck, []);
  const activeInstructionalPatterns = getDeckInstructionalPatterns(intent);
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
    reasons.push(
      "Titles or learning goals still contain prompt/instruction leakage instead of a clean subject framing.",
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
      DECK_PROMPT_CONTAMINATION_PATTERNS.some((pattern) => pattern.test(value)),
    ),
  );
  if (contaminatedSlides.length > 0) {
    reasons.push(
      "At least one slide still leaks prompt text such as creation instructions or external-information hints.",
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

const buildDeckRevisionGuidance = (topic: string, assessment: DeckCandidateAssessment): string =>
  [
    `Revise the deck so it becomes a clean audience-facing presentation about ${topic}.`,
    ...assessment.reasons,
    ...assessment.revisionNotes,
    "Every slide must teach the subject itself through concrete, complete claims.",
    "Use declarative sentences, not presenter instructions.",
    "Make slide 1 a strong introduction to the actual subject, not an abstract framing slide.",
  ].join(" ");

const CORE_DECK_QUALITY_FAILURE_CODES = new Set([
  "meta_slide_language",
  "topic_alignment",
  "intro_slide_substance",
  "source_noise_contamination",
  "language_quality",
  "prompt_contamination",
]);

const tryAcceptDeckAfterLocalRepair = (
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

const ensureNarrationSegments = (narration: SlideNarration): SlideNarration => ({
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

export class PresentationSessionService {
  private readonly planner: PresentationPlanner;
  private readonly narrationEngine: NarrationEngine;
  private readonly qualityReviewer: PresentationQualityReviewer;
  private readonly questionAnswerService: QuestionAnswerService;
  private readonly backgroundEnrichmentTasks = new Map<string, Promise<void>>();

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly deckRepository: DeckRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly transcriptRepository: TranscriptRepository,
    private readonly conversationTurnEngine: ConversationTurnEngine = new RuleBasedConversationTurnEngine(),
    private readonly resumePlanner: ResumePlanner = new SimpleResumePlanner(),
    private readonly webResearchProvider?: WebResearchProvider,
  ) {
    this.planner = new PresentationPlanner(llmProvider);
    this.narrationEngine = new NarrationEngine(llmProvider);
    this.qualityReviewer = new PresentationQualityReviewer(llmProvider);
    this.questionAnswerService = new QuestionAnswerService(
      llmProvider,
      webResearchProvider,
    );
  }

  async createSession(
    input: CreatePresentationSessionInput,
  ): Promise<CreatePresentationSessionResult> {
    const pedagogicalProfile: PedagogicalProfile = {
      ...DEFAULT_PEDAGOGICAL_PROFILE,
      ...input.pedagogicalProfile,
    };

    let plan: PresentationPlan;
    try {
      plan = await this.planner.plan(
        input.topic,
        input.presentationBrief,
        input.intent,
        pedagogicalProfile,
        input.groundingSummary,
        input.groundingHighlights,
        input.targetDurationMinutes,
        input.targetSlideCount,
      );
    } catch (error) {
      console.warn(
        `[slidespeech] presentation plan fallback for topic "${input.topic}": ${(error as Error).message}`,
      );
      plan = buildDeterministicPresentationPlan({
        topic: input.topic,
        ...(input.presentationBrief
          ? { presentationBrief: input.presentationBrief }
          : {}),
        ...(input.intent ? { intent: input.intent } : {}),
        audienceLevel: pedagogicalProfile.audienceLevel,
        ...(input.targetSlideCount ? { targetSlideCount: input.targetSlideCount } : {}),
      });
    }

    const generationInput = {
      topic: input.topic,
      ...(input.presentationBrief
        ? { presentationBrief: input.presentationBrief }
        : {}),
      ...(input.intent ? { intent: input.intent } : {}),
      plan,
      pedagogicalProfile,
      ...(input.groundingSummary
        ? { groundingSummary: input.groundingSummary }
        : {}),
      ...(input.groundingHighlights?.length
        ? { groundingHighlights: input.groundingHighlights }
        : {}),
      ...(input.groundingCoverageGoals?.length
        ? { groundingCoverageGoals: input.groundingCoverageGoals }
        : {}),
      ...(input.groundingSourceIds
        ? { groundingSourceIds: input.groundingSourceIds }
        : {}),
      ...(input.groundingSourceType
        ? { groundingSourceType: input.groundingSourceType }
        : {}),
      ...(input.targetDurationMinutes
        ? { targetDurationMinutes: input.targetDurationMinutes }
        : {}),
      ...(input.targetSlideCount
        ? { targetSlideCount: input.targetSlideCount }
        : {}),
    };

    let generatedDeck: Deck | undefined;
    let bestGeneratedDeck: Deck | null = null;
    let bestDeckAssessment: DeckCandidateAssessment | null = null;

    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      const deckAttemptInput =
        attemptIndex === 0
          ? generationInput
          : {
              ...generationInput,
              revisionGuidance: buildDeckRevisionGuidance(
                input.topic,
                bestDeckAssessment ?? {
                  retryable: true,
                  fatal: false,
                  score: 1,
                  reasons: [
                    "The previous draft was not concrete or audience-facing enough.",
                  ],
                  revisionNotes: [],
                  failingCoreChecks: [],
                },
              ),
            };

      try {
        const candidateDeck = await this.planner.generateDeck(deckAttemptInput);
        const locallyAcceptedDeck = tryAcceptDeckAfterLocalRepair(candidateDeck);
        if (locallyAcceptedDeck) {
          generatedDeck = locallyAcceptedDeck;
          break;
        }

        const candidateAssessment = evaluateDeckCandidateForRetry(
          candidateDeck,
          input.intent,
        );

        if (
          !bestGeneratedDeck ||
          !bestDeckAssessment ||
          candidateAssessment.score < bestDeckAssessment.score
        ) {
          bestGeneratedDeck = candidateDeck;
          bestDeckAssessment = candidateAssessment;
        }

        if (!candidateAssessment.retryable) {
          generatedDeck = candidateDeck;
          break;
        }

        console.warn(
          `[slidespeech] generated deck attempt ${attemptIndex + 1} for topic "${input.topic}" still needs repair-heavy cleanup: ${candidateAssessment.reasons.join(" | ")}${
            candidateAssessment.failingCoreChecks.length > 0
              ? ` | failing checks: ${candidateAssessment.failingCoreChecks.join(", ")}`
              : ""
          }`,
        );
      } catch (error) {
        console.warn(
          `[slidespeech] deck generation attempt ${attemptIndex + 1} failed for topic "${input.topic}": ${(error as Error).message}`,
        );
      }
    }

    if (!bestGeneratedDeck) {
      throw new Error(
        `No usable LLM-generated deck was produced for "${input.topic}".`,
      );
    } else if (!generatedDeck) {
      if (bestDeckAssessment?.fatal || bestDeckAssessment?.retryable) {
        throw new Error(
          `No acceptable LLM-generated deck was produced for "${input.topic}". The best draft still relied on repair-heavy cleanup: ${bestDeckAssessment.reasons.join(" | ")}`,
        );
      }
      generatedDeck = bestGeneratedDeck;
    }

    const deckValidation = validateAndRepairDeck(generatedDeck);
    let deck = ensureDeckTheme({
      ...deckValidation.value,
      metadata: {
        ...deckValidation.value.metadata,
        generation: {
          narrationReadySlides: 0,
          totalSlides: deckValidation.value.slides.length,
          backgroundEnrichmentPending: deckValidation.value.slides.length > 1,
        },
      },
    });

    const introSlide = deck.slides[0];
    const initialNarrations: SlideNarration[] = [];

    if (introSlide) {
      try {
        initialNarrations.push(
          await this.narrationEngine.generateNarration({
            deck,
            slide: introSlide,
            pedagogicalProfile,
          }),
        );
      } catch (error) {
        console.warn(
          `[slidespeech] intro narration fallback for slide "${introSlide.title}": ${(error as Error).message}`,
        );
      }
    }

    const introNarrationValidation =
      introSlide && initialNarrations[0]
        ? validateAndRepairNarrations(
            deck,
            initialNarrations,
          )
        : null;
    const introNarration = introNarrationValidation?.value[0]
      ? ensureNarrationSegments(introNarrationValidation.value[0])
      : undefined;
    const introNarrationIssues = introNarrationValidation?.issues ?? [];

    deck = {
      ...deck,
      metadata: {
        ...deck.metadata,
        validation: this.mergeValidationMetadata(deck, introNarrationIssues),
        generation: this.buildGenerationStatus(
          deck,
          introNarration ? 1 : 0,
          deck.slides.length > (introNarration ? 1 : 0),
        ),
      },
    };

    await this.deckRepository.save(deck);

    const narrationBySlideId = Object.fromEntries(
      (introNarration ? [introNarration] : []).map((narration) => [narration.slideId, narration]),
    );

    const session: Session = {
      id: createId("session"),
      deckId: deck.id,
      state: "presenting",
      currentSlideId: deck.slides[0]?.id,
      currentSlideIndex: 0,
      currentNarrationIndex: 0,
      narrationBySlideId,
      narrationProgressBySlideId: deck.slides[0]
        ? { [deck.slides[0].id]: 0 }
        : {},
      transcriptTurnIds: [],
      pedagogicalProfile,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const introTurn: TranscriptTurn = {
      id: createId("turn"),
      sessionId: session.id,
      role: "assistant",
      text: `Presentation generated for topic "${deck.topic}".`,
      createdAt: nowIso(),
      relatedSlideId: deck.slides[0]?.id,
    };

    await this.transcriptRepository.append(introTurn);

    const persistedSession: Session = {
      ...session,
      transcriptTurnIds: [introTurn.id],
      updatedAt: nowIso(),
    };

    await this.sessionRepository.save(persistedSession);

    if (deck.slides.length > 1) {
      this.startBackgroundEnrichment({
        deck,
        sessionId: persistedSession.id,
        pedagogicalProfile,
        initialNarrations: introNarration ? [introNarration] : [],
        topic: input.topic,
      });
    } else if (introNarration) {
      const review = await this.reviewPresentationWithFallback({
        deck,
        narrations: [introNarration],
        pedagogicalProfile,
        validationIssues: introNarrationIssues,
        fallbackNote:
          "Deterministic review used while completing the initial single-slide presentation.",
        topic: input.topic,
      });

      const finalNarrations = this.mergeReviewedNarrations(
        [introNarration],
        review.repairedNarrations,
      );
      const reviewedNarrationValidation = validateAndRepairNarrations(
        deck,
        finalNarrations,
        { generateMissing: false },
      );
      const locallyRepairedNarrations = this.applyLocalNarrationRepairsFromReview(
        deck,
        reviewedNarrationValidation.value,
        review,
      );
      const finalizedDeck = this.finalizeDeckMetadata(
        deck,
        locallyRepairedNarrations.narrations,
        review,
        [
          ...introNarrationIssues,
          ...reviewedNarrationValidation.issues,
          ...locallyRepairedNarrations.issues,
        ],
      );
      await this.deckRepository.save(finalizedDeck);

      await this.sessionRepository.save({
        ...persistedSession,
        narrationBySlideId: Object.fromEntries(
          locallyRepairedNarrations.narrations.map((narration) => [
            narration.slideId,
            ensureNarrationSegments(narration),
          ]),
        ),
        updatedAt: nowIso(),
      });
    }

    return {
      session: persistedSession,
      narrations: introNarration ? [introNarration] : [],
    };
  }

  async getOrGenerateNarration(
    sessionId: string,
    slideId: string,
  ): Promise<SlideNarration> {
    const session = await this.sessionRepository.getById(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    const existingNarration = session.narrationBySlideId[slideId];
    if (existingNarration) {
      return ensureNarrationSegments(existingNarration);
    }

    const deck = await this.deckRepository.getById(session.deckId);
    if (!deck) {
      throw new Error(`Deck ${session.deckId} was not found.`);
    }

    const slide = deck.slides.find((candidate) => candidate.id === slideId);
    if (!slide) {
      throw new Error(`Slide ${slideId} was not found in deck ${deck.id}.`);
    }

    const narration = ensureNarrationSegments(
      await this.narrationEngine.generateNarration({
        deck,
        slide,
        pedagogicalProfile: session.pedagogicalProfile,
      }),
    );

    const updatedSession: Session = {
      ...session,
      narrationBySlideId: {
        ...session.narrationBySlideId,
        [slideId]: narration,
      },
      updatedAt: nowIso(),
    };

    await this.sessionRepository.save(updatedSession);
    return narration;
  }

  async updateNarrationProgress(
    sessionId: string,
    slideId: string | undefined,
    narrationIndex: number,
  ): Promise<SelectSlideResult> {
    const { session, deck } = await this.loadSessionContext(sessionId);
    const targetSlide = this.requireSlide(
      deck,
      slideId ?? session.currentSlideId ?? deck.slides[session.currentSlideIndex]?.id,
    );
    const narration = await this.getOrGenerateNarration(sessionId, targetSlide.id);
    const clampedNarrationIndex = this.clampNarrationIndex(
      narration,
      narrationIndex,
    );

    const updatedSession: Session = {
      ...session,
      currentSlideId: targetSlide.id,
      currentSlideIndex: this.getSlideIndex(deck, targetSlide.id),
      currentNarrationIndex: clampedNarrationIndex,
      narrationProgressBySlideId: {
        ...session.narrationProgressBySlideId,
        [targetSlide.id]: clampedNarrationIndex,
      },
      updatedAt: nowIso(),
    };

    await this.sessionRepository.save(updatedSession);

    return {
      deck,
      session: updatedSession,
      narration,
    };
  }

  async selectSlide(
    sessionId: string,
    slideId: string,
  ): Promise<SelectSlideResult> {
    const { session, deck } = await this.loadSessionContext(sessionId);
    const targetSlide = this.requireSlide(deck, slideId);
    const existingNarration = session.narrationBySlideId[targetSlide.id];
    const narration = existingNarration
      ? ensureNarrationSegments(existingNarration)
      : undefined;

    const updatedSession: Session = {
      ...session,
      currentSlideId: targetSlide.id,
      currentSlideIndex: this.getSlideIndex(deck, targetSlide.id),
      currentNarrationIndex: this.getStoredNarrationProgress(session, targetSlide.id),
      narrationBySlideId: narration
        ? {
            ...session.narrationBySlideId,
            [targetSlide.id]: narration,
          }
        : session.narrationBySlideId,
      updatedAt: nowIso(),
    };

    await this.sessionRepository.save(updatedSession);

    return {
      deck,
      session: updatedSession,
      narration,
    };
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshotResult> {
    const { session, deck } = await this.loadSessionContext(sessionId);
    const transcripts = await this.transcriptRepository.listBySessionId(sessionId);
    const currentNarration = session.currentSlideId
      ? session.narrationBySlideId[session.currentSlideId]
      : undefined;

    return {
      deck,
      session,
      narration: currentNarration,
      transcripts,
    };
  }

  async waitForBackgroundEnrichment(sessionId: string): Promise<void> {
    await this.backgroundEnrichmentTasks.get(sessionId);
  }

  async interact(
    sessionId: string,
    text: string,
  ): Promise<SessionInteractionResult> {
    let { session, deck } = await this.loadSessionContext(sessionId);
    const activeSlide = this.requireCurrentSlide(deck, session);
    const transcript = await this.transcriptRepository.listBySessionId(sessionId);
    const turnDecision = await this.conversationTurnEngine.planTurn({
      session,
      deck,
      slide: activeSlide,
      text,
      transcript,
    });
    const interruption = turnDecision.interruption;

    session = await this.appendTurn(session, {
      role: "user",
      text,
      relatedSlideId: activeSlide.id,
      interruptionType: interruption.type,
    });

    session = {
      ...session,
      lastInterruption: interruption,
      updatedAt: nowIso(),
    };

    const resumePlan = await this.resumePlanner.createPlan({
      session,
      interruption,
      turnDecision,
      deck,
    });

    let assistantMessage = "";
    let narration: SlideNarration | undefined;

    switch (turnDecision.responseMode) {
      case "ack_pause": {
        session = this.transitionIfPossible(
          session,
          "pause",
          "User paused the presentation.",
        );
        assistantMessage = "Presentation paused. Say continue when you want to resume.";
        break;
      }
      case "ack_resume": {
        session = this.resumeSession(session);
        narration = await this.getOrGenerateNarration(session.id, activeSlide.id);
        assistantMessage =
          resumePlan.targetNarrationIndex !== undefined
            ? `Resuming from point ${resumePlan.targetNarrationIndex + 1} on the current slide.`
            : "Resuming from the current slide.";
        break;
      }
      case "ack_back": {
        session = this.transitionIfPossible(
          this.transitionIfPossible(
            session,
            "interrupt",
            "User requested to go back.",
          ),
          "pause",
          "Pausing after back navigation.",
        );

        const targetSlide = resumePlan.targetSlideId
          ? deck.slides.find((slide) => slide.id === resumePlan.targetSlideId)
          : undefined;
        const previousSlide =
          targetSlide ??
          deck.slides[Math.max(session.currentSlideIndex - 1, 0)] ??
          activeSlide;

        session = {
          ...session,
          currentSlideId: previousSlide.id,
          currentSlideIndex: this.getSlideIndex(deck, previousSlide.id),
          currentNarrationIndex: this.getStoredNarrationProgress(
            session,
            previousSlide.id,
          ),
          updatedAt: nowIso(),
        };
        narration = await this.getOrGenerateNarration(session.id, previousSlide.id);
        assistantMessage = `Moved back to slide ${previousSlide.order + 1}: ${previousSlide.title}.`;
        break;
      }
      case "simplify":
      case "example":
      case "deepen":
      case "repeat": {
        session = this.transitionIfPossible(
          session,
          "interrupt",
          "User requested a branching explanation.",
        );
        session = this.transitionIfPossible(
          session,
          "branch",
          "Switching into branching explanation mode.",
        );

        assistantMessage = await this.handleBranchingRequest(
          turnDecision.responseMode,
          deck,
          activeSlide,
          session,
          text,
        );
        session = this.transitionIfPossible(
          session,
          "pause",
          "Pause after branching explanation.",
        );

        if (
          resumePlan.adaptPedagogy ||
          turnDecision.runtimeEffects.adaptDetailLevel ||
          turnDecision.runtimeEffects.adaptPace
        ) {
          session = {
            ...session,
            pedagogicalProfile: {
              ...session.pedagogicalProfile,
              detailLevel:
                turnDecision.runtimeEffects.adaptDetailLevel ??
                "light",
              pace: turnDecision.runtimeEffects.adaptPace ?? "slow",
            },
          };
        }
        break;
      }
      case "summarize_current_slide":
      case "general_contextual":
      case "grounded_factual":
      default: {
        session = this.transitionIfPossible(
          session,
          "interrupt",
          "User asked a question.",
        );
        session = this.transitionIfPossible(
          session,
          "answer",
          "Answering user question in context.",
        );

        assistantMessage = await this.questionAnswerService.answer({
          deck,
          slide: activeSlide,
          session,
          pedagogicalProfile: session.pedagogicalProfile,
          question: text,
          turnDecision,
        });

        if (
          turnDecision.runtimeEffects.adaptDetailLevel ||
          turnDecision.runtimeEffects.adaptPace
        ) {
          session = {
            ...session,
            pedagogicalProfile: {
              ...session.pedagogicalProfile,
              detailLevel:
                turnDecision.runtimeEffects.adaptDetailLevel ??
                session.pedagogicalProfile.detailLevel,
              pace:
                turnDecision.runtimeEffects.adaptPace ??
                session.pedagogicalProfile.pace,
            },
          };
        }

        session = this.transitionIfPossible(
          session,
          "pause",
          "Pause after answering the question.",
        );
        break;
      }
    }

    session = this.applyResumePlan(session, deck, resumePlan, narration);
    session = this.applyRuntimeEffects(session, turnDecision);

    session = await this.appendTurn(session, {
      role: "assistant",
      text: assistantMessage,
      relatedSlideId: session.currentSlideId,
      interruptionType: interruption.type,
    });

    await this.sessionRepository.save(session);

    return {
      deck,
      session,
      interruption,
      turnDecision,
      resumePlan,
      assistantMessage,
      narration,
    };
  }

  private async loadSessionContext(
    sessionId: string,
  ): Promise<{ session: Session; deck: Deck }> {
    const session = await this.sessionRepository.getById(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    const deck = await this.deckRepository.getById(session.deckId);

    if (!deck) {
      throw new Error(`Deck ${session.deckId} was not found.`);
    }

    return { session, deck };
  }

  private startBackgroundEnrichment(input: BackgroundEnrichmentInput): void {
    if (this.backgroundEnrichmentTasks.has(input.sessionId)) {
      return;
    }

    const task = (async () => {
      const latestSession = await this.sessionRepository.getById(input.sessionId);
      const latestDeck = (await this.deckRepository.getById(input.deck.id)) ?? input.deck;

      if (!latestSession) {
        return;
      }

      const narrationBySlideId = new Map(
        input.initialNarrations.map((narration) => [narration.slideId, narration]),
      );

      for (const [slideId, narration] of Object.entries(latestSession.narrationBySlideId)) {
        narrationBySlideId.set(slideId, ensureNarrationSegments(narration));
      }

      for (const slide of latestDeck.slides) {
        if (narrationBySlideId.has(slide.id)) {
          continue;
        }

        try {
          narrationBySlideId.set(
            slide.id,
            ensureNarrationSegments(
              await this.narrationEngine.generateNarration({
                deck: latestDeck,
                slide,
                pedagogicalProfile: input.pedagogicalProfile,
              }),
            ),
          );
        } catch (error) {
          console.warn(
            `[slidespeech] background narration fallback for slide "${slide.title}": ${(error as Error).message}`,
          );
        }
      }

      const combinedNarrations = latestDeck.slides
        .map((slide) => narrationBySlideId.get(slide.id))
        .filter((narration): narration is SlideNarration => Boolean(narration))
        .map((narration) => ensureNarrationSegments(narration));
      const narrationValidation = validateAndRepairNarrations(
        latestDeck,
        combinedNarrations,
        { generateMissing: false },
      );

      const review = await this.reviewPresentationWithFallback({
        deck: latestDeck,
        narrations: narrationValidation.value,
        pedagogicalProfile: input.pedagogicalProfile,
        validationIssues: narrationValidation.issues,
        fallbackNote:
          "Deterministic quality review used because the LLM review step was unavailable or overruled.",
        topic: input.topic,
      });

      const finalNarrations = this.mergeReviewedNarrations(
        narrationValidation.value,
        review.repairedNarrations,
      );
      const reviewedNarrationValidation = validateAndRepairNarrations(
        latestDeck,
        finalNarrations,
        { generateMissing: false },
      );
      const locallyRepairedNarrations = this.applyLocalNarrationRepairsFromReview(
        latestDeck,
        reviewedNarrationValidation.value,
        review,
      );
      const finalizedDeck = this.finalizeDeckMetadata(
        latestDeck,
        locallyRepairedNarrations.narrations,
        review,
        [
          ...narrationValidation.issues,
          ...reviewedNarrationValidation.issues,
          ...locallyRepairedNarrations.issues,
        ],
      );
      await this.deckRepository.save(finalizedDeck);

      const refreshedSession =
        (await this.sessionRepository.getById(input.sessionId)) ?? latestSession;
      await this.sessionRepository.save({
        ...refreshedSession,
        narrationBySlideId: {
          ...refreshedSession.narrationBySlideId,
          ...Object.fromEntries(
            locallyRepairedNarrations.narrations.map((narration) => [narration.slideId, narration]),
          ),
        },
        updatedAt: nowIso(),
      });
    })()
      .catch(async (error) => {
        console.error(
          `[slidespeech] background enrichment failed for session ${input.sessionId}: ${(error as Error).message}`,
        );
        const deck = (await this.deckRepository.getById(input.deck.id)) ?? input.deck;
        const session = await this.sessionRepository.getById(input.sessionId);
        const issue: ValidationIssue = {
          code: "background_enrichment_failed",
          message: `Background enrichment failed: ${(error as Error).message}`,
          severity: "warning",
        };

        await this.deckRepository.save({
          ...deck,
          updatedAt: nowIso(),
          metadata: {
            ...deck.metadata,
            validation: this.mergeValidationMetadata(deck, [issue]),
            generation: this.buildGenerationStatus(
              deck,
              this.countReadySlides(
                deck,
                session?.narrationBySlideId ?? {},
              ),
              false,
              nowIso(),
            ),
          },
        });
      })
      .finally(() => {
        this.backgroundEnrichmentTasks.delete(input.sessionId);
      });

    this.backgroundEnrichmentTasks.set(input.sessionId, task);
  }

  private countReadySlides(
    deck: Deck,
    narrationBySlideId: Record<string, SlideNarration>,
  ): number {
    return deck.slides.reduce(
      (count, slide) => count + (narrationBySlideId[slide.id] ? 1 : 0),
      0,
    );
  }

  private buildGenerationStatus(
    deck: Deck,
    narrationReadySlides: number,
    backgroundEnrichmentPending: boolean,
    lastCompletedAt?: string,
  ): NonNullable<Deck["metadata"]["generation"]> {
    return {
      narrationReadySlides,
      totalSlides: deck.slides.length,
      backgroundEnrichmentPending,
      ...(lastCompletedAt ? { lastCompletedAt } : {}),
    };
  }

  private dedupeValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
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
  }

  private mergeValidationMetadata(
    deck: Deck,
    additionalIssues: ValidationIssue[],
    summary?: string,
    overallScore?: number,
  ): NonNullable<Deck["metadata"]["validation"]> {
    const combinedIssues = this.dedupeValidationIssues([
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
  }

  private buildDeterministicPresentationReview(
    deck: Deck,
    validationIssues: ValidationIssue[],
    repairedNarrations: SlideNarration[],
    note?: string,
  ): PresentationReview {
    return buildDeterministicReview({
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
  }

  private shouldPreferDeterministicReview(
    llmReview: PresentationReview,
    deterministicReview: PresentationReview,
  ): boolean {
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
  }

  private async reviewPresentationWithFallback(input: {
    deck: Deck;
    narrations: SlideNarration[];
    pedagogicalProfile: PedagogicalProfile;
    validationIssues: ValidationIssue[];
    fallbackNote: string;
    topic: string;
  }): Promise<PresentationReview> {
    const deterministicReview = this.buildDeterministicPresentationReview(
      input.deck,
      input.validationIssues,
      input.narrations,
      input.fallbackNote,
    );

    try {
      const llmReview = await this.qualityReviewer.review({
        deck: input.deck,
        narrations: input.narrations,
        pedagogicalProfile: input.pedagogicalProfile,
      });

      if (this.shouldPreferDeterministicReview(llmReview, deterministicReview)) {
        console.warn(
          `[slidespeech] review reconciliation fallback for topic "${input.topic}": LLM review contradicted the stronger deterministic baseline (llm_score=${llmReview.overallScore.toFixed(2)}, deterministic_score=${deterministicReview.overallScore.toFixed(2)}).`,
        );
        return deterministicReview;
      }

      return llmReview;
    } catch (error) {
      console.warn(
        `[slidespeech] presentation review fallback for topic "${input.topic}": ${(error as Error).message}`,
      );
      return deterministicReview;
    }
  }

  private mergeReviewedNarrations(
    narrations: SlideNarration[],
    repairedNarrations: SlideNarration[],
  ): SlideNarration[] {
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
  }

  private resolveSlideIdFromReviewIssue(
    deck: Deck,
    issue: PresentationReview["issues"][number],
  ): string | null {
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
  }

  private applyLocalNarrationRepairsFromReview(
    deck: Deck,
    narrations: SlideNarration[],
    review: PresentationReview,
  ): { narrations: SlideNarration[]; issues: ValidationIssue[] } {
    const narrationBySlideId = new Map(
      narrations.map((narration) => [narration.slideId, ensureNarrationSegments(narration)]),
    );
    const issues: ValidationIssue[] = [];

    for (const reviewIssue of review.issues) {
      if (!REVIEW_NARRATION_REPAIR_CODE_PATTERN.test(reviewIssue.code)) {
        continue;
      }

      const slideId = this.resolveSlideIdFromReviewIssue(deck, reviewIssue);
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
  }

  private finalizeDeckMetadata(
    deck: Deck,
    narrations: SlideNarration[],
    review: PresentationReview,
    additionalValidationIssues: ValidationIssue[] = [],
  ): Deck {
    const evaluation = evaluateDeckQuality(deck, narrations);
    const reviewIssues: ValidationIssue[] = review.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      ...(issue.slideId ? { slideId: issue.slideId } : {}),
    }));
    const validation = this.mergeValidationMetadata(
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
        generation: this.buildGenerationStatus(
          deck,
          narrations.length,
          false,
          nowIso(),
        ),
      },
    });
  }

  private requireCurrentSlide(deck: Deck, session: Session): Slide {
    const currentSlideId = session.currentSlideId ?? deck.slides[session.currentSlideIndex]?.id;
    return this.requireSlide(deck, currentSlideId);
  }

  private requireSlide(deck: Deck, slideId?: string): Slide {
    const slide = deck.slides.find((candidate) => candidate.id === slideId);

    if (!slide) {
      throw new Error(`Slide ${slideId ?? "unknown"} was not found in deck ${deck.id}.`);
    }

    return slide;
  }

  private getSlideIndex(deck: Deck, slideId: string): number {
    const index = deck.slides.findIndex((candidate) => candidate.id === slideId);

    if (index < 0) {
      throw new Error(`Slide ${slideId} was not found in deck ${deck.id}.`);
    }

    return index;
  }

  private async appendTurn(
    session: Session,
    input: Omit<TranscriptTurn, "id" | "sessionId" | "createdAt">,
  ): Promise<Session> {
    const turn: TranscriptTurn = {
      id: createId("turn"),
      sessionId: session.id,
      createdAt: nowIso(),
      ...input,
    };

    await this.transcriptRepository.append(turn);

    return {
      ...session,
      transcriptTurnIds: [...session.transcriptTurnIds, turn.id],
      updatedAt: nowIso(),
    };
  }

  private transitionIfPossible(
    session: Session,
    event: Parameters<typeof transitionSessionState>[1],
    reason: string,
  ): Session {
    try {
      const nextState = transitionSessionState(session, event);
      console.log(
        `[slidespeech] session ${session.id} transition ${session.state} -> ${nextState} (${reason})`,
      );

      return {
        ...session,
        state: nextState,
        updatedAt: nowIso(),
      };
    } catch {
      return session;
    }
  }

  private resumeSession(session: Session): Session {
    const resumed = this.transitionIfPossible(
      session,
      "resume",
      "User requested resume.",
    );

    return this.transitionIfPossible(
      resumed,
      "presentation_ready",
      "Presentation returned to active presenting state.",
    );
  }

  private getStoredNarrationProgress(session: Session, slideId: string): number {
    return session.narrationProgressBySlideId[slideId] ?? 0;
  }

  private clampNarrationIndex(
    narration: SlideNarration | undefined,
    narrationIndex: number,
  ): number {
    const segmentCount =
      narration && ensureNarrationSegments(narration).segments.length > 0
        ? ensureNarrationSegments(narration).segments.length
        : 1;

    return Math.max(0, Math.min(narrationIndex, segmentCount - 1));
  }

  private async handleBranchingRequest(
    type: ConversationTurnDecision["responseMode"],
    deck: Deck,
    slide: Slide,
    session: Session,
    rawText: string,
  ): Promise<string> {
    try {
      switch (type) {
        case "simplify": {
          const result =
            /\?/.test(rawText) || /why|what|how|can you|could you/i.test(rawText)
              ? await this.llmProvider.answerQuestion({
                  deck,
                  slide,
                  session,
                  pedagogicalProfile: {
                    ...session.pedagogicalProfile,
                    detailLevel: "light",
                    pace: "slow",
                  },
                  question: `${rawText}\n\nPlease answer in simpler terms.`,
                })
              : await this.llmProvider.simplifyExplanation({
                  deck,
                  slide,
                  session,
                  pedagogicalProfile: session.pedagogicalProfile,
                  reason: "User asked for a simpler explanation.",
                });
          return result.text;
        }
        case "example": {
          const result = await this.llmProvider.generateExample({
            deck,
            slide,
            session,
            pedagogicalProfile: session.pedagogicalProfile,
            reason: "User asked for an example.",
          });
          return result.text;
        }
        case "deepen": {
          const result = await this.llmProvider.deepenExplanation({
            deck,
            slide,
            session,
            pedagogicalProfile: session.pedagogicalProfile,
            reason: "User asked for a deeper explanation.",
          });
          return result.text;
        }
        case "repeat": {
          const narration =
            session.narrationBySlideId[slide.id] ??
            (await this.narrationEngine.generateNarration({
              deck,
              slide,
              pedagogicalProfile: session.pedagogicalProfile,
            }));
          return narration.narration;
        }
        default:
          return slide.beginnerExplanation;
      }
    } catch (error) {
      console.warn(
        `[slidespeech] branching request fallback for slide ${slide.id}: ${(error as Error).message}`,
      );
      return this.buildInteractionFallback(type, slide);
    }
  }

  private buildInteractionFallback(
    type: ConversationTurnDecision["responseMode"] | "question",
    slide: Slide,
  ): string {
    const keyPoints = slide.keyPoints.slice(0, 3);
    const mainIdea =
      keyPoints.length > 0 ? keyPoints.join(", ") : slide.learningGoal;

    switch (type) {
      case "simplify":
        return `${slide.beginnerExplanation} In simple terms, the key idea here is ${mainIdea}.`;
      case "example":
        return slide.examples[0]
          ? `A concrete example for this slide is: ${slide.examples[0]}`
          : `A concrete way to think about this slide is to focus on ${mainIdea}.`;
      case "deepen":
        return slide.advancedExplanation.trim().length > 0
          ? slide.advancedExplanation
          : `Looking one level deeper, this slide is really about ${mainIdea}.`;
      case "repeat":
        return `${slide.beginnerExplanation} The main points are ${mainIdea}.`;
      case "question":
      default:
        return `${slide.beginnerExplanation} On this slide, the important points are ${mainIdea}.`;
    }
  }

  private applyRuntimeEffects(
    session: Session,
    decision: ConversationTurnDecision,
  ): Session {
    let updatedSession = session;

    if (
      decision.runtimeEffects.adaptDetailLevel ||
      decision.runtimeEffects.adaptPace
    ) {
      updatedSession = {
        ...updatedSession,
        pedagogicalProfile: {
          ...updatedSession.pedagogicalProfile,
          detailLevel:
            decision.runtimeEffects.adaptDetailLevel ??
            updatedSession.pedagogicalProfile.detailLevel,
          pace:
            decision.runtimeEffects.adaptPace ??
            updatedSession.pedagogicalProfile.pace,
        },
      };
    }

    return {
      ...updatedSession,
      updatedAt: nowIso(),
    };
  }

  private applyResumePlan(
    session: Session,
    deck: Deck,
    resumePlan: ResumePlan,
    narration?: SlideNarration,
  ): Session {
    const currentSlideId = resumePlan.targetSlideId ?? session.currentSlideId;

    if (!currentSlideId) {
      return session;
    }

    const targetNarrationIndex =
      resumePlan.action === "restart_slide"
        ? 0
        : this.clampNarrationIndex(
            narration ??
              (currentSlideId
                ? session.narrationBySlideId[currentSlideId]
                : undefined),
            resumePlan.targetNarrationIndex ??
              this.getStoredNarrationProgress(session, currentSlideId),
          );

    return {
      ...session,
      currentSlideId,
      currentSlideIndex: this.getSlideIndex(deck, currentSlideId),
      currentNarrationIndex: targetNarrationIndex,
      narrationProgressBySlideId: {
        ...session.narrationProgressBySlideId,
        [currentSlideId]: targetNarrationIndex,
      },
      updatedAt: nowIso(),
    };
  }
}
