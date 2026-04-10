import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PresentationPlan,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
} from "@slidespeech/types";

import {
  ConversationTurnPlanSchema,
  DeckSchema,
  PresentationPlanSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";

import { extractJsonFromText, healthy, unhealthy } from "../shared";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item] : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|•|-|;|\d+\.\s/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};
const normalizeAudienceLevel = (value: unknown): string => {
  if (typeof value !== "string") {
    return "beginner";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "beginner" ||
    normalized === "intermediate" ||
    normalized === "advanced" ||
    normalized === "mixed"
  ) {
    return normalized;
  }

  return "beginner";
};

const normalizePresentationPlan = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...candidate,
    title:
      typeof candidate.title === "string"
        ? candidate.title
        : "Generated teaching plan",
    learningObjectives: toStringArray(candidate.learningObjectives),
    storyline: toStringArray(candidate.storyline),
    recommendedSlideCount:
      typeof candidate.recommendedSlideCount === "number"
        ? candidate.recommendedSlideCount
        : 4,
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
  };
};

const normalizeDeck = (value: unknown, topic: string): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const slides = Array.isArray(candidate.slides) ? candidate.slides : [];

  return {
    ...candidate,
    pedagogicalProfile:
      candidate.pedagogicalProfile &&
      typeof candidate.pedagogicalProfile === "object"
        ? candidate.pedagogicalProfile
        : {
            audienceLevel: "beginner",
            tone: "supportive and concrete",
            pace: "balanced",
            preferredExampleStyle: "real_world",
            wantsFrequentChecks: true,
            detailLevel: "standard",
          },
    topic:
      typeof candidate.topic === "string" && candidate.topic.trim().length > 0
        ? candidate.topic
        : topic,
    source:
      candidate.source && typeof candidate.source === "object"
        ? candidate.source
        : {
            type: "topic",
            topic,
            sourceIds: [],
          },
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? {
            estimatedDurationMinutes:
              typeof (candidate.metadata as Record<string, unknown>)
                .estimatedDurationMinutes === "number"
                ? (candidate.metadata as Record<string, unknown>)
                    .estimatedDurationMinutes
                : 6,
            tags: toStringArray(
              (candidate.metadata as Record<string, unknown>).tags,
            ),
            language:
              typeof (candidate.metadata as Record<string, unknown>).language ===
              "string"
                ? (candidate.metadata as Record<string, unknown>).language
                : "en",
          }
        : {
            estimatedDurationMinutes: 6,
            tags: [],
            language: "en",
          },
    slides: slides.map((slide, index) => {
      if (!slide || typeof slide !== "object") {
        return slide;
      }

      const slideCandidate = slide as Record<string, unknown>;
      return {
        ...slideCandidate,
        order:
          typeof slideCandidate.order === "number" ? slideCandidate.order : index,
        keyPoints: toStringArray(slideCandidate.keyPoints),
        requiredContext: toStringArray(slideCandidate.requiredContext),
        speakerNotes: toStringArray(slideCandidate.speakerNotes),
        examples: toStringArray(slideCandidate.examples),
        likelyQuestions: toStringArray(slideCandidate.likelyQuestions),
        dependenciesOnOtherSlides: toStringArray(
          slideCandidate.dependenciesOnOtherSlides,
        ),
        visualNotes: toStringArray(slideCandidate.visualNotes),
      };
    }),
  };
};

const normalizeNarration = (value: unknown, slideId: string): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...candidate,
    slideId,
    promptsForPauses: toStringArray(candidate.promptsForPauses),
    summaryLine:
      typeof candidate.summaryLine === "string"
        ? candidate.summaryLine
        : "Generated narration summary",
    suggestedTransition:
      typeof candidate.suggestedTransition === "string"
        ? candidate.suggestedTransition
        : "Continue to the next slide.",
  };
};

const normalizeConversationNeeds = (value: unknown): string[] => {
  const validNeeds = new Set([
    "question",
    "confusion",
    "example",
    "deepen",
    "repeat",
    "navigation",
    "pause",
    "resume",
  ]);

  return toStringArray(value)
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((item) => validNeeds.has(item));
};

const normalizeConversationPlan = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const runtimeEffects =
    candidate.runtimeEffects && typeof candidate.runtimeEffects === "object"
      ? (candidate.runtimeEffects as Record<string, unknown>)
      : {};

  const interruptionType =
    typeof candidate.interruptionType === "string"
      ? candidate.interruptionType.trim().toLowerCase()
      : "question";
  const responseMode =
    typeof candidate.responseMode === "string"
      ? candidate.responseMode.trim().toLowerCase()
      : interruptionType === "stop"
        ? "ack_pause"
        : interruptionType === "continue"
          ? "ack_resume"
          : interruptionType === "back"
            ? "ack_back"
            : interruptionType === "simplify"
              ? "simplify"
              : interruptionType === "example"
                ? "example"
                : interruptionType === "deepen"
                  ? "deepen"
                  : interruptionType === "repeat"
                    ? "repeat"
                    : "question";

  return {
    interruptionType,
    inferredNeeds: normalizeConversationNeeds(candidate.inferredNeeds),
    responseMode,
    runtimeEffects: {
      pause: runtimeEffects.pause === true,
      resume: runtimeEffects.resume === true,
      goToPreviousSlide: runtimeEffects.goToPreviousSlide === true,
      restartCurrentSlide: runtimeEffects.restartCurrentSlide === true,
      adaptDetailLevel:
        typeof runtimeEffects.adaptDetailLevel === "string"
          ? runtimeEffects.adaptDetailLevel.trim().toLowerCase()
          : undefined,
      adaptPace:
        typeof runtimeEffects.adaptPace === "string"
          ? runtimeEffects.adaptPace.trim().toLowerCase()
          : undefined,
    },
    confidence:
      typeof candidate.confidence === "number"
        ? candidate.confidence
        : 0.7,
    rationale:
      typeof candidate.rationale === "string"
        ? candidate.rationale
        : "Structured conversation plan generated from the current turn.",
  };
};

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

      return healthy(this.name, `Connected to ${this.baseUrl}.`);
    } catch (error) {
      return unhealthy(this.name, `Connection failed: ${(error as Error).message}`);
    }
  }

  async planPresentation(input: {
    topic: string;
    pedagogicalProfile: { audienceLevel: string };
  }): Promise<PresentationPlan> {
    return this.chatJson({
      schemaName: "PresentationPlan",
      system:
        "You design concise teaching plans. Return valid JSON only and no markdown.",
      user: [
        `Create a teaching plan for the topic: ${input.topic}`,
        `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
        "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
      ].join("\n"),
      parse: (value) =>
        PresentationPlanSchema.parse(normalizePresentationPlan(value)),
    });
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    return this.chatJson({
      schemaName: "Deck",
      system:
        "You create pedagogical slide decks as JSON. Return valid JSON only and no markdown.",
      user: [
        `Topic: ${input.topic}`,
        `Audience: ${input.pedagogicalProfile.audienceLevel}`,
        `Plan title: ${input.plan?.title ?? input.topic}`,
        `Learning objectives: ${(input.plan?.learningObjectives ?? []).join("; ")}`,
        "Return a deck with fields id, title, topic, summary, pedagogicalProfile, source, slides, createdAt, updatedAt, metadata.",
        "Each slide must include: id, order, title, learningGoal, keyPoints, requiredContext, speakerNotes, beginnerExplanation, advancedExplanation, examples, likelyQuestions, canSkip, dependenciesOnOtherSlides, visualNotes.",
        "Use English. Keep it concrete and beginner-friendly.",
      ].join("\n"),
      parse: (value) => DeckSchema.parse(normalizeDeck(value, input.topic)),
    });
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    return this.chatJson({
      schemaName: "SlideNarration",
      system:
        "You create narration text for teaching slides. Return valid JSON only and no markdown.",
      user: [
        `Deck topic: ${input.deck.topic}`,
        `Slide title: ${input.slide.title}`,
        `Learning goal: ${input.slide.learningGoal}`,
        `Key points: ${input.slide.keyPoints.join("; ")}`,
        "Return fields: slideId, narration, summaryLine, promptsForPauses, suggestedTransition.",
        "Use English and keep the explanation clear enough to read aloud.",
      ].join("\n"),
      parse: (value) =>
        SlideNarrationSchema.parse(normalizeNarration(value, input.slide.id)),
    });
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "You are a patient AI teacher. Answer in English. Be concrete and pedagogical.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Question: ${input.question}`,
          `Beginner explanation: ${input.slide.beginnerExplanation}`,
          `Examples: ${input.slide.examples.join("; ")}`,
        ].join("\n"),
      },
    ]);

    return { text };
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
    ]);

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
    ]);

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
    ]);

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
    ]);

    return { text };
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    const transcriptWindow = input.transcript
      .slice(-6)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n");

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
        "Valid responseMode values: ack_pause, ack_resume, ack_back, question, simplify, deepen, example, repeat.",
        "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
        "Use interruptionType=question by default for freeform learner input.",
      ].join("\n"),
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

  protected async chatText(messages: ChatMessage[]): Promise<string> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.name} request timed out after ${this.timeoutMs}ms`,
        );
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(
        `${this.name} request failed with status ${response.status}`,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`${this.name} returned an empty response.`);
    }

    return content;
  }

  protected async chatJson<T>(input: {
    schemaName: string;
    system: string;
    user: string;
    parse: (value: unknown) => T;
  }): Promise<T> {
    const text = await this.chatText([
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ]);

    const jsonText = extractJsonFromText(text);
    const parsed = JSON.parse(jsonText) as unknown;
    return input.parse(parsed);
  }
}
