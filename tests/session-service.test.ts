import test from "node:test";
import assert from "node:assert/strict";

import {
  PresentationSessionService,
  validateDeck,
} from "@slidespeech/core";
import { MockLLMProvider } from "@slidespeech/providers";
import { DeckSchema } from "@slidespeech/types";
import type {
  DeckSemanticReviewResult,
  Deck,
  DeckRepository,
  GenerateDeckInput,
  GenerateNarrationInput,
  PresentationReview,
  ReviewDeckSemanticsInput,
  ReviewPresentationInput,
  Session,
  SessionRepository,
  SlideNarration,
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

class AcceptableMockLLMProvider extends MockLLMProvider {
  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const validated = validateDeck(generated).value;
    return {
      ...validated,
      metadata: {
        ...validated.metadata,
        validation: {
          passed: true,
          repaired: false,
          validatedAt: new Date().toISOString(),
          issues: [],
        },
      },
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

class TrackingSemanticReviewLLMProvider extends AcceptableMockLLMProvider {
  lastReviewDeckSemanticsInput: ReviewDeckSemanticsInput | undefined;

  override async reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
    this.lastReviewDeckSemanticsInput = input;
    return {
      approved: true,
      score: 0.96,
      summary: "Accepted with scoped review context.",
      issues: [],
    };
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

class WeakDeckLLMProvider extends AcceptableMockLLMProvider {
  deckCalls = 0;

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    this.deckCalls += 1;

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

  override async reviewDeckSemantics(input: {
    deck: Deck;
  }): Promise<DeckSemanticReviewResult> {
    if (input.deck.id === "deck_retry_1") {
      return {
        approved: false,
        score: 0.42,
        summary:
          "The first generated draft describes presentation mechanics instead of the requested subject.",
        issues: [
          {
            code: "prompt_leakage",
            severity: "error",
            message:
              "The deck contains presentation-mechanics copy instead of subject content.",
            revisionInstruction:
              "Regenerate the deck around the requested subject rather than presentation instructions.",
          },
        ],
      };
    }

    return {
      approved: true,
      score: 0.96,
      summary: "The generated deck is acceptable.",
      issues: [],
    };
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

class WarningOnlyRejectedReviewLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const firstSlide = generated.slides[0];

    assert.ok(firstSlide);

    return DeckSchema.parse({
      ...generated,
      id: "deck_single_slide_warning_rejected",
      slides: [{ ...firstSlide, order: 0 }],
    });
  }

  override async reviewPresentation() {
    return {
      approved: false,
      overallScore: 0.74,
      summary: "Review rejected the deck without a hard error issue.",
      issues: [
        {
          code: "review_warning_1",
          severity: "warning" as const,
          dimension: "deck" as const,
          message: "The deck needs another pass before publication.",
        },
      ],
      repairedNarrations: [],
    };
  }
}

class VisualPromptOnlyReviewLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const firstSlide = generated.slides[0];

    assert.ok(firstSlide);

    return DeckSchema.parse({
      ...generated,
      id: "deck_single_slide_visual_prompt_review",
      slides: [{ ...firstSlide, order: 0 }],
    });
  }

  override async reviewPresentation() {
    return {
      approved: true,
      overallScore: 0.74,
      summary: "Visual prompts need another pass, but the deck is publishable.",
      issues: [
        {
          code: "visual_prompt_quality",
          severity: "error" as const,
          dimension: "visual" as const,
          message: "The generated visual prompt is too descriptive and should be rewritten later.",
        },
      ],
      repairedNarrations: [],
    };
  }
}

class UnavailableSingleSlideReviewLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);
    const firstSlide = generated.slides[0];

    assert.ok(firstSlide);

    return DeckSchema.parse({
      ...generated,
      id: "deck_single_slide_unavailable_review",
      slides: [{ ...firstSlide, order: 0 }],
    });
  }

  override async reviewPresentation() {
    throw new Error("final review timed out");
  }
}

class UnavailableBackgroundReviewLLMProvider extends TrackingPlanLLMProvider {
  override async reviewPresentation() {
    throw new Error("background final review timed out");
  }
}

class FailingBackgroundNarrationLLMProvider extends TrackingPlanLLMProvider {
  private narrationCalls = 0;

  override async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    this.narrationCalls += 1;

    if (this.narrationCalls > 1) {
      throw new Error("background narration generation failed");
    }

    return super.generateNarration(input);
  }
}

class ReviewWithIgnoredNarrationRewriteLLMProvider extends AcceptableMockLLMProvider {
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
      summary: "LLM review suggested a narration rewrite that must be ignored.",
      issues: [],
      repairedNarrations: [
        {
          slideId: "slide_single_review",
          narration:
            "Welcome everyone. We will start by grounding state machines in clear system conditions. State machines describe how a system moves between clear conditions. From there, transitions determine what happens next when an event arrives. In practice, this keeps the valid path visible instead of hidden in scattered branches. I will pause here because questions are welcome about states, transitions, and when the system is allowed to move.",
          segments: [
            "Welcome everyone. We will start by grounding state machines in clear system conditions.",
            "State machines describe how a system moves between clear conditions.",
            "From there, transitions determine what happens next when an event arrives.",
            "In practice, this keeps the valid path visible instead of hidden in scattered branches.",
            "I will pause here because questions are welcome about states, transitions, and when the system is allowed to move.",
          ],
          summaryLine: "Model repaired narration",
          promptsForPauses: [],
          suggestedTransition: "Continue.",
        },
      ],
    };
  }
}

class BackgroundIntroRewriteReviewLLMProvider extends TrackingPlanLLMProvider {
  override async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    const firstSlide = input.deck.slides[0];
    if (!firstSlide) {
      return {
        approved: true,
        overallScore: 0.99,
        summary: "No slides to review.",
        issues: [],
        repairedNarrations: [],
      };
    }

    const rewrittenIntro: SlideNarration = {
      slideId: firstSlide.id,
      narration:
        "Background review tried to replace the already published intro narration. This text should never replace the session copy.",
      segments: [
        "Background review tried to replace the already published intro narration.",
        "This text should never replace the session copy.",
        "The presenter should keep the narration that was already available.",
        "Only missing slide narrations should be added in the background.",
      ],
      summaryLine: "Background rewrite",
      promptsForPauses: [],
      suggestedTransition: "Continue.",
    };

    return {
      approved: true,
      overallScore: 0.99,
      summary: "Review suggests a rewrite that must not replace published narration.",
      issues: [],
      repairedNarrations: [rewrittenIntro],
    };
  }
}

class TopicOnlyPremiereDeckLLMProvider extends AcceptableMockLLMProvider {
  override async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const generated = await super.generateDeck(input);

    return DeckSchema.parse({
      ...generated,
      id: "deck_topic_only_premiere",
      title: "SpongeBob SquarePants: The 1999 Premiere",
      topic: input.topic,
      summary:
        "This deck explains when SpongeBob SquarePants first aired in 1999, what happened in the debut episode, and why that premiere mattered to the series.",
      source: {
        type: "topic",
        topic: input.topic,
        sourceIds: [],
      },
      slides: generated.slides.map((slide, index) => {
        switch (index) {
          case 0:
            return {
              ...slide,
              title: "When SpongeBob First Aired",
              learningGoal:
                "Understand when SpongeBob SquarePants first premiered and why that date matters.",
              keyPoints: [
                "Nickelodeon aired 'Help Wanted' on May 1, 1999.",
                "That broadcast introduced SpongeBob SquarePants as a television series to a wide audience.",
                "The debut set the tone for the humor, setting, and energy that defined the franchise.",
              ],
              beginnerExplanation:
                "SpongeBob first reached television audiences when 'Help Wanted' aired on May 1, 1999.",
              advancedExplanation:
                "The May 1, 1999 premiere turned the character from a pilot concept into a broadcast series with a recognizable comic identity.",
              examples: [
                "A viewer in 1999 would have met SpongeBob for the first time through 'Help Wanted' on Nickelodeon.",
              ],
            };
          case 1:
            return {
              ...slide,
              title: "How the Premiere Introduced Bikini Bottom",
              learningGoal:
                "See how the first episode introduced SpongeBob, the Krusty Krab, and the tone of Bikini Bottom.",
              keyPoints: [
                "The episode quickly showed SpongeBob's optimism and eagerness to work at the Krusty Krab.",
                "Squidward's irritation and Mr. Krabs's skepticism gave the comedy immediate contrast.",
                "The undersea setting made the world feel playful, strange, and easy to recognize.",
              ],
              beginnerExplanation:
                "The premiere showed who SpongeBob is and what kind of world he lives in.",
              advancedExplanation:
                "The debut episode established character contrast, comic rhythm, and a memorable sense of place in only a few scenes.",
              examples: [
                "SpongeBob's excitement about getting a job contrasts sharply with Squidward's visible dread.",
              ],
            };
          case 2:
            return {
              ...slide,
              title: "Why the First Episode Mattered",
              learningGoal:
                "Explain why the 1999 premiere became an important starting point for the series.",
              keyPoints: [
                "The debut episode proved that SpongeBob's fast, absurd humor worked in a full television story.",
                "It gave the show a repeatable formula: optimism, chaos, and a strange but relatable workplace.",
                "Later episodes could build on characters and settings that audiences already understood from the premiere.",
              ],
              beginnerExplanation:
                "The first episode mattered because it showed that SpongeBob's style and characters could carry a whole series.",
              advancedExplanation:
                "The premiere functioned as a template for the show's pacing, workplace comedy, and emotional contrast.",
              examples: [
                "Once the premiere made the Krusty Krab and its characters familiar, later episodes could move faster and go bigger.",
              ],
            };
          default:
            return {
              ...slide,
              title: "What Viewers Remember from the Debut",
              learningGoal:
                "Summarize the most memorable parts of SpongeBob's first television appearance.",
              keyPoints: [
                "SpongeBob's determination made him instantly distinct from typical cartoon leads.",
                "The burger-flipping chaos at the Krusty Krab made the episode easy to remember.",
                "The combination of bright visuals and earnest comedy helped the premiere stand out in 1999.",
              ],
              beginnerExplanation:
                "People remember the debut because it was energetic, funny, and clear about who SpongeBob was.",
              advancedExplanation:
                "The premiere left a durable impression by combining a strong lead performance, clear comic stakes, and a distinctive visual world.",
              examples: [
                "Many viewers remember SpongeBob proving himself through sheer enthusiasm during the Krusty Krab rush.",
              ],
            };
        }
      }),
    });
  }
}

class FatalSemanticPremiereReviewLLMProvider extends TopicOnlyPremiereDeckLLMProvider {
  override async reviewDeckSemantics(): Promise<DeckSemanticReviewResult> {
    return {
      approved: false,
      score: 0.4,
      summary:
        "The semantic reviewer considers this premiere deck fatal even though the generated deck is still more specific than fallback.",
      issues: [
        {
          code: "prompt_leakage",
          severity: "error",
          message: "The reviewer found a fatal issue in the generated deck.",
          revisionInstruction: "Repair the affected slide instead of replacing the full deck.",
        },
      ],
    };
  }
}

class PrePublishFatalSemanticReviewLLMProvider extends AcceptableMockLLMProvider {
  reviewCalls = 0;

  override async reviewDeckSemantics(): Promise<DeckSemanticReviewResult> {
    this.reviewCalls += 1;

    if (this.reviewCalls === 1) {
      return {
        approved: true,
        score: 0.96,
        summary: "The generated candidate is acceptable during orchestration.",
        issues: [],
      };
    }

    return {
      approved: false,
      score: 0.5,
      summary: "The final deck regressed before publish.",
      issues: [
        {
          code: "repetitive_copy",
          severity: "error",
          message: "The deck repeats the same visible claim across slides.",
          revisionInstruction: "Regenerate the deck instead of publishing it.",
        },
      ],
    };
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

  override async reviewDeckSemantics(): Promise<DeckSemanticReviewResult> {
    return {
      approved: false,
      score: 0.42,
      summary:
        "The semantic reviewer rejected this deck because it describes presentation mechanics instead of the requested subject.",
      issues: [
        {
          code: "prompt_leakage",
          severity: "error",
          message:
            "The deck contains presentation-mechanics copy instead of subject content.",
          revisionInstruction:
            "Regenerate the deck around the requested subject rather than presentation instructions.",
        },
      ],
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
      new AcceptableMockLLMProvider(),
      deckRepository,
      sessionRepository,
      transcriptRepository,
    ),
  };
};


test("createSession stores the requested presentation theme on the deck", async () => {
  const { deckRepository, service } = createHarness();
  const created = await service.createSession({
    topic: "State machines",
    theme: "editorial",
  });

  const deck = await deckRepository.getById(created.session.deckId);

  assert.equal(deck?.metadata.theme, "editorial");
});

test("semantic deck review receives scoped facts and slide briefs", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new TrackingSemanticReviewLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await service.createSession({
    topic: "System Verification onboarding",
    groundingFacts: [
      {
        id: "fact_operations_1",
        role: "operations",
        claim: "System Verification uses delivery teams and QA specialists to support customer projects.",
        evidence:
          "Delivery teams and QA specialists support customer projects through tailored quality assurance.",
        sourceIds: ["systemverification-home"],
        confidence: "high",
      },
      {
        id: "fact_onboarding_1",
        role: "onboarding",
        claim: "System Verification works with quality assurance for software organizations.",
        evidence:
          "System Verification works with quality assurance for software organizations.",
        sourceIds: ["systemverification-home"],
        confidence: "high",
      },
      {
        id: "fact_delivery_1",
        role: "delivery",
        claim: "System Verification adapts QA support to each customer project.",
        evidence:
          "System Verification adapts QA support to each customer project.",
        sourceIds: ["systemverification-home"],
        confidence: "high",
      },
      {
        id: "fact_closing_1",
        role: "closing",
        claim: "System Verification presents quality assurance as a way to reduce software delivery risk.",
        evidence:
          "System Verification presents quality assurance as a way to reduce software delivery risk.",
        sourceIds: ["systemverification-home"],
        confidence: "high",
      },
    ],
    slideBriefs: [
      {
        index: 1,
        role: "operations",
        audienceQuestion: "How does System Verification deliver QA support?",
        requiredClaims: [
          "System Verification uses delivery teams and QA specialists to support customer projects.",
        ],
        evidenceFactIds: ["fact_operations_1"],
        forbiddenOverlap: ["generic software quality"],
      },
    ],
  });

  assert.equal(
    llmProvider.lastReviewDeckSemanticsInput?.generationInput.groundingFacts?.[0]?.id,
    "fact_operations_1",
  );
  assert.equal(
    llmProvider.lastReviewDeckSemanticsInput?.generationInput.slideBriefs?.[0]?.role,
    "operations",
  );
});

test("single-slide session creation rejects a blocking llm review before publishing it", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new OverzealousReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    () =>
      service.createSession({
        topic: "State machines",
        targetSlideCount: 1,
      }),
    /final quality review|deck is incoherent/i,
  );

  const savedDecks = await deckRepository.list();
  const savedSessions = await sessionRepository.list();
  assert.equal(savedDecks.length, 0);
  assert.equal(savedSessions.length, 0);
});

test("single-slide session creation rejects approved false review even when issues are warnings", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new WarningOnlyRejectedReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    () =>
      service.createSession({
        topic: "State machines",
        targetSlideCount: 1,
      }),
    /final quality review|Review rejected the deck/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
  assert.equal(transcriptRepository.turns.length, 0);
});

test("single-slide session creation accepts visual-prompt-only final review errors", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new VisualPromptOnlyReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const result = await service.createSession({
    topic: "State machines",
    targetSlideCount: 1,
  });

  assert.equal(result.session.state, "presenting");
  assert.equal((await deckRepository.list()).length, 1);
  assert.equal((await sessionRepository.list()).length, 1);
  assert.equal(transcriptRepository.turns.length, 1);
});

test("single-slide session creation rejects unavailable final llm review before publishing", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new UnavailableSingleSlideReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    () =>
      service.createSession({
        topic: "State machines",
        targetSlideCount: 1,
      }),
    /final quality review|review unavailable|final review timed out/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
  assert.equal(transcriptRepository.turns.length, 0);
});

test("review-supplied narration rewrites are ignored instead of persisted", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new ReviewWithIgnoredNarrationRewriteLLMProvider(),
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

  const persistedNarration = savedSession.narrationBySlideId["slide_single_review"];
  assert.ok(persistedNarration);
  assert.equal((persistedNarration?.segments.length ?? 0) >= 4, true);
  assert.match(
    persistedNarration?.narration ?? "",
    /We will start by grounding State machines in the first idea on this slide/i,
  );
  assert.doesNotMatch(
    persistedNarration?.narration ?? "",
    /valid path visible|questions are welcome about states, transitions/i,
  );
  assert.notEqual(persistedNarration?.summaryLine, "Model repaired narration");
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
  assert.equal(created.session.state, "preparing_presentation");
  assert.ok(deck);
  assert.equal(created.narrations.length, 1);
  assert.ok(created.narrations[0]);
  assert.ok((created.narrations[0]?.segments.length ?? 0) >= 4);
  assert.match(created.narrations[0]?.segments[0] ?? "", /^Welcome everyone\./);
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
  assert.equal(finalizedSession.state, "presenting");
  assert.equal(
    Object.keys(finalizedSession.narrationBySlideId).length,
    finalizedDeck.slides.length,
  );
});

test("session creation can skip background enrichment for deck-only evaluation", async () => {
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
    targetSlideCount: 1,
    skipBackgroundEnrichment: true,
  });
  await service.waitForBackgroundEnrichment(created.session.id);

  const deck = await deckRepository.getById(created.session.deckId);
  const session = await sessionRepository.getById(created.session.id);

  assert.equal(created.session.state, "presenting");
  assert.ok(deck);
  assert.equal(deck.metadata.generation?.narrationReadySlides, 1);
  assert.equal(deck.metadata.generation?.backgroundEnrichmentPending, false);
  assert.ok(session);
  assert.equal(Object.keys(session.narrationBySlideId).length, 1);
});

test("background final review unavailability marks the published session as error", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new UnavailableBackgroundReviewLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "Interactive AI teachers",
  });
  assert.equal(created.session.state, "preparing_presentation");

  await service.waitForBackgroundEnrichment(created.session.id);

  const finalizedDeck = await deckRepository.getById(created.session.deckId);
  const finalizedSession = await sessionRepository.getById(created.session.id);

  assert.ok(finalizedDeck);
  assert.equal(finalizedSession?.state, "error");
  assert.equal(finalizedDeck.metadata.generation?.backgroundEnrichmentPending, false);
  assert.match(
    finalizedDeck.metadata.validation?.issues.map((issue) => issue.message).join(" ") ?? "",
    /background final review timed out/i,
  );
});

test("background narration failure keeps incomplete sessions out of presenting", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new FailingBackgroundNarrationLLMProvider();
  const service = new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  const created = await service.createSession({
    topic: "Interactive AI teachers",
  });
  assert.equal(created.session.state, "preparing_presentation");

  await service.waitForBackgroundEnrichment(created.session.id);

  const finalizedDeck = await deckRepository.getById(created.session.deckId);
  const finalizedSession = await sessionRepository.getById(created.session.id);

  assert.ok(finalizedDeck);
  assert.equal(finalizedSession?.state, "error");
  assert.equal(finalizedDeck.metadata.generation?.backgroundEnrichmentPending, false);
  assert.ok(
    (finalizedDeck.metadata.generation?.narrationReadySlides ?? 0) <
      finalizedDeck.slides.length,
  );
  assert.match(
    finalizedDeck.metadata.validation?.issues.map((issue) => issue.message).join(" ") ?? "",
    /background narration generation did not complete/i,
  );
});

test("background enrichment does not replace already published intro narration", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new BackgroundIntroRewriteReviewLLMProvider();
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
  const introSlideId = deck?.slides[0]?.id;
  const publishedIntro = created.narrations[0];

  assert.ok(introSlideId);
  assert.ok(publishedIntro);

  await service.waitForBackgroundEnrichment(created.session.id);

  const finalizedSession = await sessionRepository.getById(created.session.id);
  const finalizedIntro = finalizedSession?.narrationBySlideId[introSlideId];

  assert.ok(finalizedIntro);
  assert.equal(finalizedIntro.narration, publishedIntro.narration);
  assert.doesNotMatch(finalizedIntro.narration, /Background review tried to replace/i);
  assert.equal(
    Object.keys(finalizedSession?.narrationBySlideId ?? {}).length,
    deck?.slides.length,
  );
});

test("session creation rejects broken intro narration instead of repairing it locally", async () => {
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

  await assert.rejects(
    () =>
      service.createSession({
        topic: "System Verification",
      }),
    /narration_intro_missing|presenter introduction/i,
  );
});

test("session creation rejects when llm planning or generation produces no usable deck", async () => {
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
    () =>
      service.createSession({
        topic: "Jivr onboarding",
        groundingSummary:
          "Jivr is a tool created by Per Hjalhdal. It is used to support onboarding and structured team knowledge sharing.",
        groundingSourceIds: ["https://jivr.com"],
        groundingSourceType: "mixed",
        targetSlideCount: 4,
      }),
    /empty response/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
});

test("session creation rejects fatal semantic review without publishing a replacement deck", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new FatalSemanticPremiereReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    () =>
      service.createSession({
        topic: "Spongebob Squarepants first episode that was aired in 1999",
        targetSlideCount: 4,
      }),
    /quality gate|fatal issue/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
});

test("session creation rejects pre-publish deck review before saving a visible session", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const service = new PresentationSessionService(
    new PrePublishFatalSemanticReviewLLMProvider(),
    deckRepository,
    sessionRepository,
    transcriptRepository,
  );

  await assert.rejects(
    () =>
      service.createSession({
        topic: "Interactive AI teachers",
        targetSlideCount: 4,
      }),
    /pre-publish deck review|repeats the same visible claim/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
  assert.equal(transcriptRepository.turns.length, 0);
});

test("session creation retries a failed deck generation pass before failing or saving", async () => {
  const deckRepository = new InMemoryDeckRepository();
  const sessionRepository = new InMemorySessionRepository();
  const transcriptRepository = new InMemoryTranscriptRepository();
  const llmProvider = new WeakDeckLLMProvider();
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

  assert.equal(llmProvider.deckCalls, 2);
  assert.ok(deck);
  assert.doesNotMatch(
    deck?.slides.map((slide) => slide.keyPoints.join(" ")).join(" ") ?? "",
    /walk through|direct new hires|avoid clutter|internal portal/i,
  );
});

test("session creation rejects semantic-review failures instead of relying on local text guards", async () => {
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
    () =>
      service.createSession({
        topic: "System Verification",
        presentationBrief: "Create an onboarding presentation about our company.",
        groundingSummary:
          "System Verification provides quality management, QA operations, and delivery support for complex engineering teams.",
        groundingSourceIds: ["https://www.systemverification.com/"],
        groundingSourceType: "mixed",
        targetSlideCount: 2,
      }),
    /quality gate|semantic reviewer|prompt_leakage/i,
  );

  assert.equal((await deckRepository.list()).length, 0);
  assert.equal((await sessionRepository.list()).length, 0);
});
