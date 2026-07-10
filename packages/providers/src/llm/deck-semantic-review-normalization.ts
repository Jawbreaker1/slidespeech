import type {
  DeckSemanticIssue,
  DeckSemanticReviewResult,
} from "@slidespeech/types";

const DECK_SEMANTIC_ISSUE_CODES = new Set<DeckSemanticIssue["code"]>([
  "prompt_leakage",
  "wrong_language",
  "mixed_language",
  "role_drift",
  "template_language",
  "unsupported_claim",
  "fragmentary_copy",
  "source_noise",
  "repetitive_copy",
  "weak_opening",
  "weak_closing",
  "other",
]);

const DECK_SEMANTIC_SEVERITIES = new Set<DeckSemanticIssue["severity"]>([
  "info",
  "warning",
  "error",
]);

export const normalizeDeckSemanticReviewResult = (
  value: unknown,
): DeckSemanticReviewResult => {
  if (!value || typeof value !== "object") {
    throw new Error("Deck semantic review returned an invalid payload.");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.approved !== "boolean") {
    throw new Error("Deck semantic review payload is missing approved.");
  }

  if (
    typeof record.score !== "number" ||
    !Number.isFinite(record.score) ||
    record.score < 0 ||
    record.score > 1
  ) {
    throw new Error("Deck semantic review payload has an invalid score.");
  }

  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new Error("Deck semantic review payload is missing summary.");
  }

  if (!Array.isArray(record.issues)) {
    throw new Error("Deck semantic review payload is missing issues.");
  }

  const issues = record.issues.map((issue, index): DeckSemanticIssue => {
    if (typeof issue !== "object" || issue === null) {
      throw new Error(`Deck semantic review issue ${index + 1} is invalid.`);
    }

    const issueRecord = issue as Record<string, unknown>;
    if (
      typeof issueRecord.code !== "string" ||
      !DECK_SEMANTIC_ISSUE_CODES.has(issueRecord.code as DeckSemanticIssue["code"])
    ) {
      throw new Error(`Deck semantic review issue ${index + 1} has an invalid code.`);
    }
    if (
      typeof issueRecord.severity !== "string" ||
      !DECK_SEMANTIC_SEVERITIES.has(issueRecord.severity as DeckSemanticIssue["severity"])
    ) {
      throw new Error(`Deck semantic review issue ${index + 1} has an invalid severity.`);
    }
    if (typeof issueRecord.message !== "string" || !issueRecord.message.trim()) {
      throw new Error(`Deck semantic review issue ${index + 1} is missing message.`);
    }
    const code =
      issueRecord.code as DeckSemanticIssue["code"];
    const severity =
      issueRecord.severity as DeckSemanticIssue["severity"];
    const message = issueRecord.message.trim();
    const revisionInstruction =
      typeof issueRecord.revisionInstruction === "string" &&
      issueRecord.revisionInstruction.trim()
        ? issueRecord.revisionInstruction.trim()
        : `Revise this issue: ${message}`;
    const slideId =
      typeof issueRecord.slideId === "string" && issueRecord.slideId.trim()
        ? issueRecord.slideId.trim()
        : undefined;

    return {
      code,
      severity,
      ...(slideId ? { slideId } : {}),
      message,
      revisionInstruction,
    };
  });

  return {
    approved: record.approved,
    score: record.score,
    summary: record.summary.trim(),
    issues,
  };
};
