type ResearchFinding = {
  title: string;
  url: string;
  content: string;
};

const BRIEF_WRAPPER_PATTERNS = [
  /^(?:create|build|generate|write|prepare)\s+/i,
  /^(?:(?:a|an|the)\s+)?(?:(?:short|brief|quick)\s+)?(?:presentation|overview|deck|talk|session|slides?)\s+(?:about|on|regarding)\s+/i,
  /^(?:about|on|regarding)\s+/i,
];

const BRIEF_NOISE_PATTERNS = [
  /\buse google\b.*$/gi,
  /\bmore information is available at\b.*$/gi,
];

const NAVIGATION_NOISE_PATTERN =
  /\b(home|contact|career|careers|about us|privacy|newsletter|knowledge hub|customer case|open positions|follow us)\b/i;

const PROMOTIONAL_NOISE_PATTERN =
  /\b(subscribe now|learn more|buy now|free trial|6-month subscription offer|blaze through|limited[- ]time|pre[- ]purchase|upgrade now|by purchasing|purchase(?:d|s|ing)?|starter edition|charity|donation|bundle)\b/i;
const SCRAPED_RELATED_TITLE_RUN_PATTERN =
  /^(?:\p{Lu}[\p{L}\p{M}'’:-]*[\s,]+){5,}(?:also known|is|are|was|were)\b/iu;

const DISCUSSION_SOURCE_PATTERN =
  /\b(forum|forums|community|discussion|thread)\b/i;

const INFORMATIVE_VERB_PATTERN =
  /\b(is|are|helps?|support(?:s)?|combine(?:s)?|deliver(?:s)?|provide(?:s)?|improve(?:s)?|reduce(?:s)?|boost(?:s)?|keep(?:s)?|open(?:s)?|extend(?:s)?|operate(?:s)?|offer(?:s)?|enable(?:s)?|focus(?:es)?|drive(?:s)?)\b/i;

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
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

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const overlapCount = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenize(left))];
  const rightTokens = new Set(tokenize(right));
  return leftTokens.filter((token) => rightTokens.has(token)).length;
};

export const compactPresentationBrief = (
  brief: string | undefined,
  subject: string,
): string | undefined => {
  if (!brief?.trim()) {
    return undefined;
  }

  const genericEntityPattern =
    /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi;

  const normalizedOriginal = brief.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");
  let compacted = normalizedOriginal.replace(genericEntityPattern, subject);
  for (const pattern of BRIEF_NOISE_PATTERNS) {
    compacted = compacted.replace(pattern, " ");
  }

  let stripped = compacted;
  for (const pattern of BRIEF_WRAPPER_PATTERNS) {
    stripped = stripped.replace(pattern, "");
  }

  compacted = stripped.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");

  if (compacted.length < 8) {
    return normalizedOriginal.length > 1 ? normalizedOriginal : undefined;
  }

  return compacted;
};

const normalizeFindingContent = (content: string): string =>
  content.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const trimNavigationPrefix = (content: string): string => {
  const normalized = normalizeFindingContent(content);
  const markers = [" We ", " Our ", " As ", " From ", " Whether ", " Wherever ", " The "];

  let bestIndex = normalized.length;
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index > 40 && index < bestIndex) {
      bestIndex = index;
    }
  }

  return bestIndex < normalized.length ? normalized.slice(bestIndex + 1).trim() : normalized;
};

const toSentenceCandidates = (content: string): string[] =>
  trimNavigationPrefix(content)
    .replace(/([a-z0-9])\s+([A-Z][a-z]+,?\s+we\b)/g, "$1. $2")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 220)
    .filter((sentence) => !NAVIGATION_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !PROMOTIONAL_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !SCRAPED_RELATED_TITLE_RUN_PATTERN.test(sentence));

const CURRENT_NEWS_SNIPPET_PATTERN =
  /\bthis week in\b|\bcatch up on all the latest\b|\blatest (?:news|updates?)\b/i;

const scoreSentence = (
  sentence: string,
  subject: string,
  coverageGoals: string[],
  freshnessSensitive: boolean,
): number => {
  let score = 0;

  if (INFORMATIVE_VERB_PATTERN.test(sentence)) {
    score += 3;
  }
  if (sentence.toLowerCase().includes(subject.toLowerCase())) {
    score += 2;
  }
  if (PROMOTIONAL_NOISE_PATTERN.test(sentence)) {
    score -= 4;
  }
  if (/\b\d+\b/.test(sentence)) {
    score += 1;
  }
  if (/[,:;]/.test(sentence)) {
    score += 1;
  }
  if (sentence.length > 170) {
    score -= 1;
  }

  const coverageOverlap = coverageGoals.reduce(
    (best, goal) => Math.max(best, overlapCount(sentence, goal)),
    0,
  );
  score += coverageOverlap * 3;

  if (!freshnessSensitive && CURRENT_NEWS_SNIPPET_PATTERN.test(sentence) && coverageOverlap === 0) {
    score -= 6;
  }

  return score;
};

export const deriveGroundingHighlights = (input: {
  subject: string;
  findings: ResearchFinding[];
  coverageGoals?: string[];
  freshnessSensitive?: boolean;
}): string[] => {
  const fetchedFindings = input.findings.filter(
    (finding) =>
      !finding.content.startsWith("Failed to fetch source content:") &&
      !finding.content.startsWith("Search result snippet:") &&
      !DISCUSSION_SOURCE_PATTERN.test(`${finding.title} ${finding.url}`),
  );

  const sentenceCandidates = fetchedFindings.flatMap((finding) =>
    toSentenceCandidates(finding.content).map((sentence) => ({
      sentence,
      coverageOverlap: (input.coverageGoals ?? []).reduce(
        (best, goal) => Math.max(best, overlapCount(sentence, goal)),
        0,
      ),
      score: scoreSentence(
        sentence,
        input.subject,
        input.coverageGoals ?? [],
        input.freshnessSensitive ?? false,
      ),
    })),
  );

  const topRankedCandidates = (
    sentenceCandidates.some((candidate) => candidate.coverageOverlap > 0)
      ? sentenceCandidates.filter((candidate) => candidate.coverageOverlap > 0)
      : sentenceCandidates
  )
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) =>
      right.coverageOverlap - left.coverageOverlap || right.score - left.score,
    )
    .slice(0, 4);

  const topSentences = topRankedCandidates.map((candidate) => candidate.sentence);

  return uniqueNonEmptyStrings(topSentences).slice(0, 5);
};
