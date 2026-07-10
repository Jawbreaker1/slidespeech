import type {
  GenerateDeckInput,
  GroundingFact,
  PresentationPlan,
} from "@slidespeech/types";

import { PresentationPlanSchema } from "@slidespeech/types";

import { normalizePresentationPlan } from "./presentation-plan-normalization";
import {
  buildGroundingFactPlanningLines,
  buildIntentPromptLines,
} from "./openai-compatible-prompt-context";
import { compactGroundingSummary } from "./prompt-shaping";
import { buildArcPolicyPromptLines } from "./slide-arc-policy";

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

export type OpenAICompatiblePlanPresentationInput = {
  topic: string;
  presentationBrief?: string;
  intent?: GenerateDeckInput["intent"];
  groundingHighlights?: string[];
  groundingExcerpts?: string[];
  groundingCoverageGoals?: string[];
  groundingFacts?: GroundingFact[];
  pedagogicalProfile: { audienceLevel: string };
  groundingSummary?: string;
  targetDurationMinutes?: number;
  targetSlideCount?: number;
};

export type OpenAICompatiblePresentationPlanRuntime = {
  providerName: string;
  chatToolCall: <T>(input: ToolCallRequest<T>) => Promise<T>;
  chatJson: <T>(input: StructuredChatRequest<T>) => Promise<T>;
};

const PRESENTATION_PLAN_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "learningObjectives",
    "storyline",
    "recommendedSlideCount",
    "audienceLevel",
  ],
  properties: {
    title: {
      type: "string",
    },
    learningObjectives: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
    storyline: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
    recommendedSlideCount: {
      type: "integer",
      minimum: 1,
    },
    audienceLevel: {
      type: "string",
      enum: ["beginner", "intermediate", "advanced", "mixed"],
    },
  },
};

const normalizePlan = (
  input: OpenAICompatiblePlanPresentationInput,
  value: unknown,
): PresentationPlan =>
  PresentationPlanSchema.parse(
    normalizePresentationPlan(value, {
      targetSlideCount: input.targetSlideCount,
      topic: input.topic,
      subject: input.intent?.subject ?? input.topic,
      intent: input.intent,
      groundingHighlights: input.groundingHighlights,
      groundingCoverageGoals: input.groundingCoverageGoals,
      groundingFacts: input.groundingFacts,
    }),
  );

const buildPlanToolUserPrompt = (
  input: OpenAICompatiblePlanPresentationInput,
): string => {
  const groundingFactLines = buildGroundingFactPlanningLines(input.groundingFacts);
  return [
    ...buildIntentPromptLines(input),
    groundingFactLines.length > 0
      ? `Structured grounded facts for planning:\n${groundingFactLines
          .map((value) => `- ${value}`)
          .join("\n")}`
      : "No structured grounded facts were provided.",
    input.groundingHighlights?.length
      ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
      : "No grounding highlights were provided.",
    input.groundingExcerpts?.length
      ? `Grounded source excerpts:\n${input.groundingExcerpts
          .slice(0, 6)
          .map((value) => `- ${value}`)
          .join("\n")}`
      : "No grounded source excerpts were provided.",
    input.groundingCoverageGoals?.length
      ? `Coverage goals for the outline:\n${input.groundingCoverageGoals
          .slice(0, 8)
          .map((value) => `- ${value}`)
          .join("\n")}`
      : "No explicit outline coverage goals were provided.",
    `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
    input.groundingSummary
      ? `External grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
      : "No external grounding summary was provided.",
    input.targetDurationMinutes
      ? `Target duration: about ${input.targetDurationMinutes} minutes.`
      : "No explicit target duration was provided.",
    input.targetSlideCount
      ? `Target slide count: about ${input.targetSlideCount} slides.`
      : "No explicit target slide count was provided.",
    "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
    "This is the outline stage. The storyline must contain one clean audience-facing beat for each final slide.",
    groundingFactLines.length > 0
      ? "When structured grounded facts are provided, each storyline beat must be supportable by those facts or by the explicit source excerpts. Do not invent impact, legacy, development, creator-background, customer, or causal beats unless that information appears in the provided facts or excerpts."
      : null,
    groundingFactLines.length > 0
      ? "If the grounded facts are too sparse for the requested duration or slide count, recommend fewer slides rather than stretching one fact into repeated beats."
      : null,
    "Storyline beats are slide intentions, not source notes. Never copy labels such as Research coverage goals, Curated grounding highlights, External grounding summary, Grounded source excerpts, or other internal planning text into the storyline.",
    "Use the core subject as the thing the audience is learning about. The presentation brief and intent fields only describe the intended angle, audience, or delivery context.",
    ...buildArcPolicyPromptLines(input),
    input.intent?.framing || input.presentationBrief
      ? "Treat the framing context as binding scope for the plan; do not broaden beyond the requested audience, delivery format, or angle."
      : null,
    "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
    "For beginner audiences, choose an accessible sequence, but do not use a fixed template when the source material suggests a clearer arc.",
    input.targetSlideCount
      ? groundingFactLines.length > 0
        ? `Use ${input.targetSlideCount} as an upper bound, not a requirement, when the grounded facts cannot support that many distinct slides.`
        : `Return exactly ${input.targetSlideCount} storyline beats.`
      : "Keep the plan close to the requested duration and slide count when they are provided.",
    "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
  ].filter((line): line is string => Boolean(line)).join("\n");
};

const buildPlanJsonUserPrompt = (
  input: OpenAICompatiblePlanPresentationInput,
): string =>
  [
    ...buildIntentPromptLines(input),
    input.groundingHighlights?.length
      ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
      : "No grounding highlights were provided.",
    input.groundingExcerpts?.length
      ? `Grounded source excerpts:\n${input.groundingExcerpts
          .slice(0, 6)
          .map((value) => `- ${value}`)
          .join("\n")}`
      : "No grounded source excerpts were provided.",
    input.groundingCoverageGoals?.length
      ? `Coverage goals for the outline:\n${input.groundingCoverageGoals
          .slice(0, 8)
          .map((value) => `- ${value}`)
          .join("\n")}`
      : "No explicit outline coverage goals were provided.",
    `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
    input.groundingSummary
      ? `External grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
      : "No external grounding summary was provided.",
    input.targetDurationMinutes
      ? `Target duration: about ${input.targetDurationMinutes} minutes.`
      : "No explicit target duration was provided.",
    input.targetSlideCount
      ? `Target slide count: about ${input.targetSlideCount} slides.`
      : "No explicit target slide count was provided.",
    "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
    "This is the outline stage. Return one clean audience-facing storyline beat per final slide.",
    "Never copy internal labels such as Research coverage goals, Curated grounding highlights, External grounding summary, or Grounded source excerpts into the plan.",
    "Use the core subject as the thing the audience is learning about. The presentation brief and intent fields only describe the intended angle, audience, or delivery context.",
    ...buildArcPolicyPromptLines(input),
    input.intent?.framing || input.presentationBrief
      ? "Treat the framing context as binding scope for the plan; do not broaden beyond the requested audience, delivery format, or angle."
      : null,
    "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
    "For beginner audiences, choose an accessible sequence, but do not use a fixed template when the source material suggests a clearer arc.",
    input.targetSlideCount
      ? `Return exactly ${input.targetSlideCount} storyline beats.`
      : "Keep the plan close to the requested duration and slide count when they are provided.",
    "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
  ].filter((line): line is string => Boolean(line)).join("\n");

export const planPresentationWithOpenAICompatibleProvider = async (
  input: OpenAICompatiblePlanPresentationInput,
  runtime: OpenAICompatiblePresentationPlanRuntime,
): Promise<PresentationPlan> => {
  const system =
    "You design concise teaching plans. Call the provided tool and do not answer in plain text.";

  try {
    return await runtime.chatToolCall({
      functionName: "return_presentation_plan",
      functionDescription:
        "Return the structured teaching plan for the requested presentation.",
      parameters: PRESENTATION_PLAN_PARAMETERS,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildPlanToolUserPrompt(input) },
      ],
      maxTokens: 900,
      timeoutMs: 6000,
      tokenAttempts: [900, 1400],
      parse: (value) => normalizePlan(input, value),
    });
  } catch (error) {
    console.warn(
      `[slidespeech] ${runtime.providerName} tool-call presentation plan path failed: ${(error as Error).message}`,
    );
  }

  return runtime.chatJson({
    schemaName: "PresentationPlan",
    system:
      "You design concise teaching plans. Return valid JSON only and no markdown.",
    user: buildPlanJsonUserPrompt(input),
    maxTokens: 2200,
    parse: (value) => normalizePlan(input, value),
  });
};
