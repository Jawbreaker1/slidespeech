import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  DeckRepository,
  Deck,
  LLMProvider,
  PedagogicalProfile,
  PresentationPlan,
  ResumePlan,
  ResumePlanner,
  Session,
  SessionRepository,
  SlideNarration,
  Slide,
  TranscriptRepository,
  TranscriptTurn,
  UserInterruption,
} from "@slidespeech/types";

import { DEFAULT_PEDAGOGICAL_PROFILE } from "./defaults";
import {
  buildDeterministicDeck,
  buildDeterministicNarration,
  buildDeterministicPresentationPlan,
  buildDeterministicReview,
} from "./deterministic-generation";
import { RuleBasedConversationTurnEngine } from "./conversation-turn-engine";
import {
  NarrationEngine,
  PresentationPlanner,
  PresentationQualityReviewer,
} from "./planners";
import { SimpleResumePlanner } from "./resume-planner";
import { transitionSessionState } from "./state-machine";
import { createId, nowIso } from "./utils";
import { validateAndRepairDeck, validateAndRepairNarrations } from "./validation";

export interface CreatePresentationSessionInput {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
  groundingSummary?: string | undefined;
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

const splitNarrationIntoSegments = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceLikeSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (sentenceLikeSegments.length > 1) {
    return sentenceLikeSegments;
  }

  const clauseSegments = normalized
    .split(/,\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return clauseSegments.length > 1 ? clauseSegments : [normalized];
};

const ensureNarrationSegments = (narration: SlideNarration): SlideNarration => ({
  ...narration,
  segments:
    narration.segments.length > 0
      ? narration.segments
      : splitNarrationIntoSegments(narration.narration),
});

export class PresentationSessionService {
  private readonly planner: PresentationPlanner;
  private readonly narrationEngine: NarrationEngine;
  private readonly qualityReviewer: PresentationQualityReviewer;

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly deckRepository: DeckRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly transcriptRepository: TranscriptRepository,
    private readonly conversationTurnEngine: ConversationTurnEngine = new RuleBasedConversationTurnEngine(),
    private readonly resumePlanner: ResumePlanner = new SimpleResumePlanner(),
  ) {
    this.planner = new PresentationPlanner(llmProvider);
    this.narrationEngine = new NarrationEngine(llmProvider);
    this.qualityReviewer = new PresentationQualityReviewer(llmProvider);
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
        pedagogicalProfile,
        input.groundingSummary,
        input.targetDurationMinutes,
        input.targetSlideCount,
      );
    } catch (error) {
      console.warn(
        `[slidespeech] presentation plan fallback for topic "${input.topic}": ${(error as Error).message}`,
      );
      plan = buildDeterministicPresentationPlan({
        topic: input.topic,
        audienceLevel: pedagogicalProfile.audienceLevel,
        ...(input.targetSlideCount ? { targetSlideCount: input.targetSlideCount } : {}),
      });
    }

    const generationInput = {
      topic: input.topic,
      plan,
      pedagogicalProfile,
      ...(input.groundingSummary
        ? { groundingSummary: input.groundingSummary }
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

    let generatedDeck: Deck;
    let usedDeterministicDeckFallback = false;

    try {
      generatedDeck = await this.planner.generateDeck(generationInput);
    } catch (error) {
      console.warn(
        `[slidespeech] deck generation fallback for topic "${input.topic}": ${(error as Error).message}`,
      );
      generatedDeck = buildDeterministicDeck(generationInput);
      usedDeterministicDeckFallback = true;
    }

    const deckValidation = validateAndRepairDeck(generatedDeck);
    let deck = deckValidation.value;
    const generatedNarrations: SlideNarration[] = [];
    let usedDeterministicNarrationFallback = false;

    for (const slide of deck.slides) {
      try {
        generatedNarrations.push(
          await this.narrationEngine.generateNarration({
            deck,
            slide,
            pedagogicalProfile,
          }),
        );
      } catch (error) {
        console.warn(
          `[slidespeech] narration fallback for slide "${slide.title}": ${(error as Error).message}`,
        );
        generatedNarrations.push(
          buildDeterministicNarration({
            deck,
            slide,
            pedagogicalProfile,
          }),
        );
        usedDeterministicNarrationFallback = true;
      }
    }

    const narrationValidation = validateAndRepairNarrations(
      deck,
      generatedNarrations,
    );
    let narrations = narrationValidation.value;
    const shouldUseDeterministicReview =
      usedDeterministicDeckFallback || usedDeterministicNarrationFallback;
    const combinedValidationIssues = [
      ...deckValidation.issues,
      ...narrationValidation.issues,
    ];
    const llmReview = shouldUseDeterministicReview
      ? buildDeterministicReview({
          deck,
          validationIssues: combinedValidationIssues,
          note:
            "Deterministic review used because one or more generation stages fell back from the LLM path.",
        })
      : await this.qualityReviewer
          .review({
            deck,
            narrations,
            pedagogicalProfile,
          })
          .catch((error) => {
            console.warn(
              `[slidespeech] presentation review fallback for topic "${input.topic}": ${(error as Error).message}`,
            );
            return buildDeterministicReview({
              deck,
              validationIssues: combinedValidationIssues,
              note:
                "Deterministic review used because the LLM review step was unavailable.",
            });
          });
    if (llmReview.repairedNarrations.length > 0) {
      const repairedBySlideId = new Map(
        llmReview.repairedNarrations.map((narration) => [narration.slideId, narration]),
      );
      narrations = deck.slides.map((slide) => {
        const repaired = repairedBySlideId.get(slide.id);
        if (repaired) {
          return repaired;
        }

        return (
          narrations.find((narration) => narration.slideId === slide.id) ??
          ensureNarrationSegments(
            narrationValidation.value.find((narration) => narration.slideId === slide.id)!,
          )
        );
      });
    }
    const postReviewNarrationValidation = validateAndRepairNarrations(deck, narrations);
    narrations = postReviewNarrationValidation.value;
    deck = {
      ...deck,
      metadata: {
        ...deck.metadata,
        ...(deck.metadata.validation
          ? {
              validation: {
                ...deck.metadata.validation,
                repaired:
                  deck.metadata.validation.repaired ||
                  narrationValidation.repaired ||
                  llmReview.repairedNarrations.length > 0 ||
                  postReviewNarrationValidation.repaired,
                summary: llmReview.summary,
                overallScore: llmReview.overallScore,
                issues: [
                  ...deck.metadata.validation.issues,
                  ...narrationValidation.issues,
                  ...llmReview.issues.map((issue) => ({
                    code: issue.code,
                    message: issue.message,
                    severity: issue.severity,
                    ...(issue.slideId ? { slideId: issue.slideId } : {}),
                  })),
                  ...postReviewNarrationValidation.issues,
                ],
                passed:
                  deck.metadata.validation.passed &&
                  llmReview.approved &&
                  !narrationValidation.issues.some(
                    (issue) => issue.severity === "error",
                  ) &&
                  !postReviewNarrationValidation.issues.some(
                    (issue) => issue.severity === "error",
                  ),
              },
            }
          : {}),
      },
    };

    await this.deckRepository.save(deck);

    const narrationBySlideId = Object.fromEntries(
      narrations.map((narration) => [narration.slideId, narration]),
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

    return {
      session: persistedSession,
      narrations,
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

        try {
          const answer = await this.llmProvider.answerQuestion({
            deck,
            slide: activeSlide,
            session,
            pedagogicalProfile: session.pedagogicalProfile,
            question: text,
          });
          assistantMessage = answer.text;
        } catch (error) {
          console.warn(
            `[slidespeech] question answering fallback for slide ${activeSlide.id}: ${(error as Error).message}`,
          );
          assistantMessage = this.buildInteractionFallback("question", activeSlide);
        }

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

    session = this.applyResumePlan(session, resumePlan, narration);
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
      currentNarrationIndex: targetNarrationIndex,
      narrationProgressBySlideId: {
        ...session.narrationProgressBySlideId,
        [currentSlideId]: targetNarrationIndex,
      },
      updatedAt: nowIso(),
    };
  }
}
