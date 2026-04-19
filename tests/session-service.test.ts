import test from "node:test";
import assert from "node:assert/strict";

import {
  LLMConversationTurnEngine,
  PresentationSessionService,
  validateAndRepairDeck,
} from "@slidespeech/core";
import { MockLLMProvider } from "@slidespeech/providers";
import { DeckSchema } from "@slidespeech/types";
import type {
  ConversationTurnPlan,
  Deck,
  DeckRepository,
  GenerateDeckInput,
  GenerateNarrationInput,
  Session,
  SessionRepository,
  TranscriptRepository,
  TranscriptTurn,
  WebFetchResult,
  WebResearchProvider,
} from "@slidespeech/types";

class InMemoryDeckRepository implements DeckRepository {
  private readonly decks = new Map<string, Deck>();

  async save(deck: Deck): Promise<void> {
    this.decks.set(deck.id, deck);
  }

  async getById(id: string): Promise<Deck | null> {
    return this.decks.get(id) ?? null;
  }

  async list(): Promise<Deck[]> {
    return [...this.decks.values()];
  }
}

class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getById(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async list(): Promise<Session[]> {
    return [...this.sessions.values()];
  }
}

class InMemoryTranscriptRepository implements TranscriptRepository {
  readonly turns: TranscriptTurn[] = [];

  async append(turn: TranscriptTurn): Promise<void> {
    this.turns.push(turn);
  }

  async listBySessionId(sessionId: string): Promise<TranscriptTurn[]> {
    return this.turns.filter((turn) => turn.sessionId === sessionId);
  }
}

class AcceptableMockLLMProvider extends MockLLMProvider {
  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    return validateAndRepairDeck(generated).value;
  }
}

class ScriptedTurnPlannerLLMProvider extends AcceptableMockLLMProvider {
  async planConversationTurn(): Promise<ConversationTurnPlan> {
    return {
      interruptionType: "example",
      inferredNeeds: ["example"],
      responseMode: "example",
      runtimeEffects: {},
      confidence: 0.99,
      rationale: "Use the scripted example path for this test.",
    };
  }
}

class TrackingPlanLLMProvider extends AcceptableMockLLMProvider {
  planCalls = 0;

  async planPresentation(input: { topic: string }) {
    this.planCalls += 1;
    return super.planPresentation(input);
  }
}

class EmptyResponseLLMProvider extends AcceptableMockLLMProvider {
  async planPresentation(input: { topic: string }) {
    throw new Error("lmstudio returned an empty response.");
  }

  async generateDeck() {
    throw new Error("lmstudio returned an empty response.");
  }

  async generateNarration() {
    throw new Error("lmstudio returned an empty response.");
  }

  async reviewPresentation() {
    throw new Error("lmstudio returned an empty response.");
  }
}

class RetryingDeckLLMProvider extends AcceptableMockLLMProvider {
  deckCalls = 0;
  revisionGuidances: string[] = [];

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    this.deckCalls += 1;
    this.revisionGuidances.push(input.revisionGuidance ?? "");

    if (this.deckCalls === 1) {
      return DeckSchema.parse({
        id: "deck_retry_1",
        title: "Why This Matters",
        topic: input.topic,
        summary: "Weak meta draft",
        pedagogicalProfile: {
          audienceLevel: "beginner",
          tone: "supportive and concrete",
          pace: "balanced",
          preferredExampleStyle: "real_world",
          wantsFrequentChecks: true,
          detailLevel: "standard",
        },
        source: {
          type: input.groundingSourceType ?? "topic",
          topic: input.topic,
          sourceIds: input.groundingSourceIds ?? [],
        },
        slides: [
          {
            id: "slide_retry_1",
            order: 0,
            title: "Why This Matters",
            learningGoal: "Explain how to structure this onboarding presentation.",
            keyPoints: [
              "Walk through the two main pillars.",
              "Emphasize the core messaging.",
              "Direct new hires to the internal portal.",
            ],
            beginnerExplanation:
              "Use this slide to explain how the presentation should work.",
            advancedExplanation:
              "This slide is about the presentation rather than the company.",
          },
          {
            id: "slide_retry_2",
            order: 1,
            title: "How to continue the deck",
            learningGoal: "Map out what each slide should contain.",
            keyPoints: [
              "Map out the delivery story.",
              "Validate that the audience follows.",
              "Avoid clutter in each slide.",
            ],
            beginnerExplanation:
              "This slide is still presentation advice rather than subject content.",
            advancedExplanation:
              "It should fail the first-pass deck quality gate and trigger a retry.",
          },
        ],
        createdAt: "2026-04-14T10:00:00.000Z",
        updatedAt: "2026-04-14T10:00:00.000Z",
        metadata: {
          estimatedDurationMinutes: 3,
          tags: [],
          language: "en",
        },
      });
    }

    return DeckSchema.parse({
      id: "deck_retry_2",
      title: "Welcome to System Verification",
      topic: input.topic,
      summary: "Improved audience-facing company deck",
      pedagogicalProfile: {
        audienceLevel: "beginner",
        tone: "supportive and concrete",
        pace: "balanced",
        preferredExampleStyle: "real_world",
        wantsFrequentChecks: true,
        detailLevel: "standard",
      },
      source: {
        type: input.groundingSourceType ?? "topic",
        topic: input.topic,
        sourceIds: input.groundingSourceIds ?? [],
      },
      slides: [
        {
          id: "slide_good_1",
          order: 0,
          title: "Welcome to System Verification",
          learningGoal:
            "Understand what System Verification does and why that matters to customers.",
          keyPoints: [
            "System Verification helps customers reduce quality risks before systems reach production.",
            "The company combines verification expertise, QA operations, and delivery support across industries.",
            "This onboarding talk explains the work in terms of customer value and practical delivery.",
          ],
          beginnerExplanation:
            "System Verification exists to help teams ship safer and more reliable systems.",
          advancedExplanation:
            "The company connects verification practice with customer outcomes across complex delivery environments.",
        },
        {
          id: "slide_good_2",
          order: 1,
          title: "How Delivery and QA Operations Work",
          learningGoal:
            "Understand how delivery structure and QA operations support the company mission.",
          keyPoints: [
            "QA operations provide a repeatable way to keep delivery quality consistent.",
            "Delivery models let the company support customers through experts, services, or teams.",
            "The practical result is safer systems and more predictable customer outcomes.",
          ],
          beginnerExplanation:
            "The company uses structured QA and delivery practices so project quality does not depend on luck.",
          advancedExplanation:
            "Delivery structure and QA operations create a scalable operating model for customer-facing verification work.",
        },
      ],
      createdAt: "2026-04-14T10:00:00.000Z",
      updatedAt: "2026-04-14T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 3,
        tags: [],
        language: "en",
      },
    });
  }
}

class BrokenIntroNarrationLLMProvider extends AcceptableMockLLMProvider {
  async generateNarration(input: GenerateNarrationInput) {
    if (input.slide.order === 0) {
      return {
        slideId: input.slide.id,
        narration: "On this slide, the first key point is that testing matters.",
        segments: ["On this slide, the first key point is that testing matters."],
        summaryLine: "Weak intro narration",
        promptsForPauses: [],
        suggestedTransition: "Continue.",
      };
    }

    return super.generateNarration(input);
  }
}

class BrokenQuestionLLMProvider extends AcceptableMockLLMProvider {
  override async answerQuestion() {
    throw new Error("question answering timed out");
  }
}

class OverzealousReviewLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const firstSlide = generated.slides[0];

    assert.ok(firstSlide);

    return DeckSchema.parse({
      ...generated,
      id: "deck_single_slide_review",
      slides: [{ ...firstSlide, order: 0 }],
    });
  }

  override async reviewPresentation() {
    return {
      approved: false,
      overallScore: 0.1,
      summary: "Overly harsh LLM review.",
      issues: [
        {
          code: "review_issue_1",
          severity: "error" as const,
          dimension: "coherence" as const,
          message: "The deck is incoherent.",
        },
        {
          code: "review_issue_2",
          severity: "warning" as const,
          dimension: "deck" as const,
          message: "The title is weak.",
        },
        {
          code: "review_issue_3",
          severity: "warning" as const,
          dimension: "narration" as const,
          message: "The narration is unclear.",
        },
      ],
      repairedNarrations: [],
    };
  }
}

class ThinNarrationRepairReviewLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const firstSlide = generated.slides[0];

    assert.ok(firstSlide);

    return DeckSchema.parse({
      ...generated,
      id: "deck_single_slide_thin_repair",
      slides: [{ ...firstSlide, id: "slide_single_review", order: 0 }],
    });
  }

  override async reviewPresentation() {
    return {
      approved: true,
      overallScore: 0.92,
      summary: "LLM review suggested a narration rewrite.",
      issues: [],
      repairedNarrations: [
        {
          slideId: "slide_single_review",
          narration:
            "State machines describe how a system moves between clear conditions. Transitions determine what happens next.",
          segments: [
            "State machines describe how a system moves between clear conditions.",
            "Transitions determine what happens next.",
          ],
          summaryLine: "Thin repaired narration",
          promptsForPauses: [],
          suggestedTransition: "Continue.",
        },
      ],
    };
  }
}

class TrackingQuestionLLMProvider extends AcceptableMockLLMProvider {
  answerQuestionCalls = 0;
  lastAnswerQuestionInput:
    | Parameters<MockLLMProvider["answerQuestion"]>[0]
    | undefined;

  override async answerQuestion(
    input: Parameters<MockLLMProvider["answerQuestion"]>[0],
  ) {
    this.answerQuestionCalls += 1;
    this.lastAnswerQuestionInput = input;
    return super.answerQuestion(input);
  }
}

class ExampleNeedQuestionLLMProvider extends TrackingQuestionLLMProvider {
  override async planConversationTurn(): Promise<ConversationTurnPlan> {
    return {
      interruptionType: "question",
      inferredNeeds: ["example", "question"],
      responseMode: "question",
      runtimeEffects: {},
      confidence: 0.99,
      rationale: "The user wants a concrete example while staying in question mode.",
    };
  }
}

class SourceAwareQuestionLLMProvider extends TrackingQuestionLLMProvider {
  override async answerQuestion(
    input: Parameters<MockLLMProvider["answerQuestion"]>[0],
  ) {
    this.answerQuestionCalls += 1;
    this.lastAnswerQuestionInput = input;
    return {
      text:
        input.sourceGroundingContext ??
        "No grounded source context was provided for the question.",
    };
  }
}

class StubWebResearchProvider implements WebResearchProvider {
  readonly name = "stub-web-research";

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "stub ready",
      checkedAt: "2026-04-17T00:00:00.000Z",
    };
  }

  async search() {
    return [];
  }

  async fetch(url: string): Promise<WebFetchResult> {
    return {
      url,
      title: "System Verification - Home",
      content:
        "System Verification - Home Solutions Quality Management QA Operations About us Sweden Germany Bosnia and Herzegovina Poland Denmark Contact. We help engineering teams strengthen software quality and delivery outcomes.",
    };
  }

  async summarizeFindings() {
    return "Stub summary";
  }
}

class AlwaysMetaDeckLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    return DeckSchema.parse({
      id: "deck_always_meta",
      title: "Why This Matters",
      topic: input.topic,
      summary: "Weak meta draft",
      pedagogicalProfile: {
        audienceLevel: "beginner",
        tone: "supportive and concrete",
        pace: "balanced",
        preferredExampleStyle: "real_world",
        wantsFrequentChecks: true,
        detailLevel: "standard",
      },
      source: {
        type: input.groundingSourceType ?? "topic",
        topic: input.topic,
        sourceIds: input.groundingSourceIds ?? [],
      },
      slides: [
        {
          id: "slide_meta_1",
          order: 0,
          title: "Why This Matters",
          learningGoal: "Explain how to structure this presentation.",
          keyPoints: [
            "Walk through the main story arc.",
            "Emphasize the most important slide message.",
            "Direct the audience to the next section of the deck.",
          ],
          beginnerExplanation:
            "This slide explains how the presentation should be delivered.",
          advancedExplanation:
            "The content is about presentation technique rather than the subject itself.",
        },
        {
          id: "slide_meta_2",
          order: 1,
          title: "How to continue the deck",
          learningGoal: "Map out what each slide should contain.",
          keyPoints: [
            "Map out the delivery story.",
            "Validate that the audience follows.",
            "Avoid clutter in each slide.",
          ],
          beginnerExplanation:
            "This remains presentation advice rather than subject content.",
          advancedExplanation:
            "A repair-heavy deck like this should be rejected instead of accepted.",
        },
      ],
      createdAt: "2026-04-14T10:00:00.000Z",
      updatedAt: "2026-04-14T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 3,
        tags: [],
        language: "en",
      },
    });
  }
}

const createHarness = () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();

  return {
    deckRepository,
    sessionRepository,
    transcriptRepository,
    service: new PresentationSessionService(
      new AcceptableMockLLMProvider(),
      deckRepository,
      sessionRepository,
      transcriptRepository,
    ),
  };
};

test("question interaction answers in context and pauses the session", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "What problem does this solve?",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.session.state, "slide_paused");
  assert.equal(result.session.transcriptTurnIds.length, 3);
  assert.match(result.assistantMessage, /Short answer|State machines/i);
});

test("continue resumes a paused session back to presenting", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "Vector databases",
  });

  await service.interact(created.session.id, "stop");
  const resumed = await service.interact(created.session.id, "continue");

  assert.equal(resumed.interruption.type, "continue");
  assert.equal(resumed.session.state, "presenting");
  assert.ok(resumed.narration);
});

test("back changes slide and simplify adapts pedagogical profile", async () => {
  const { service, deckRepository } = createHarness();
  const created = await service.createSession({
    topic: "RAG systems",
  });
  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(deck);
  const secondSlide = deck.slides[1];
  assert.ok(secondSlide);

  await service.selectSlide(created.session.id, secondSlide.id);

  const backResult = await service.interact(created.session.id, "back");
  assert.equal(backResult.session.currentSlideIndex, 0);
  assert.ok(backResult.narration);

  const simplifyResult = await service.interact(
    created.session.id,
    "explain simpler",
  );

  assert.equal(simplifyResult.interruption.type, "simplify");
  assert.equal(simplifyResult.session.pedagogicalProfile.detailLevel, "light");
  assert.equal(simplifyResult.session.pedagogicalProfile.pace, "slow");
  assert.equal(simplifyResult.session.state, "slide_paused");
});

test("freeform confusion stays conversational while adapting pedagogy", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "I do not get why the processing step matters here",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.session.state, "slide_paused");
  assert.equal(result.session.pedagogicalProfile.detailLevel, "light");
  assert.equal(result.session.pedagogicalProfile.pace, "slow");
  assert.equal(result.resumePlan.action, "restart_slide");
  assert.equal(result.resumePlan.adaptPedagogy, true);
  assert.match(result.assistantMessage, /Short answer|State machines/i);
});

test("question fallback stays usable when llm answering fails", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new BrokenQuestionLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "Why does this matter?",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.session.state, "slide_paused");
  assert.match(result.assistantMessage, /The main reason is|State machines|important points/i);
});

test("single-slide session creation prefers deterministic review over an overzealous llm review", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new OverzealousReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "State machines",
    targetSlideCount: 1,
  });

  const savedDeck = await deckRepository.getById(created.session.deckId);
  assert.ok(savedDeck);
  assert.ok(savedDeck.metadata.validation);
  assert.equal(savedDeck.metadata.validation.passed, true);
  assert.ok(
    (savedDeck.metadata.validation.overallScore ?? 0) >= 0.8,
    "deterministic review score should survive an overzealous llm review",
  );
  assert.match(
    savedDeck.metadata.validation.summary ?? "",
    /Deterministic review used while completing the initial single-slide presentation/i,
  );
  assert.equal(
    savedDeck.metadata.validation.issues.some((issue) => issue.code === "review_issue_1"),
    false,
  );
});

test("review-repaired narration is revalidated before it is persisted", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new ThinNarrationRepairReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "State machines",
    targetSlideCount: 1,
  });

  const savedSession = await sessionRepository.getById(created.session.id);
  assert.ok(savedSession);

  const repairedNarration = savedSession.narrationBySlideId["slide_single_review"];
  assert.ok(repairedNarration);
  assert.equal((repairedNarration?.segments.length ?? 0) >= 4, true);
  assert.doesNotMatch(
    repairedNarration?.narration ?? "",
    /today i want to orient you|a practical point here is that|another thing to notice is that|this also means that/i,
  );
});

test("general question fallback stays anchored to the active slide instead of drifting to intro context", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new BrokenQuestionLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "State machines",
  });
  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(deck);
  const laterSlide = deck.slides[2];
  assert.ok(laterSlide);

  await service.selectSlide(created.session.id, laterSlide.id);

  const result = await service.interact(
    created.session.id,
    "What is the main point of this slide?",
  );

  assert.equal(result.interruption.type, "question");
  assert.match(
    result.assistantMessage,
    new RegExp(laterSlide.beginnerExplanation.split(" ").slice(0, 5).join(" "), "i"),
  );
  assert.doesNotMatch(
    result.assistantMessage,
    /understand what .* why it matters|one concrete way/i,
  );
});

test("example-leaning questions route into example mode instead of generic question answering", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new TrackingQuestionLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
  );

  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "Can you give me a concrete example?",
  );

  assert.equal(result.interruption.type, "example");
  assert.equal(result.session.state, "slide_paused");
  assert.equal(llmProvider.answerQuestionCalls, 0);
  assert.equal(result.turnDecision.responseMode, "example");
  assert.ok(result.assistantMessage.trim().length > 0);
});

test("example-leaning questions can use inferred needs even when planner keeps question mode", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new ExampleNeedQuestionLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
  );

  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "Can you give me a concrete example?",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.turnDecision.responseMode, "question");
  assert.deepEqual(result.turnDecision.inferredNeeds, ["example", "question"]);
  assert.equal(llmProvider.answerQuestionCalls, 0);
  assert.match(result.assistantMessage, /One concrete example is/i);
});

test("main-point questions can be answered locally without calling the llm", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new TrackingQuestionLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
  );

  const created = await service.createSession({
    topic: "State machines",
  });

  const result = await service.interact(
    created.session.id,
    "What is the main point of this slide?",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.session.state, "slide_paused");
  assert.equal(llmProvider.answerQuestionCalls, 0);
  assert.equal(result.turnDecision.responseMode, "summarize_current_slide");
  assert.equal(
    result.assistantMessage,
    result.deck.slides[result.session.currentSlideIndex]?.beginnerExplanation,
  );
});

test("llm-backed turn planning can drive branching behavior", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new ScriptedTurnPlannerLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
  );

  const created = await service.createSession({
    topic: "Presentation runtimes",
  });

  const result = await service.interact(
    created.session.id,
    "Need a concrete scenario from this one ✦",
  );

  assert.equal(result.interruption.type, "example");
  assert.equal(result.turnDecision.responseMode, "example");
  assert.deepEqual(result.turnDecision.inferredNeeds, ["example"]);
  assert.equal(result.session.state, "slide_paused");
  assert.match(result.assistantMessage, /colleague|care/i);
});

test("resume plan preserves narration point after a pause", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "Voice-first teaching runtimes",
  });

  const progressed = await service.updateNarrationProgress(
    created.session.id,
    created.session.currentSlideId,
    2,
  );
  const paused = await service.interact(created.session.id, "stop");
  const resumed = await service.interact(created.session.id, "continue");

  assert.equal(progressed.session.currentNarrationIndex, 2);
  assert.equal(paused.resumePlan.action, "resume_same_point");
  assert.equal(paused.resumePlan.targetNarrationIndex, 2);
  assert.equal(paused.session.currentNarrationIndex, 2);
  assert.equal(resumed.session.currentNarrationIndex, 2);
  assert.match(resumed.assistantMessage, /point 3|current slide/i);
});

test("question resume advances to the next narration point after answering", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "Voice-first teaching runtimes",
  });

  await service.updateNarrationProgress(
    created.session.id,
    created.session.currentSlideId,
    1,
  );
  const answered = await service.interact(
    created.session.id,
    "What does this solve?",
  );

  assert.equal(answered.interruption.type, "question");
  assert.equal(answered.resumePlan.action, "resume_same_point");
  assert.equal(answered.resumePlan.targetNarrationIndex, 2);
  assert.equal(answered.session.currentNarrationIndex, 2);
});

test("question on the last narration point resumes on the next slide", async () => {
  const { service, deckRepository } = createHarness();
  const created = await service.createSession({
    topic: "Voice-first teaching runtimes",
  });
  await service.waitForBackgroundEnrichment(created.session.id);
  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(deck);
  const currentSlideIndex = deck.slides.findIndex(
    (slide) => slide.id === created.session.currentSlideId,
  );
  const nextSlide = deck.slides[currentSlideIndex + 1];
  assert.ok(nextSlide);

  const narration = (
    await service.getSessionSnapshot(created.session.id)
  ).narration;
  assert.ok(narration);

  await service.updateNarrationProgress(
    created.session.id,
    created.session.currentSlideId,
    Math.max((narration?.segments.length ?? 1) - 1, 0),
  );
  const answered = await service.interact(
    created.session.id,
    "What does this solve?",
  );

  assert.equal(answered.resumePlan.targetSlideId, nextSlide.id);
  assert.equal(answered.resumePlan.targetNarrationIndex, 0);
  assert.equal(answered.session.currentSlideId, nextSlide.id);
  assert.equal(answered.session.currentNarrationIndex, 0);
});

test("grounded questions can include source context beyond the current slide", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new SourceAwareQuestionLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
    undefined,
    new StubWebResearchProvider(),
  );

  const created = await service.createSession({
    topic: "System Verification",
    groundingSourceIds: ["https://www.systemverification.com/"],
    groundingSourceType: "mixed",
  });

  const result = await service.interact(
    created.session.id,
    "What countries are System Verification in?",
  );

  assert.equal(result.interruption.type, "question");
  assert.equal(result.turnDecision.responseMode, "grounded_factual");
  assert.match(result.assistantMessage, /Sweden|Germany|Bosnia|Poland|Denmark/i);
  assert.match(
    llmProvider.lastAnswerQuestionInput?.sourceGroundingContext ?? "",
    /Sweden|Germany|Bosnia and Herzegovina|Poland|Denmark/i,
  );
});

test("grounded question fallback can use a clear source excerpt when llm answering times out", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new BrokenQuestionLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    new LLMConversationTurnEngine(llmProvider),
    undefined,
    new StubWebResearchProvider(),
  );

  const created = await service.createSession({
    topic: "System Verification",
    groundingSourceIds: ["https://www.systemverification.com/"],
    groundingSourceType: "mixed",
  });

  const result = await service.interact(
    created.session.id,
    "What countries are System Verification in?",
  );

  assert.match(
    result.assistantMessage,
    /Sweden|Germany|Bosnia and Herzegovina|Poland|Denmark/i,
  );
});

test("restart-style explanations reset narration progress to the start", async () => {
  const { service } = createHarness();
  const created = await service.createSession({
    topic: "Adaptive tutoring",
  });

  await service.updateNarrationProgress(
    created.session.id,
    created.session.currentSlideId,
    2,
  );
  const repeated = await service.interact(created.session.id, "repeat");

  assert.equal(repeated.resumePlan.action, "restart_slide");
  assert.equal(repeated.resumePlan.targetNarrationIndex, 0);
  assert.equal(repeated.session.currentNarrationIndex, 0);
});

test("grounded session creation persists mixed source metadata", async () => {
  const { service, deckRepository } = createHarness();
  const created = await service.createSession({
    topic: "Latest AI chip export restrictions",
    groundingSummary: "External research summary for current developments.",
    groundingSourceIds: ["https://example.com/source-1", "https://example.com/source-2"],
    groundingSourceType: "mixed",
  });

  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(deck);
  assert.equal(deck.source.type, "mixed");
  assert.deepEqual(deck.source.sourceIds, [
    "https://example.com/source-1",
    "https://example.com/source-2",
  ]);
});

test("session creation plans first and gives the intro narration multiple beats", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new TrackingPlanLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "Interactive AI teachers",
  });
  const deck = await deckRepository.getById(created.session.deckId);

  assert.equal(llmProvider.planCalls, 1);
  assert.ok(deck);
  assert.equal(created.narrations.length, 1);
  assert.ok(created.narrations[0]);
  assert.ok((created.narrations[0]?.segments.length ?? 0) >= 4);
  assert.ok(deck.metadata.generation);
  assert.equal(deck.metadata.generation?.narrationReadySlides, 1);
  assert.equal(deck.metadata.generation?.backgroundEnrichmentPending, true);
  assert.ok(deck.metadata.validation);

  await service.waitForBackgroundEnrichment(created.session.id);

  const finalizedDeck = await deckRepository.getById(created.session.deckId);
  const finalizedSession = await sessionRepository.getById(created.session.id);

  assert.ok(finalizedDeck);
  assert.equal(finalizedDeck.metadata.generation?.backgroundEnrichmentPending, false);
  assert.equal(finalizedDeck.metadata.generation?.narrationReadySlides, finalizedDeck.slides.length);
  assert.ok(finalizedDeck.metadata.evaluation);
  assert.ok(finalizedSession);
  assert.equal(
    Object.keys(finalizedSession.narrationBySlideId).length,
    finalizedDeck.slides.length,
  );
});

test("intro narration repair keeps the next-slide transition when the deck has more slides", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new BrokenIntroNarrationLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "System Verification",
  });
  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(deck);
  const secondSlide = deck?.slides[1];
  assert.ok(secondSlide);
  assert.ok(created.narrations[0]);
  assert.doesNotMatch(
    created.narrations[0]?.narration ?? "",
    /clear close/i,
  );
  assert.equal((created.narrations[0]?.segments.length ?? 0) >= 4, true);
  assert.match(
    created.narrations[0]?.suggestedTransition ?? "",
    new RegExp(secondSlide?.title ?? "", "i"),
  );
});

test("session creation fails when llm generation produces no usable deck", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new EmptyResponseLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    service.createSession({
      topic: "Jivr onboarding",
      groundingSummary:
        "Jivr is a tool created by Per Hjalhdal. It is used to support onboarding and structured team knowledge sharing.",
      groundingSourceIds: ["https://jivr.com"],
      groundingSourceType: "mixed",
      targetSlideCount: 4,
    }),
    /No usable LLM-generated deck was produced|lmstudio returned an empty response/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
});

test("session creation retries weak deck drafts before relying on repair", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new RetryingDeckLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "System Verification",
    presentationBrief: "Create an onboarding presentation about our company.",
    groundingSummary:
      "System Verification provides quality management, QA operations, and delivery support for complex engineering teams.",
    groundingSourceIds: ["https://www.systemverification.com/"],
    groundingSourceType: "mixed",
    targetSlideCount: 2,
  });

  const deck = await deckRepository.getById(created.session.deckId);

  assert.ok(llmProvider.deckCalls >= 2);
  assert.match(
    llmProvider.revisionGuidances[1] ?? "",
    /audience-facing|opening slide|instructional bullet points/i,
  );
  assert.ok(deck);
  assert.equal(deck?.title, "Welcome to System Verification");
  assert.doesNotMatch(
    deck?.slides.map((slide) => slide.keyPoints.join(" ")).join(" ") ?? "",
    /walk through|direct new hires|avoid clutter|internal portal/i,
  );
  assert.ok(
    !(deck?.metadata.validation?.issues ?? []).some(
      (issue) => issue.code === "deck_wide_meta_presentation_repaired",
    ),
  );
});

test("session creation rejects repair-heavy meta decks even when the LLM returns structured JSON", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new AlwaysMetaDeckLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    service.createSession({
      topic: "System Verification",
      presentationBrief: "Create an onboarding presentation about our company.",
      groundingSummary:
        "System Verification provides quality management, QA operations, and delivery support for complex engineering teams.",
      groundingSourceIds: ["https://www.systemverification.com/"],
      groundingSourceType: "mixed",
      targetSlideCount: 2,
    }),
    /No acceptable LLM-generated deck was produced/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
});
