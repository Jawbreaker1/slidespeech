import type {
  GenerateNarrationInput,
  SlideNarration,
} from "@slidespeech/types";

import { SlideNarrationSchema } from "@slidespeech/types";

import { buildNarrationFromPlainText } from "./narration-review-normalization";
import { toStringArray } from "./structured-normalization";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatTextOptions = {
  maxTokens?: number;
  timeoutMs?: number;
  tokenAttempts?: number[];
  disableLmStudioBudgetLift?: boolean;
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

export type OpenAICompatibleNarrationRuntime = {
  providerName: string;
  chatToolCall: <T>(input: ToolCallRequest<T>) => Promise<T>;
  chatText: (messages: ChatMessage[], options?: ChatTextOptions) => Promise<string>;
};

export const generateNarrationWithOpenAICompatibleProvider = async (
  input: GenerateNarrationInput,
  runtime: OpenAICompatibleNarrationRuntime,
): Promise<SlideNarration> => {
  const previousSlide = input.deck.slides[input.slide.order - 1];
  const nextSlide = input.deck.slides[input.slide.order + 1];
  const isFinalSlide = input.slide.order === input.deck.slides.length - 1;
  const tryStructuredNarration = async (): Promise<SlideNarration> =>
    await runtime.chatToolCall({
      functionName: "return_narration",
      functionDescription:
        "Return spoken narration segments for one presentation slide.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "segments",
          "summaryLine",
          "promptsForPauses",
          "suggestedTransition",
        ],
        properties: {
          segments: {
            type: "array",
            items: { type: "string" },
            minItems: input.slide.order === 0 ? 4 : 3,
            maxItems: input.slide.order === 0 ? 5 : 4,
          },
          summaryLine: { type: "string" },
          promptsForPauses: {
            type: "array",
            items: { type: "string" },
          },
          suggestedTransition: { type: "string" },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Write spoken narration for a presentation slide. Call the provided tool and do not answer in plain text. Speak directly to an audience, stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language. The segments must read as one connected mini-script, not as isolated bullet points.",
        },
        {
          role: "user",
          content: [
            `Topic: ${input.deck.topic}`,
            `Deck language: ${input.deck.metadata.language}`,
            `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
            `Slide title: ${input.slide.title}`,
            `Learning goal: ${input.slide.learningGoal}`,
            `Key points: ${input.slide.keyPoints.join("; ")}`,
            `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
            `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
            `Visible diagram nodes: ${input.slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
            previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
            nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
            input.slide.order === 0
              ? `Return 4 to 5 short spoken segments in ${input.deck.metadata.language}. The first segment must be a natural presenter intro before moving into the first substantive point.`
              : isFinalSlide
                ? `Return 3 to 4 short spoken segments in ${input.deck.metadata.language}. The final segment must visibly close the presentation and explicitly welcome audience questions.`
                : `Return 3 to 4 short spoken segments in ${input.deck.metadata.language}. Each segment must clearly relate to the visible slide content and present the idea directly.`,
            "Use light transitions between segments so each thought follows from the previous one. Do not copy visible bullet text verbatim as the whole narration. Explain it in spoken language while staying grounded.",
          ].join("\n"),
        },
      ],
      maxTokens: input.slide.order === 0 ? 1800 : 1400,
      timeoutMs: input.slide.order === 0 ? 22000 : 18000,
      tokenAttempts: input.slide.order === 0 ? [1800, 2600] : [1400, 2200],
      parse: (value) => {
        if (!value || typeof value !== "object") {
          throw new Error("Structured narration returned no object.");
        }

        const record = value as Record<string, unknown>;
        const segments = toStringArray(record.segments);
        const narrationText =
          segments.length > 0
            ? segments.join("\n\n")
            : typeof record.narration === "string"
              ? record.narration
              : "";
        const narration = buildNarrationFromPlainText(
          narrationText,
          input.slide,
          input.deck,
        );

        if (!narration) {
          throw new Error("Structured narration did not pass local grounding and quality checks.");
        }

        return SlideNarrationSchema.parse({
          ...narration,
          summaryLine:
            typeof record.summaryLine === "string" && record.summaryLine.trim()
              ? record.summaryLine.trim()
              : narration.summaryLine,
          promptsForPauses: toStringArray(record.promptsForPauses),
          suggestedTransition:
            typeof record.suggestedTransition === "string" &&
            record.suggestedTransition.trim()
              ? record.suggestedTransition.trim()
              : narration.suggestedTransition,
        });
      },
    });
  const tryPlainTextNarration = async (
    maxTokens: number,
    timeoutMs?: number,
    tokenAttempts?: number[],
  ): Promise<SlideNarration> => {
    const narrationText = await runtime.chatText(
      [
        {
          role: "system",
          content:
            "Write spoken narration for a presentation slide. Do not use JSON or markdown. Speak directly to an audience, stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language. The paragraphs must read as one connected mini-script, not as isolated bullet points.",
        },
        {
          role: "user",
          content: [
            `Topic: ${input.deck.topic}`,
            `Deck language: ${input.deck.metadata.language}`,
            `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
            `Slide title: ${input.slide.title}`,
            `Learning goal: ${input.slide.learningGoal}`,
            `Key points: ${input.slide.keyPoints.join("; ")}`,
            `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
            `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
            `Visible diagram nodes: ${input.slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
            previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
            nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
            input.slide.order === 0
              ? `Write exactly 4 short spoken paragraphs for the opening in ${input.deck.metadata.language}. Separate them with blank lines. The first paragraph must be a clear presenter intro, for example "Welcome everyone..." in English or "Välkomna..." in Swedish, before moving into the first substantive point.`
              : isFinalSlide
                ? `Write exactly 3 short spoken paragraphs for the closing in ${input.deck.metadata.language}. Separate them with blank lines. The final paragraph must close the presentation and explicitly welcome audience questions.`
                : `Write exactly 3 short spoken paragraphs for this slide in ${input.deck.metadata.language}. Separate them with blank lines. Each paragraph must clearly relate to the visible slide content and present the idea directly.`,
            "Use light transitions between paragraphs so the narration has a clear spoken flow.",
          ].join("\n"),
        },
      ],
      {
        maxTokens,
        ...(timeoutMs ? { timeoutMs } : {}),
        ...(tokenAttempts ? { tokenAttempts } : {}),
      },
    );

    const narration = buildNarrationFromPlainText(
      narrationText,
      input.slide,
      input.deck,
    );

    if (!narration) {
      throw new Error(
        "Plain-text narration did not pass local grounding and quality checks.",
      );
    }

    return narration;
  };

  let lastError: Error | null = null;
  const narrationStrategies: Array<{
    label: string;
    run: () => Promise<SlideNarration>;
  }> =
    input.slide.order === 0
      ? [
          {
            label: "structured primary",
            run: () => tryStructuredNarration(),
          },
          {
            label: "plain-text primary",
            run: () => tryPlainTextNarration(3000, 40000, [3000, 4200, 5600]),
          },
          {
            label: "plain-text retry",
            run: () => tryPlainTextNarration(3600, 50000, [3600, 5200, 6800]),
          },
        ]
      : [
          {
            label: "structured primary",
            run: () => tryStructuredNarration(),
          },
          {
            label: "plain-text primary",
            run: () => tryPlainTextNarration(2200, 30000, [2200, 3200, 4400]),
          },
        ];

  for (const strategy of narrationStrategies) {
    try {
      return await strategy.run();
    } catch (plainTextError) {
      lastError = plainTextError as Error;
      console.warn(
        `[slidespeech] ${runtime.providerName} narration ${strategy.label} path failed for "${input.slide.title}": ${lastError.message}`,
      );
    }
  }

  try {
    const compactNarrationText = await runtime.chatText(
      [
        {
          role: "system",
          content:
            "Write concise spoken narration for one teaching slide. Do not use JSON. Stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language. The lines must form one connected spoken explanation, not isolated bullets.",
        },
        {
          role: "user",
          content: [
            `Topic: ${input.deck.topic}`,
            `Deck language: ${input.deck.metadata.language}`,
            `Slide title: ${input.slide.title}`,
            `Learning goal: ${input.slide.learningGoal}`,
            `Key points: ${input.slide.keyPoints.join("; ")}`,
            `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
            `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
            previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
            nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
            input.slide.order === 0
              ? `Write exactly 4 short spoken lines in ${input.deck.metadata.language}, one per line, for the opening. The first line must be a clear presenter intro before the first content claim.`
              : isFinalSlide
                ? `Write exactly 3 short spoken lines in ${input.deck.metadata.language}, one per line, for the closing. The last line must welcome questions.`
                : `Write exactly 3 short spoken lines in ${input.deck.metadata.language}, one per line, for this slide.`,
          ].join("\n"),
        },
      ],
      {
        maxTokens: input.slide.order === 0 ? 1800 : 1400,
        timeoutMs: 25000,
        tokenAttempts: input.slide.order === 0 ? [1800, 2600] : [1400, 2200],
      },
    );

    const compactNarration = buildNarrationFromPlainText(
      compactNarrationText,
      input.slide,
      input.deck,
    );

    if (!compactNarration) {
      throw new Error(
        "Compact plain-text narration did not pass local grounding and quality checks.",
      );
    }

    return compactNarration;
  } catch (compactPlainTextError) {
    lastError = compactPlainTextError as Error;
    console.warn(
      `[slidespeech] ${runtime.providerName} narration compact plain-text path failed for "${input.slide.title}": ${lastError.message}`,
    );
  }

  throw lastError ?? new Error(`${runtime.providerName} narration generation failed.`);
};
