import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  DeckRepository,
  Deck,
  LLMProvider,
  PedagogicalProfile,
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
import { RuleBasedConversationTurnEngine } from "./conversation-turn-engine";
import { NarrationEngine, PresentationPlanner } from "./planners";
import { SimpleResumePlanner } from "./resume-planner";
import { transitionSessionState } from "./state-machine";
import { createId, nowIso } from "./utils";

export interface CreatePresentationSessionInput {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
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
  }

  async createSession(
    input: CreatePresentationSessionInput,
  ): Promise<CreatePresentationSessionResult> {
    const pedagogicalProfile: PedagogicalProfile = {
      ...DEFAULT_PEDAGOGICAL_PROFILE,
      ...input.pedagogicalProfile,
    };

    const deck = await this.planner.generateDeck({
      topic: input.topic,
      pedagogicalProfile,
    });
    const firstSlide = deck.slides[0];

    const narrations = firstSlide
      ? [
          await this.narrationEngine.generateNarration({
            deck,
            slide: firstSlide,
            pedagogicalProfile,
          }),
        ]
      : [];

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
      narrationBySlideId,
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
      return existingNarration;
    }

    const deck = await this.deckRepository.getById(session.deckId);
    if (!deck) {
      throw new Error(`Deck ${session.deckId} was not found.`);
    }

    const slide = deck.slides.find((candidate) => candidate.id === slideId);
    if (!slide) {
      throw new Error(`Slide ${slideId} was not found in deck ${deck.id}.`);
    }

    const narration = await this.narrationEngine.generateNarration({
      deck,
      slide,
      pedagogicalProfile: session.pedagogicalProfile,
    });

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

  async selectSlide(
    sessionId: string,
    slideId: string,
  ): Promise<SelectSlideResult> {
    const { session, deck } = await this.loadSessionContext(sessionId);
    const targetSlide = this.requireSlide(deck, slideId);

    const updatedSession: Session = {
      ...session,
      currentSlideId: targetSlide.id,
      currentSlideIndex: targetSlide.order,
      updatedAt: nowIso(),
    };

    await this.sessionRepository.save(updatedSession);

    return {
      deck,
      session: updatedSession,
      narration: updatedSession.narrationBySlideId[targetSlide.id],
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
        assistantMessage = "Resuming from the current slide.";
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
          currentSlideIndex: previousSlide.order,
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

        const answer = await this.llmProvider.answerQuestion({
          deck,
          slide: activeSlide,
          session,
          pedagogicalProfile: session.pedagogicalProfile,
          question: text,
        });
        assistantMessage = answer.text;

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

  private async handleBranchingRequest(
    type: ConversationTurnDecision["responseMode"],
    deck: Deck,
    slide: Slide,
    session: Session,
    rawText: string,
  ): Promise<string> {
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
}
