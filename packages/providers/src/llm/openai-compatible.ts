import type {
  AnswerQuestionInput,
  AnswerValidationResult,
  ClassifyGroundingInput,
  ConversationTurnPlan,
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  GroundingClassificationResult,
  GroundingFact,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PlanResearchInput,
  PresentationPlan,
  PresentationReview,
  ReviewDeckSemanticsInput,
  ResearchPlanningSuggestion,
  ReviewPresentationInput,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
  ValidateQuestionAnswerInput,
  DeckSemanticReviewResult,
} from "@slidespeech/types";

import { ConversationTurnPlanSchema } from "@slidespeech/types";

import {
  extractJsonFromText,
  healthy,
  unhealthy,
} from "../shared";
import { normalizeConversationPlan } from "./conversation-plan-normalization";
import {
  getChatChoiceTextCandidates,
  parseLmStudioReasoningText,
  parseLmStudioTaggedToolCall,
} from "./lmstudio-structured-output";
import { reviewDeckSemanticsWithOpenAICompatibleProvider } from "./openai-compatible-deck-semantic-review";
import { classifyGroundingWithOpenAICompatibleProvider } from "./openai-compatible-grounding-classification";
import { generateNarrationWithOpenAICompatibleProvider } from "./openai-compatible-narration-generation";
import { planPresentationWithOpenAICompatibleProvider } from "./openai-compatible-presentation-plan";
import { reviewPresentationWithOpenAICompatibleProvider } from "./openai-compatible-presentation-review";
import { buildIntentPromptLines } from "./openai-compatible-prompt-context";
import { normalizeResearchPlanningSuggestion } from "./research-planning";
import { resolvePresentationSubjectLabel } from "./slide-arc-policy";

export { normalizeDeckSemanticReviewResult } from "./deck-semantic-review-normalization";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const looksLikeStructuredReasoningPayload = (value: string): boolean =>
  /^\s*[{[]/.test(value);

const looksLikeReasoningTrace = (value: string): boolean =>
  /\b(the user wants|i should|we need|need to answer|do not use json|follow the requested section labels)\b/i.test(
    value,
  );

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

interface ModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

export interface OpenAICompatibleConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;
  protected readonly baseUrl: string;
  protected readonly model: string;
  protected readonly apiKey: string | undefined;
  protected readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 45000;
  }

  private isLmStudioProvider(): boolean {
    return this.name === "lmstudio";
  }

  private raiseInitialTokenBudget(maxTokens: number): number {
    if (!this.isLmStudioProvider()) {
      return maxTokens;
    }

    if (maxTokens <= 300) {
      return 900;
    }

    if (maxTokens <= 600) {
      return 1400;
    }

    if (maxTokens <= 1200) {
      return 2200;
    }

    if (maxTokens <= 1800) {
      return 3000;
    }

    if (maxTokens <= 2400) {
      return 3600;
    }

    if (maxTokens <= 3200) {
      return 4400;
    }

    if (maxTokens <= 4200) {
      return 5600;
    }

    if (maxTokens <= 5200) {
      return 6800;
    }

    return Math.round(maxTokens * 1.15);
  }

  private normalizeTokenAttempts(options?: {
    maxTokens?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): number[] {
    const rawAttempts =
      options?.tokenAttempts && options.tokenAttempts.length > 0
        ? options.tokenAttempts
        : [
            options?.maxTokens ?? 1600,
            Math.max(
              3200,
              Math.min(6400, Math.round((options?.maxTokens ?? 1600) * 1.5)),
            ),
            Math.max(
              4800,
              Math.min(9600, Math.round((options?.maxTokens ?? 1600) * 2.2)),
            ),
          ];

    const adjustedAttempts = this.isLmStudioProvider() && !options?.disableLmStudioBudgetLift
      ? rawAttempts.map((attempt) => this.raiseInitialTokenBudget(attempt))
      : rawAttempts;

    return [...new Set(adjustedAttempts)].sort((left, right) => left - right);
  }

  private resolveRequestTimeout(
    requestedTimeoutMs: number | undefined,
    maxTokens: number | undefined,
    disableLmStudioBudgetLift: boolean | undefined,
  ): number {
    const baseTimeout = requestedTimeoutMs ?? this.timeoutMs;
    if (!this.isLmStudioProvider() || !maxTokens || disableLmStudioBudgetLift) {
      return baseTimeout;
    }

    const raisedBudget = this.raiseInitialTokenBudget(maxTokens);
    const additionalMs = Math.max(0, raisedBudget - 1800) * 6;
    return Math.min(90000, Math.max(baseTimeout, baseTimeout + additionalMs));
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        return unhealthy(
          this.name,
          `Health check failed with status ${response.status}.`,
        );
      }

      if (this.isLmStudioProvider()) {
        const payload = (await response.json().catch(() => null)) as
          | ModelsResponse
          | null;
        const loadedModelIds = Array.isArray(payload?.data)
          ? payload.data
              .map((model) => model.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)
          : [];

        if (loadedModelIds.length === 0) {
          return unhealthy(
            this.name,
            `Connected to ${this.baseUrl}, but LM Studio has no loaded models. Load "${this.model}" before generating.`,
          );
        }

        if (!loadedModelIds.includes(this.model)) {
          return unhealthy(
            this.name,
            `Connected to ${this.baseUrl}, but configured model "${this.model}" is not loaded. Loaded models: ${loadedModelIds.join(", ")}.`,
          );
        }

        return healthy(
          this.name,
          `Connected to ${this.baseUrl} with model "${this.model}" loaded.`,
        );
      }

      return healthy(this.name, `Connected to ${this.baseUrl}.`);
    } catch (error) {
      return unhealthy(this.name, `Connection failed: ${(error as Error).message}`);
    }
  }

  async planResearch(
    input: PlanResearchInput,
  ): Promise<ResearchPlanningSuggestion> {
    return this.chatToolCall({
      functionName: "return_research_plan",
      functionDescription:
        "Return a concise structured web research plan for grounded presentation generation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "searchQueries", "coverageGoals", "rationale"],
        properties: {
          subject: { type: "string" },
          searchQueries: {
            type: "array",
            minItems: 0,
            maxItems: 4,
            items: { type: "string" },
          },
          coverageGoals: {
            type: "array",
            minItems: 0,
            maxItems: 4,
            items: { type: "string" },
          },
          rationale: {
            type: "array",
            minItems: 0,
            maxItems: 3,
            items: { type: "string" },
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You refine web research plans for grounded presentation generation. Do not browse. Do not invent facts or URLs. Call the provided tool only.",
        },
        {
          role: "user",
          content: [
            `Prompt: ${input.topic}`,
            ...buildIntentPromptLines(input),
            `Heuristic subject: ${input.heuristicSubject}`,
            `Heuristic search queries: ${input.heuristicQueries.join(" | ") || "none"}`,
            input.explicitSourceUrls.length > 0
              ? `Explicit source URLs: ${input.explicitSourceUrls.join(" | ")}`
              : "No explicit source URLs were provided.",
            `Freshness sensitive: ${input.freshnessSensitive ? "yes" : "no"}`,
            `Grounded facts required: ${input.requiresGroundedFacts ? "yes" : "no"}`,
            "Refine the subject wording and search queries so backend fetch/search can gather stronger evidence.",
            "Prefer authoritative, official, or primary-source terminology.",
            "Coverage goals should describe facts or angles the presentation must substantiate.",
            "Do not mention slides, decks, templates, or presentation design.",
            "Keep subject as the real entity or topic, not the request phrasing.",
          ].join("\n"),
        },
      ],
      maxTokens: 1400,
      timeoutMs: 25000,
      tokenAttempts: [1400, 2400, 3600],
      parse: (value) => normalizeResearchPlanningSuggestion(value, input),
    });
  }

  async classifyGrounding(
    input: ClassifyGroundingInput,
  ): Promise<GroundingClassificationResult> {
    return classifyGroundingWithOpenAICompatibleProvider(input, {
      providerName: this.name,
      chatToolCall: (request) => this.chatToolCall(request),
      chatJson: (request) => this.chatJson(request),
    });
  }

  async planPresentation(input: {
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
  }): Promise<PresentationPlan> {
    return planPresentationWithOpenAICompatibleProvider(input, {
      providerName: this.name,
      chatToolCall: (request) => this.chatToolCall(request),
      chatJson: (request) => this.chatJson(request),
    });
  }

  async generateDeck(_input: GenerateDeckInput): Promise<Deck> {
    throw new Error(
      "Deck generation is intentionally disabled while the V2 DeckStrategy/SlidePlan pipeline is being built. The legacy outline scaffold and fake working deck path has been removed to prevent fallback presentations from being published.",
    );
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    return generateNarrationWithOpenAICompatibleProvider(input, {
      providerName: this.name,
      chatToolCall: (request) => this.chatToolCall(request),
      chatText: (messages, options) => this.chatText(messages, options),
    });
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    const visibleCards = input.slide.visuals.cards
      .slice(0, 2)
      .map((card) => `${card.title}: ${card.body}`)
      .join(" | ");
    const visibleCallouts = input.slide.visuals.callouts
      .slice(0, 2)
      .map((callout) => `${callout.label}: ${callout.text}`)
      .join(" | ");
    const slideExample = input.slide.examples[0]?.trim() || "None";
    const normalizeShortAnswer = (value: string): string => {
      const trimmed = value.replace(/\s+/g, " ").trim();
      if (!trimmed) {
        return trimmed;
      }

      return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    };

    if (input.answerMode === "grounded_factual" && input.sourceGroundingContext) {
      try {
        const groundedAnswer = await this.chatToolCall({
          functionName: "return_grounded_factual_answer",
          functionDescription:
            "Return whether the grounded source context directly supports a short factual answer.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["answerable", "answer"],
            properties: {
              answerable: {
                type: "boolean",
              },
              answer: {
                type: "string",
              },
            },
          },
          messages: [
            {
              role: "system",
              content: [
                "You answer short factual questions for an AI presentation runtime.",
                "Use only the provided grounded source context.",
                "Do not use slide text, broader deck context, or outside knowledge.",
                "If the grounded source context does not directly support the answer, set answerable=false and leave answer empty.",
                "Call the provided tool and do not answer in plain text.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Deck topic: ${input.deck.topic}`,
                `Question: ${input.question}`,
                `Grounded source context: ${input.sourceGroundingContext}`,
                "If a short list or contact-style excerpt directly contains the fact, you may extract it.",
                "Keep the answer short and direct.",
              ].join("\n"),
            },
          ],
          maxTokens: 500,
          timeoutMs: 7000,
          tokenAttempts: [500, 800, 1200],
          parse: (value) => {
            if (
              typeof value !== "object" ||
              value === null ||
              typeof (value as { answerable?: unknown }).answerable !== "boolean" ||
              typeof (value as { answer?: unknown }).answer !== "string"
            ) {
              throw new Error("Grounded factual answer tool returned an invalid payload.");
            }

            return {
              answerable: (value as { answerable: boolean }).answerable,
              answer: (value as { answer: string }).answer,
            };
          },
        });

        if (!groundedAnswer.answerable || !groundedAnswer.answer.trim()) {
          return {
            text: "I do not have a reliable answer to that from the current slide or the available source material.",
          };
        }

        return {
          text: normalizeShortAnswer(groundedAnswer.answer),
        };
      } catch (error) {
        console.warn(
          `[slidespeech] ${this.name} grounded factual tool-call path failed: ${(error as Error).message}`,
        );
      }
    }

    const answerInstruction =
      input.answerMode === "example"
        ? "Give one concrete example. Do not just restate the slide."
        : input.answerMode === "grounded_factual"
          ? "Answer only if the available grounded context supports it. If a short list, navigation excerpt, or contact-style excerpt directly carries the fact, you may extract the fact from it. If the context still does not support the fact, say that briefly."
          : input.answerMode === "summarize_current_slide"
            ? "State the main point of the current slide in direct language."
            : "Answer the user's question directly. Prefer concrete wording over abstract framing. If the question asks for a concrete fact that the context does not actually provide, say that briefly instead of replying with a generic summary.";
    const preferredAnswerLanguage = input.deck.metadata.language || "en";
    const text = await this.chatText([
      {
        role: "system",
        content:
          input.answerMode === "grounded_factual"
            ? `You are a fast AI presentation assistant. Answer using at most 3 short sentences. Answer in the same language as the user's question when that is clear; otherwise use the deck language (${preferredAnswerLanguage}). Use only the provided grounded source context. Do not use the slide text, the broader deck context, or outside knowledge. If the grounded source context does not support the answer, say that briefly instead of bluffing.`
            : `You are a fast AI presentation assistant. Answer using at most 4 short sentences. Answer in the same language as the user's question when that is clear; otherwise use the deck language (${preferredAnswerLanguage}). Prefer the current slide, but use broader deck context or source grounding when they clearly answer the question better. If the available context still does not support the answer, say that briefly instead of bluffing. Do not replace a missing concrete fact with a generic description of the company, topic, or slide.`,
      },
      {
        role: "user",
        content:
          input.answerMode === "grounded_factual"
            ? [
                `Deck topic: ${input.deck.topic}`,
                `Question: ${input.question}`,
                input.sourceGroundingContext
                  ? `Source grounding context: ${input.sourceGroundingContext}`
                  : "Source grounding context: None",
                answerInstruction,
              ].join("\n")
            : [
                `Topic: ${input.deck.topic}`,
                `Slide title: ${input.slide.title}`,
                `Slide learning goal: ${input.slide.learningGoal}`,
                `Visible key points: ${input.slide.keyPoints.join("; ")}`,
                `Visible cards: ${visibleCards || "None"}`,
                `Visible callouts: ${visibleCallouts || "None"}`,
                `Example on this slide: ${slideExample}`,
                `Question: ${input.question}`,
                `Beginner explanation: ${input.slide.beginnerExplanation}`,
                input.broaderDeckContext
                  ? `Broader deck context: ${input.broaderDeckContext}`
                  : null,
                input.sourceGroundingContext
                  ? `Source grounding context: ${input.sourceGroundingContext}`
                  : null,
                answerInstruction,
                "Do not mention the presentation, deck, or slide unless the user asks about them.",
              ].join("\n"),
      },
    ], {
      maxTokens: input.answerMode === "grounded_factual" ? 700 : 1200,
      timeoutMs: input.answerMode === "grounded_factual" ? 9000 : 18000,
      tokenAttempts:
        input.answerMode === "grounded_factual" ? [700, 1000] : [1200, 1600],
      disableLmStudioBudgetLift: true,
    });

    return { text: normalizeShortAnswer(text) };
  }

  async validateQuestionAnswer(
    input: ValidateQuestionAnswerInput,
  ): Promise<AnswerValidationResult> {
    return this.chatToolCall({
      functionName: "return_answer_validation",
      functionDescription:
        "Decide whether the proposed answer directly and honestly answers the user's question.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["isValid", "reason"],
        properties: {
          isValid: {
            type: "boolean",
          },
          reason: {
            type: "string",
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You validate answers in an AI presentation runtime.",
            "Approve only when the proposed answer directly addresses the user's question.",
            "Reject answers that dodge the question, drift into generic company or topic summaries, paste navigation or homepage sludge, or claim a grounded fact that is not actually supported.",
            "For grounded factual questions, require that the answer contain the concrete fact requested or explicitly and honestly state that the fact is not available.",
            "Call the provided tool and do not answer in plain text.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Deck topic: ${input.deck.topic}`,
            `Slide title: ${input.slide.title}`,
            `Question: ${input.question}`,
            `Answer mode: ${input.answerMode ?? "general_contextual"}`,
            `Proposed answer: ${input.proposedAnswer}`,
            input.broaderDeckContext
              ? `Broader deck context: ${input.broaderDeckContext}`
              : null,
            input.sourceGroundingContext
              ? `Source grounding context: ${input.sourceGroundingContext}`
              : null,
          ]
            .filter((value): value is string => Boolean(value))
            .join("\n"),
        },
      ],
      maxTokens: 300,
      timeoutMs: 7000,
      tokenAttempts: [300, 500],
      parse: (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          typeof (value as { isValid?: unknown }).isValid !== "boolean" ||
          typeof (value as { reason?: unknown }).reason !== "string"
        ) {
          throw new Error("Answer validation tool returned an invalid payload.");
        }

        return {
          isValid: (value as { isValid: boolean }).isValid,
          reason: (value as { reason: string }).reason,
        };
      },
    });
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Rewrite explanations in simpler English with short sentences and one analogy.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Current explanation: ${input.slide.beginnerExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Expand explanations for an advanced learner in English. Mention tradeoffs if relevant.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Advanced explanation seed: ${input.slide.advancedExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1800,
      timeoutMs: 18000,
      tokenAttempts: [1800, 3000],
    });

    return { text };
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Generate one concrete example in English for a teaching presentation.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Example seeds: ${input.slide.examples.join("; ")}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content: "Summarize teaching material in English using three short paragraphs.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slides: ${input.slides.map((slide) => `${slide.title}: ${slide.learningGoal}`).join(" | ")}`,
        ].join("\n"),
      },
    ], { maxTokens: 1400, timeoutMs: 30000 });

    return { text };
  }

  async reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
    return reviewDeckSemanticsWithOpenAICompatibleProvider(input, {
      chatToolCall: (request) => this.chatToolCall(request),
    });
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    return reviewPresentationWithOpenAICompatibleProvider(input, {
      providerName: this.name,
      chatToolCall: (request) => this.chatToolCall(request),
      chatJson: (request) => this.chatJson(request),
    });
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    const transcriptWindow = input.transcript
      .slice(-6)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n");

    const system = [
      "You are a conversation planner for an AI teacher runtime.",
      "Treat the learner's turn as freeform conversation first, not as a command parser.",
      "Infer both pedagogical needs and runtime side effects.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");
    const user = [
      `Topic: ${input.deck.topic}`,
      `Current slide title: ${input.slide.title}`,
      `Current slide learning goal: ${input.slide.learningGoal}`,
      `Current session state: ${input.session.state}`,
      `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
      `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
      `User turn: ${input.text}`,
      "Return a structured conversation plan through the tool.",
      "Use interruptionType=question by default for freeform learner input.",
      "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
      "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
      "Concrete factual questions about locations, countries, offices, dates, counts, certifications, customers, or legal/organizational facts should normally use grounded_factual when sources are available.",
      "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
      "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
    ].join("\n");

    try {
      return await this.chatToolCall({
        functionName: "return_turn_plan",
        functionDescription:
          "Return the structured learner-turn classification for the teaching runtime.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [
            "interruptionType",
            "inferredNeeds",
            "responseMode",
            "runtimeEffects",
            "confidence",
            "rationale",
          ],
          properties: {
            interruptionType: {
              type: "string",
              enum: [
                "stop",
                "question",
                "simplify",
                "deepen",
                "example",
                "back",
                "repeat",
                "continue",
                "unknown",
              ],
            },
            inferredNeeds: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "question",
                  "confusion",
                  "example",
                  "deepen",
                  "repeat",
                  "navigation",
                  "pause",
                  "resume",
                ],
              },
            },
            responseMode: {
              type: "string",
              enum: [
                "ack_pause",
                "ack_resume",
                "ack_back",
                "question",
                "summarize_current_slide",
                "general_contextual",
                "grounded_factual",
                "simplify",
                "deepen",
                "example",
                "repeat",
              ],
            },
            runtimeEffects: {
              type: "object",
              additionalProperties: false,
              properties: {
                pause: { type: "boolean" },
                resume: { type: "boolean" },
                goToPreviousSlide: { type: "boolean" },
                restartCurrentSlide: { type: "boolean" },
                adaptDetailLevel: {
                  type: "string",
                  enum: ["light", "standard", "deep"],
                },
                adaptPace: {
                  type: "string",
                  enum: ["slow", "balanced", "fast"],
                },
              },
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            rationale: {
              type: "string",
            },
          },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 600,
        timeoutMs: 5000,
        parse: (value) =>
          ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call planner path failed: ${(error as Error).message}`,
      );
    }

    return this.chatJson<ConversationTurnPlan>({
      schemaName: "ConversationTurnPlan",
      system: [
        "You are a conversation planner for an AI teacher runtime.",
        "Treat the learner's turn as freeform conversation first, not as a command parser.",
        "Infer both pedagogical needs and runtime side effects.",
        "Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        `Topic: ${input.deck.topic}`,
        `Current slide title: ${input.slide.title}`,
        `Current slide learning goal: ${input.slide.learningGoal}`,
        `Current session state: ${input.session.state}`,
        `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
        `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
        `User turn: ${input.text}`,
        "Return fields: interruptionType, inferredNeeds, responseMode, runtimeEffects, confidence, rationale.",
        "Valid interruptionType values: stop, question, simplify, deepen, example, back, repeat, continue, unknown.",
        "Valid responseMode values: ack_pause, ack_resume, ack_back, question, summarize_current_slide, general_contextual, grounded_factual, simplify, deepen, example, repeat.",
        "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
        "Use interruptionType=question by default for freeform learner input.",
        "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
        "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
        "Concrete factual questions about locations, countries, offices, dates, counts, certifications, customers, or legal/organizational facts should normally use grounded_factual when sources are available.",
        "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
        "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
      ].join("\n"),
      maxTokens: 220,
      timeoutMs: 4000,
      tokenAttempts: [220],
      disableLmStudioBudgetLift: true,
      parse: (value) =>
        ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
    });
  }

  protected buildHeaders(): HeadersInit {
    return this.apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        }
      : {
          "Content-Type": "application/json",
        };
  }

  protected async chatText(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tokenAttempts?: number[] | undefined;
      disableLmStudioBudgetLift?: boolean | undefined;
    },
  ): Promise<string> {
    const attempts = this.normalizeTokenAttempts(options);

    let lastEmptyReasoning = false;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          options?.timeoutMs,
          maxTokens,
          options?.disableLmStudioBudgetLift,
        ),
      });

      const choice = json.choices?.[0];
      const content = choice?.message?.content?.trim();
      if (content) {
        return content;
      }

      const reasoningContent = choice?.message?.reasoning_content?.trim();
      lastEmptyReasoning = Boolean(reasoningContent);

      if (
        reasoningContent &&
        choice?.finish_reason === "length" &&
        attemptIndex < attempts.length - 1
      ) {
        console.warn(
          `[slidespeech] ${this.name} returned only reasoning content at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      if (reasoningContent && this.isLmStudioProvider()) {
        const extractedReasoningText = parseLmStudioReasoningText(reasoningContent);
        if (extractedReasoningText) {
          console.warn(
            `[slidespeech] ${this.name} returned final text inside structured reasoning_content; extracted text field as a local LM Studio fallback.`,
          );
          return extractedReasoningText;
        }

        if (
          (looksLikeStructuredReasoningPayload(reasoningContent) ||
            looksLikeReasoningTrace(reasoningContent)) &&
          attemptIndex < attempts.length - 1
        ) {
          console.warn(
            `[slidespeech] ${this.name} returned reasoning metadata without a usable final text at max_tokens=${maxTokens}; retrying with a larger token budget.`,
          );
          continue;
        }

        if (
          looksLikeStructuredReasoningPayload(reasoningContent) ||
          looksLikeReasoningTrace(reasoningContent)
        ) {
          break;
        }

        console.warn(
          `[slidespeech] ${this.name} returned final text in reasoning_content; using it as a local LM Studio fallback.`,
        );
        return reasoningContent;
      }

      break;
    }

    throw new Error(
      lastEmptyReasoning
        ? `${this.name} returned only reasoning content without a final answer.`
        : `${this.name} returned an empty response.`,
    );
  }

  protected async chatJson<T>(input: {
    schemaName: string;
    system: string;
    user: string;
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const attempts = this.normalizeTokenAttempts(input);
    let lastError: Error | null = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion([
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ], {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          input.timeoutMs,
          maxTokens,
          input.disableLmStudioBudgetLift,
        ),
      });
      const choice = json.choices?.[0];

      for (const candidateText of getChatChoiceTextCandidates(choice)) {
        try {
          const jsonText = extractJsonFromText(candidateText);
          const parsed = JSON.parse(jsonText) as unknown;
          return input.parse(parsed);
        } catch (error) {
          lastError = error as Error;
        }
      }

      if (
        attemptIndex < attempts.length - 1 &&
        (choice?.finish_reason === "length" ||
          Boolean(choice?.message?.reasoning_content?.trim()))
      ) {
        console.warn(
          `[slidespeech] ${this.name} returned unparsable JSON for ${input.schemaName} at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      break;
    }

    throw lastError ?? new Error(`${this.name} returned no JSON for ${input.schemaName}.`);
  }

  protected async chatToolCall<T>(input: {
    functionName: string;
    functionDescription: string;
    parameters: Record<string, unknown>;
    messages: ChatMessage[];
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const attempts =
      input.tokenAttempts && input.tokenAttempts.length > 0
        ? [...new Set(input.tokenAttempts.filter((value) => Number.isFinite(value) && value > 0))]
        : [input.maxTokens ?? 800];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(input.messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          input.timeoutMs,
          maxTokens,
          input.disableLmStudioBudgetLift,
        ),
        tools: [
          {
            type: "function",
            function: {
              name: input.functionName,
              description: input.functionDescription,
              parameters: input.parameters,
            },
          },
        ],
        toolChoice: "required",
        extraBody: this.isLmStudioProvider()
          ? {
              chat_template_kwargs: {
                enable_thinking: false,
              },
            }
          : undefined,
      });

      const choice = json.choices?.[0];
      const toolArguments =
        choice?.message?.tool_calls?.[0]?.function?.arguments?.trim();

      if (toolArguments) {
        return input.parse(JSON.parse(toolArguments));
      }

      for (const candidateText of getChatChoiceTextCandidates(choice)) {
        try {
          const jsonText = extractJsonFromText(candidateText);
          return input.parse(JSON.parse(jsonText) as unknown);
        } catch {
          // Some LM Studio structured-output modes emit XML-like tool markup
          // inside reasoning_content instead of OpenAI-compatible tool_calls.
        }

        const taggedToolCall = parseLmStudioTaggedToolCall(
          candidateText,
          input.functionName,
        );
        if (taggedToolCall) {
          return input.parse(taggedToolCall);
        }
      }

      const shouldRetry =
        attemptIndex < attempts.length - 1 &&
        (choice?.finish_reason === "length" ||
          Boolean(choice?.message?.reasoning_content?.trim()) ||
          Boolean(choice?.message?.content?.trim()));

      if (shouldRetry) {
        console.warn(
          `[slidespeech] ${this.name} returned no tool arguments for ${input.functionName} at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      const finishReason = choice?.finish_reason
        ? ` finish_reason=${choice.finish_reason}.`
        : "";
      throw new Error(
        `${this.name} returned no tool arguments for ${input.functionName}.${finishReason}`,
      );
    }

    throw new Error(
      `${this.name} returned no tool arguments for ${input.functionName} after exhausting token attempts.`,
    );
  }

  private async requestChatCompletion(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tools?: unknown;
      toolChoice?: string | undefined;
      extraBody?: Record<string, unknown> | undefined;
    },
  ): Promise<ChatCompletionResponse> {
    let response: Response;
    const lmStudioNoThinkingBody = this.isLmStudioProvider()
      ? {
          chat_template_kwargs: {
            enable_thinking: false,
          },
        }
      : {};

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options?.tools ? { tools: options.tools } : {}),
          ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          ...lmStudioNoThinkingBody,
          ...(options?.extraBody ?? {}),
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.name} request timed out after ${options?.timeoutMs ?? this.timeoutMs}ms`,
        );
      }

      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.name} request failed with status ${response.status}${
          detail ? `: ${detail.slice(0, 400)}` : ""
        }`,
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  }

}
