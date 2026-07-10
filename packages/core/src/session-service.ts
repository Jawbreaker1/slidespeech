import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  DeckRepository,
  Deck,
  GroundingFact,
  LLMProvider,
  PedagogicalProfile,
  PresentationTheme,
  PresentationIntent,
  PresentationPlan,
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
import { generatePresentationDeck } from "./generation/generation-orchestrator";
import { RuleBasedConversationTurnEngine } from "./conversation-turn-engine";
import {
  NarrationEngine,
  PresentationPlanner,
  PresentationQualityReviewer,
} from "./planners";
import { QuestionAnswerService } from "./question-answer-service";
import { SimpleResumePlanner } from "./resume-planner";
import {
  ensureDeckTheme,
  ensureNarrationSegments,
  type BackgroundEnrichmentInput,
} from "./session-deck-quality";
import type { ValidationIssue } from "./session-deck-quality";
import {
  formatBlockingDeckValidationIssues,
  formatBlockingReviewIssues,
  isBlockingDeckValidationIssue,
  reviewDeckBeforePublishing,
  reviewHasBlockingDeckIssues,
  reviewPresentationWithLocalBaseline,
  validateReviewedNarrationsForPublication,
} from "./session-publication-review";
import {
  buildGenerationStatus,
  countReadySlides,
  finalizeDeckMetadata,
  mergeNewNarrationsPreservingExisting,
  mergeValidationMetadata,
} from "./session-review-helpers";
import { transitionSessionState } from "./state-machine";
import { createId, nowIso } from "./utils";
import {
  validateDeck,
  validateNarrations,
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
  skipBackgroundEnrichment?: boolean | undefined;
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

    const plan = await this.planner.plan(
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
      input.groundingFacts,
    );

    const deckGeneration = await generatePresentationDeck({
      planner: this.planner,
      qualityReviewer: this.qualityReviewer,
      request: input,
      pedagogicalProfile,
      plan,
    });

    const deckValidation = validateDeck(deckGeneration.deck);
    if (deckValidation.issues.some(isBlockingDeckValidationIssue)) {
      throw new Error(
        `Presentation generation failed deck validation for "${input.topic}": ${formatBlockingDeckValidationIssues(deckValidation.issues)}`,
      );
    }

    let deck = ensureDeckTheme({
      ...deckValidation.value,
      metadata: {
        ...deckValidation.value.metadata,
        generation: {
          narrationReadySlides: 0,
          totalSlides: deckValidation.value.slides.length,
          backgroundEnrichmentPending:
            !input.skipBackgroundEnrichment && deckValidation.value.slides.length > 1,
        },
      },
    }, input.theme);

    await reviewDeckBeforePublishing({
      qualityReviewer: this.qualityReviewer,
      deck,
      generationInput: deckGeneration.generationInput,
      pedagogicalProfile,
      topic: input.topic,
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
          `[slidespeech] intro narration generation failed for slide "${introSlide.title}": ${(error as Error).message}`,
        );
      }
    }

    const introNarrationValidation =
      introSlide && initialNarrations[0]
        ? validateNarrations(
            deck,
            initialNarrations,
            { generateMissing: false },
          )
        : null;
    const introNarration = introNarrationValidation?.value[0]
      ? ensureNarrationSegments(introNarrationValidation.value[0])
      : undefined;
    const introNarrationIssues = introNarrationValidation?.issues ?? [];

    if (introNarrationIssues.some(isBlockingDeckValidationIssue)) {
      throw new Error(
        `Presentation generation failed opening narration validation for "${input.topic}": ${formatBlockingDeckValidationIssues(introNarrationIssues)}`,
      );
    }

    const backgroundEnrichmentPending =
      !input.skipBackgroundEnrichment &&
      deck.slides.length > (introNarration ? 1 : 0);

    if (!introNarration && !backgroundEnrichmentPending && deck.slides.length > 0) {
      throw new Error(
        `Presentation generation failed narration validation for "${input.topic}": opening narration was not generated.`,
      );
    }

    deck = {
      ...deck,
      metadata: {
        ...deck.metadata,
        validation: mergeValidationMetadata(deck, introNarrationIssues),
        generation: buildGenerationStatus(
          deck,
          introNarration ? 1 : 0,
          backgroundEnrichmentPending,
        ),
      },
    };

    let narrationsToPersist = introNarration ? [introNarration] : [];

    if (
      introNarration &&
      (input.skipBackgroundEnrichment || deck.slides.length <= 1)
    ) {
      const review = await reviewPresentationWithLocalBaseline({
        qualityReviewer: this.qualityReviewer,
        deck,
        narrations: [introNarration],
        pedagogicalProfile,
        validationIssues: introNarrationIssues,
        baselineNote:
          "Local review baseline used while completing the initial synchronous presentation.",
        topic: input.topic,
      });

      if (reviewHasBlockingDeckIssues(review)) {
        throw new Error(
          `Presentation generation failed final quality review for "${input.topic}": ${formatBlockingReviewIssues(review)}`,
        );
      }

      const reviewedNarrations = validateReviewedNarrationsForPublication({
        deck,
        narrations: [introNarration],
        review,
      });

      if (reviewedNarrations.issues.some(isBlockingDeckValidationIssue)) {
        throw new Error(
          `Presentation generation failed narration validation for "${input.topic}": ${formatBlockingDeckValidationIssues(reviewedNarrations.issues)}`,
        );
      }

      narrationsToPersist = reviewedNarrations.narrations;
      deck = finalizeDeckMetadata(
        deck,
        narrationsToPersist,
        review,
        [
          ...introNarrationIssues,
          ...reviewedNarrations.issues,
        ],
      );
    }

    await this.deckRepository.save(deck);

    const narrationBySlideId = Object.fromEntries(
      narrationsToPersist.map((narration) => [narration.slideId, narration]),
    );

    const session: Session = {
      id: createId("session"),
      deckId: deck.id,
      state: backgroundEnrichmentPending ? "preparing_presentation" : "presenting",
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
    let finalSession = persistedSession;

    if (backgroundEnrichmentPending) {
      this.startBackgroundEnrichment({
        deck,
        sessionId: persistedSession.id,
        generationInput: deckGeneration.generationInput,
        pedagogicalProfile,
        initialNarrations: narrationsToPersist,
        topic: input.topic,
      });
    }

    return {
      session: finalSession,
      narrations: narrationsToPersist,
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
        if (session.state === "preparing_presentation") {
          assistantMessage =
            "Presentation is still being prepared. Playback will be available after narration and final review complete.";
          break;
        }

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
            `[slidespeech] background narration generation failed for slide "${slide.title}": ${(error as Error).message}`,
          );
        }
      }

      const combinedNarrations = latestDeck.slides
        .map((slide) => narrationBySlideId.get(slide.id))
        .filter((narration): narration is SlideNarration => Boolean(narration))
        .map((narration) => ensureNarrationSegments(narration));
      const missingNarrationSlides = latestDeck.slides.filter(
        (slide) => !narrationBySlideId.has(slide.id),
      );
      if (missingNarrationSlides.length > 0) {
        const issue: ValidationIssue = {
          code: "narration_missing",
          message: `Background narration generation did not complete for ${missingNarrationSlides.length} slide(s): ${missingNarrationSlides.map((slide) => slide.title).join("; ")}`,
          severity: "error",
        };
        const failedDeck: Deck = {
          ...latestDeck,
          updatedAt: nowIso(),
          metadata: {
            ...latestDeck.metadata,
            validation: mergeValidationMetadata(
              latestDeck,
              [issue],
              "Background narration generation did not complete.",
              0,
            ),
            generation: buildGenerationStatus(
              latestDeck,
              combinedNarrations.length,
              false,
              nowIso(),
            ),
          },
        };
        await this.deckRepository.save(failedDeck);

        const refreshedSession =
          (await this.sessionRepository.getById(input.sessionId)) ?? latestSession;
        await this.sessionRepository.save({
          ...refreshedSession,
          state: "error",
          errorMessage: issue.message,
          narrationBySlideId: mergeNewNarrationsPreservingExisting(
            refreshedSession.narrationBySlideId,
            combinedNarrations,
          ),
          updatedAt: nowIso(),
        });
        return;
      }
      const narrationValidation = validateNarrations(
        latestDeck,
        combinedNarrations,
        { generateMissing: false },
      );

      const review = await reviewPresentationWithLocalBaseline({
        qualityReviewer: this.qualityReviewer,
        deck: latestDeck,
        narrations: narrationValidation.value,
        pedagogicalProfile: input.pedagogicalProfile,
        validationIssues: narrationValidation.issues,
        baselineNote:
          "Local review baseline used because the LLM review step was unavailable.",
        topic: input.topic,
      });
      if (reviewHasBlockingDeckIssues(review)) {
        console.warn(
          `[slidespeech] final background review rejected generated deck for "${input.topic}"; marking session as failed.`,
        );
        const failedDeck = finalizeDeckMetadata(
          latestDeck,
          narrationValidation.value,
          review,
          narrationValidation.issues,
        );
        await this.deckRepository.save(failedDeck);

        const refreshedSession =
          (await this.sessionRepository.getById(input.sessionId)) ?? latestSession;
        await this.sessionRepository.save({
          ...refreshedSession,
          state: "error",
          errorMessage: formatBlockingReviewIssues(review),
          narrationBySlideId: mergeNewNarrationsPreservingExisting(
            refreshedSession.narrationBySlideId,
            narrationValidation.value,
          ),
          updatedAt: nowIso(),
        });
        return;
      }

      const reviewedNarrations = validateReviewedNarrationsForPublication({
        deck: latestDeck,
        narrations: narrationValidation.value,
        review,
        priorValidationIssues: narrationValidation.issues,
      });

      if (reviewedNarrations.issues.some(isBlockingDeckValidationIssue)) {
        const message = formatBlockingDeckValidationIssues(reviewedNarrations.issues);
        console.warn(
          `[slidespeech] final background narration validation rejected generated deck for "${input.topic}"; marking session as failed.`,
        );
        const failedDeck = finalizeDeckMetadata(
          latestDeck,
          reviewedNarrations.narrations,
          {
            ...review,
            approved: false,
            overallScore: 0,
            summary: message,
          },
          reviewedNarrations.issues,
        );
        await this.deckRepository.save(failedDeck);

        const refreshedSession =
          (await this.sessionRepository.getById(input.sessionId)) ?? latestSession;
        await this.sessionRepository.save({
          ...refreshedSession,
          state: "error",
          errorMessage: message,
          narrationBySlideId: mergeNewNarrationsPreservingExisting(
            refreshedSession.narrationBySlideId,
            reviewedNarrations.narrations,
          ),
          updatedAt: nowIso(),
        });
        return;
      }

      const finalizedDeck = finalizeDeckMetadata(
        latestDeck,
        reviewedNarrations.narrations,
        review,
        reviewedNarrations.issues,
      );
      await this.deckRepository.save(finalizedDeck);

      const refreshedSession =
        (await this.sessionRepository.getById(input.sessionId)) ?? latestSession;
      const readySession = this.transitionIfPossible(
        refreshedSession,
        "presentation_ready",
        "Background narration and final review completed.",
      );
      await this.sessionRepository.save({
        ...readySession,
        errorMessage:
          readySession.state === "presenting"
            ? undefined
            : refreshedSession.errorMessage,
        narrationBySlideId: mergeNewNarrationsPreservingExisting(
          refreshedSession.narrationBySlideId,
          reviewedNarrations.narrations,
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
          severity: "error",
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

        if (session) {
          await this.sessionRepository.save({
            ...session,
            state: "error",
            errorMessage: issue.message,
            updatedAt: nowIso(),
          });
        }
      })
      .finally(() => {
        this.backgroundEnrichmentTasks.delete(input.sessionId);
      });

    this.backgroundEnrichmentTasks.set(input.sessionId, task);
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
  ): Promise<string> {
    try {
      switch (type) {
        case "simplify": {
          const result = await this.llmProvider.simplifyExplanation({
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
        `[slidespeech] branching request model path failed for slide ${slide.id}: ${(error as Error).message}`,
      );
      return this.buildInteractionUnavailableResponse(type, slide);
    }
  }

  private buildInteractionUnavailableResponse(
    type: ConversationTurnDecision["responseMode"] | "question",
    slide: Slide,
  ): string {
    const action =
      type === "simplify"
        ? "simplified explanation"
        : type === "example"
          ? "example"
          : type === "deepen"
            ? "deeper explanation"
            : type === "repeat"
              ? "repeat"
              : "answer";

    return `I could not generate a reliable ${action} right now. We are currently on "${slide.title}", so I will stay with the prepared material instead of guessing.`;
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
