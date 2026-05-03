import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  DeckRepository,
  Deck,
  GenerateDeckInput,
  GroundingFact,
  LLMProvider,
  PedagogicalProfile,
  PresentationTheme,
  PresentationIntent,
  PresentationPlan,
  PresentationReview,
  ResumePlan,
  ResumePlanner,
  Session,
  SessionRepository,
  SlideNarration,
  SlideBrief,
  Slide,
  TranscriptRepository,
  TranscriptTurn,
  UserInterruption,
  WebResearchProvider,
} from "@slidespeech/types";

import { DEFAULT_PEDAGOGICAL_PROFILE } from "./defaults";
import {
  buildDeterministicDeck,
  buildDeterministicNarration,
  buildDeterministicPresentationPlan,
} from "./deterministic-generation";
import { RuleBasedConversationTurnEngine } from "./conversation-turn-engine";
import {
  NarrationEngine,
  PresentationPlanner,
  PresentationQualityReviewer,
} from "./planners";
import { QuestionAnswerService } from "./question-answer-service";
import { SimpleResumePlanner } from "./resume-planner";
import {
  buildDeckRevisionGuidance,
  buildDeckSemanticReviewAssessment,
  ensureDeckTheme,
  ensureNarrationSegments,
  evaluateDeckCandidateForRetry,
  MAX_DECK_GENERATION_ATTEMPTS,
  mergeDeckCandidateAssessments,
  tryAcceptDeckAfterLocalRepair,
  type BackgroundEnrichmentInput,
  type DeckCandidateAssessment,
  type ValidationIssue,
} from "./session-deck-quality";
import {
  applyLocalNarrationRepairsFromReview,
  buildDeterministicPresentationReview,
  buildGenerationStatus,
  countReadySlides,
  finalizeDeckMetadata,
  mergeNewNarrationsPreservingExisting,
  mergeReviewedNarrations,
  mergeValidationMetadata,
  shouldPreferDeterministicReview,
} from "./session-review-helpers";
import { transitionSessionState } from "./state-machine";
import { createId, nowIso } from "./utils";
import {
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
  groundingExcerpts?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
  groundingFacts?: GroundingFact[] | undefined;
  slideBriefs?: SlideBrief[] | undefined;
  groundingSourceType?: "topic" | "document" | "pptx" | "mixed" | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
  theme?: PresentationTheme | undefined;
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
    webResearchProvider?: WebResearchProvider,
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
        input.groundingExcerpts,
        input.groundingCoverageGoals,
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
      ...(input.groundingExcerpts?.length
        ? { groundingExcerpts: input.groundingExcerpts }
        : {}),
      ...(input.groundingCoverageGoals?.length
        ? { groundingCoverageGoals: input.groundingCoverageGoals }
        : {}),
      ...(input.groundingSourceIds
        ? { groundingSourceIds: input.groundingSourceIds }
        : {}),
      ...(input.groundingFacts?.length
        ? { groundingFacts: input.groundingFacts }
        : {}),
      ...(input.slideBriefs?.length ? { slideBriefs: input.slideBriefs } : {}),
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
    let usedDeterministicDeckFallback = false;
    let bestGeneratedDeck: Deck | null = null;
    let bestDeckAssessment: DeckCandidateAssessment | null = null;
    let lastGenerationError: Error | null = null;
    let deckGenerationAttemptCount = 0;

    for (
      let attemptIndex = 0;
      attemptIndex < MAX_DECK_GENERATION_ATTEMPTS;
      attemptIndex += 1
    ) {
      deckGenerationAttemptCount += 1;
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
                generationInput.intent,
              ),
            };

      try {
        const candidateDeck = await this.planner.generateDeck(deckAttemptInput);
        const locallyAcceptedDeck = tryAcceptDeckAfterLocalRepair(candidateDeck);
        const deckForAssessment = locallyAcceptedDeck ?? candidateDeck;

        const deterministicAssessment = evaluateDeckCandidateForRetry(
          deckForAssessment,
          input.intent,
        );
        const semanticAssessment = await this.reviewDeckSemanticsForRetry({
          deck: deckForAssessment,
          generationInput: deckAttemptInput,
          pedagogicalProfile,
          topic: input.topic,
          shouldReview:
            Boolean(locallyAcceptedDeck) ||
            !deterministicAssessment.retryable ||
            attemptIndex === MAX_DECK_GENERATION_ATTEMPTS - 1,
        });
        const candidateAssessment = semanticAssessment
          ? mergeDeckCandidateAssessments(
              deterministicAssessment,
              semanticAssessment,
            )
          : deterministicAssessment;

        if (
          !bestGeneratedDeck ||
          !bestDeckAssessment ||
          candidateAssessment.score < bestDeckAssessment.score
        ) {
          bestGeneratedDeck = deckForAssessment;
          bestDeckAssessment = candidateAssessment;
        }

        if (!candidateAssessment.retryable) {
          generatedDeck = deckForAssessment;
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
        lastGenerationError = error as Error;
        console.warn(
          `[slidespeech] deck generation attempt ${attemptIndex + 1} failed for topic "${input.topic}": ${(error as Error).message}`,
        );
      }
    }

    if (!bestGeneratedDeck) {
      console.warn(
        `[slidespeech] no usable LLM-generated deck was produced for "${input.topic}" after ${deckGenerationAttemptCount} attempt(s); using deterministic fallback.${
          lastGenerationError ? ` Last error: ${lastGenerationError.message}` : ""
        }`,
      );
      generatedDeck = buildDeterministicDeck(generationInput);
      usedDeterministicDeckFallback = true;
    } else if (!generatedDeck) {
      if (bestDeckAssessment?.fatal) {
        console.warn(
          `[slidespeech] best LLM-generated deck for "${input.topic}" still had fatal quality issues; using deterministic fallback: ${bestDeckAssessment.reasons.join(" | ")}`,
        );
        generatedDeck = buildDeterministicDeck(generationInput);
        usedDeterministicDeckFallback = true;
      } else if (bestDeckAssessment?.retryable) {
        console.warn(
          `[slidespeech] using best available LLM-generated deck for "${input.topic}" after retries: ${bestDeckAssessment.reasons.join(" | ")}`,
        );
        generatedDeck = bestGeneratedDeck;
      } else {
        generatedDeck = bestGeneratedDeck;
      }
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
    }, input.theme);

    const introSlide = deck.slides[0];
    const initialNarrations: SlideNarration[] = [];

    if (introSlide) {
      if (usedDeterministicDeckFallback) {
        initialNarrations.push(
          buildDeterministicNarration({
            deck,
            slide: introSlide,
            pedagogicalProfile,
          }),
        );
      } else {
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
        validation: mergeValidationMetadata(deck, introNarrationIssues),
        generation: buildGenerationStatus(
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

      const finalNarrations = mergeReviewedNarrations(
        [introNarration],
        review.repairedNarrations,
      );
      const reviewedNarrationValidation = validateAndRepairNarrations(
        deck,
        finalNarrations,
        { generateMissing: false },
      );
      const locallyRepairedNarrations = applyLocalNarrationRepairsFromReview(
        deck,
        reviewedNarrationValidation.value,
        review,
      );
      const finalizedDeck = finalizeDeckMetadata(
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
        narrationBySlideId: mergeNewNarrationsPreservingExisting(
          persistedSession.narrationBySlideId,
          locallyRepairedNarrations.narrations,
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

    const latestSession = (await this.sessionRepository.getById(sessionId)) ?? session;
    const existingAfterGeneration = latestSession.narrationBySlideId[slideId];
    if (existingAfterGeneration) {
      return ensureNarrationSegments(existingAfterGeneration);
    }

    const updatedSession: Session = {
      ...latestSession,
      narrationBySlideId: {
        ...latestSession.narrationBySlideId,
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

      const finalNarrations = mergeReviewedNarrations(
        narrationValidation.value,
        review.repairedNarrations,
      );
      const reviewedNarrationValidation = validateAndRepairNarrations(
        latestDeck,
        finalNarrations,
        { generateMissing: false },
      );
      const locallyRepairedNarrations = applyLocalNarrationRepairsFromReview(
        latestDeck,
        reviewedNarrationValidation.value,
        review,
      );
      const finalizedDeck = finalizeDeckMetadata(
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
        narrationBySlideId: mergeNewNarrationsPreservingExisting(
          refreshedSession.narrationBySlideId,
          locallyRepairedNarrations.narrations,
        ),
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
            validation: mergeValidationMetadata(deck, [issue]),
            generation: buildGenerationStatus(
              deck,
              countReadySlides(
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

  private async reviewPresentationWithFallback(input: {
    deck: Deck;
    narrations: SlideNarration[];
    pedagogicalProfile: PedagogicalProfile;
    validationIssues: ValidationIssue[];
    fallbackNote: string;
    topic: string;
  }): Promise<PresentationReview> {
    const deterministicReview = buildDeterministicPresentationReview(
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

      if (shouldPreferDeterministicReview(llmReview, deterministicReview)) {
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

  private async reviewDeckSemanticsForRetry(input: {
    deck: Deck;
    generationInput: GenerateDeckInput;
    pedagogicalProfile: PedagogicalProfile;
    topic: string;
    shouldReview: boolean;
  }): Promise<DeckCandidateAssessment | null> {
    if (!input.shouldReview) {
      return null;
    }

    try {
      const review = await this.qualityReviewer.reviewDeckSemantics({
        deck: input.deck,
        generationInput: {
          topic: input.generationInput.topic,
          ...(input.generationInput.presentationBrief
            ? { presentationBrief: input.generationInput.presentationBrief }
            : {}),
          ...(input.generationInput.intent
            ? { intent: input.generationInput.intent }
            : {}),
          ...(input.generationInput.revisionGuidance
            ? { revisionGuidance: input.generationInput.revisionGuidance }
            : {}),
          ...(input.generationInput.plan ? { plan: input.generationInput.plan } : {}),
          pedagogicalProfile: input.pedagogicalProfile,
          ...(input.generationInput.groundingSummary
            ? { groundingSummary: input.generationInput.groundingSummary }
            : {}),
          ...(input.generationInput.groundingHighlights
            ? { groundingHighlights: input.generationInput.groundingHighlights }
            : {}),
          ...(input.generationInput.groundingExcerpts
            ? { groundingExcerpts: input.generationInput.groundingExcerpts }
            : {}),
          ...(input.generationInput.groundingCoverageGoals
            ? { groundingCoverageGoals: input.generationInput.groundingCoverageGoals }
            : {}),
          ...(input.generationInput.groundingSourceIds
            ? { groundingSourceIds: input.generationInput.groundingSourceIds }
            : {}),
          ...(input.generationInput.groundingSourceType
            ? { groundingSourceType: input.generationInput.groundingSourceType }
            : {}),
          ...(input.generationInput.targetDurationMinutes
            ? { targetDurationMinutes: input.generationInput.targetDurationMinutes }
            : {}),
          ...(input.generationInput.targetSlideCount
            ? { targetSlideCount: input.generationInput.targetSlideCount }
            : {}),
        },
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
        `[slidespeech] semantic deck review fallback for topic "${input.topic}": ${(error as Error).message}`,
      );
      return null;
    }
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
