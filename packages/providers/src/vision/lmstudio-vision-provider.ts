import type {
  AnalyzeDeckImagesInput,
  AnalyzeSlideImageInput,
  VisionInsight,
  VisionProvider,
} from "@slidespeech/types";

import { extractJsonFromText, healthy, unhealthy } from "../shared";

interface LMStudioVisionProviderConfig {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

interface VisionChatMessage {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

interface VisionChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const extractBase64ImagePayload = (
  value: string,
): { mimeType: string; base64: string } | null => {
  const match = value.match(/^data:(image\/[^;]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
};

const clampScore = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
};

export const normalizeVisionInsight = (
  value: unknown,
  fallbackSummary: string,
): VisionInsight => {
  const parsed =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const visualIssues = Array.isArray(parsed.visualIssues)
    ? parsed.visualIssues.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const pedagogicalHints = Array.isArray(parsed.pedagogicalHints)
    ? parsed.pedagogicalHints.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : fallbackSummary;
  const relevanceScore = clampScore(parsed.relevanceScore);
  const isRelevant =
    typeof parsed.isRelevant === "boolean"
      ? parsed.isRelevant
      : relevanceScore >= 0.65;

  return {
    summary,
    isRelevant,
    relevanceScore,
    visualIssues,
    pedagogicalHints,
  };
};

export class LMStudioVisionProvider implements VisionProvider {
  readonly name = "lmstudio-vision";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string | undefined;

  constructor(config: LMStudioVisionProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 45000;
    this.apiKey = config.apiKey;
  }

  private buildHeaders(): HeadersInit {
    return this.apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        }
      : {
          "Content-Type": "application/json",
        };
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

      return healthy(
        this.name,
        `Connected to ${this.baseUrl} with vision model "${this.model}".`,
      );
    } catch (error) {
      return unhealthy(this.name, `Connection failed: ${(error as Error).message}`);
    }
  }

  private async request(
    messages: VisionChatMessage[],
    timeoutMs?: number,
  ): Promise<string> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          messages,
          max_tokens: 260,
        }),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.name} request timed out after ${timeoutMs ?? this.timeoutMs}ms`,
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

    const json = (await response.json()) as VisionChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`${this.name} returned an empty response.`);
    }

    return content;
  }

  private async toLmStudioImageUrl(value: string): Promise<string> {
    const inlineBase64 = extractBase64ImagePayload(value);
    if (inlineBase64) {
      return `data:${inlineBase64.mimeType};base64,${inlineBase64.base64}`;
    }

    const response = await fetch(value, {
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `${this.name} image fetch failed with status ${response.status}.`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(
        `${this.name} expected an image response but received ${contentType || "unknown content type"}.`,
      );
    }

    const buffer = await response.arrayBuffer();
    const mimeType = contentType.split(";")[0] ?? "image/png";
    return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
  }

  async analyzeSlideImage(input: AnalyzeSlideImageInput): Promise<VisionInsight> {
    const imageUrl = input.imageDataUrl ?? input.imageUrl;

    if (!imageUrl) {
      return {
        summary: `No image data was provided for ${input.slideId}.`,
        isRelevant: false,
        relevanceScore: 0,
        visualIssues: ["No image was available to validate."],
        pedagogicalHints: [],
      };
    }

    const content = await this.request([
      {
        role: "system",
        content:
          "You validate whether a candidate image is relevant for an educational slide. Return valid JSON only. Be strict. Mark images as irrelevant if they are just logos, wordmarks, cropped letters, unrelated UI fragments, generic page furniture, or clearly depict the wrong topic.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Topic: ${input.topic}`,
              `Slide title: ${input.slideTitle}`,
              `Learning goal: ${input.learningGoal}`,
              `Key points: ${input.keyPoints.join(" | ") || "none"}`,
              input.imageAltText
                ? `Image alt text: ${input.imageAltText}`
                : "No image alt text was provided.",
              input.sourcePageUrl
                ? `Source page: ${input.sourcePageUrl}`
                : "No source page URL was provided.",
              'Return JSON with exactly these fields: {"summary": string, "isRelevant": boolean, "relevanceScore": number, "visualIssues": string[], "pedagogicalHints": string[]}.',
              "Use a relevanceScore from 0 to 1.",
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: {
              url: await this.toLmStudioImageUrl(imageUrl),
            },
          },
        ],
      },
    ]);

    const parsed = JSON.parse(extractJsonFromText(content)) as unknown;
    return normalizeVisionInsight(
      parsed,
      `Visual relevance analysis completed for ${input.slideId}.`,
    );
  }

  async analyzeDeckImages(input: AnalyzeDeckImagesInput): Promise<VisionInsight[]> {
    return Promise.all(input.slides.map((slide) => this.analyzeSlideImage(slide)));
  }

  async describeVisualIssues(input: AnalyzeDeckImagesInput): Promise<string[]> {
    const insights = await this.analyzeDeckImages(input);
    return insights.flatMap((insight) => insight.visualIssues);
  }

  async extractPedagogicalVisualHints(
    input: AnalyzeDeckImagesInput,
  ): Promise<string[]> {
    const insights = await this.analyzeDeckImages(input);
    return insights.flatMap((insight) => insight.pedagogicalHints);
  }
}
