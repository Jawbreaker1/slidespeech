import type {
  GenerationAgentCall,
  GenerationJsonSchema,
  GenerationStageTelemetry,
  ProviderHealthStatus,
} from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

type StructuredGenerationClientConfig = {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  reasoningEffort?: "none" | "low" | undefined;
};

type StructuredCompletionInput<TValue> = {
  schemaName: string;
  jsonSchema: GenerationJsonSchema;
  system: string;
  user: string;
  images?: readonly { dataUrl: string }[];
  maxTokens: number;
  parse: (value: unknown) => TValue;
  signal?: AbortSignal | undefined;
};

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

type ModelsResponse = {
  data?: Array<{ id?: string }>;
};

type StructuredCompletionResponse = {
  content: string;
  telemetry: GenerationStageTelemetry;
};

const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const MAX_PARSE_FEEDBACK_CHARACTERS = 1_000;

const optionalTokenCount = (
  value: number | undefined,
): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;

const aggregateTelemetry = (
  accumulated: GenerationStageTelemetry | undefined,
  current: GenerationStageTelemetry,
): GenerationStageTelemetry => {
  if (!accumulated) {
    return current;
  }
  const sum = (
    field:
      | "promptTokens"
      | "completionTokens"
      | "reasoningTokens"
      | "totalTokens",
  ): number | undefined => {
    const values = [accumulated[field], current[field]].filter(
      (value): value is number => typeof value === "number",
    );
    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : undefined;
  };
  return {
    provider: current.provider,
    model: current.model,
    ...(sum("promptTokens") !== undefined
      ? { promptTokens: sum("promptTokens") }
      : {}),
    ...(sum("completionTokens") !== undefined
      ? { completionTokens: sum("completionTokens") }
      : {}),
    ...(sum("reasoningTokens") !== undefined
      ? { reasoningTokens: sum("reasoningTokens") }
      : {}),
    ...(sum("totalTokens") !== undefined
      ? { totalTokens: sum("totalTokens") }
      : {}),
  };
};

export class StructuredGenerationClient {
  readonly providerName: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly reasoningEffort: "none" | "low";

  constructor(config: StructuredGenerationClientConfig) {
    this.providerName = config.providerName;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 90_000;
    this.reasoningEffort = config.reasoningEffort ?? "low";
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return unhealthy(
          this.providerName,
          `Model discovery failed with status ${response.status}.`,
        );
      }

      const payload = (await response.json()) as ModelsResponse;
      const loadedModels = (payload.data ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => Boolean(id));
      if (!loadedModels.includes(this.model)) {
        return unhealthy(
          this.providerName,
          `Configured model "${this.model}" is not loaded. Loaded models: ${loadedModels.join(", ") || "none"}.`,
        );
      }

      return healthy(
        this.providerName,
        `Structured generation is ready with model "${this.model}".`,
      );
    } catch (error) {
      return unhealthy(
        this.providerName,
        `Structured generation health check failed: ${(error as Error).message}`,
      );
    }
  }

  async complete<TValue>(
    input: StructuredCompletionInput<TValue>,
  ): Promise<GenerationAgentCall<TValue>> {
    let previousContent: string | undefined;
    let parseFeedback: string | undefined;
    let telemetry: GenerationStageTelemetry | undefined;

    for (
      let attempt = 1;
      attempt <= MAX_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const response = await this.requestCompletion({
        ...input,
        ...(previousContent && parseFeedback
          ? { previousContent, parseFeedback }
          : {}),
      });
      telemetry = aggregateTelemetry(telemetry, response.telemetry);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(response.content) as unknown;
        return {
          value: input.parse(parsedJson),
          telemetry,
        };
      } catch (error) {
        if (attempt === MAX_STRUCTURED_OUTPUT_ATTEMPTS) {
          throw new Error(
            `${this.providerName} returned invalid structured output for ${input.schemaName} after ${attempt} attempts: ${(error as Error).message}`,
          );
        }
        previousContent = response.content;
        parseFeedback = (error as Error).message.slice(
          0,
          MAX_PARSE_FEEDBACK_CHARACTERS,
        );
      }
    }

    throw new Error("Structured output retry loop exited without a result.");
  }

  private async requestCompletion(
    input: StructuredCompletionInput<unknown> & {
      previousContent?: string | undefined;
      parseFeedback?: string | undefined;
    },
  ): Promise<StructuredCompletionResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              // Grammar constraints do not make the contract visible to the model.
              content: `${input.system}\n\nOutput contract (JSON Schema):\n${JSON.stringify(input.jsonSchema)}`,
            },
            { role: "user", content: input.images?.length ? [
              { type: "text", text: input.user },
              ...input.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
            ] : input.user },
            ...(input.previousContent && input.parseFeedback
              ? [
                  { role: "assistant", content: input.previousContent },
                  {
                    role: "user",
                    content: `The previous response violated the required JSON contract: ${input.parseFeedback}. Return a corrected response matching the same schema.`,
                  },
                ]
              : []),
          ],
          temperature: 0.1,
          max_tokens: input.maxTokens,
          stream: false,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.schemaName,
              strict: true,
              schema: input.jsonSchema,
            },
          },
          reasoning_effort: this.reasoningEffort,
        }),
        signal: input.signal
          ? AbortSignal.any([
              input.signal,
              AbortSignal.timeout(this.timeoutMs),
            ])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.providerName} structured request timed out after ${this.timeoutMs}ms.`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.providerName} structured request failed with status ${response.status}${
          detail ? `: ${detail.slice(0, 500)}` : ""
        }`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const choice = payload.choices?.[0];
    // Exhaustion is incomplete execution, not a contract mistake to replay.
    if (choice?.finish_reason === "length") {
      const completionTokens = optionalTokenCount(payload.usage?.completion_tokens);
      const reasoningTokens = optionalTokenCount(
        payload.usage?.completion_tokens_details?.reasoning_tokens,
      );
      throw new Error(
        `${this.providerName} reached the structured output token limit for ${input.schemaName}; finish_reason=length, max_tokens=${input.maxTokens}, completion_tokens=${completionTokens ?? "unknown"}, reasoning_tokens=${reasoningTokens ?? "unknown"}.`,
      );
    }
    const content = choice?.message?.content?.trim();
    if (!content) {
      const finishReason = choice?.finish_reason ?? "unknown";
      const reasoningPresent = Boolean(
        choice?.message?.reasoning_content?.trim(),
      );
      throw new Error(
        `${this.providerName} returned no structured content for ${input.schemaName}; finish_reason=${finishReason}, reasoning_present=${reasoningPresent}.`,
      );
    }

    const usage = payload.usage;
    const telemetry: GenerationStageTelemetry = {
      provider: this.providerName,
      model: this.model,
      ...(optionalTokenCount(usage?.prompt_tokens) !== undefined
        ? { promptTokens: usage!.prompt_tokens! }
        : {}),
      ...(optionalTokenCount(usage?.completion_tokens) !== undefined
        ? { completionTokens: usage!.completion_tokens! }
        : {}),
      ...(optionalTokenCount(
        usage?.completion_tokens_details?.reasoning_tokens,
      ) !== undefined
        ? {
            reasoningTokens:
              usage!.completion_tokens_details!.reasoning_tokens!,
          }
        : {}),
      ...(optionalTokenCount(usage?.total_tokens) !== undefined
        ? { totalTokens: usage!.total_tokens! }
        : {}),
    };

    return {
      content,
      telemetry,
    };
  }

  private buildHeaders(): HeadersInit {
    return this.apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        }
      : { "Content-Type": "application/json" };
  }
}
