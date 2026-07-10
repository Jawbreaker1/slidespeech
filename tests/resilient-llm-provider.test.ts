import test from "node:test";
import assert from "node:assert/strict";

import { DeckSchema } from "@slidespeech/types";
import type {
  AnswerQuestionInput,
  GenerateDeckInput,
  ClassifyGroundingInput,
  PlanPresentationInput,
  PlanResearchInput,
  ReviewPresentationInput,
  ReviewDeckSemanticsInput,
  ValidateQuestionAnswerInput,
} from "@slidespeech/types";
import {
  MockLLMProvider,
  ResilientLLMProvider,
} from "@slidespeech/providers";

const pedagogicalProfile = {
  audienceLevel: "beginner" as const,
  tone: "supportive and concrete",
  pace: "balanced",
  preferredExampleStyle: "real_world" as const,
  wantsFrequentChecks: true,
  detailLevel: "standard" as const,
};

class FailingCriticalLLMProvider extends MockLLMProvider {
  override readonly name = "primary";

  override async planResearch(_input: PlanResearchInput) {
    throw new Error("primary research planning failed");
  }

  override async classifyGrounding(_input: ClassifyGroundingInput) {
    throw new Error("primary grounding classification failed");
  }

  override async planPresentation(_input: PlanPresentationInput) {
    throw new Error("primary presentation planning failed");
  }

  override async generateDeck(_input: GenerateDeckInput) {
    throw new Error("primary deck generation failed");
  }

  override async answerQuestion(_input: AnswerQuestionInput) {
    throw new Error("primary question answering failed");
  }

  override async reviewDeckSemantics(_input: ReviewDeckSemanticsInput) {
    throw new Error("primary semantic review failed");
  }

  override async validateQuestionAnswer(_input: ValidateQuestionAnswerInput) {
    throw new Error("primary answer validation failed");
  }

  override async reviewPresentation(_input: ReviewPresentationInput) {
    throw new Error("primary presentation review failed");
  }
}

test("resilient provider does not use mock fallback for research planning", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );

  await assert.rejects(
    () =>
      provider.planResearch({
        topic: "System Verification",
        heuristicSubject: "System Verification",
        heuristicQueries: ["System Verification official"],
        explicitSourceUrls: [],
        freshnessSensitive: false,
        requiresGroundedFacts: true,
      }),
    /primary research planning failed/,
  );
});

test("resilient provider does not use mock fallback for grounding classification", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );

  await assert.rejects(
    () =>
      provider.classifyGrounding({
        topic: "System Verification",
        coverageGoals: ["Explain what System Verification does."],
        findings: [
          {
            title: "System Verification",
            url: "https://example.com",
            content: "System Verification provides QA services.",
          },
        ],
      }),
    /primary grounding classification failed/,
  );
});

test("resilient provider does not use mock fallback for presentation planning", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );

  await assert.rejects(
    () =>
      provider.planPresentation({
        topic: "System Verification",
        pedagogicalProfile,
      }),
    /primary presentation planning failed/,
  );
});

test("resilient provider does not use mock fallback for deck generation", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );

  await assert.rejects(
    () =>
      provider.generateDeck({
        topic: "System Verification",
        pedagogicalProfile,
      }),
    /primary deck generation failed/,
  );
});

test("resilient provider does not use mock fallback for question answering", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );
  const deck = DeckSchema.parse({
    id: "deck_resilient_qa",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "A short onboarding deck.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "System Verification onboarding",
        learningGoal: "See what System Verification does and why QA support matters.",
        keyPoints: [
          "System Verification supports software quality work for delivery teams.",
          "QA support connects testing, evidence, and release confidence.",
          "The onboarding view explains the company before specific services.",
        ],
        beginnerExplanation:
          "System Verification is introduced through its role in software quality.",
        advancedExplanation:
          "The company context links QA support with delivery confidence and operating model.",
      },
    ],
    createdAt: "2026-05-05T10:00:00.000Z",
    updatedAt: "2026-05-05T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });
  const slide = deck.slides[0];

  assert.ok(slide);
  await assert.rejects(
    () =>
      provider.answerQuestion({
        deck,
        slide,
        pedagogicalProfile,
        question: "What does System Verification do?",
      }),
    /primary question answering failed/,
  );
});

test("resilient provider does not use mock fallback for semantic deck review", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );
  const deck = DeckSchema.parse({
    id: "deck_resilient_review",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "A short onboarding deck.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "System Verification onboarding",
        learningGoal: "See what System Verification does and why QA support matters.",
        keyPoints: [
          "System Verification supports software quality work for delivery teams.",
          "QA support connects testing, evidence, and release confidence.",
          "The onboarding view explains the company before specific services.",
        ],
        beginnerExplanation:
          "System Verification is introduced through its role in software quality.",
        advancedExplanation:
          "The company context links QA support with delivery confidence and operating model.",
      },
    ],
    createdAt: "2026-05-05T10:00:00.000Z",
    updatedAt: "2026-05-05T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  await assert.rejects(
    () =>
      provider.reviewDeckSemantics({
        deck,
        generationInput: {
          topic: "System Verification",
          pedagogicalProfile,
        },
        pedagogicalProfile,
      }),
    /primary semantic review failed/,
  );
});

test("resilient provider does not use mock fallback for answer validation", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );
  const deck = DeckSchema.parse({
    id: "deck_resilient_qa_validation",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "A short onboarding deck.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "System Verification onboarding",
        learningGoal: "See what System Verification does and why QA support matters.",
        keyPoints: [
          "System Verification supports software quality work for delivery teams.",
          "QA support connects testing, evidence, and release confidence.",
          "The onboarding view explains the company before specific services.",
        ],
        beginnerExplanation:
          "System Verification is introduced through its role in software quality.",
        advancedExplanation:
          "The company context links QA support with delivery confidence and operating model.",
      },
    ],
    createdAt: "2026-05-05T10:00:00.000Z",
    updatedAt: "2026-05-05T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });
  const slide = deck.slides[0];

  assert.ok(slide);
  await assert.rejects(
    () =>
      provider.validateQuestionAnswer({
        deck,
        slide,
        pedagogicalProfile,
        question: "Who is the CEO of System Verification?",
        proposedAnswer:
          "System Verification helps organizations improve software quality.",
        answerMode: "grounded_factual",
      }),
    /primary answer validation failed/,
  );
});

test("resilient provider does not use mock fallback for final presentation review", async () => {
  const provider = new ResilientLLMProvider(
    new FailingCriticalLLMProvider(),
    new MockLLMProvider(),
  );
  const deck = DeckSchema.parse({
    id: "deck_resilient_final_review",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "A short onboarding deck.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "System Verification onboarding",
        learningGoal: "See what System Verification does and why QA support matters.",
        keyPoints: [
          "System Verification supports software quality work for delivery teams.",
          "QA support connects testing, evidence, and release confidence.",
          "The onboarding view explains the company before specific services.",
        ],
        beginnerExplanation:
          "System Verification is introduced through its role in software quality.",
        advancedExplanation:
          "The company context links QA support with delivery confidence and operating model.",
      },
    ],
    createdAt: "2026-05-05T10:00:00.000Z",
    updatedAt: "2026-05-05T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });
  const slide = deck.slides[0];

  assert.ok(slide);
  await assert.rejects(
    () =>
      provider.reviewPresentation({
        deck,
        narrations: [
          {
            slideId: slide.id,
            narration:
              "System Verification is introduced through its role in software quality.",
            segments: [
              "System Verification is introduced through its role in software quality.",
              "QA support connects testing, evidence, and release confidence.",
              "The onboarding view explains the company before specific services.",
              "This gives the audience a concrete starting point.",
            ],
            summaryLine: "System Verification onboarding.",
            promptsForPauses: [],
            suggestedTransition: "Continue.",
          },
        ],
        pedagogicalProfile,
      }),
    /primary presentation review failed/,
  );
});
