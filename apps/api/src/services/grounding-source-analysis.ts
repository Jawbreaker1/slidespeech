import type {
  GroundingClassificationResult,
  GroundingFinding,
} from "@slidespeech/types";
import {
  decodeHtmlEntities,
  looksOverlyPromotionalSourceCopy,
} from "@slidespeech/providers";

export const uniqueNonEmptyStrings = (
  values: Array<string | null | undefined>,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value
      ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim()
      : "";
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

export const normalizeGroundingText = (value: string): string =>
  decodeHtmlEntities(value).replace(/\s+/g, " ").trim();

const ABBREVIATION_PERIOD_PLACEHOLDER = "<slidespeech-period>";

const splitGroundingSentences = (value: string): string[] =>
  value
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\./g, `$1${ABBREVIATION_PERIOD_PLACEHOLDER}`)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence.replaceAll(ABBREVIATION_PERIOD_PLACEHOLDER, "."),
    );

const INTERNAL_GROUNDING_SCAFFOLD_PATTERN =
  /\b(?:external research summary|no external findings were fetched|supporting same-domain source grounding|search research(?:\s+\d+)?|search result snippet|failed to fetch source content)\b/i;
const SCRAPED_RELATED_TITLE_RUN_PATTERN =
  /^(?:\p{Lu}[\p{L}\p{M}'’:-]*[\s,]+){5,}(?:also known|is|are|was|were)\b/iu;
const GROUNDING_PREDICATE_PATTERN =
  /\b(?:is|are|was|were|has|have|had|uses?|used|works?|worked|operates?|operated|offers?|offered|provides?|provided|supports?|supported|helps?|helped|includes?|included|contains?|contained|follows?|followed|established|founded|created|developed|built|made|launched|released|published|started|delivers?|delivered|identif(?:y|ies|ied)|validates?|validated|connects?|connected|reduces?|reduced|improves?|improved|är|var|har|använder|arbetar|verkar|erbjuder|stödjer|hjälper|innehåller|omfattar|grundades|skapade|utvecklade|byggde|levererar|identifierar|validerar|minskar|förbättrar)\b/iu;
const DATED_EVENT_PATTERN =
  /\b(?:published|released|founded|launched|created|opened|started|established|submitted|updated|publicerades|släpptes|grundades|lanserades|skapades|startades|etablerades|uppdaterades)\b/iu;
const SOURCE_ARTIFACT_NOISE_PATTERN =
  /(?:\[\s*\d+\s*\]|\[update\]|\blast edited\b|\bretrieved from\b|\bcreative commons\b|\bwikipedia\b)/iu;
const LOW_VALUE_SOURCE_METADATA_PATTERN =
  /\b(?:production code|catalog(?:ue)? number|internal id|identifier|page id|isbn|asin)\b/iu;

export const looksLikeUsefulGroundingStatement = (value: string): boolean => {
  const normalized = normalizeGroundingText(value);

  if (!looksLikeAtomicGroundingClaim(normalized)) {
    return false;
  }

  if (
    INTERNAL_GROUNDING_SCAFFOLD_PATTERN.test(normalized) ||
    SOURCE_ARTIFACT_NOISE_PATTERN.test(normalized) ||
    LOW_VALUE_SOURCE_METADATA_PATTERN.test(normalized) ||
    SCRAPED_RELATED_TITLE_RUN_PATTERN.test(normalized) ||
    looksOverlyPromotionalSourceCopy(normalized)
  ) {
    return false;
  }

  return (
    GROUNDING_PREDICATE_PATTERN.test(normalized) ||
    (/\b\d{4}\b/.test(normalized) && DATED_EVENT_PATTERN.test(normalized))
  );
};

export const looksLikeAtomicGroundingClaim = (value: string): boolean => {
  const normalized = normalizeGroundingText(value);

  if (normalized.length < 18 || normalized.length > 320) {
    return false;
  }

  if (
    normalized.startsWith("-") ||
    normalized.startsWith("*") ||
    normalized.startsWith("•")
  ) {
    return false;
  }

  if (
    normalized.includes(" - ") ||
    normalized.includes(" • ") ||
    normalized.includes(" * ") ||
    normalized.includes("...") ||
    normalized.includes("…") ||
    [",", ";", ":"].some((suffix) => normalized.endsWith(suffix))
  ) {
    return false;
  }

  return (
    !INTERNAL_GROUNDING_SCAFFOLD_PATTERN.test(normalized) &&
    !LOW_VALUE_SOURCE_METADATA_PATTERN.test(normalized) &&
    !looksOverlyPromotionalSourceCopy(normalized)
  );
};

export const normalizeSourceUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.hostname.replace(/^www\./i, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.replace(/\s+/g, " ").trim();
  }
};

export const uniqueSourceUrls = (
  values: Array<string | null | undefined>,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalizeSourceUrl(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const tokenizeForGrounding = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const SOURCE_SUPPORT_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "before",
  "but",
  "can",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "that",
  "the",
  "their",
  "this",
  "through",
  "with",
  "what",
  "where",
  "which",
  "why",
  "your",
]);

const sourceSupportTokens = (value: string): string[] =>
  [
    ...new Set(
      tokenizeForGrounding(value).filter(
        (token) => !SOURCE_SUPPORT_STOPWORDS.has(token),
      ),
    ),
  ];

const SUBJECT_RELEVANCE_STOPWORDS = new Set([
  ...SOURCE_SUPPORT_STOPWORDS,
  "brand",
  "brands",
  "overview",
  "strategy",
  "strategies",
  "impact",
  "lesson",
  "lessons",
]);

const subjectRelevanceTokens = (subject: string): string[] =>
  sourceSupportTokens(subject).filter(
    (token) => token.length >= 4 && !SUBJECT_RELEVANCE_STOPWORDS.has(token),
  );

const CLAIM_FOCUS_STOPWORDS = new Set([
  ...SUBJECT_RELEVANCE_STOPWORDS,
  "background",
  "brief",
  "confirm",
  "context",
  "date",
  "detail",
  "details",
  "direct",
  "evidence",
  "exact",
  "identify",
  "overview",
  "presentation",
  "production",
  "release",
  "released",
  "role",
  "roles",
  "sequence",
  "specific",
  "using",
  "verify",
]);

const distinctiveFocusTokens = (value: string): string[] =>
  sourceSupportTokens(value).filter(
    (token) =>
      token.length >= 4 &&
      !/^\d+$/u.test(token) &&
      !CLAIM_FOCUS_STOPWORDS.has(token),
  );

const tokenOverlap = (tokens: string[], text: string): number => {
  const haystack = text.toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length;
};

const tokensHaveFocusedOverlap = (
  tokens: string[],
  text: string,
  options: { allowSingleDistinctive?: boolean } = {},
): boolean => {
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) {
    return false;
  }

  const overlap = tokenOverlap(uniqueTokens, text);
  if (overlap >= Math.min(2, uniqueTokens.length)) {
    return true;
  }

  return Boolean(
    options.allowSingleDistinctive &&
      overlap >= 1 &&
      uniqueTokens.some((token) => token.length >= 5 && text.toLowerCase().includes(token)),
  );
};

const findingMatchesSubject = (
  subjectTokens: string[],
  finding: GroundingFinding,
): boolean => {
  if (subjectTokens.length === 0) {
    return true;
  }

  const haystack = `${finding.url} ${finding.title} ${finding.content}`.toLowerCase();
  return subjectTokens.some((token) => haystack.includes(token));
};

const findingSupportsText = (value: string, finding: GroundingFinding): boolean => {
  const tokens = sourceSupportTokens(value);
  if (tokens.length === 0) {
    return false;
  }

  const haystack = `${finding.title} ${finding.content}`.toLowerCase();
  const overlap = tokens.filter((token) => haystack.includes(token)).length;
  const requiredOverlap = tokens.length <= 2
    ? tokens.length
    : Math.min(4, Math.max(2, Math.ceil(tokens.length * 0.45)));

  return overlap >= requiredOverlap;
};

const coverageGoalLooksGeneric = (value: string): boolean =>
  /^what .+ (?:is|does|offers?)\b/i.test(value) ||
  /\b(?:how .+ works in practice|identity or definition details)\b/i.test(value);

const findingMatchesCoverageGoals = (
  coverageGoals: string[],
  finding: GroundingFinding,
): boolean =>
  coverageGoals.filter((goal) => !coverageGoalLooksGeneric(goal)).some((goal) => {
    const goalTokens = subjectRelevanceTokens(goal);
    return (
      findingSupportsText(goal, finding) ||
      (goalTokens.length > 0 && findingMatchesSubject(goalTokens, finding))
    );
  });

export const selectGroundingFindings = (input: {
  subject: string;
  coverageGoals: string[];
  findings: GroundingFinding[];
  classification?: GroundingClassificationResult | null;
}): GroundingFinding[] => {
  const findingByUrl = new Map(
    input.findings.map((finding) => [normalizeSourceUrl(finding.url), finding]),
  );
  const classificationSourceUrls = uniqueSourceUrls([
    ...(input.classification?.relevantSourceUrls ?? []),
    ...(input.classification?.sourceAssessments
      ?.filter(
        (assessment) =>
          assessment.role !== "junk" && assessment.relevance !== "junk",
      )
      .map((assessment) => assessment.url) ?? []),
    ...(input.classification?.facts?.flatMap((fact) => fact.sourceIds) ?? []),
  ]);
  const subjectTokens = subjectRelevanceTokens(input.subject);

  const selected = [
    ...input.findings.filter((finding) => findingMatchesSubject(subjectTokens, finding)),
    ...input.findings.filter((finding) =>
      findingMatchesCoverageGoals(input.coverageGoals, finding),
    ),
    ...classificationSourceUrls
      .map((url) => findingByUrl.get(normalizeSourceUrl(url)))
      .filter(
        (finding): finding is GroundingFinding => {
          if (!finding) {
            return false;
          }

          return (
            findingMatchesSubject(subjectTokens, finding) ||
            findingMatchesCoverageGoals(input.coverageGoals, finding)
          );
        },
      ),
  ];
  const seen = new Set<string>();
  const result: GroundingFinding[] = [];

  for (const finding of selected) {
    const key = normalizeSourceUrl(finding.url);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(finding);
  }

  return result;
};

const sourceIdMatchesFinding = (sourceId: string, finding: GroundingFinding): boolean =>
  normalizeSourceUrl(sourceId) === normalizeSourceUrl(finding.url);

const sourceTitleAnchorTokens = (
  sourceIds: string[],
  findings: GroundingFinding[],
): string[][] =>
  sourceIds
    .flatMap((sourceId) =>
      findings.filter((finding) => sourceIdMatchesFinding(sourceId, finding)),
    )
    .map((finding) => distinctiveFocusTokens(finding.title))
    .filter((tokens) => tokens.length >= 2);

const coverageGoalSpecificTokens = (coverageGoal: string, subject: string): string[] => {
  const subjectTokens = new Set(distinctiveFocusTokens(subject));
  return distinctiveFocusTokens(coverageGoal).filter(
    (token) => !subjectTokens.has(token),
  );
};

export const claimHasGroundingFocusSupport = (input: {
  subject: string;
  coverageGoals: string[];
  claim: string;
  evidence: string;
  findings: GroundingFinding[];
  sourceIds: string[];
}): boolean => {
  const text = `${input.claim} ${input.evidence}`;
  const subjectTokens = distinctiveFocusTokens(input.subject);

  if (tokensHaveFocusedOverlap(subjectTokens, text, { allowSingleDistinctive: true })) {
    return true;
  }

  if (
    input.coverageGoals.some((goal) => {
      const tokens = coverageGoalSpecificTokens(goal, input.subject);
      return tokensHaveFocusedOverlap(tokens, text, { allowSingleDistinctive: true });
    })
  ) {
    return true;
  }

  return sourceTitleAnchorTokens(input.sourceIds, input.findings).some((tokens) =>
    tokensHaveFocusedOverlap(tokens, text),
  );
};

export const textHasSourceSupport = (
  value: string,
  findings: GroundingFinding[],
  sourceIds?: string[],
): boolean => {
  const scopedFindings = sourceIds?.length
    ? findings.filter((finding) =>
        sourceIds.some((sourceId) => sourceIdMatchesFinding(sourceId, finding)),
      )
    : findings;
  const candidates = scopedFindings.length > 0 ? scopedFindings : findings;

  return candidates.some((finding) => findingSupportsText(value, finding));
};

const coverageGoalLooksInstructional = (value: string): boolean =>
  /\b(?:explicitly provided sources?|primary grounding|source urls?)\b/i.test(value);

export const keepGroundingCoverageGoal = (
  value: string,
  subject: string,
  findings: GroundingFinding[],
): boolean => {
  if (coverageGoalLooksInstructional(value)) {
    return false;
  }

  if (coverageGoalLooksGeneric(value)) {
    return true;
  }

  return textHasSourceSupport(`${subject} ${value}`, findings);
};

export const deriveGroundingExcerpts = (input: {
  subject: string;
  coverageGoals: string[];
  findings: GroundingFinding[];
}): string[] => {
  const anchors = uniqueNonEmptyStrings([input.subject, ...input.coverageGoals]).join(" ");
  const anchorTokens = tokenizeForGrounding(anchors);

  const candidates = input.findings
    .flatMap((finding) =>
      splitGroundingSentences(finding.content)
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length >= 40 && value.length <= 260)
        .map((value, index) => ({
          value,
          index,
          score:
            anchorTokens.filter((token) => value.toLowerCase().includes(token)).length * 2 +
            (GROUNDING_PREDICATE_PATTERN.test(value) ? 2 : 0) +
            (/\b\d{2,4}\b/.test(value) ? 2 : 0) +
            (/[,:;]/.test(value) ? 1 : 0),
        })),
    )
    .filter((candidate) => looksLikeUsefulGroundingStatement(candidate.value))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.value);

  return uniqueNonEmptyStrings(candidates).slice(0, 8);
};
