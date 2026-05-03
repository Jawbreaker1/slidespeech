import type {
  GroundingClassificationResult,
  GroundingFactRole,
} from "@slidespeech/types";

export const normalizeSourceType = (
  value: unknown,
  fallback: "topic" | "document" | "pptx" | "mixed",
): "topic" | "document" | "pptx" | "mixed" => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "topic" ||
    normalized === "document" ||
    normalized === "pptx" ||
    normalized === "mixed"
  ) {
    return normalized;
  }

  if (normalized === "internal" || normalized === "generated" || normalized === "local") {
    return fallback;
  }

  return fallback;
};

export const compactGroundingFindingContent = (content: string): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 20)
    .slice(0, 6);
  const compacted = (sentences.length > 0 ? sentences.join(" ") : normalized).trim();
  return compacted.length > 1400 ? `${compacted.slice(0, 1397).trim()}...` : compacted;
};

export const normalizeGroundingSourceRole = (
  value: unknown,
): GroundingClassificationResult["sourceAssessments"][number]["role"] => {
  if (typeof value !== "string") {
    return "reference";
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "identity":
    case "background":
    case "footprint":
    case "operations":
    case "capabilities":
    case "example":
    case "timeline":
    case "practice":
    case "reference":
    case "junk":
      return normalized;
    default:
      return "reference";
  }
};

export const normalizeGroundingFactRole = (
  value: unknown,
): GroundingFactRole => {
  if (typeof value !== "string") {
    return "reference";
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "identity":
    case "background":
    case "footprint":
    case "operations":
    case "capabilities":
    case "example":
    case "timeline":
    case "practice":
    case "reference":
    case "value":
      return normalized;
    default:
      return "reference";
  }
};

export const normalizeGroundingRelevance = (
  value: unknown,
): GroundingClassificationResult["sourceAssessments"][number]["relevance"] => {
  if (typeof value !== "string") {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "high":
    case "medium":
    case "low":
    case "junk":
      return normalized;
    default:
      return "medium";
  }
};
