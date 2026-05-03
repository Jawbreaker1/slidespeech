import { decodeHtmlEntities } from "../shared";

export type StructuredOutputChoice = {
  message?:
    | {
        content?: string | undefined;
        reasoning_content?: string | undefined;
      }
    | undefined;
};

export const getChatChoiceTextCandidates = (
  choice: StructuredOutputChoice | undefined,
): string[] =>
  [
    choice?.message?.content?.trim(),
    choice?.message?.reasoning_content?.trim(),
  ].filter((value): value is string => Boolean(value));

const getStructuredTextField = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const field of ["text", "content", "answer", "response", "output", "final"]) {
    const candidate = record[field];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
};

export const parseLmStudioReasoningText = (value: string): string | null => {
  const trimmed = decodeHtmlEntities(value).trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return getStructuredTextField(parsed);
    } catch {
      return null;
    }
  }

  return null;
};

export const parseLooseStructuredValue = (value: string): unknown => {
  const trimmed = decodeHtmlEntities(value).trim();

  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Fall through to primitive parsing.
    }
  }

  if (/^(?:true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  if (/^null$/i.test(trimmed)) {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return trimmed.replace(/\s+/g, " ");
};

export const parseLmStudioTaggedToolCall = (
  text: string,
  functionName: string,
): Record<string, unknown> | null => {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionMatch =
    text.match(new RegExp(`<function=${escapedFunctionName}>\\s*([\\s\\S]*?)\\s*</function>`, "i")) ??
    text.match(/<function=[^>]+>\s*([\s\S]*?)\s*<\/function>/i);
  const body = functionMatch?.[1] ?? text;
  const parameters = new Map<string, unknown>();

  for (const match of body.matchAll(
    /<parameter=([a-zA-Z0-9_]+)>\s*([\s\S]*?)\s*<\/parameter>/g,
  )) {
    const key = match[1]?.trim();
    const value = match[2] ?? "";

    if (key) {
      parameters.set(key, parseLooseStructuredValue(value));
    }
  }

  return parameters.size > 0 ? Object.fromEntries(parameters) : null;
};
