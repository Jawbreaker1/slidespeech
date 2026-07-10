import type {
  PresentationReview,
  ReviewPresentationInput,
} from "@slidespeech/types";

import { PresentationReviewSchema } from "@slidespeech/types";

import {
  buildCompactDeckReviewSummary,
  buildCompactNarrationReviewSummary,
  narrationNeedsDetailedReview,
  normalizeDeckReviewResult,
  normalizePresentationReview,
} from "./narration-review-normalization";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type StructuredChatRequest<T> = {
  schemaName: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  tokenAttempts?: number[];
  disableLmStudioBudgetLift?: boolean;
  parse: (value: unknown) => T;
};

type ToolCallRequest<T> = {
  functionName: string;
  functionDescription: string;
  parameters: Record<string, unknown>;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  tokenAttempts?: number[];
  disableLmStudioBudgetLift?: boolean;
  parse: (value: unknown) => T;
};

export type OpenAICompatiblePresentationReviewRuntime = {
  providerName: string;
  chatToolCall: <T>(input: ToolCallRequest<T>) => Promise<T>;
  chatJson: <T>(input: StructuredChatRequest<T>) => Promise<T>;
};

const DECK_REVIEW_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "overallScore", "summary", "issues"],
  properties: {
    approved: {
      type: "boolean",
    },
    overallScore: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    summary: {
      type: "string",
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "dimension", "message"],
        properties: {
          code: { type: "string" },
          severity: {
            type: "string",
            enum: ["info", "warning", "error"],
          },
          dimension: {
            type: "string",
            enum: ["deck", "visual", "coherence", "grounding"],
          },
          message: { type: "string" },
          slideId: { type: "string" },
        },
      },
    },
  },
};

export const reviewPresentationWithOpenAICompatibleProvider = async (
  input: ReviewPresentationInput,
  runtime: OpenAICompatiblePresentationReviewRuntime,
): Promise<PresentationReview> => {
  const narrationBySlideId = new Map(
    input.narrations.map((narration) => [narration.slideId, narration]),
  );
  const detailedSlides = input.deck.slides.filter((slide) =>
    narrationNeedsDetailedReview(
      input.deck,
      slide,
      narrationBySlideId.get(slide.id),
    ),
  );
  const slidesForDetailedReview = (
    detailedSlides.length > 0
      ? detailedSlides
      : input.deck.slides.slice(0, 2)
  ).slice(0, 2);

  const deckReviewSystem = [
    "You are a strict presentation QA reviewer for an interactive AI teacher.",
    "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether the slides form a strong teaching sequence.",
    "Judge the deck itself in this step. Do not rewrite narration here.",
    "Call the provided tool and do not answer in plain text.",
  ].join(" ");

  const deckReviewUser = [
    `Deck title: ${input.deck.title}`,
    `Deck topic: ${input.deck.topic}`,
    `Deck summary: ${input.deck.summary}`,
    `Audience: ${input.pedagogicalProfile.audienceLevel}`,
    `Deck outline:\n${input.deck.slides
      .map((slide) => buildCompactDeckReviewSummary(slide, { includeVisuals: true }))
      .join("\n\n")}`,
    "Return fields: approved, overallScore, summary, issues.",
    "Issue fields: code, severity, dimension, message, optional slideId.",
    "Valid dimensions: deck, visual, coherence, grounding.",
  ].join("\n");

  try {
    const deckReview = await runtime.chatToolCall({
      functionName: "return_presentation_deck_review",
      functionDescription:
        "Return the structured QA review for the deck itself, excluding narration rewrites.",
      parameters: DECK_REVIEW_PARAMETERS,
      messages: [
        { role: "system", content: deckReviewSystem },
        { role: "user", content: deckReviewUser },
      ],
      maxTokens: 2600,
      timeoutMs: 18000,
      tokenAttempts: [2600, 3600, 5200],
      parse: (value) => normalizeDeckReviewResult(value),
    });

    return PresentationReviewSchema.parse({
      ...deckReview,
      repairedNarrations: [],
    });
  } catch (error) {
    console.warn(
      `[slidespeech] ${runtime.providerName} tool-call review path failed: ${(error as Error).message}`,
    );
  }

  return runtime.chatJson({
    schemaName: "PresentationReview",
    system: [
      "You are a strict presentation QA reviewer for an interactive AI teacher.",
      "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether each slide narration is clearly about the visible slide without reading it verbatim.",
      "If a narration is weak or drifts away from the slide, report a narration issue. Do not rewrite narration in this review step.",
      "Do not rewrite the whole deck. Return valid JSON only and no markdown.",
    ].join(" "),
    user: [
      deckReviewUser,
      `Detailed review targets:\n${slidesForDetailedReview
        .map((slide) =>
          buildCompactNarrationReviewSummary(
            slide,
            narrationBySlideId.get(slide.id),
          ),
        )
        .join("\n\n")}`,
      "Return fields: approved, overallScore, summary, issues.",
      "Valid dimensions: deck, visual, narration, coherence, grounding.",
    ].join("\n"),
    parse: (value) =>
      PresentationReviewSchema.parse(normalizePresentationReview(value, input)),
  });
};
