import type {
  ClassifyGroundingInput,
  GroundingClassificationResult,
  GroundingFact,
} from "@slidespeech/types";

import { uniqueNonEmptyStrings } from "./deck-shape-text";
import {
  compactGroundingFindingContent,
  normalizeGroundingFactRole,
  normalizeGroundingRelevance,
  normalizeGroundingSourceRole,
} from "./grounding-normalization";
import { buildIntentPromptLines } from "./openai-compatible-prompt-context";
import {
  toRecordArray,
  toStringArray,
} from "./structured-normalization";

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

export type OpenAICompatibleGroundingRuntime = {
  providerName: string;
  chatToolCall: <T>(input: ToolCallRequest<T>) => Promise<T>;
  chatJson: <T>(input: StructuredChatRequest<T>) => Promise<T>;
};

const parseGroundingClassification = (
  input: ClassifyGroundingInput,
  value: unknown,
): GroundingClassificationResult => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Grounding classification tool returned an invalid payload.");
  }

  const record = value as Record<string, unknown>;
  const highlights = uniqueNonEmptyStrings(toStringArray(record.highlights)).slice(0, 6);
  const excerpts = uniqueNonEmptyStrings(toStringArray(record.excerpts)).slice(0, 8);
  const relevantSourceUrls = uniqueNonEmptyStrings(
    toStringArray(record.relevantSourceUrls),
  ).slice(0, 8);
  const facts = toRecordArray(record.facts)
    .map((item, index) => {
      const claim =
        typeof item.claim === "string" ? item.claim.trim() : "";
      const evidence =
        typeof item.evidence === "string" ? item.evidence.trim() : "";
      const sourceIds = uniqueNonEmptyStrings(
        toStringArray(item.sourceIds),
      ).slice(0, 4);
      const confidence: GroundingFact["confidence"] =
        item.confidence === "high" ||
        item.confidence === "medium" ||
        item.confidence === "low"
          ? item.confidence
          : "medium";

      return {
        id: `fact_${index + 1}`,
        role: normalizeGroundingFactRole(item.role),
        claim,
        evidence: evidence || claim,
        sourceIds,
        confidence,
      };
    })
    .filter((fact) => fact.claim.length > 0 && fact.evidence.length > 0)
    .slice(0, 12);
  const sourceAssessments = toRecordArray(record.sourceAssessments)
    .map((item) => ({
      url: typeof item.url === "string" ? item.url.trim() : "",
      title: typeof item.title === "string" ? item.title.trim() : "",
      role: normalizeGroundingSourceRole(item.role),
      relevance: normalizeGroundingRelevance(item.relevance),
      notes: typeof item.notes === "string" ? item.notes.trim() : "",
    }))
    .filter((item) => item.url.length > 0 && item.title.length > 0)
    .slice(0, input.findings.length);

  return {
    highlights,
    excerpts,
    relevantSourceUrls,
    sourceAssessments,
    facts,
  };
};

const buildGroundingClassificationRequest = (input: ClassifyGroundingInput) => {
  const system = [
    "You classify fetched source material for presentation grounding.",
    "Your job is to keep concrete, trustworthy, teaching-useful evidence and reject junk.",
    "Prefer factual identity, background, footprint, operations, capabilities, examples, timelines, practice guidance, and concrete outcomes when they exist.",
    "Treat navigation text, slogans, broad homepage marketing, generic category copy, cookie/legal boilerplate, FAQ questions, careers blurbs, and low-information repetition as low-signal or junk.",
    "Treat unsupported superlatives and self-evaluative company claims such as leading, world-class, innovative, strategic, or trusted partner language as promotional unless the source also gives concrete evidence for them.",
    "Do not invent facts, roles, or URLs.",
    "Highlights should be short factual statements grounded in the provided sources.",
    "Excerpts should be concise high-signal snippets from the provided source text, not rewritten slide copy.",
    "Facts should be role-scoped atomic claims for later slide generation. Each fact must include the claim, supporting evidence text, source URLs, confidence, and one best role.",
    "If one source sentence contains both identity (what something is called or what it is) and timing (when it aired, launched, or happened), split it into separate identity and timeline facts.",
    "Prioritize the requested topic and coverage goals over generally interesting adjacent facts. The first facts should directly answer the requested subject before adding secondary context.",
    "If the source names the exact title, event, creator, date, release, location, mechanism, or concrete example requested by the user, include those as facts even when adjacent source text also mentions later or secondary events.",
  ].join(" ");
  const user = [
    `Topic: ${input.topic}`,
    ...buildIntentPromptLines({
      topic: input.topic,
      ...(input.presentationBrief
        ? { presentationBrief: input.presentationBrief }
        : {}),
      ...(input.intent ? { intent: input.intent } : {}),
    }),
    input.coverageGoals.length > 0
      ? `Coverage goals: ${input.coverageGoals.join("; ")}`
      : "No explicit coverage goals were provided.",
    "Fetched source candidates:",
    ...input.findings.flatMap((finding, index) => [
      `SOURCE ${index + 1}`,
      `URL: ${finding.url}`,
      `Title: ${finding.title}`,
      `Content: ${compactGroundingFindingContent(finding.content) || "No usable content."}`,
    ]),
    "Select only the material that would actually improve grounded presentation generation.",
    "If a source is mostly promotional or irrelevant, keep it but classify it as low or junk rather than fabricating useful content from it.",
    "Use role=reference when the source is useful but does not clearly fit a narrower role.",
  ].join("\n");
  const parameters = {
    type: "object",
    additionalProperties: false,
    required: [
      "highlights",
      "excerpts",
      "relevantSourceUrls",
      "sourceAssessments",
      "facts",
    ],
    properties: {
      highlights: {
        type: "array",
        items: { type: "string" },
      },
      excerpts: {
        type: "array",
        items: { type: "string" },
      },
      relevantSourceUrls: {
        type: "array",
        items: { type: "string" },
      },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["role", "claim", "evidence", "sourceIds", "confidence"],
          properties: {
            role: {
              type: "string",
              enum: [
                "identity",
                "background",
                "footprint",
                "operations",
                "capabilities",
                "example",
                "timeline",
                "practice",
                "reference",
                "value",
              ],
            },
            claim: { type: "string" },
            evidence: { type: "string" },
            sourceIds: {
              type: "array",
              items: { type: "string" },
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
          },
        },
      },
      sourceAssessments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "title", "role", "relevance", "notes"],
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            role: {
              type: "string",
              enum: [
                "identity",
                "background",
                "footprint",
                "operations",
                "capabilities",
                "example",
                "timeline",
                "practice",
                "reference",
                "junk",
              ],
            },
            relevance: {
              type: "string",
              enum: ["high", "medium", "low", "junk"],
            },
            notes: { type: "string" },
          },
        },
      },
    },
  };

  return { system, user, parameters };
};

export const classifyGroundingWithOpenAICompatibleProvider = async (
  input: ClassifyGroundingInput,
  runtime: OpenAICompatibleGroundingRuntime,
): Promise<GroundingClassificationResult> => {
  if (input.findings.length === 0) {
    return {
      highlights: [],
      excerpts: [],
      relevantSourceUrls: [],
      sourceAssessments: [],
    };
  }

  const request = buildGroundingClassificationRequest(input);
  const parse = (value: unknown) => parseGroundingClassification(input, value);

  try {
    return await runtime.chatToolCall({
      functionName: "return_grounding_classification",
      functionDescription:
        "Select the strongest grounding evidence from fetched sources, reject junk or low-signal content, and classify each source by role and relevance.",
      parameters: request.parameters,
      messages: [
        {
          role: "system",
          content: `${request.system} Return the tool call only.`,
        },
        {
          role: "user",
          content: request.user,
        },
      ],
      maxTokens: 1800,
      timeoutMs: 25000,
      tokenAttempts: [1800, 2600, 3600],
      parse,
    });
  } catch (error) {
    console.warn(
      `[slidespeech] ${runtime.providerName} grounding classification tool call failed; retrying as plain JSON: ${(error as Error).message}`,
    );
    return runtime.chatJson({
      schemaName: "grounding_classification",
      system: [
        request.system,
        "Return only valid JSON. Do not use markdown.",
        "The JSON object must contain highlights, excerpts, relevantSourceUrls, sourceAssessments, and facts.",
      ].join(" "),
      user: [
        request.user,
        "Return JSON with this shape:",
        JSON.stringify(request.parameters),
      ].join("\n"),
      maxTokens: 3600,
      timeoutMs: 35000,
      tokenAttempts: [3600, 5200, 7000],
      parse,
    });
  }
};
