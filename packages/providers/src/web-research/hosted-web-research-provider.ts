import type {
  SummarizeFindingsInput,
  WebFetchResult,
  WebResearchProvider,
  WebSearchResult,
} from "@slidespeech/types";

import { decodeHtmlEntities, healthy, unhealthy } from "../shared";

interface HostedWebResearchConfig {
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "latest",
  "need",
  "of",
  "on",
  "or",
  "recent",
  "the",
  "to",
  "today",
  "what",
  "when",
  "why",
]);

const TRUSTED_DOMAIN_PATTERNS = [
  /\.gov$/i,
  /\.edu$/i,
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)nvidia\.com$/i,
  /(^|\.)meta\.com$/i,
  /(^|\.)amazon\.com$/i,
];
const LOW_TRUST_DOMAIN_PATTERNS = [
  /(^|\.)zhihu\.com$/i,
  /(^|\.)quora\.com$/i,
  /(^|\.)answers\.com$/i,
  /(^|\.)pinterest\./i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)fandom\.com$/i,
  /(^|\.)wikia\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
];
const CURRENT_TOPIC_PATTERNS = [
  /\b(current|latest|recent|today|this week|this month|this year)\b/i,
  /\bnews|update|updates|announcement|release|releases|earnings|launch\b/i,
  /\b202[4-9]\b/,
];
const SPECIALIZED_RESEARCH_QUERY_PATTERN =
  /\b(outbreak|incident|plague|research(?:er|ers)?|stud(?:y|ied|ies)|epidemi\w*|pandemic|contagion|disease spread|infection spread)\b/i;

const stripTags = (html: string): string =>
  decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

const extractTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? stripTags(match[1]) : null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const domainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const sanitizeResearchQuery = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return trimmed;
  }

  const aboutMatch = trimmed.match(
    /\babout\s+([^.,;:!?]+?)(?:\s+\bfor\b|\s+\busing\b|\s+\bwith\b|[.,;:!?]|$)/i,
  );

  const candidate = aboutMatch?.[1] ?? trimmed;

  return candidate
    .replace(/\b(create|make|build|generate|write)\b/gi, " ")
    .replace(/\b(presentation|overview|deck|slides?)\b/gi, " ")
    .replace(/\b(audience|children|kids|beginners|beginner|pictures|images|visuals)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const slugifySubject = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

export const buildSearchQueries = (query: string): string[] => {
  const normalized = sanitizeResearchQuery(query) || query.trim();
  const lower = normalized.toLowerCase();
  const slug = slugifySubject(normalized);
  const specializedQuery = SPECIALIZED_RESEARCH_QUERY_PATTERN.test(query);
  const queries = [normalized];

  if (specializedQuery) {
    queries.push(`${normalized} wikipedia`);
    queries.push(`${normalized} study`);
  } else {
    queries.push(`${normalized} official`);
    queries.push(`${normalized} announcement`);
  }

  if (!specializedQuery && slug.length >= 3 && slug.length <= 24 && !slug.includes(" ")) {
    queries.push(`site:${slug}.com ${normalized}`);
    if (/\b(car|cars|vehicle|vehicles|automotive|truck|trucks)\b/i.test(query)) {
      queries.push(`site:${slug}cars.com ${normalized}`);
    }
  }

  if (/\bopenai\b/i.test(lower)) {
    queries.push(`site:openai.com ${normalized}`);
  }

  if (/\banthropic\b/i.test(lower)) {
    queries.push(`site:anthropic.com ${normalized}`);
  }

  if (/\bgoogle\b|\bgemini\b/i.test(lower)) {
    queries.push(`site:blog.google ${normalized}`);
  }

  if (/\bmicrosoft\b|\bazure\b/i.test(lower)) {
    queries.push(`site:microsoft.com ${normalized}`);
  }

  return unique(queries).slice(0, 6);
};

const queryLooksCurrent = (query: string): boolean =>
  CURRENT_TOPIC_PATTERNS.some((pattern) => pattern.test(query));

const trustedDomainBonus = (domain: string): number => {
  if (!domain) {
    return 0;
  }

  return TRUSTED_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain)) ? 6 : 0;
};

const lowTrustDomainPenalty = (domain: string): number => {
  if (!domain) {
    return 0;
  }

  return LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain)) ? -12 : 0;
};

export const scoreSearchResult = (
  query: string,
  result: WebSearchResult,
): number => {
  const queryTokens = unique(tokenize(sanitizeResearchQuery(query) || query));
  const titleTokens = tokenize(result.title);
  const snippetTokens = tokenize(result.snippet);
  const domain = domainFromUrl(result.url);
  const domainTokens = tokenize(domain.replace(/\./g, " "));
  const titleMatches = queryTokens.filter((token) => titleTokens.includes(token));
  const snippetMatches = queryTokens.filter((token) => snippetTokens.includes(token));
  const domainMatches = queryTokens.filter((token) => domainTokens.includes(token));
  const missingPenalty =
    titleMatches.length === 0 && snippetMatches.length === 0 ? -8 : 0;

  return (
    titleMatches.length * 4 +
    snippetMatches.length * 2 +
    domainMatches.length * 5 +
    trustedDomainBonus(domain) +
    lowTrustDomainPenalty(domain) +
    missingPenalty
  );
};

export const rankSearchResults = (
  query: string,
  results: WebSearchResult[],
): WebSearchResult[] => {
  const seen = new Set<string>();

  return [...results]
    .filter((result) => !LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domainFromUrl(result.url))))
    .filter((result) => {
      const key = `${result.url}::${result.title}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const scoreDelta =
        scoreSearchResult(query, right) - scoreSearchResult(query, left);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.url.localeCompare(right.url);
    });
};

const parseRssItems = (xml: string, query: string): WebSearchResult[] => {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  return items.slice(0, 8).flatMap((match, index) => {
    const item = match[1];
    const title = item?.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = item?.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const description = item?.match(/<description>([\s\S]*?)<\/description>/i)?.[1];

    if (!title || !link) {
      return [];
    }

    return [
      {
        title: stripTags(title),
        url: stripTags(link),
        snippet:
          stripTags(description ?? "") ||
          `Search result ${index + 1} for "${query}".`,
      },
    ];
  });
};

export class HostedWebResearchProvider implements WebResearchProvider {
  readonly name = "hosted-web-research";
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(config: HostedWebResearchConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.userAgent =
      config.userAgent ??
      "SlideSpeechBot/0.1 (+https://slidespeech.local; educational research)";
  }

  async healthCheck() {
    try {
      const response = await fetch(
        "https://www.bing.com/search?format=rss&setlang=en-US&cc=us&mkt=en-US&q=test",
        {
          headers: {
            "User-Agent": this.userAgent,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (!response.ok) {
        return unhealthy(
          this.name,
          `Hosted search returned status ${response.status}.`,
        );
      }

      return healthy(this.name, "Hosted web research provider is reachable.");
    } catch (error) {
      return unhealthy(
        this.name,
        `Hosted web research check failed: ${(error as Error).message}`,
      );
    }
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const allResults: WebSearchResult[] = [];

    if (queryLooksCurrent(query)) {
      const googleNewsResponse = await fetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
        {
          headers: {
            "User-Agent": this.userAgent,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (googleNewsResponse.ok) {
        const xml = await googleNewsResponse.text();
        allResults.push(...parseRssItems(xml, query));
      }
    }

    for (const searchQuery of buildSearchQueries(query)) {
      const response = await fetch(
        `https://www.bing.com/search?format=rss&setlang=en-US&cc=us&mkt=en-US&q=${encodeURIComponent(searchQuery)}`,
        {
          headers: {
            "User-Agent": this.userAgent,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (!response.ok) {
        throw new Error(
          `${this.name} search failed with status ${response.status}.`,
        );
      }

      const xml = await response.text();
      allResults.push(...parseRssItems(xml, searchQuery));
    }

    return rankSearchResults(query, allResults).slice(0, 8);
  }

  async fetch(url: string): Promise<WebFetchResult> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`${this.name} fetch failed with status ${response.status}.`);
    }

    const html = await response.text();
    const title = extractTitle(html) ?? new URL(url).hostname;
    const content = truncate(stripTags(html), 8000);

    return {
      url,
      title,
      content,
    };
  }

  async summarizeFindings(input: SummarizeFindingsInput): Promise<string> {
    if (input.findings.length === 0) {
      return `No external findings were fetched for "${input.query}".`;
    }

    const lines = input.findings.slice(0, 3).map((finding, index) => {
      const excerpt = truncate(finding.content, 320);
      return `${index + 1}. ${finding.title}: ${excerpt}`;
    });

    return `External research summary for "${input.query}": ${lines.join(" ")}`;
  }
}
