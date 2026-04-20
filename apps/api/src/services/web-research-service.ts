import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  WebResearchQueryResponse,
  WebFetchResponseSchema,
  WebResearchQueryResponseSchema,
} from "@slidespeech/types";
import { sanitizeResearchQuery } from "@slidespeech/providers";

import { appContext } from "../lib/context";

const findingHasFetchedSourceContent = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:") &&
  !content.startsWith("Search snippet fallback:");

const DISCUSSION_SOURCE_PATTERN =
  /\b(forum|forums|community|discussion|thread)\b/i;

const LOW_SIGNAL_QA_SOURCE_PATTERN =
  /\b(stackexchange\.com|stackoverflow\.com|reddit\.com|quora\.com|fandom\.com|wikia\.com)\b/i;

const NAVIGATION_NOISE_PATTERN =
  /\b(home|contact|career|careers|about us|privacy|newsletter|knowledge hub|customer case|open positions|follow us|view all news|follow warcraft)\b/i;

const PROMOTIONAL_NOISE_PATTERN =
  /\b(subscribe now|learn more|buy now|free trial|6-month subscription offer|blaze through|limited[- ]time|pre[- ]purchase|upgrade now|visit the shop|choose your edition|adopt today|by purchasing|purchase(?:d|s|ing)?|starter edition|charity|donation|bundle|recruit a friend|roofus pack|habitat for humanity|adopt roofus)\b/i;

const INFORMATIVE_FINDING_PATTERN =
  /\b(is|are|was|were|introduced|released|launched|developed|features?|includes?|explores?|explains?|supports?|stud(?:y|ied|ies)|spread|outbreak|incident|research(?:er|ers)?|model(?:s|ed|ing)?|quarantine|pandemic|contagion|operations?|management|insights|services?|solutions?|quality)\b/i;

const SPECIALIZED_RESEARCH_QUERY_PATTERN =
  /\b(outbreak|incident|plague|research(?:er|ers)?|stud(?:y|ied|ies)|epidemi\w*|pandemic|contagion|disease spread|infection spread|model(?:s|ed|ing)?)\b/i;
const TITLE_CASE_ENTITY_PATTERN =
  /\b([A-Z][a-z]+(?:\s+(?:of|the|and|for|in|on|to|a|an)\s+[A-Z][a-z]+|\s+[A-Z][a-z]+){1,5})\b/g;

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

const tokenize = (value: string): string[] =>
  tokenizeWords(value)
    .filter((token) => token.length >= 3 || /^\p{Lu}{2,}$/u.test(token))
    .map((token) => token.toLowerCase());

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

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const buildQueryTokens = (query: string): string[] =>
  uniqueStrings(
    tokenize(sanitizeResearchQuery(query) || query).filter(
      (token) => !QUERY_STOPWORDS.has(token),
    ),
  );

const buildSpecificQueryTokens = (query: string): string[] =>
  buildQueryTokens(query).filter((token) => token.length >= 5 || /\d/.test(token));

const buildEntityHintTokens = (input: { title: string; url: string }): string[] =>
  tokenize(`${input.title} ${input.url}`)
    .filter((token) => token.length >= 4)
    .filter((token) => !["home", "about", "contact", "www", "https", "http"].includes(token));

const trimExplicitSourceLeadIn = (content: string): string => {
  const markers = [
    " Det här gör vi ",
    " Om VGR ",
    " We ",
    " Our ",
    " About us ",
    " About ",
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
    LOW_SIGNAL_QA_SOURCE_PATTERN.test(finding.url)
  ) {
    return null;
  }

  const genericEntityQuery = GENERIC_ENTITY_REFERENCE_PATTERN.test(query.trim());
  const entityHintTokens =
    options?.allowTrustedExplicitSource && (genericEntityQuery || buildQueryTokens(query).length <= 2)
      ? buildEntityHintTokens({ title: finding.title, url: finding.url })
      : [];
  const queryTokens = uniqueStrings([...buildQueryTokens(query), ...entityHintTokens]);
  const specificQueryTokens = uniqueStrings([
    ...buildSpecificQueryTokens(query),
    ...entityHintTokens.filter((token) => token.length >= 5 || /\d/.test(token)),
  ]);
  const specializedQuery = SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query);
  const normalizedContent = finding.content
    .replace(/\u00a0/g, " ")
    .replace(/\b(Buy Now|Learn More|Subscribe Now|View All News|Visit the Shop|Choose Your Edition|Adopt Today|Follow Warcraft)\b/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  const candidateContent = options?.allowTrustedExplicitSource
    ? trimExplicitSourceLeadIn(normalizedContent)
    : normalizedContent;
  const sentences = candidateContent
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= (options?.allowTrustedExplicitSource ? 420 : 280))
    .filter((sentence) => !NAVIGATION_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !PROMOTIONAL_NOISE_PATTERN.test(sentence))
    .filter((sentence) => !looksLikeTaxonomyNoise(sentence));

  const scoredSentences = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const overlap = queryTokens.filter((token) => lower.includes(token)).length;
      const specificOverlap = specificQueryTokens.filter((token) =>
        lower.includes(token),
      ).length;
      const informativeBoost = INFORMATIVE_FINDING_PATTERN.test(sentence) ? 2 : 0;
      const factualBoost = /\b\d{4}\b/.test(sentence) ? 1 : 0;
      return {
        sentence,
        overlap,
        specificOverlap,
        score: overlap * 2 + specificOverlap * 3 + informativeBoost + factualBoost,
      };
    })
    .filter((candidate) =>
      options?.allowTrustedExplicitSource ? candidate.score >= 1 : candidate.score >= 2,
    )
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
    content,
  };
};

const findingLooksRelevant = (
  query: string,
  input: { url: string; title: string; content: string },
): boolean => {
  if (DISCUSSION_SOURCE_PATTERN.test(`${input.url} ${input.title}`)) {
    return false;
  }

  if (LOW_SIGNAL_QA_SOURCE_PATTERN.test(input.url)) {
    return false;
  }

  const queryTokens = buildQueryTokens(query);
  const specificQueryTokens = buildSpecificQueryTokens(query);
  const specializedQuery = SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query);

  if (queryTokens.length === 0) {
    return true;
  }

  const haystack = `${input.title} ${input.content.slice(0, 1200)} ${input.url}`.toLowerCase();
  const overlap = queryTokens.filter((token) => haystack.includes(token)).length;
  const specificOverlap = specificQueryTokens.filter((token) =>
    haystack.includes(token),
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

export const buildExplicitSourceFallbackQuery = (input: {
  topic: string;
  urls: string[];
}): string => {
  const hostnames = input.urls
    .map((value) => {
      try {
        return new URL(value).hostname.replace(/^www\./i, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const normalizedTopic = (() => {
    const sanitized = sanitizeResearchQuery(input.topic) || input.topic;
    const lower = sanitized.toLowerCase();
    if (lower.startsWith("using ")) {
      return sanitized.slice("using ".length).trim();
    }
    if (lower.startsWith("how ")) {
      return sanitized.slice("how ".length).trim();
    }
    return sanitized.trim();
  })();
  const siteFilters = [...new Set(hostnames)].map((hostname) => `site:${hostname}`);

  return [...siteFilters, normalizedTopic].filter(Boolean).join(" ").trim();
};

export const buildGuessedOfficialUrls = (query: string): string[] => {
  if (SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query)) {
    return [];
  }

  const subject = sanitizeResearchQuery(query);
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (slug.length < 3 || slug.length > 24) {
    return [];
  }

  const urls = [
    `https://www.${slug}.com/`,
    `https://${slug}.com/`,
  ];

  if (/\b(car|cars|vehicle|vehicles|automotive|truck|trucks)\b/i.test(query)) {
    urls.push(`https://www.${slug}cars.com/`);
  }

  return [...new Set(urls)];
};

const slugifyWikiTitle = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const extractNamedPhrases = (query: string): string[] => {
  const quotedPhrases = Array.from(query.matchAll(/"([^"]+)"/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length >= 3);
  const titleCasePhrases = Array.from(query.matchAll(TITLE_CASE_ENTITY_PATTERN))
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length >= 3);

  return uniqueStrings([...quotedPhrases, ...titleCasePhrases]);
};

export const buildGuessedKnowledgeUrls = (query: string): string[] => {
  if (!SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query)) {
    return [];
  }

  const phrases = extractNamedPhrases(query);
  const urls: string[] = [];

  for (const phrase of phrases) {
    const slug = slugifyWikiTitle(phrase);
    if (!slug) {
      continue;
    }

    urls.push(`https://en.wikipedia.org/wiki/${slug}`);
    urls.push(`https://en.wikipedia.org/wiki/${slug}_incident`);
    urls.push(`https://en.wikipedia.org/wiki/${slug}_event`);
  }

  return uniqueStrings(urls);
};

export const searchAndSummarizeWebResearch = async (input: {
  query: string;
  maxResults: number;
}) => {
  const cached = await readResearchCache({
    kind: "search",
    query: input.query,
    maxResults: input.maxResults,
    ttlMs: 1000 * 60 * 60 * 6,
  });

  if (cached) {
    return cached;
  }

  const findings = [];
  const successfulResults = [];
  const guessedKnowledgeUrls = buildGuessedKnowledgeUrls(input.query);
  const guessedOfficialUrls = buildGuessedOfficialUrls(input.query);

  for (const url of guessedKnowledgeUrls) {
    if (successfulResults.length >= input.maxResults) {
      break;
    }

    try {
      const rawFinding = await appContext.webResearchProvider.fetch(url);
      const finding = sanitizeFetchedFinding(input.query, rawFinding, {
        allowTrustedExplicitSource: true,
      });
      if (!finding || !findingLooksRelevant(input.query, finding)) {
        continue;
      }
      findings.push(finding);
      successfulResults.push({
        title: finding.title,
        url: finding.url,
        snippet: finding.content.slice(0, 240),
      });
    } catch {
      continue;
    }
  }

  for (const url of guessedOfficialUrls) {
    if (successfulResults.length >= input.maxResults) {
      break;
    }

    try {
      const rawFinding = await appContext.webResearchProvider.fetch(url);
      const finding = sanitizeFetchedFinding(input.query, rawFinding);
      if (!finding || !findingLooksRelevant(input.query, finding)) {
        continue;
      }
      findings.push(finding);
      successfulResults.push({
        title: finding.title,
        url: finding.url,
        snippet: finding.content.slice(0, 240),
      });
    } catch {
      continue;
    }
  }

  const results = await appContext.webResearchProvider.search(input.query);
  const candidateResults = results.slice(0, Math.max(input.maxResults * 3, 5));

  for (const result of candidateResults) {
    if (successfulResults.some((existing) => existing.url === result.url)) {
      continue;
    }

    try {
      const rawFinding = await appContext.webResearchProvider.fetch(result.url);
      const finding = sanitizeFetchedFinding(input.query, rawFinding);
      if (!finding || !findingLooksRelevant(input.query, finding)) {
        continue;
      }
      findings.push(finding);
      successfulResults.push(result);

      if (successfulResults.length >= input.maxResults) {
        break;
      }
    } catch (error) {
      findings.push({
        url: result.url,
        title: result.title,
        content:
          result.snippet.trim().length > 0
            ? `Search snippet fallback: ${result.snippet}`
            : `Failed to fetch source content: ${(error as Error).message}`,
      });
      successfulResults.push(result);

      if (successfulResults.length >= input.maxResults) {
        break;
      }
    }
  }

  const summary = await appContext.webResearchProvider.summarizeFindings({
    query: input.query,
    findings,
  });

  const response = WebResearchQueryResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    query: input.query,
    results: successfulResults.length > 0
      ? successfulResults
      : candidateResults.slice(0, input.maxResults),
    findings,
    summary,
  });

  await writeResearchCache({
    kind: "search",
    query: input.query,
    maxResults: input.maxResults,
    response,
  });

  return response;
};

export const fetchAndSummarizeExplicitSources = async (input: {
  query: string;
  urls: string[];
}) => {
  const cached = await readResearchCache({
    kind: "explicit",
    query: input.query,
    urls: input.urls,
    ttlMs: 1000 * 60 * 60 * 12,
  });

  if (cached) {
    return cached;
  }

  const dedupedUrls = [...new Set(input.urls)].slice(0, 5);
  const findings = [];
  const results = [];

  for (const url of dedupedUrls) {
    try {
      const rawFinding = await appContext.webResearchProvider.fetch(url);
      const finding = sanitizeFetchedFinding(input.query, rawFinding, {
        allowTrustedExplicitSource: true,
      });
      if (!finding) {
        continue;
      }
      findings.push(finding);
      results.push({
        title: finding.title,
        url: finding.url,
        snippet: finding.content.slice(0, 240),
      });
    } catch (error) {
      findings.push({
        url,
        title: url,
        content: `Failed to fetch source content: ${(error as Error).message}`,
      });
      results.push({
        title: url,
        url,
        snippet: `Failed to fetch explicit source: ${(error as Error).message}`,
      });
    }
  }

  const summary = await appContext.webResearchProvider.summarizeFindings({
    query: input.query,
    findings,
  });

  const response = WebResearchQueryResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    query: input.query,
    results,
    findings,
    summary,
  });

  await writeResearchCache({
    kind: "explicit",
    query: input.query,
    urls: input.urls,
    response,
  });

  return response;
};

export const fetchWebPage = async (url: string) => {
  const result = await appContext.webResearchProvider.fetch(url);

  return WebFetchResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    result,
  });
};

type ResearchCacheKeyInput =
  | {
      kind: "search";
      query: string;
      maxResults: number;
    }
  | {
      kind: "explicit";
      query: string;
      urls: string[];
    };

const RESEARCH_CACHE_DIR = resolve(process.cwd(), "data/research-cache");
const RESEARCH_CACHE_VERSION = 13;

const cacheKeyFor = (input: ResearchCacheKeyInput): string => {
  const hash = createHash("sha1");
  hash.update(JSON.stringify({ version: RESEARCH_CACHE_VERSION, ...input }));
  return hash.digest("hex");
};

const readResearchCache = async (input: ResearchCacheKeyInput & { ttlMs: number }) => {
  try {
    const { ttlMs: _ttlMs, ...cacheKeyInput } = input;
    const cachePath = resolve(RESEARCH_CACHE_DIR, `${cacheKeyFor(cacheKeyInput)}.json`);
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as {
      createdAt?: string;
      response?: unknown;
    };

    if (!parsed.createdAt || !parsed.response) {
      return null;
    }

    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > input.ttlMs) {
      return null;
    }

    return WebResearchQueryResponseSchema.parse(parsed.response);
  } catch {
    return null;
  }
};

const writeResearchCache = async (input: ResearchCacheKeyInput & {
  response: WebResearchQueryResponse;
}) => {
  try {
    await mkdir(RESEARCH_CACHE_DIR, { recursive: true });
    const { response, ...cacheKeyInput } = input;
    const cachePath = resolve(RESEARCH_CACHE_DIR, `${cacheKeyFor(cacheKeyInput)}.json`);
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          response,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Best-effort cache only.
  }
};
