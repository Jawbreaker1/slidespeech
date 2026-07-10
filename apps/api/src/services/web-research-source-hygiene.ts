import {
  decodeHtmlEntities,
  looksOverlyPromotionalSourceCopy,
  sanitizeResearchQuery,
} from "@slidespeech/providers";

export type ResearchFinding = { url: string; title: string; content: string };
export type ResearchResult = { title: string; url: string; snippet: string };

export const findingHasFetchedSourceContent = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:") &&
  !content.startsWith("Search result snippet:");

export const summarizeCandidateFindings = (
  findings: Array<{ url: string; title: string; content: string }>,
) => {
  const fetchedFindings = findings.filter((finding) =>
    findingHasFetchedSourceContent(finding.content),
  );

  return fetchedFindings.length > 0 ? fetchedFindings : findings;
};

const DISCUSSION_SOURCE_PATTERN =
  /\b(forum|forums|community|discussion|thread)\b/i;

const LOW_SIGNAL_USER_GENERATED_SOURCE_PATTERN =
  /\b(stackexchange\.com|stackoverflow\.com|reddit\.com|quora\.com|answers\.com|fandom\.com|wikia\.com)\b/i;

const NAVIGATION_NOISE_PATTERN =
  /\b(home|contact|career|careers|about us|privacy|newsletter|knowledge hub|customer case|open positions|follow us|view all news)\b/i;

const PROMOTIONAL_NOISE_PATTERN =
  /\b(subscribe now|learn more|buy now|free trial|6-month subscription offer|blaze through|limited[- ]time|pre[- ]purchase|upgrade now|visit the shop|choose your edition|adopt today|adopt\s+\p{Lu}[\p{L}\p{M}'’-]+|by purchasing|purchase(?:d|s|ing)?|starter edition|charity|donation|bundle|recruit a friend|the\s+\p{Lu}[\p{L}\p{M}'’-]+\s+pack)\b/iu;

const SCRAPED_COUNTER_NOISE_PATTERN =
  /\b0\s+(?:years?|locations?|employees?|consultant rating)\b/i;

const INFORMATIVE_FINDING_PATTERN =
  /\b(is|are|was|were|introduced|released|launched|developed|features?|includes?|explores?|explains?|supports?|stud(?:y|ied|ies)|spread|outbreak|incident|research(?:er|ers)?|model(?:s|ed|ing)?|quarantine|pandemic|contagion|operations?|management|insights|services?|solutions?|quality)\b/i;

export const SPECIALIZED_RESEARCH_QUERY_PATTERN =
  /\b(outbreak|incident|plague|research(?:er|ers)?|stud(?:y|ied|ies)|epidemi\w*|pandemic|contagion|disease spread|infection spread|model(?:s|ed|ing)?)\b/i;
export const TITLE_CASE_ENTITY_PATTERN =
  /\b(\p{Lu}[\p{L}\p{M}0-9'’:-]+(?:\s+(?:of|the|and|for|in|on|to|a|an)\s+\p{Lu}[\p{L}\p{M}0-9'’:-]+|\s+\p{Lu}[\p{L}\p{M}0-9'’:-]+){1,7})\b/gu;
const QUERY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "these",
  "those",
  "what",
  "why",
  "how",
  "when",
  "where",
  "was",
  "were",
  "are",
  "is",
  "one",
  "ones",
  "latest",
  "their",
  "use",
  "used",
  "using",
  "tool",
  "tools",
  "work",
  "working",
  "daily",
]);

const GENERIC_ENTITY_REFERENCE_PATTERN =
  /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/i;

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

const tokenizeWords = (value: string): string[] =>
  Array.from(value.normalize("NFKC").matchAll(WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);

export const tokenize = (value: string): string[] =>
  tokenizeWords(value)
    .filter((token) => token.length >= 3 || /^\p{Lu}{2,}$/u.test(token))
    .map((token) => token.toLowerCase().replace(/['’]s$/u, ""));

const hasRepeatedWordWindow = (value: string, minWindowSize = 5): boolean => {
  const tokens = tokenizeWords(value)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2);

  if (tokens.length < minWindowSize * 2) {
    return false;
  }

  const maxWindowSize = Math.min(10, Math.floor(tokens.length / 2));

  for (let windowSize = maxWindowSize; windowSize >= minWindowSize; windowSize -= 1) {
    for (let start = 0; start + windowSize * 2 <= tokens.length; start += 1) {
      let matches = true;
      for (let index = 0; index < windowSize; index += 1) {
        if (tokens[start + index] !== tokens[start + windowSize + index]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return true;
      }
    }
  }

  return false;
};

const ABBREVIATION_PERIOD_PLACEHOLDER = "<slidespeech-period>";

const splitIntoSentences = (value: string): string[] =>
  value
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\./g, `$1${ABBREVIATION_PERIOD_PLACEHOLDER}`)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence.replaceAll(ABBREVIATION_PERIOD_PLACEHOLDER, "."),
    );

const looksLikeTaxonomyNoise = (value: string): boolean => {
  const tokens = tokenizeWords(value).filter((token) => /\p{L}/u.test(token));

  if (tokens.length < 8) {
    return false;
  }

  const isTitleishToken = (token: string): boolean => /^\p{Lu}/u.test(token);
  const titleishCount = tokens.filter(isTitleishToken).length;
  const lowercaseCount = tokens.filter((token) => /^\p{Ll}/u.test(token)).length;
  const titleRatio = titleishCount / tokens.length;

  let longestTitleishRun = 0;
  let currentRun = 0;
  for (const token of tokens) {
    if (isTitleishToken(token)) {
      currentRun += 1;
      if (currentRun > longestTitleishRun) {
        longestTitleishRun = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  return (
    (hasRepeatedWordWindow(value) || longestTitleishRun >= 7 || titleRatio >= 0.7) &&
    lowercaseCount <= Math.max(3, Math.floor(tokens.length * 0.3))
  );
};

export const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const NAMED_PHRASE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
]);

export const buildQueryTokens = (query: string): string[] =>
  uniqueStrings(
    tokenize(sanitizeResearchQuery(query) || query).filter(
      (token) => !QUERY_STOPWORDS.has(token),
    ),
  );

const buildSpecificQueryTokens = (query: string): string[] =>
  buildQueryTokens(query).filter((token) => token.length >= 5 || /\d/.test(token));

export const normalizeNamedPhrase = (value: string): string =>
  value
    .replace(/([\p{L}\p{M}\p{N}])['’]s(?=\s|$)/giu, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

const requiredNamedPhraseTokenGroups = (query: string): string[][] =>
  extractNamedPhrases(query)
    .map((phrase) =>
      tokenize(phrase)
        .filter((token) => !NAMED_PHRASE_STOPWORDS.has(token))
        .filter((token) => token.length >= 3 || /^\d+$/.test(token)),
    )
    .filter((tokens) => tokens.length >= 2);

const containsRequiredNamedPhrase = (query: string, haystack: string): boolean => {
  const requiredGroups = requiredNamedPhraseTokenGroups(query);

  if (requiredGroups.length === 0) {
    return true;
  }

  const haystackTokens = new Set(tokenize(haystack));
  return requiredGroups.some((tokens) =>
    tokens.every((token) => haystackTokens.has(token)),
  );
};

export const normalizeComparableSearchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

export const normalizeHostname = (value: string): string =>
  value.replace(/^www\./i, "").toLowerCase();

export const hostnameFromUrl = (value: string): string | null => {
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return null;
  }
};

export const hostMatchesAllowedHostnames = (
  url: string,
  allowedHostnames: string[],
): boolean => {
  const candidate = hostnameFromUrl(url);
  if (!candidate) {
    return false;
  }

  return allowedHostnames.some(
    (hostname) => candidate === hostname || candidate.endsWith(`.${hostname}`),
  );
};

const buildEntityHintTokens = (input: { title: string; url: string }): string[] =>
  tokenize(`${input.title} ${input.url}`)
    .filter((token) => token.length >= 4)
    .filter((token) => !["home", "about", "contact", "www", "https", "http"].includes(token));

const trimExplicitSourceLeadIn = (content: string): string => {
  const markers = [
    " Det här gör vi ",
    " We ",
    " Our ",
    " About us ",
    " About ",
    " Om oss ",
  ];

  let bestIndex = content.length;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    if (index > 20 && index < bestIndex) {
      bestIndex = index;
    }
  }

  return bestIndex < content.length ? content.slice(bestIndex + 1).trim() : content;
};

export const extractNamedPhrases = (query: string): string[] => {
  const quotedPhrases = Array.from(query.matchAll(/"([^"]+)"/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length >= 3);
  const titleCasePhrases = Array.from(query.matchAll(TITLE_CASE_ENTITY_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length >= 3);

  return uniqueStrings([...quotedPhrases, ...titleCasePhrases]
    .map(normalizeNamedPhrase)
    .filter((value) => value.length >= 3));
};

export const sanitizeFetchedFinding = (
  query: string,
  finding: { url: string; title: string; content: string },
  options?: {
    allowTrustedExplicitSource?: boolean | undefined;
  },
) => {
  if (!findingHasFetchedSourceContent(finding.content)) {
    return finding;
  }

  if (
    DISCUSSION_SOURCE_PATTERN.test(`${finding.url} ${finding.title}`) ||
    LOW_SIGNAL_USER_GENERATED_SOURCE_PATTERN.test(finding.url)
  ) {
    return null;
  }

  const genericEntityQuery = GENERIC_ENTITY_REFERENCE_PATTERN.test(query.trim());
  const decodedTitle = decodeHtmlEntities(finding.title);
  const decodedContent = decodeHtmlEntities(finding.content);
  const entityHintTokens =
    options?.allowTrustedExplicitSource && (genericEntityQuery || buildQueryTokens(query).length <= 2)
      ? buildEntityHintTokens({ title: decodedTitle, url: finding.url })
      : [];
  const queryTokens = uniqueStrings([...buildQueryTokens(query), ...entityHintTokens]);
  const specificQueryTokens = uniqueStrings([
    ...buildSpecificQueryTokens(query),
    ...entityHintTokens.filter((token) => token.length >= 5 || /\d/.test(token)),
  ]);
  const queryYears = uniqueStrings(Array.from(query.matchAll(/\b(?:1[5-9]\d{2}|20\d{2})\b/g)).map((match) => match[0]!));
  const specializedQuery = SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query);
  const normalizedContent = decodedContent
    .replace(/\u00a0/g, " ")
    .replace(/\[\s*(?:edit|\d+)\s*\]/gi, " ")
    .replace(/\b(Buy Now|Learn More|Subscribe Now|View All News|Visit the Shop|Choose Your Edition|Adopt Today|Follow\s+[\p{L}\p{M}\p{N}'’:-]+)\b/giu, ". ")
    .replace(/\s+/g, " ")
    .trim();
  const candidateContent = options?.allowTrustedExplicitSource
    ? trimExplicitSourceLeadIn(normalizedContent)
    : normalizedContent;
  const sentences = splitIntoSentences(candidateContent)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= (options?.allowTrustedExplicitSource ? 420 : 280))
    .filter((sentence) => !NAVIGATION_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !PROMOTIONAL_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !looksOverlyPromotionalSourceCopy(sentence))
    .filter((sentence) => !SCRAPED_COUNTER_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !/\?$/.test(sentence))
    .filter((sentence) => !looksLikeTaxonomyNoise(sentence));

  const scoredSentences = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const overlap = queryTokens.filter((token) => lower.includes(token)).length;
      const specificOverlap = specificQueryTokens.filter((token) =>
        lower.includes(token),
      ).length;
      const yearOverlap = queryYears.filter((year) => lower.includes(year)).length;
      const hasNonQueryYear =
        queryYears.length > 0 &&
        /\b(?:1[5-9]\d{2}|20\d{2})\b/.test(sentence) &&
        yearOverlap === 0;
      const informativeBoost = INFORMATIVE_FINDING_PATTERN.test(sentence) ? 2 : 0;
      const factualBoost = /\b\d{4}\b/.test(sentence) ? 1 : 0;
      return {
        sentence,
        overlap,
        specificOverlap,
        yearOverlap,
        hasNonQueryYear,
        score:
          overlap * 2 +
          specificOverlap * 3 +
          yearOverlap * 8 +
          informativeBoost +
          factualBoost -
          (hasNonQueryYear ? 5 : 0),
      };
    })
    .filter((candidate) =>
      options?.allowTrustedExplicitSource ? candidate.score >= 1 : candidate.score >= 2,
    )
    .filter((candidate, _index, candidates) => {
      if (queryYears.length === 0) {
        return true;
      }

      const hasQueryYearCandidate = candidates.some((item) => item.yearOverlap > 0);
      return !hasQueryYearCandidate || candidate.yearOverlap > 0 || !candidate.hasNonQueryYear;
    })
    .filter((candidate) =>
      options?.allowTrustedExplicitSource || specificQueryTokens.length === 0
        ? true
        : candidate.specificOverlap >= 1 || candidate.overlap >= 2,
    )
    .filter(
      (candidate) =>
        options?.allowTrustedExplicitSource ||
        !specializedQuery ||
        candidate.overlap >= 2,
    )
    .sort((left, right) => right.score - left.score);

  const content =
    scoredSentences.length > 0
      ? uniqueStrings([
          ...scoredSentences.slice(0, 4).map((candidate) => candidate.sentence),
          ...scoredSentences
            .filter(
              (candidate) =>
                candidate.specificOverlap >= 1 ||
                /\b\d{2,4}\b/.test(candidate.sentence) ||
                /[,:;]/.test(candidate.sentence),
            )
            .slice(0, 3)
            .map((candidate) => candidate.sentence),
        ])
          .slice(0, 6)
          .join(" ")
      : options?.allowTrustedExplicitSource
        ? sentences.slice(0, 4).join(" ")
        : "";

  if (!content) {
    return null;
  }

  return {
    ...finding,
    title: decodedTitle,
    content,
  };
};

export const findingLooksRelevant = (
  query: string,
  input: { url: string; title: string; content: string },
): boolean => {
  if (DISCUSSION_SOURCE_PATTERN.test(`${input.url} ${input.title}`)) {
    return false;
  }

  if (LOW_SIGNAL_USER_GENERATED_SOURCE_PATTERN.test(input.url)) {
    return false;
  }

  const queryTokens = buildQueryTokens(query);
  const specificQueryTokens = buildSpecificQueryTokens(query);
  const specializedQuery = SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query);

  if (queryTokens.length === 0) {
    return true;
  }

  const haystack = `${input.title} ${input.content.slice(0, 1200)} ${input.url}`.toLowerCase();
  if (!containsRequiredNamedPhrase(query, haystack)) {
    return false;
  }

  const haystackTokens = new Set(tokenize(haystack));
  const overlap = queryTokens.filter((token) => haystackTokens.has(token)).length;
  const specificOverlap = specificQueryTokens.filter((token) =>
    haystackTokens.has(token),
  ).length;

  if (specializedQuery) {
    return overlap >= 3;
  }

  if (specificQueryTokens.length > 0) {
    return specificOverlap >= 1 || overlap >= 2;
  }

  return overlap >= 1;
};

export const collectFetchedFindingUrls = (
  findings: Array<{ url: string; content: string }>,
): string[] =>
  findings
    .filter((finding) => findingHasFetchedSourceContent(finding.content))
    .map((finding) => finding.url);

export const findingToResult = (finding: ResearchFinding): ResearchResult => ({
  title: finding.title,
  url: finding.url,
  snippet: finding.content.slice(0, 240),
});
