import type { PresentationIntent } from "@slidespeech/types";

import { subjectIsGenericEntityReference } from "./presentation-intent";

const tokenizeResearchText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

export const normalizeResearchSubjectKey = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "");

export const researchSubjectTokenCount = (value: string): number =>
  tokenizeResearchText(value).length;

const ENTITY_DESCRIPTOR_TOKENS = new Set([
  "the",
  "and",
  "brand",
  "brands",
  "company",
  "organization",
  "organisation",
  "overview",
  "strategy",
  "impact",
  "lessons",
]);

const CONNECTOR_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const STRUCTURAL_DESCRIPTOR_TOKENS = new Set(
  [...ENTITY_DESCRIPTOR_TOKENS].filter((token) => !CONNECTOR_TOKENS.has(token)),
);

const tokenLooksLikeEntityAnchor = (token: string): boolean =>
  /^[A-ZÅÄÖ][\p{L}\p{N}&+-]*$/u.test(token) &&
  !CONNECTOR_TOKENS.has(token.toLocaleLowerCase());

const deriveDescriptorStrippedEntitySubject = (subject: string): string | null => {
  const tokens = subject.match(/[\p{L}\p{N}&+-]+/gu) ?? [];
  const entityAnchorTokens = tokens.filter(tokenLooksLikeEntityAnchor);
  const nonAnchorTokens = tokens.filter((token) => !tokenLooksLikeEntityAnchor(token));
  const hasDescriptorContext = nonAnchorTokens.some((token) =>
    STRUCTURAL_DESCRIPTOR_TOKENS.has(token.toLocaleLowerCase()),
  );

  if (
    entityAnchorTokens.length > 0 &&
    entityAnchorTokens.length <= 3 &&
    entityAnchorTokens.length < tokens.length &&
    hasDescriptorContext &&
    nonAnchorTokens.every((token) => !tokenLooksLikeEntityAnchor(token))
  ) {
    return entityAnchorTokens.join(" ");
  }

  const keptTokens = tokens.filter(
    (token) => !ENTITY_DESCRIPTOR_TOKENS.has(token.toLocaleLowerCase()),
  );

  if (
    keptTokens.length === 0 ||
    keptTokens.length === tokens.length ||
    keptTokens.length > 3
  ) {
    return null;
  }

  const hasNamedEntityShape = keptTokens.some((token) => /^[A-ZÅÄÖ]/u.test(token));
  if (!hasNamedEntityShape) {
    return null;
  }

  return keptTokens.join(" ");
};

const deriveHostnameResearchAnchor = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0]?.trim() ?? "";
    if (root.length < 3) {
      return null;
    }

    const normalized = root.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return null;
    }

    return normalized.replace(/\b\p{L}/gu, (value) => value.toLocaleUpperCase());
  } catch {
    return null;
  }
};

export const resolveResearchSubject = (input: {
  subject: string;
  explicitSourceUrls: string[];
  intent: PresentationIntent;
}): string => {
  const descriptorStrippedSubject = deriveDescriptorStrippedEntitySubject(input.subject);
  if (descriptorStrippedSubject && !subjectIsGenericEntityReference(descriptorStrippedSubject)) {
    return descriptorStrippedSubject;
  }

  if (
    input.intent.presentationFrame !== "organization" ||
    !subjectIsGenericEntityReference(input.subject)
  ) {
    return input.subject;
  }

  for (const url of input.explicitSourceUrls) {
    const anchor = deriveHostnameResearchAnchor(url);
    if (anchor && !subjectIsGenericEntityReference(anchor)) {
      return anchor;
    }
  }

  return input.subject;
};
