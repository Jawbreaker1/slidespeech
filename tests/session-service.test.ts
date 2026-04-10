import test from "node:test";
import assert from "node:assert/strict";

import {
  LLMConversationTurnEngine,
  PresentationSessionService,
} from "@slidespeech/core";
import { MockLLMProvider } from "@slidespeech/providers";
import type {
  ConversationTurnPlan,
  Deck,
  DeckRepository,
  Session,
  SessionRepository,
  TranscriptRepository,
  TranscriptTurn,
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

class ScriptedTurnPlannerLLMProvider extends MockLLMProvider {
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

const createHarness = () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();

  return {
    deckRepository,
    sessionRepository,
    transcriptRepository,
    service: new PresentationSessionService(
      new MockLLMProvider(),
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
    topic: "AI tutors",
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
  assert.match(result.assistantMessage, /Short answer|AI tutors/i);
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
    "I want something more concrete here",
  );

  assert.equal(result.interruption.type, "example");
  assert.equal(result.turnDecision.responseMode, "example");
  assert.deepEqual(result.turnDecision.inferredNeeds, ["example"]);
  assert.equal(result.session.state, "slide_paused");
  assert.match(result.assistantMessage, /colleague|care/i);
});
