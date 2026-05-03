import type { GenerateDeckInput } from "@slidespeech/types";

import { uniqueNonEmptyStrings } from "./deck-shape-text";
import { resolveIntentSubject } from "./slide-arc-policy";

export const lowerCaseFirstCharacter = (value: string): string =>
  value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

export const subjectToActionPhrase = (subject: string): string => {
  const normalized = subject.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (lower.startsWith("using ")) {
    return `use ${normalized.slice(6).trim()}`;
  }

  if (lower.startsWith("making ")) {
    return `make ${normalized.slice(7).trim()}`;
  }

  if (lower.startsWith("preparing ")) {
    return `prepare ${normalized.slice(10).trim()}`;
  }

  if (lower.startsWith("building ")) {
    return `build ${normalized.slice(9).trim()}`;
  }

  return `work with ${normalized}`;
};

export const subjectToWorkshopNounPhrase = (subject: string): string => {
  const normalized = subject.replace(/\s+/g, " ").trim();
  if (/^using\s+ai tools?\b/i.test(normalized)) {
    return "AI-assisted work";
  }
  if (/^using\s+/i.test(normalized)) {
    return `${normalized.replace(/^using\s+/i, "")} use`;
  }
  return lowerCaseFirstCharacter(normalized);
};

export const looksLikeWorkshopBriefEcho = (value: string): boolean =>
  /\b(?:how\s+)?[\p{L}\s,]+?\bcan use\b.+\bdaily work\b/iu.test(value) ||
  /\b(?:can use|using)\b.+\bdaily work\b/i.test(value) ||
  /\bhow\b.+\bAI tools?\b.+\bdaily work\b/i.test(value) ||
  /\bAI tools?\s+in\s+daily work\s+for\b/i.test(value) ||
  /\b(?:specific|practical)\s+use cases?\s+for\s+AI tools?\b/i.test(value) ||
  /\bteams?\s+keep\s+AI-assisted work tied\b/i.test(value) ||
  /\bwhere it fits\b/i.test(value) ||
  /\bintended roles?\b/i.test(value) ||
  /\boverview of\b.+\buse cases?\b/i.test(value) ||
  /\bpolic(?:y|ies),\s*constraints?,\s*or\s+working context\b/i.test(value) ||
  /\bapply\b.+\bpractical scenario\b/i.test(value) ||
  /\bapply\s+AI tools?\s+to\s+a\s+specific work task\b/i.test(value) ||
  /\bcomplete\b.+\bpractical exercise\b/i.test(value) ||
  /\bwhy\b.+\brelevant\b/i.test(value) ||
  /\bhow\b.+\bsupport\b.+\btasks?\b/i.test(value) ||
  /\bpolitically governed public sector environment\b/i.test(value) ||
  /\bcurrent work task\b/i.test(value);

export const resolveAudienceLabel = (
  input: Pick<GenerateDeckInput, "intent">,
  maxCount = 3,
): string =>
  uniqueNonEmptyStrings(input.intent?.audienceCues ?? [])
    .slice(0, maxCount)
    .join(", ");

export const buildWorkshopPracticeLearningGoalText = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
): string => {
  const subject = resolveIntentSubject(input);
  const workshopNounPhrase = subjectToWorkshopNounPhrase(subject);

  return `A practical exercise turns one real work artifact into a reviewable draft for ${workshopNounPhrase}.`;
};
