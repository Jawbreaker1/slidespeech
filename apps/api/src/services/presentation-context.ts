type ResearchFinding = {
  title: string;
  url: string;
  content: string;
};

const BRIEF_STOP_PATTERNS = [
  /\bcreate\b/gi,
  /\bmake\b/gi,
  /\bbuild\b/gi,
  /\bgenerate\b/gi,
  /\bwrite\b/gi,
  /\bprepare\b/gi,
  /\bpresentation\b/gi,
  /\boverview\b/gi,
  /\bdeck\b/gi,
  /\btalk\b/gi,
  /\bsession\b/gi,
  /\bslides?\b/gi,
  /\babout\b/gi,
  /\bon\b/gi,
  /\bregarding\b/gi,
  /\bof\b/gi,
  /\bthe\b/gi,
  /\bour\b/gi,
  /\bmy\b/gi,
  /\bcompany\b/gi,
  /\borganisation\b/gi,
  /\borganization\b/gi,
  /\bbusiness\b/gi,
  /\bemployer\b/gi,
  /\buse google\b.*$/gi,
  /\bmore information is available at\b.*$/gi,
];

const NAVIGATION_NOISE_PATTERN =
  /\b(home|contact|career|careers|about us|privacy|newsletter|knowledge hub|customer case|open positions|follow us)\b/i;

const PROMOTIONAL_NOISE_PATTERN =
  /\b(subscribe now|learn more|buy now|free trial|6-month subscription offer|blaze through|limited[- ]time|pre[- ]purchase|upgrade now|by purchasing|purchase(?:d|s|ing)?|starter edition|charity|donation|bundle)\b/i;

const DISCUSSION_SOURCE_PATTERN =
  /\b(forum|forums|community|discussion|thread)\b/i;

const INFORMATIVE_VERB_PATTERN =
  /\b(is|are|helps?|support(?:s)?|combine(?:s)?|deliver(?:s)?|provide(?:s)?|improve(?:s)?|reduce(?:s)?|boost(?:s)?|keep(?:s)?|open(?:s)?|extend(?:s)?|operate(?:s)?|offer(?:s)?|enable(?:s)?|focus(?:es)?|drive(?:s)?)\b/i;

const NAMED_PHRASE_HINT_PATTERN =
  /\b(?:AI|QA|RAG|API|SDK)\b|&|\b(Operations|Management|Insights|Delivery|Platform|Research|Incident|Outbreak|Network|Solutions|Automation|Lifecycle)\b/i;

const GENERIC_NAMED_PHRASES = new Set([
  "Home",
  "Contact",
  "About us",
  "Customer Success Stories",
  "Open Positions",
  "Knowledge Hub",
  "Privacy and cookie policy",
  "Follow us",
  "Sign up for newsletter",
]);

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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

  const subjectPattern = new RegExp(`\\b${escapeRegExp(subject)}\\b`, "gi");
  const genericEntityPattern =
    /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi;

  let compacted = brief.replace(subjectPattern, " ").replace(genericEntityPattern, " ");
  for (const pattern of BRIEF_STOP_PATTERNS) {
    compacted = compacted.replace(pattern, " ");
  }

  compacted = compacted.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");

  return compacted.length > 1 ? compacted : undefined;
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
    .filter((sentence) => !PROMOTIONAL_NOISE_PATTERN.test(sentence));

const CURRENT_NEWS_SNIPPET_PATTERN =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?\s+\d{1,2},?\s+\d{4}\b|\bthis week in\b|\bcatch up on all the latest\b/i;

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
  if (NAMED_PHRASE_HINT_PATTERN.test(sentence)) {
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

const extractNamedPhrases = (content: string, subject: string): string[] => {
  const patterns = [
    /\b[A-Z]{2,}\s*&\s*[A-Z][a-z]+\b/g,
    /\b(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:Operations|Management|Insights|Delivery|Platform|Research|Incident|Outbreak|Network|Solutions|Automation|Lifecycle)\b/g,
  ];
  const matches = patterns.flatMap((pattern) => content.match(pattern) ?? []);

  return uniqueNonEmptyStrings(matches)
    .map((phrase) =>
      phrase
        .replace(/\b(?:Home|About|Contact)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((phrase) => phrase.length >= 3 && phrase.length <= 40)
    .filter((phrase) => !GENERIC_NAMED_PHRASES.has(phrase))
    .filter((phrase) => phrase.toLowerCase() !== subject.toLowerCase())
    .filter((phrase) => NAMED_PHRASE_HINT_PATTERN.test(phrase))
    .slice(0, 6);
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
      !finding.content.startsWith("Search snippet fallback:") &&
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

  const namedPhrases = uniqueNonEmptyStrings(
    fetchedFindings.flatMap((finding) =>
      extractNamedPhrases(finding.content, input.subject),
    ),
  );

  const syntheticHighlights =
    namedPhrases.length >= 2
      ? [
          `Notable focus areas include ${namedPhrases.slice(0, 3).join(", ")}.`,
        ]
      : [];

  return uniqueNonEmptyStrings([...topSentences, ...syntheticHighlights]).slice(0, 5);
};
