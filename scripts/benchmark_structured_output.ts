import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type RawCompletionChoice = {
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
};

type RawCompletionResponse = {
  choices?: RawCompletionChoice[];
};

type Variant = {
  id: string;
  description: string;
  request: {
    messages: ChatMessage[];
    max_tokens: number;
    temperature?: number;
    tools?: unknown;
    tool_choice?: unknown;
    extra_body?: Record<string, unknown>;
  };
  decode: (response: RawCompletionResponse) => DecodedResult;
};

type DecodedResult = {
  finishReason: string;
  hasContent: boolean;
  hasReasoning: boolean;
  jsonParsed: boolean;
  schemaPass: boolean;
  decodedValue?: unknown;
  error?: string;
};

type SampleResult = DecodedResult & {
  latencyMs: number;
  rawContent?: string;
  rawReasoning?: string;
};

type BenchmarkSummary = {
  variant: string;
  description: string;
  runs: number;
  medianLatencyMs: number;
  contentRate: number;
  reasoningRate: number;
  jsonRate: number;
  schemaRate: number;
  finishReasons: Record<string, number>;
  examples: SampleResult[];
};

type ConversationTurnPlan = {
  interruptionType:
    | "stop"
    | "question"
    | "simplify"
    | "deepen"
    | "example"
    | "back"
    | "repeat"
    | "continue"
    | "unknown";
  inferredNeeds: string[];
  responseMode:
    | "ack_pause"
    | "ack_resume"
    | "ack_back"
    | "question"
    | "summarize_current_slide"
    | "general_contextual"
    | "grounded_factual"
    | "simplify"
    | "deepen"
    | "example"
    | "repeat";
  runtimeEffects?: string[];
  confidence?: number;
  rationale?: string;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_RUNS = 4;
const DEFAULT_MAX_TOKENS = 320;

const parseDotEnv = async (): Promise<Record<string, string>> => {
  try {
    const text = await readFile(resolve(process.cwd(), ".env"), "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const splitIndex = line.indexOf("=");
          if (splitIndex === -1) {
            return [line, ""];
          }
          const key = line.slice(0, splitIndex).trim();
          const rawValue = line.slice(splitIndex + 1).trim();
          const value =
            rawValue.startsWith("\"") && rawValue.endsWith("\"")
              ? rawValue.slice(1, -1)
              : rawValue;
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
};

const extractJsonFromText = (text: string): string => {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  throw new Error("No JSON object found in response text.");
};

const isConversationTurnPlan = (value: unknown): value is ConversationTurnPlan => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.interruptionType === "string" &&
    Array.isArray(candidate.inferredNeeds) &&
    candidate.inferredNeeds.every((entry) => typeof entry === "string") &&
    typeof candidate.responseMode === "string"
  );
};

const buildPlannerMessages = (prefix?: string): ChatMessage[] => {
  const systemLines = [
    prefix,
    "You are a conversation planner for an AI teacher runtime.",
    "Treat the learner's turn as freeform conversation first, not as a command parser.",
    "Infer both pedagogical needs and runtime side effects.",
    "Return valid JSON only and no markdown.",
  ].filter((line): line is string => Boolean(line));

  const userLines = [
    prefix,
    "Topic: System Verification onboarding",
    "Current slide title: Why system verification matters",
    "Current slide learning goal: Understand the main point of this slide and how it connects to software quality work.",
    "Current session state: presenting",
    "Pedagogical profile: audience=beginner, detail=standard, pace=balanced",
    "Recent transcript:\nassistant: This slide explains why system verification matters.\nuser: okay",
    "User turn: What is the main point of this slide?",
    "Return fields: interruptionType, inferredNeeds, responseMode, runtimeEffects, confidence, rationale.",
    "Valid interruptionType values: stop, question, simplify, deepen, example, back, repeat, continue, unknown.",
    "Valid responseMode values: ack_pause, ack_resume, ack_back, question, summarize_current_slide, general_contextual, grounded_factual, simplify, deepen, example, repeat.",
    "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
    "Use interruptionType=question by default for freeform learner input.",
    "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
  ].filter((line): line is string => Boolean(line));

  return [
    { role: "system", content: systemLines.join(" ") },
    { role: "user", content: userLines.join("\n") },
  ];
};

const decodeJsonTextVariant = (response: RawCompletionResponse): DecodedResult => {
  const choice = response.choices?.[0];
  const content = choice?.message?.content?.trim() ?? "";
  const reasoning = choice?.message?.reasoning_content?.trim() ?? "";

  try {
    const parsed = JSON.parse(extractJsonFromText(content));
    return {
      finishReason: choice?.finish_reason ?? "unknown",
      hasContent: content.length > 0,
      hasReasoning: reasoning.length > 0,
      jsonParsed: true,
      schemaPass: isConversationTurnPlan(parsed),
      decodedValue: parsed,
      ...(isConversationTurnPlan(parsed)
        ? {}
        : { error: "Parsed JSON did not match ConversationTurnPlan shape." }),
    };
  } catch (error) {
    return {
      finishReason: choice?.finish_reason ?? "unknown",
      hasContent: content.length > 0,
      hasReasoning: reasoning.length > 0,
      jsonParsed: false,
      schemaPass: false,
      error: (error as Error).message,
    };
  }
};

const decodeToolVariant = (response: RawCompletionResponse): DecodedResult => {
  const choice = response.choices?.[0];
  const content = choice?.message?.content?.trim() ?? "";
  const reasoning = choice?.message?.reasoning_content?.trim() ?? "";
  const toolCall = choice?.message?.tool_calls?.[0];
  const argumentsText = toolCall?.function?.arguments?.trim() ?? "";

  try {
    const parsed = JSON.parse(argumentsText);
    return {
      finishReason: choice?.finish_reason ?? "unknown",
      hasContent: content.length > 0,
      hasReasoning: reasoning.length > 0,
      jsonParsed: true,
      schemaPass: isConversationTurnPlan(parsed),
      decodedValue: parsed,
      ...(isConversationTurnPlan(parsed)
        ? {}
        : { error: "Tool arguments did not match ConversationTurnPlan shape." }),
    };
  } catch (error) {
    return {
      finishReason: choice?.finish_reason ?? "unknown",
      hasContent: content.length > 0,
      hasReasoning: reasoning.length > 0,
      jsonParsed: false,
      schemaPass: false,
      error: (error as Error).message || "No valid tool arguments found.",
    };
  }
};

const buildVariants = (maxTokens: number): Variant[] => [
  {
    id: "json-baseline",
    description: "Current-style JSON-in-content prompt",
    request: {
      messages: buildPlannerMessages(),
      max_tokens: maxTokens,
      temperature: 0.2,
    },
    decode: decodeJsonTextVariant,
  },
  {
    id: "json-no-think-prompt",
    description: "JSON-in-content with /no_think prompt prefix",
    request: {
      messages: buildPlannerMessages("/no_think"),
      max_tokens: maxTokens,
      temperature: 0.2,
    },
    decode: decodeJsonTextVariant,
  },
  {
    id: "json-thinking-disabled",
    description: "JSON-in-content with LM Studio thinking explicitly disabled",
    request: {
      messages: buildPlannerMessages(),
      max_tokens: maxTokens,
      temperature: 0.2,
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    },
    decode: decodeJsonTextVariant,
  },
  {
    id: "json-thinking-enabled",
    description: "JSON-in-content with LM Studio thinking explicitly enabled",
    request: {
      messages: buildPlannerMessages(),
      max_tokens: maxTokens,
      temperature: 0.2,
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    },
    decode: decodeJsonTextVariant,
  },
  {
    id: "tool-call-thinking-disabled",
    description: "Tool/function-style output with thinking disabled",
    request: {
      messages: [
        ...buildPlannerMessages(),
        {
          role: "user",
          content:
            "You must answer by calling the provided function. Do not answer in plain text.",
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      tools: [
        {
          type: "function",
          function: {
            name: "return_turn_plan",
            description: "Return the classified learner turn.",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["interruptionType", "inferredNeeds", "responseMode"],
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
                  items: { type: "string" },
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
                  type: "array",
                  items: { type: "string" },
                },
                confidence: {
                  type: "number",
                },
                rationale: {
                  type: "string",
                },
              },
            },
          },
        },
      ],
      tool_choice: "required",
      extra_body: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    },
    decode: decodeToolVariant,
  },
];

const percentile50 = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};

const postChatCompletion = async (
  baseUrl: string,
  model: string,
  variant: Variant,
): Promise<SampleResult> => {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...variant.request,
    }),
  });
  const latencyMs = performance.now() - startedAt;

  if (!response.ok) {
    return {
      latencyMs,
      finishReason: "http_error",
      hasContent: false,
      hasReasoning: false,
      jsonParsed: false,
      schemaPass: false,
      error: `HTTP ${response.status}: ${await response.text()}`,
    };
  }

  const json = (await response.json()) as RawCompletionResponse;
  const choice = json.choices?.[0];
  const rawContent = choice?.message?.content?.trim() ?? "";
  const rawReasoning = choice?.message?.reasoning_content?.trim() ?? "";
  const decoded = variant.decode(json);

  return {
    latencyMs,
    rawContent: rawContent || undefined,
    rawReasoning: rawReasoning || undefined,
    ...decoded,
  };
};

const toSummary = (
  variant: Variant,
  results: SampleResult[],
): BenchmarkSummary => {
  const finishReasons: Record<string, number> = {};
  for (const result of results) {
    finishReasons[result.finishReason] =
      (finishReasons[result.finishReason] ?? 0) + 1;
  }

  return {
    variant: variant.id,
    description: variant.description,
    runs: results.length,
    medianLatencyMs: Number(percentile50(results.map((result) => result.latencyMs)).toFixed(1)),
    contentRate: Number(
      (results.filter((result) => result.hasContent).length / results.length).toFixed(2),
    ),
    reasoningRate: Number(
      (results.filter((result) => result.hasReasoning).length / results.length).toFixed(2),
    ),
    jsonRate: Number(
      (results.filter((result) => result.jsonParsed).length / results.length).toFixed(2),
    ),
    schemaRate: Number(
      (results.filter((result) => result.schemaPass).length / results.length).toFixed(2),
    ),
    finishReasons,
    examples: results.slice(0, 2),
  };
};

const main = async () => {
  const dotEnv = await parseDotEnv();
  const model =
    process.env.LMSTUDIO_MODEL ??
    dotEnv.LMSTUDIO_MODEL ??
    "qwen/qwen3.6-35b-a3b";
  const baseUrl =
    process.env.LMSTUDIO_BASE_URL ??
    dotEnv.LMSTUDIO_BASE_URL ??
    DEFAULT_BASE_URL;
  const runs = Number(process.env.STRUCTURED_BENCH_RUNS ?? DEFAULT_RUNS);
  const maxTokens = Number(
    process.env.STRUCTURED_BENCH_MAX_TOKENS ?? DEFAULT_MAX_TOKENS,
  );
  const variants = buildVariants(maxTokens);
  const report: BenchmarkSummary[] = [];

  console.log(
    `[structured-bench] model=${model} baseUrl=${baseUrl} runs=${runs} maxTokens=${maxTokens}`,
  );

  for (const variant of variants) {
    console.log(`\n[structured-bench] variant=${variant.id} ${variant.description}`);
    const results: SampleResult[] = [];

    for (let index = 0; index < runs; index += 1) {
      const result = await postChatCompletion(baseUrl, model, variant);
      results.push(result);
      console.log(
        `[structured-bench] run=${index + 1}/${runs} latencyMs=${result.latencyMs.toFixed(
          1,
        )} finish=${result.finishReason} content=${result.hasContent} reasoning=${result.hasReasoning} json=${result.jsonParsed} schema=${result.schemaPass}${result.error ? ` error=${result.error}` : ""}`,
      );
    }

    report.push(toSummary(variant, results));
  }

  console.log("\n[structured-bench] summary");
  console.log(JSON.stringify(report, null, 2));
};

main().catch((error) => {
  console.error(`[structured-bench] failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
