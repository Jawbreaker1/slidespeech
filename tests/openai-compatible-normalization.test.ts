import assert from "node:assert/strict";
import test from "node:test";

import { DeckSchema } from "@slidespeech/types";

import {
  normalizeDeckSemanticReviewResult,
  OpenAICompatibleLLMProvider,
} from "../packages/providers/src/llm/openai-compatible";
import {
  normalizeDeckReviewResult,
  normalizePresentationReview,
} from "../packages/providers/src/llm/narration-review-normalization";

const pedagogicalProfile = {
  audienceLevel: "beginner" as const,
  tone: "supportive and concrete",
  pace: "balanced",
  preferredExampleStyle: "real_world" as const,
  wantsFrequentChecks: true,
  detailLevel: "standard" as const,
};

test("deck semantic review normalization rejects malformed payloads", () => {
  assert.throws(
    () => normalizeDeckSemanticReviewResult({}),
    /missing approved/i,
  );
  assert.throws(
    () =>
      normalizeDeckSemanticReviewResult({
        approved: true,
        summary: "Accepted.",
        issues: [],
      }),
    /invalid score/i,
  );
  assert.throws(
    () =>
      normalizeDeckSemanticReviewResult({
        approved: true,
        score: 0.92,
        summary: "Accepted.",
        issues: [{ code: "unsupported_claim", severity: "warning" }],
      }),
    /missing message/i,
  );
});

test("deck semantic review normalization accepts explicit valid payloads", () => {
  assert.deepEqual(
    normalizeDeckSemanticReviewResult({
      approved: false,
      score: 0.74,
      summary: "The deck needs revision.",
      issues: [
        {
          code: "unsupported_claim",
          severity: "warning",
          message: "A claim lacks source support.",
          revisionInstruction: "Remove or ground the unsupported claim.",
          slideId: "slide_1",
        },
      ],
    }),
    {
      approved: false,
      score: 0.74,
      summary: "The deck needs revision.",
      issues: [
        {
          code: "unsupported_claim",
          severity: "warning",
          message: "A claim lacks source support.",
          revisionInstruction: "Remove or ground the unsupported claim.",
          slideId: "slide_1",
        },
      ],
    },
  );
});

test("final presentation review normalization rejects malformed payloads", () => {
  assert.throws(
    () => normalizeDeckReviewResult({}),
    /missing approved/i,
  );
  assert.throws(
    () =>
      normalizeDeckReviewResult({
        approved: true,
        overallScore: 0.8,
        summary: "Looks usable.",
      }),
    /missing issues/i,
  );
  assert.throws(
    () =>
      normalizePresentationReview(null, {
        deck: DeckSchema.parse({
          id: "deck_review_malformed",
          title: "Malformed review",
          topic: "Malformed review",
          summary: "A malformed review test deck.",
          pedagogicalProfile,
          source: {
            type: "topic",
            topic: "Malformed review",
            sourceIds: [],
          },
          slides: [
            {
              id: "slide_review_malformed",
              order: 0,
              title: "Malformed review",
              learningGoal: "Malformed review payloads must not be accepted.",
              keyPoints: [
                "The final review gate needs explicit approval.",
                "Malformed review data should reject the session.",
                "Fallback approval hides review failures.",
              ],
              beginnerExplanation:
                "The review gate should fail closed when structured output is malformed.",
              advancedExplanation:
                "Failing closed keeps malformed model responses from becoming publishable sessions.",
            },
          ],
          createdAt: "2026-05-07T10:00:00.000Z",
          updatedAt: "2026-05-07T10:00:00.000Z",
          metadata: {
            estimatedDurationMinutes: 1,
            tags: [],
            language: "en",
          },
        }),
        narrations: [],
        pedagogicalProfile,
      }),
    /invalid payload/i,
  );
});

test("deck semantic review normalization repairs missing issue revision instructions", () => {
  const normalized = normalizeDeckSemanticReviewResult({
    approved: false,
    score: 0.71,
    summary: "The deck needs revision.",
    issues: [
      {
        code: "repetitive_copy",
        severity: "error",
        message: "Slide 2 repeats the same visible sentence.",
      },
    ],
  });

  assert.equal(normalized.approved, false);
  assert.equal(
    normalized.issues[0]?.revisionInstruction,
    "Revise this issue: Slide 2 repeats the same visible sentence.",
  );
});

class GroundingJsonFallbackProvider extends OpenAICompatibleLLMProvider {
  toolCallAttempted = false;
  jsonFallbackAttempted = false;

  constructor() {
    super({
      providerName: "test-openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "test-model",
    });
  }

  protected override async chatToolCall<T>(input: {
    functionName: string;
  }): Promise<T> {
    this.toolCallAttempted = true;
    throw new Error(`No tool arguments for ${input.functionName}`);
  }

  protected override async chatJson<T>(input: {
    schemaName: string;
    parse: (value: unknown) => T;
  }): Promise<T> {
    this.jsonFallbackAttempted = true;
    assert.equal(input.schemaName, "grounding_classification");
    return input.parse({
      highlights: ["Help Wanted is the first SpongeBob SquarePants episode."],
      excerpts: ["Help Wanted first aired on May 1, 1999."],
      relevantSourceUrls: ["https://example.com/help-wanted"],
      sourceAssessments: [
        {
          url: "https://example.com/help-wanted",
          title: "Help Wanted",
          role: "identity",
          relevance: "high",
          notes: "Primary topic page.",
        },
      ],
      facts: [
        {
          role: "identity",
          claim: "The first SpongeBob SquarePants episode is Help Wanted.",
          evidence: "Help Wanted is the first SpongeBob SquarePants episode.",
          sourceIds: ["https://example.com/help-wanted"],
          confidence: "high",
        },
      ],
    });
  }
}

test("grounding classification retries as plain JSON when tool calls fail", async () => {
  const provider = new GroundingJsonFallbackProvider();
  const result = await provider.classifyGrounding({
    topic: "SpongeBob SquarePants first episode in 1999",
    coverageGoals: ["Identify the first episode title."],
    findings: [
      {
        url: "https://example.com/help-wanted",
        title: "Help Wanted",
        content: "Help Wanted is the first SpongeBob SquarePants episode.",
      },
    ],
  });

  assert.equal(provider.toolCallAttempted, true);
  assert.equal(provider.jsonFallbackAttempted, true);
  assert.equal(result.facts?.[0]?.role, "identity");
  assert.equal(
    result.facts?.[0]?.claim,
    "The first SpongeBob SquarePants episode is Help Wanted.",
  );
});

class DeckReviewOnlyProvider extends OpenAICompatibleLLMProvider {
  readonly toolCalls: string[] = [];

  constructor() {
    super({
      providerName: "test-openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "test-model",
    });
  }

  protected override async chatToolCall<T>(input: {
    functionName: string;
  }): Promise<T> {
    this.toolCalls.push(input.functionName);

    if (input.functionName === "return_presentation_deck_review") {
      return {
        approved: true,
        overallScore: 0.92,
        summary: "Deck review passed.",
        issues: [],
      } as T;
    }

    throw new Error(`Unexpected tool call ${input.functionName}`);
  }

  protected override async chatJson<T>(): Promise<T> {
    throw new Error("fallback review path should not run after deck review succeeds");
  }
}

class StructuredNarrationProvider extends OpenAICompatibleLLMProvider {
  toolCalls: string[] = [];

  constructor() {
    super({
      providerName: "test-openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "test-model",
    });
  }

  protected override async chatToolCall<T>(input: {
    functionName: string;
    functionDescription: string;
    parameters: Record<string, unknown>;
    messages: Array<{ role: "system" | "user"; content: string }>;
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    this.toolCalls.push(input.functionName);

    if (input.functionName !== "return_narration") {
      throw new Error(`Unexpected tool call ${input.functionName}`);
    }

    return input.parse({
      segments: [
        "Welcome everyone. Today we start with Donald Duck's first cartoon appearance and the concrete 1934 anchor that makes the topic specific.",
        "From there, The Wise Little Hen gives the story a named cartoon and a source-backed starting point rather than a broad franchise overview.",
        "In practice, the character, the film title, and the 1934 date belong together before any wider Disney context is added.",
        "Taken together, that starting point keeps the first appearance specific and leaves room to explain what the source does not prove.",
        "I will pause here because questions are welcome about Donald Duck, The Wise Little Hen, or the 1934 source anchor.",
      ],
      summaryLine: "Donald Duck's first appearance is anchored to The Wise Little Hen in 1934.",
      promptsForPauses: ["Ask if you want the source distinction explained."],
      suggestedTransition: "Bridge into the next source-backed detail.",
    });
  }

  protected override async chatText(): Promise<string> {
    throw new Error("plain-text narration path should not run first");
  }
}

test("narration generation prefers structured tool output before plain text", async () => {
  const deck = DeckSchema.parse({
    id: "deck_structured_narration",
    title: "Donald Duck's first cartoon appearance",
    topic: "Donald Duck's first cartoon appearance released in 1934",
    summary: "A source-backed introduction to the first appearance.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: "Donald Duck's first cartoon appearance released in 1934",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "Donald Duck's first cartoon appearance",
        learningGoal:
          "Donald Duck's first appearance is anchored to The Wise Little Hen in 1934.",
        keyPoints: [
          "The Wise Little Hen is the named cartoon tied to Donald Duck's first appearance.",
          "The 1934 date gives the opening a concrete source-backed starting point.",
        ],
        beginnerExplanation:
          "The opening connects Donald Duck, The Wise Little Hen, and the 1934 date before wider Disney context.",
        advancedExplanation:
          "The source-backed start separates the named first appearance from broader franchise claims.",
        examples: [],
        likelyQuestions: [],
      },
    ],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });
  const provider = new StructuredNarrationProvider();

  const narration = await provider.generateNarration({
    deck,
    slide: deck.slides[0]!,
    pedagogicalProfile,
  });

  assert.deepEqual(provider.toolCalls, ["return_narration"]);
  assert.match(narration.narration, /Welcome everyone/i);
  assert.match(narration.narration, /The Wise Little Hen/i);
  assert.deepEqual(narration.promptsForPauses, [
    "Ask if you want the source distinction explained.",
  ]);
});

test("presentation review does not run a narration repair side path", async () => {
  const deck = DeckSchema.parse({
    id: "deck_review_repair_failure",
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
  const provider = new DeckReviewOnlyProvider();

  const review = await provider.reviewPresentation({
    deck,
    narrations: [],
    pedagogicalProfile,
  });

  assert.equal(review.approved, true);
  assert.deepEqual(review.repairedNarrations, []);
  assert.deepEqual(provider.toolCalls, ["return_presentation_deck_review"]);
});
