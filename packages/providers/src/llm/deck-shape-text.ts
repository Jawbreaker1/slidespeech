import type { GenerateDeckInput } from "@slidespeech/types";

import { decodeHtmlEntities } from "../shared";

export const normalizeComparableText = (value: string): string =>
  decodeHtmlEntities(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const uniqueNonEmptyStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

export const DECK_SHAPE_META_PATTERNS = [
  /^\s*(?:selected source roles|curated grounding highlights|research coverage goals|source roles|grounding summary)\s*:/i,
  /\bthis slide\b/i,
  /\bslides?\b/i,
  /\bpresentation\b/i,
  /\bdeck\b/i,
  /\btarget audience\b/i,
  /\baudience-facing\b/i,
  /\baudience can\b/i,
  /\bfor the audience\b/i,
  /\bremind the audience\b/i,
  /\bsession\b/i,
  /\bthis session\b/i,
  /\bblueprint\b/i,
  /\bmatters because it\b/i,
  /\bsubject or organization\b/i,
  /\bcore mechanisms, characteristics, or defining ideas\b/i,
  /\bselected source roles\b/i,
  /\bcurated grounding highlights\b/i,
  /\bresearch coverage goals\b/i,
  /\bgrounding summary\b/i,
  /\bframes? the concrete case\b/i,
  /\bconcrete case within\b/i,
  /\b(?:later|following) details matter\b/i,
  /\b(?:specific examples|later details) that follow\b/i,
  /\bmain context for the specific examples\b/i,
  /\bsetting for the concrete case\b/i,
  /\bspecific event, mechanism, or fact\b/i,
  /\bstrongest supported lesson\b/i,
  /\bconsequence beyond the first event or fact\b/i,
  /\bstarts with identity, origin\b/i,
  /\bconcrete example\s*:/i,
  /\bmental model\s*:/i,
  /\bprocess view\s*:/i,
  /^\s*explanation of\b/i,
  /^\s*it helps\s*:/i,
  /^\s*structure\s*:/i,
  /^\s*motivation\s*:/i,
];

export const DECK_SHAPE_INSTRUCTIONAL_PATTERNS = [
  /^\s*(walk through|review|direct|show|tell|emphasize|map out|validate|highlight|mention|note|point out|call out|focus on|leverage|grasp)\b/i,
  /^\s*(?:ask|encourage|invite)\s+(?:the\s+)?(?:audience|participants|learners|people)\b/i,
  /^\s*participants\s+(?:draft|map|review|select|choose|write|create|use)\b/i,
  /^\s*use\b/i,
  /^\s*leave with\b/i,
  /^\s*to wrap up\b/i,
  /^\s*welcome everyone\b/i,
  /^\s*we are here to\b/i,
  /^\s*this session orients?\b/i,
  /^\s*depending on your needs\b/i,
  /\buse screenshots?\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\btext-heavy\b/i,
  /\binternal portal\b/i,
  /\bcore messaging\b/i,
];

const DECK_SHAPE_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS = new Set([
  /^\s*use\b/i.source,
]);

export const getActiveInstructionalPatterns = (
  input: Pick<GenerateDeckInput, "intent">,
): RegExp[] => {
  const allowsParticipantActionLanguage =
    input.intent?.deliveryFormat === "workshop" ||
    Boolean(input.intent?.activityRequirement) ||
    input.intent?.contentMode === "procedural";

  if (!allowsParticipantActionLanguage) {
    return DECK_SHAPE_INSTRUCTIONAL_PATTERNS;
  }

  return DECK_SHAPE_INSTRUCTIONAL_PATTERNS.filter(
    (pattern) => !DECK_SHAPE_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS.has(pattern.source),
  );
};

export const DECK_SHAPE_SUMMARY_PATTERNS = [
  /^\s*key takeaway\s*$/i,
  /^\s*one concrete (?:detail|example|part)\s*$/i,
  /^\s*why it matters\s*$/i,
  /^\s*real-world applications\s*$/i,
  /\bsummary\b/i,
  /\brecap\b/i,
  /\bwrap(?: |-)?up\b/i,
  /\bnext steps?\b/i,
  /\bcarry forward\b/i,
  /\bconclusion\b/i,
];

const ABSTRACT_MARKETING_COPY_PATTERNS = [
  /\blong-term business value\b/i,
  /\breal impact\b/i,
  /\bcustomer satisfaction\b/i,
  /\bquality journey\b/i,
  /\bsmarter solutions?\b/i,
  /\bleading qa network\b/i,
  /\bleading quality assurance network\b/i,
  /\bmove forward more safely\b/i,
  /\bbetter decisions?\b/i,
  /\bsafer products?\b/i,
  /\bhigher-quality software\b/i,
  /\bhappier users?\b/i,
  /\bfrontier in the ai era\b/i,
  /\bunpleasant surprises\b/i,
  /\boptimi[sz]e software quality\b/i,
  /\bresilient digital systems?\b/i,
  /\btrust(?:-based)? results?\b/i,
  /\bboost customer satisfaction\b/i,
  /\byour daily operations\b/i,
  /\byour delivery pipeline\b/i,
  /\byour\s+[\p{L}\p{M}-]+\s+(?:pipelines?|workflows?|teams?|systems|processes|operations|environments?)\b/iu,
  /\byour specific workflows?\b/i,
  /\byour quality journey\b/i,
  /\btailored to your needs\b/i,
];

const PROMOTIONAL_SOURCE_PATTERNS = [
  /\bsubscribe now\b/i,
  /\blearn more\b/i,
  /\b6-month subscription offer\b/i,
  /\bblaze through\b/i,
  /\bfree trial\b/i,
  /\bupgrade now\b/i,
  /\bby purchasing\b/i,
  /\bpurchase(?:d|s|ing)?\b/i,
  /\bstarter edition\b/i,
  /\bcharity\b/i,
  /\bdonation\b/i,
  /\bbundle\b/i,
];

export const looksOverlyPromotionalSourceCopy = (value: string): boolean =>
  PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value)) ||
  ABSTRACT_MARKETING_COPY_PATTERNS.some((pattern) => pattern.test(value));

const DIRECT_ORGANIZATION_PERSONA_PATTERN = /\b(?:we|our|us|you|your)\b/i;

export const usesDirectOrganizationPersona = (value: string): boolean =>
  DIRECT_ORGANIZATION_PERSONA_PATTERN.test(value);

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

export const tokenizeSemanticText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

export const tokenizeDeckShapeText = (value: string): string[] =>
  tokenizeSemanticText(value);

export const looksAbstractForIntro = (value: string): boolean => {
  const tokens = [...new Set(tokenizeDeckShapeText(value))];
  return tokens.length > 0 && tokens.length <= 3;
};

export const looksFragmentarySlidePoint = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  const tokens = tokenizeDeckShapeText(trimmed);
  const fragmentaryLeadPattern =
    /^(?:through|via|with|by|using|applying|including|generating|leveraging|focusing|across|after|before|during|leave with|practice)\b/i;
  const lowerTrimmed = trimmed.toLowerCase();
  const finiteVerbPattern =
    /\b(?:is|are|was|were|be|becomes|become|shows?|offers?|provides?|supports?|helps?|keeps?|works?|operates?|integrates?|reduces?|improves?|maps?|drafts?|summarizes?|checks?|lets?|gives?|uses?|applies?|stays?)\b/i;
  const clauseLikeParts = trimmed
    .split(/[,:;–—]/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (tokens.length <= 8 && fragmentaryLeadPattern.test(lowerTrimmed)) {
    return true;
  }

  if (tokens.length <= 10 && /[.!?]$/.test(trimmed) && !finiteVerbPattern.test(trimmed)) {
    return true;
  }

  if (/\bensuring\s+risks?\.?$/i.test(trimmed)) {
    return true;
  }

  if (tokens.length <= 10 && clauseLikeParts.length <= 1 && !finiteVerbPattern.test(trimmed)) {
    return true;
  }

  if (tokens.length >= 7 && /[.!?]$/.test(trimmed)) {
    return false;
  }

  if (tokens.length < 3) {
    return true;
  }

  if (/[.!?]$/.test(trimmed)) {
    return false;
  }

  return tokens.length < 5 && clauseLikeParts.length <= 1;
};

export const countAnchorOverlap = (value: string, anchor: string): number => {
  const left = [...new Set(tokenizeDeckShapeText(value))];
  const right = new Set(tokenizeDeckShapeText(anchor));

  if (left.length === 0 || right.size === 0) {
    return 0;
  }

  return left.filter((token) => right.has(token)).length;
};

export const hasMeaningfulAnchorOverlap = (value: string, anchor: string): boolean => {
  const left = [...new Set(tokenizeDeckShapeText(value))];
  const right = new Set(tokenizeDeckShapeText(anchor));

  if (left.length === 0 || right.size === 0) {
    return false;
  }

  const overlap = left.filter((token) => right.has(token));
  return overlap.length >= Math.min(3, Math.max(1, Math.floor(right.size / 5)));
};

export const contractTextSimilarity = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeDeckShapeText(left))];
  const rightTokens = new Set(tokenizeDeckShapeText(right));

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.size);
};

export const toAudienceFacingSentence = (value: string): string => {
  const normalized = decodeHtmlEntities(value)
    .replace(/\bshould be explained with a clear connection back to\b.*$/gi, " ")
    .replace(
      /^\s*(?:explain|show|see|understand|identify|recognize|summarize|learn|describe|teach|outline|review|walk through|highlight)\b[:\s-]*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");

  if (!normalized) {
    return "";
  }

  const sentence =
    normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

export const toAudienceFacingLearningGoal = (value: string): string => {
  const normalized = decodeHtmlEntities(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");
  const cleaned = normalized
    .replace(
      /^\s*(?:explain|show|see|understand|grasp|identify|recognize|summarize|learn|describe|teach|outline|review|walk through|highlight)\s+(?:how|why|what|where|when|which|who)\s+/i,
      "",
    )
    .replace(
      /^\s*(?:explain|show|see|understand|grasp|identify|recognize|summarize|learn|describe|teach|outline|review|walk through|highlight)\s+/i,
      "",
    )
    .replace(/^the\s+specific\s+role\s+of\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const result = cleaned.length >= 12 ? cleaned : normalized;
  return toAudienceFacingSentence(result);
};

export const shortenTitlePhrase = (value: string, maxLength = 72): string => {
  const stripDanglingTitleTail = (input: string): string =>
    input
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/,\s*(?:which|that|where|who|whose)\b.*$/i, "")
      .replace(
        /\b(?:which|that|where|who|whose)\s+(?:is|are|was|were|has|have|had|can|will|would|could|should)\b.*$/i,
        "",
      )
      .replace(/\b(?:a|an|and|as|at|before|after|by|for|from|in|of|on|or|that|the|to|which|who|with)\s*$/i, "")
      .replace(/['’]+$/g, "")
      .replace(/[.,:!?]+$/g, "")
      .trim();

  const trimmed = stripDanglingTitleTail(value);
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const shortened = stripDanglingTitleTail(
    trimmed.slice(0, maxLength).replace(/\s+\S*$/, "").trim(),
  );
  return shortened || stripDanglingTitleTail(trimmed.slice(0, maxLength).trim());
};
