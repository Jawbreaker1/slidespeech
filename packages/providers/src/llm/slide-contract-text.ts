import type { GenerateDeckInput } from "@slidespeech/types";

import { decodeHtmlEntities } from "../shared";
import {
  countAnchorOverlap,
  DECK_SHAPE_INSTRUCTIONAL_PATTERNS,
  DECK_SHAPE_META_PATTERNS,
  DECK_SHAPE_SUMMARY_PATTERNS,
  getActiveInstructionalPatterns,
  hasMeaningfulAnchorOverlap,
  looksFragmentarySlidePoint,
  normalizeComparableText,
  shortenTitlePhrase,
  toAudienceFacingSentence,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import { extractCoverageRequirements } from "./prompt-shaping";
import {
  deriveSlideArcPolicy,
  resolveIntentFocusAnchor,
  resolveIntentSubject,
} from "./slide-arc-policy";

const CONTRACT_LEAD_IN_PATTERNS = [
  /^\s*by the time of\b/i,
  /^\s*although\b/i,
  /^\s*while\b/i,
  /^\s*when\b/i,
  /^\s*because\b/i,
  /^\s*if\b/i,
  /^\s*as soon as\b/i,
  /^\s*as\b/i,
];

export const NON_SLIDEABLE_COVERAGE_PATTERNS = [
  /^\s*what\s+.+\s+(?:is|does)\s+and\s+why\s+(?:it|they)\s+matters?\s*$/i,
  /^\s*[\p{L}\p{M}]{8,}\s+(?:is|does)\s+and\s+why\s+(?:it|they)\s+matters?\s*$/iu,
  /^\s*the specific case study or research angle requested in the prompt:\s*/i,
  /^\s*why the specific incident, case study, or research angle connected to\b/i,
  /^\s*what the case study reveals about behavior, systems, or real-world consequences\b/i,
  /\bat least one practical exercise for the audience to complete\b/i,
];

const stripLeadingContractClause = (value: string): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  const clauses = trimmed
    .split(/,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (
    clauses.length >= 2 &&
    CONTRACT_LEAD_IN_PATTERNS.some((pattern) => pattern.test(clauses[0]!))
  ) {
    return clauses.slice(1).join(", ").trim();
  }

  return trimmed;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const repairQuestionSubjectEcho = (value: string, topic: string): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const topicText = topic.replace(/\s+/g, " ").trim();
  const topicWithoutLeadingQuestion = topicText
    .replace(/^(?:how|why|what|which|where|who)\s+/i, "")
    .trim();

  if (!trimmed || !topicText || !topicWithoutLeadingQuestion) {
    return trimmed;
  }

  if (new RegExp(`^${escapeRegExp(topicText)}\\s+is$`, "i").test(trimmed)) {
    return topicText;
  }

  if (
    /^(?:how|why|what|which|where|who)\s+/i.test(topicText) &&
    new RegExp(`^${escapeRegExp(topicWithoutLeadingQuestion)}$`, "i").test(
      trimmed,
    )
  ) {
    return topicText;
  }

  if (
    new RegExp(
      `^${escapeRegExp(topicWithoutLeadingQuestion)}\\s+is$`,
      "i",
    ).test(trimmed)
  ) {
    return topicText;
  }

  return trimmed;
};

export const sanitizeContractText = (value: string, topic: string): string => {
  const normalized = stripLeadingContractClause(
    decodeHtmlEntities(value)
    .replace(
      /^\s*the specific case study or research angle requested in the prompt:\s*/i,
      "",
    )
    .replace(/^\s*(?:selected source roles|source roles|grounding summary)\s*:.*$/i, "")
    .replace(/^\s*curated grounding highlights\s*:\s*/i, "")
    .replace(/^\s*research coverage goals\s*:\s*/i, "")
    .replace(
      /^\s*the main systems, parts, or focus areas that define\b.*$/i,
      "Core systems and focus areas",
    )
    .replace(
      /^\s*the main services, products, or focus areas connected to\b.*$/i,
      "Core systems and focus areas",
    )
    .replace(
      /^\s*the main services, capabilities, or focus areas connected to\b.*$/i,
      "Core systems and focus areas",
    )
    .replace(
      /^\s*a concrete example, consequence, or real-world application of\b.*$/i,
      "Real-world applications",
    )
    .replace(/^\s*application in\b.*$/i, "Real-world applications")
    .replace(/^\s*the most important lessons about\b.*$/i, "Key takeaways")
    .replace(/^\s*(?:concrete example|structure|mental model|process view|analysis)\s*:\s*/i, "")
    .replace(/^\s*motivation\s*:\s*/i, "")
    .replace(/^\s*(?:the\s+)?role of\s+/i, "")
    .replace(/\bthis part of\s+[^\s].*?\s+focuses on\b/gi, " ")
    .replace(/\bthis part of\b/gi, " ")
    .replace(/\bthis session\b/gi, " ")
    .replace(/\bthe practical takeaway is\b/gi, " ")
    .replace(/\b(?:the\s+)?audience should remember(?:\s+about\b[^.?!]*)?/gi, " ")
    .replace(/\bthe broader story of\b/gi, " ")
    .replace(/\bhow it connects to\b/gi, " ")
    .replace(/\bshould be explained with a clear connection back to\b.*$/gi, " ")
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(
      /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi,
      topic,
    )
    .replace(
      /^\s*(?:understand|grasp|appreciate|recognize|explain|describe|show|teach|define|identify|outline|summarize|review|explore|analy[sz]e|examine|discuss|detail|deconstruct|compare|trace)\s+/i,
      "",
    )
    .replace(/^\s*(?:what|which|how|why|where|who)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim(),
  )
    .replace(/(?:,?\s*(?:and|or))$/i, "")
    .replace(/\b(?:a|an|as|at|before|after|by|for|from|in|of|on|that|the|to|which|who|with)\s*$/i, "")
    .replace(/['’]+$/g, "")
    .replace(/[.,;:!?]+$/g, "");

  return repairQuestionSubjectEcho(normalized, topic) || topic;
};

export const looksMalformedCandidatePoint = (value: string): boolean => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return true;
  }

  return (
    trimmed.length > 280 ||
    NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    /,\s*:/.test(trimmed) ||
    /\bbackground in shaping\.?$/i.test(trimmed) ||
    /\bmatters because it shows what\b/i.test(trimmed) ||
    /\bmatters because it changes how\b/i.test(trimmed) ||
    /\boffers matters\b/i.test(trimmed) ||
    /\boffers through\b/i.test(trimmed) ||
    /\breal-world applications is one concrete way\b/i.test(trimmed) ||
    /\bevidence-backed practical consequence\b/i.test(trimmed) ||
    /\bselected source roles\b/i.test(trimmed) ||
    /\bcurated grounding highlights\b/i.test(trimmed) ||
    /\bresearch coverage goals\b/i.test(trimmed) ||
    /\bgrounding summary\b/i.test(trimmed) ||
    /\borganization this onboarding overview introduces\b/i.test(trimmed) ||
    /\borganization at the center of this overview\b/i.test(trimmed) ||
    /\bwhat kind of organization it is\b/i.test(trimmed) ||
    /\bframes? the concrete case\b/i.test(trimmed) ||
    /\bconcrete case within\b/i.test(trimmed) ||
    /\b(?:later|following) details matter\b/i.test(trimmed) ||
    /\b(?:specific examples|later details) that follow\b/i.test(trimmed) ||
    /\bmain context for the specific examples\b/i.test(trimmed) ||
    /\bsetting for the concrete case\b/i.test(trimmed) ||
    /\bspecific event, mechanism, or fact\b/i.test(trimmed) ||
    /\bstrongest supported lesson\b/i.test(trimmed) ||
    /\bconsequence beyond the first event or fact\b/i.test(trimmed) ||
    /\bstarts with identity, origin\b/i.test(trimmed) ||
    /\bbecomes easier to (?:understand|place|evaluate|recognize)\b/i.test(trimmed) ||
    /\bday-to-day operating methods that can be described concretely\b/i.test(trimmed) ||
    /\boperating details make\b/i.test(trimmed) ||
    /\bconcrete capabilities make\b/i.test(trimmed) ||
    /^the core services offered\b/i.test(trimmed) ||
    /\boffers concrete capabilities\b/i.test(trimmed) ||
    /\bwhich capabilities define it\b/i.test(trimmed) ||
    /\bconcrete capabilities, services, or responsibilities\b/i.test(trimmed) ||
    /\bone specific consequence makes\b/i.test(trimmed) ||
    /\beasier to recognize when\b/i.test(trimmed) ||
    /\beasier to evaluate when\b/i.test(trimmed) ||
    /\bis explained through a source-backed arc\b/i.test(trimmed) ||
    /\bin daily work in daily work\b/i.test(trimmed) ||
    /\bthe core inputs establish\b/i.test(trimmed) ||
    /\bpreparation order changes texture\b/i.test(trimmed) ||
    /\bthe ingredients, preparation sequence, and finishing cues\b/i.test(trimmed) ||
    /\bthe inputs that shape flavor\b/i.test(trimmed) ||
    /\b(?:where|that|which|who|when)\s+[\p{L}\p{M}-]+\.?$/iu.test(trimmed) ||
    /\b(?:terawatts?|nuclear power plants?|human civilization'?s? power consumption)\b/i.test(trimmed) ||
    /\bthe preparation steps change texture\b/i.test(trimmed) ||
    /\bthe cues that show whether\b/i.test(trimmed) ||
    /^\W*ensuring\b/i.test(trimmed) ||
    /\bfinished result shows whether\b/i.test(trimmed) ||
    /\bclear material choices\b/i.test(trimmed) ||
    /\bvisible target result\b/i.test(trimmed) ||
    /\bwork becomes easier to control\b/i.test(trimmed) ||
    /\bvisible or sensory checks\b/i.test(trimmed) ||
    /\bliquid ingredients\b/i.test(trimmed) ||
    /\bdistribute (?:the )?flavo[u]?rs evenly\b/i.test(trimmed) ||
    /\bmore complex settings\b/i.test(trimmed) ||
    /\bUsing [^.]+ works in practice\b/.test(trimmed) ||
    /\bshapes how Using [^.]+ works\b/.test(trimmed) ||
    /\bhow [^.]+ can use AI tools? in (?:their )?daily work\b/i.test(trimmed) ||
    /\bAI tools?\s+in\s+daily work\s+for\b/i.test(trimmed) ||
    /\b(?:specific|practical)\s+use cases?\s+for\s+AI tools?\b/i.test(trimmed) ||
    /\bapply\s+AI tools?\s+to\s+a\s+specific work task\b/i.test(trimmed) ||
    /\bpolitically governed public sector environment\b/i.test(trimmed) ||
    /\bteams?\s+keep\s+AI-assisted work tied\b/i.test(trimmed) ||
    /^\s*participants\s+(?:draft|map|review|select|choose|write|create|use)\b/i.test(trimmed) ||
    /^it is crucial to emphasize\b/i.test(trimmed) ||
    /^\s*structure\s*:/i.test(trimmed) ||
    /^practical exercise:\s*use\b/i.test(trimmed) ||
    /\bit helps\s*:/i.test(trimmed) ||
    /\be\.g\.?$/i.test(trimmed) ||
    /^recognize the importance of\b/i.test(trimmed) ||
    /^\[/.test(trimmed) ||
    /\\"/.test(trimmed) ||
    /^evidence-backed outcome, example, or consequence\b/i.test(trimmed) ||
    /^\s*explanation of\b/i.test(trimmed) ||
    /\bin\s+(?:their|your|the|our)\s+(?:daily|public|regional|digital|internal|external)\.?$/i.test(trimmed) ||
    /\binto\s+(?:daily|public|regional|digital|internal|external)\.?$/i.test(trimmed) ||
    /\b(?:in|on|at|for|to|from|through|with|by)\.?$/i.test(trimmed)
  );
};

export const looksDanglingSlidePhrase = (value: string): boolean =>
  /,\s*$/.test(value.trim()) ||
  /\b(?:a|an|and|as|at|before|after|by|for|from|in|of|on|or|that|the|to|which|who|with)\s*$/i.test(
    value.trim(),
  );

export const canUseAsSlidePoint = (
  input: Pick<GenerateDeckInput, "intent">,
  value: string | undefined,
): value is string => {
  if (!value) {
    return false;
  }

  const sentence = toAudienceFacingSentence(value);
  return (
    !looksFragmentarySlidePoint(value) &&
    !looksMalformedCandidatePoint(sentence) &&
    !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(sentence)) &&
    !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(sentence)) &&
    !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(sentence)) &&
    !getActiveInstructionalPatterns(input).some((pattern) => pattern.test(sentence))
  );
};

export const canUseAsSlideExample = (
  input: Pick<GenerateDeckInput, "intent">,
  value: string | undefined,
): value is string => {
  if (!value) {
    return false;
  }

  const sentence = toAudienceFacingSentence(value);
  return (
    sentence.length <= 260 &&
    !looksFragmentarySlidePoint(sentence) &&
    !looksMalformedCandidatePoint(sentence) &&
    !looksDanglingSlidePhrase(sentence) &&
    !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(sentence)) &&
    !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(sentence)) &&
    !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(sentence))
  );
};

export const compactGroundingHighlight = (value: string, topic: string): string => {
  const normalized = sanitizeContractText(value, topic)
    .replace(/^whether you need help with\b/i, "Flexible QA services cover")
    .replace(/\bregardless of what industry you.?re in\b/gi, "across industries")
    .replace(/^as [^,]+,\s*we\b/i, "We")
    .replace(/^our\b/i, "The team's")
    .replace(/^we\b/i, "The team")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 160 && !looksDanglingSlidePhrase(normalized)) {
    return normalized;
  }

  const clauses = normalized
    .split(/(?<=[.!?])\s+|,\s+|;\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24 && part.length <= 160 && !looksDanglingSlidePhrase(part));

  return clauses[0] ?? normalized.slice(0, 160).replace(/\s+\S*$/, "").trim();
};

const MONTH_DAY_YEAR_PATTERN =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;

const ENGLISH_REQUEST_WORD_PATTERN =
  /\b(?:about|and|create|daily|explain|for|how|in|leads|managers|presentation|product|project|test|using|what|with|work|workshop)\b/gi;

const SWEDISH_SOURCE_WORD_PATTERN =
  /\b(?:att|de|den|det|eller|från|för|genom|handlingar|har|inom|kan|med|och|protokoll|ska|som|styrs|till|utan|är)\b/giu;

const countPatternMatches = (value: string, pattern: RegExp): number =>
  decodeHtmlEntities(value).match(pattern)?.length ?? 0;

const textLooksLikeEnglishRequest = (value: string): boolean =>
  countPatternMatches(value, ENGLISH_REQUEST_WORD_PATTERN) >= 2;

const textLooksLikeUntranslatedSwedishPhrase = (value: string): boolean => {
  const normalized = decodeHtmlEntities(value);
  const swedishWordCount = countPatternMatches(normalized, SWEDISH_SOURCE_WORD_PATTERN);

  return (
    tokenizeDeckShapeText(normalized).length >= 4 &&
    (swedishWordCount >= 2 || (swedishWordCount >= 1 && /[åäö]/i.test(normalized)))
  );
};

export const compactSourceBackedAnchor = (value: string, topic: string): string => {
  const normalized = sanitizeContractText(value, topic);
  if (!normalized) {
    return topic;
  }

  if (
    textLooksLikeEnglishRequest(topic) &&
    textLooksLikeUntranslatedSwedishPhrase(normalized)
  ) {
    return topic;
  }

  const date = normalized.match(MONTH_DAY_YEAR_PATTERN)?.[0];
  const quotedTitle = normalized.match(/['"“”]([^'"“”]{2,60})['"“”]/)?.[1]?.trim();
  const eventLabel = (() => {
    if (/\bsneak peek\b/i.test(normalized)) {
      return "sneak peek airing";
    }
    if (/\bofficial(?:ly)?\s+premier/i.test(normalized)) {
      return "official premiere";
    }
    if (/\bpremier(?:e|ed|es|ing)\b/i.test(normalized)) {
      return "premiere";
    }
    if (/\b(?:aired|broadcast)\b/i.test(normalized)) {
      return "broadcast";
    }
    if (/\breleas(?:e|ed)\b/i.test(normalized)) {
      return "release";
    }
    return "";
  })();

  if (quotedTitle && date && eventLabel) {
    return shortenTitlePhrase(`${quotedTitle}: ${date} ${eventLabel}`, 72);
  }

  if (date && eventLabel) {
    return shortenTitlePhrase(`${date} ${eventLabel}`, 72);
  }

  if (quotedTitle && eventLabel) {
    return shortenTitlePhrase(`${quotedTitle}: ${eventLabel}`, 72);
  }

  return shortenTitlePhrase(normalized, 72);
};

export const sourceBackedFocusEqualsSubject = (
  focus: string,
  compactFocus: string,
  subject: string,
): boolean =>
  normalizeComparableText(focus) === normalizeComparableText(subject) ||
  normalizeComparableText(compactFocus) === normalizeComparableText(subject);

const splitContractCandidateClauses = (value: string): string[] =>
  value
    .split(/[:;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const compressContractCandidate = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  candidate: string,
): string => {
  const subject = resolveIntentSubject(input);
  const normalized = sanitizeContractText(candidate, subject);
  if (!normalized) {
    return subject;
  }

  if (normalized.length <= 84) {
    return normalized;
  }

  const anchors = uniqueNonEmptyStrings([
    subject,
    resolveIntentFocusAnchor(input) ?? "",
    ...(input.intent?.coverageRequirements ?? []),
  ]);
  const clauses = splitContractCandidateClauses(normalized);
  const anchoredClause = clauses.find((clause) =>
    anchors.some((anchor) => hasMeaningfulAnchorOverlap(clause, anchor)),
  );

  if (anchoredClause && anchoredClause.length <= 84) {
    return anchoredClause;
  }

  if (hasMeaningfulAnchorOverlap(normalized, subject)) {
    const subjectTokens = new Set(tokenizeDeckShapeText(subject));
    const candidateTokens = [...new Set(tokenizeDeckShapeText(normalized))];
    const novelTokenCount = candidateTokens.filter((token) => !subjectTokens.has(token)).length;

    if (novelTokenCount >= 2) {
      return shortenTitlePhrase(normalized, 84);
    }

    return subject;
  }

  return shortenTitlePhrase(normalized, 84);
};

export const pickContractText = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  candidates: Array<string | undefined>,
  options?: {
    preferConcrete?: boolean | undefined;
  },
): string => {
  const subject = resolveIntentSubject(input);
  const sanitized = uniqueNonEmptyStrings(
    candidates
      .map((candidate) =>
        typeof candidate === "string" ? compressContractCandidate(input, candidate) : "",
      )
      .filter(
        (candidate) =>
          candidate.length > 0 &&
          !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(candidate)) &&
          !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(candidate)),
      ),
  );

  if (sanitized.length === 0) {
    return subject;
  }

  if (options?.preferConcrete) {
    const concrete = sanitized.find(
      (candidate) =>
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(candidate)) &&
        !CONTRACT_LEAD_IN_PATTERNS.some((pattern) => pattern.test(candidate)),
    );
    if (concrete) {
      return concrete;
    }
  }

  return sanitized[0]!;
};

export const shouldLeadWithGroundingHighlight = (
  subject: string,
  highlight: string | undefined,
  anchors: Array<string | undefined>,
): boolean => {
  if (!highlight) {
    return false;
  }

  const anchorContext = uniqueNonEmptyStrings([
    subject,
    ...anchors.filter((anchor): anchor is string => Boolean(anchor)),
  ]).join(" ");
  return (
    hasMeaningfulAnchorOverlap(highlight, anchorContext) ||
    countAnchorOverlap(highlight, anchorContext) >= 2
  );
};

export const isOrientationCoverageAnchor = (topic: string, value: string): boolean => {
  const normalized = sanitizeContractText(value, topic).toLowerCase();
  const normalizedComparable = normalizeComparableText(normalized);
  const compactNormalizedComparable = normalizedComparable.replace(/\s+/g, "");
  const openingAnchors = [
    `What ${topic} is and why it matters`,
    `What ${topic} does and why it matters`,
    `${topic} is and why it matters`,
    `${topic} does and why it matters`,
  ].map((anchor) =>
    normalizeComparableText(sanitizeContractText(anchor, topic)),
  );
  const compactOpeningAnchors = openingAnchors.map((anchor) =>
    anchor.replace(/\s+/g, ""),
  );

  return (
    openingAnchors.includes(normalizedComparable) ||
    compactOpeningAnchors.includes(compactNormalizedComparable) ||
    /^what\b.+\b(?:is|does)\b.+\bwhy\b.+\bmatters?\b/i.test(normalized)
  );
};

export const isGenericOpeningFocus = (subject: string, value: string): boolean => {
  const normalized = sanitizeContractText(value, subject);
  if (!normalized) {
    return true;
  }

  return (
    isOrientationCoverageAnchor(subject, normalized) ||
    DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    /^why\b.+\bmatters?\b/i.test(normalized)
  );
};

export const resolveSourceBackedCaseAnchor = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
): string | undefined => {
  const explicitFocusAnchor = resolveIntentFocusAnchor(input);
  if (explicitFocusAnchor) {
    return explicitFocusAnchor;
  }

  if (deriveSlideArcPolicy(input) !== "source-backed-subject") {
    return undefined;
  }

  const subject = resolveIntentSubject(input);
  const subjectTokens = new Set(tokenizeDeckShapeText(subject));
  const explicitCoverageRequirements =
    input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? "");
  const caseAnchorHints = uniqueNonEmptyStrings([
    ...explicitCoverageRequirements,
    ...(input.groundingCoverageGoals ?? []),
    input.presentationBrief ?? "",
    subject,
  ]);
  const hasSpecificCaseHint =
    subjectTokens.size >= 5 ||
    /\p{N}/u.test(subject) ||
    caseAnchorHints.some(
      (value) =>
        /\p{N}/u.test(value) ||
        /["'“”]/.test(value) ||
        /\b(?:case|incident|event|episode|premiere|outbreak|plague|study|model|specific|first|launch|research angle)\b/i.test(
          value,
        ),
    );

  if (!hasSpecificCaseHint) {
    return undefined;
  }

  const contextAnchor = uniqueNonEmptyStrings([
    subject,
    ...(input.groundingCoverageGoals ?? []),
  ]).join(" ");
  const candidates = [
    ...explicitCoverageRequirements
      .map((value) => ({
        source: "coverageRequirement" as const,
        text: sanitizeContractText(value, subject),
      })),
    ...(input.groundingCoverageGoals ?? []).map((value) => ({
      source: "coverageGoal" as const,
      text: sanitizeContractText(value, subject),
    })),
    ...(input.groundingHighlights ?? []).map((value) => ({
      source: "groundingHighlight" as const,
      text: compactGroundingHighlight(value, subject),
    })),
  ].filter((candidate) => candidate.text.length > 0);

  const ranked = uniqueNonEmptyStrings(candidates.map((candidate) => candidate.text))
    .map((candidate) => {
      const source =
        candidates.find((entry) => normalizeComparableText(entry.text) === normalizeComparableText(candidate))
          ?.source ?? "coverageGoal";
      const candidateTokens = [...new Set(tokenizeDeckShapeText(candidate))];
      const novelTokenCount = candidateTokens.filter((token) => !subjectTokens.has(token)).length;
      const overlapScore = countAnchorOverlap(candidate, contextAnchor);
      const meaningfulOverlap = hasMeaningfulAnchorOverlap(candidate, contextAnchor) ? 3 : 0;
      const summaryPenalty = isGenericOpeningFocus(subject, candidate) ? -4 : 0;
      const specificityScore = Math.min(4, candidateTokens.length);
      const sourceBonus =
        source === "groundingHighlight" ? 4 : source === "coverageRequirement" ? 3 : 1;
      return {
        candidate,
        source,
        score:
          sourceBonus +
          overlapScore * 2 +
          meaningfulOverlap +
          novelTokenCount * 2 +
          specificityScore +
          (/\p{N}/u.test(candidate) ? 1 : 0) +
          summaryPenalty,
      };
    })
    .sort((left, right) => {
      const sourceRank = (source: "coverageRequirement" | "coverageGoal" | "groundingHighlight") =>
        source === "coverageRequirement" ? 0 : source === "groundingHighlight" ? 1 : 2;
      if (sourceRank(left.source) !== sourceRank(right.source)) {
        return sourceRank(left.source) - sourceRank(right.source);
      }
      return right.score - left.score;
    });

  const selected = ranked[0]?.candidate;
  return selected ? compressContractCandidate(input, selected) : undefined;
};
