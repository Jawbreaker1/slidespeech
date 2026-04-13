import {
  WebFetchResponseSchema,
  WebResearchQueryResponseSchema,
} from "@slidespeech/types";
import { sanitizeResearchQuery } from "@slidespeech/providers";

import { appContext } from "../lib/context";

const findingHasFetchedSourceContent = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:") &&
  !content.startsWith("Search snippet fallback:");

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const findingLooksRelevant = (
  query: string,
  input: { url: string; title: string; content: string },
): boolean => {
  const normalizedQuery = sanitizeResearchQuery(query) || query;
  const queryTokens = [...new Set(tokenize(normalizedQuery))];

  if (queryTokens.length === 0) {
    return true;
  }

  const haystack = `${input.title} ${input.content.slice(0, 1200)} ${input.url}`.toLowerCase();

  return queryTokens.some((token) => haystack.includes(token));
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
  const hostTerms = input.urls
    .map((value) => {
      try {
        return new URL(value).hostname.replace(/^www\./i, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join(" ");

  return [input.topic, hostTerms].filter(Boolean).join(" ").trim();
};

export const buildGuessedOfficialUrls = (query: string): string[] => {
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

export const searchAndSummarizeWebResearch = async (input: {
  query: string;
  maxResults: number;
}) => {
  const findings = [];
  const successfulResults = [];
  const guessedOfficialUrls = buildGuessedOfficialUrls(input.query);

  for (const url of guessedOfficialUrls) {
    if (successfulResults.length >= input.maxResults) {
      break;
    }

    try {
      const finding = await appContext.webResearchProvider.fetch(url);
      if (!findingLooksRelevant(input.query, finding)) {
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
      const finding = await appContext.webResearchProvider.fetch(result.url);
      if (!findingLooksRelevant(input.query, finding)) {
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

  return WebResearchQueryResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    query: input.query,
    results: successfulResults.length > 0
      ? successfulResults
      : candidateResults.slice(0, input.maxResults),
    findings,
    summary,
  });
};

export const fetchAndSummarizeExplicitSources = async (input: {
  query: string;
  urls: string[];
}) => {
  const dedupedUrls = [...new Set(input.urls)].slice(0, 5);
  const findings = [];
  const results = [];

  for (const url of dedupedUrls) {
    try {
      const finding = await appContext.webResearchProvider.fetch(url);
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

  return WebResearchQueryResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    query: input.query,
    results,
    findings,
    summary,
  });
};

export const fetchWebPage = async (url: string) => {
  const result = await appContext.webResearchProvider.fetch(url);

  return WebFetchResponseSchema.parse({
    provider: appContext.webResearchProvider.name,
    result,
  });
};
