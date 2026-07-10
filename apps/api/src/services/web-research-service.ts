import {
  WebFetchResponseSchema,
  WebResearchQueryResponseSchema,
} from "@slidespeech/types";
import { sanitizeResearchQuery } from "@slidespeech/providers";

import { appContext } from "../lib/context";
import { readResearchCache, writeResearchCache } from "./web-research-cache";
import {
  collectFetchedFindingUrls,
  findingLooksRelevant,
  hostMatchesAllowedHostnames,
  hostnameFromUrl,
  normalizeComparableSearchText,
  normalizeHostname,
  sanitizeFetchedFinding,
  summarizeCandidateFindings,
  type ResearchFinding,
  type ResearchResult,
} from "./web-research-source-hygiene";

export {
  collectFetchedFindingUrls,
  findingLooksRelevant,
  sanitizeFetchedFinding,
} from "./web-research-source-hygiene";

const fetchSanitizedRelevantFinding = async (input: {
  query: string;
  url: string;
  allowedHostnames: string[];
  allowTrustedExplicitSource?: boolean | undefined;
}): Promise<ResearchFinding | null> => {
  if (
    input.allowedHostnames.length > 0 &&
    !hostMatchesAllowedHostnames(input.url, input.allowedHostnames)
  ) {
    return null;
  }

  const rawFinding = await appContext.webResearchProvider.fetch(input.url);
  if (
    input.allowedHostnames.length > 0 &&
    !hostMatchesAllowedHostnames(rawFinding.url, input.allowedHostnames)
  ) {
    return null;
  }

  const finding = sanitizeFetchedFinding(input.query, rawFinding, {
    ...(input.allowTrustedExplicitSource
      ? { allowTrustedExplicitSource: true }
      : {}),
  });
  if (!finding || !findingLooksRelevant(input.query, finding)) {
    return null;
  }

  return finding;
};

export const buildExplicitSourceSupplementalQuery = (input: {
  topic: string;
  urls: string[];
  organization?: string;
  presentationFrame?: "subject" | "organization" | "mixed";
  deliveryFormat?: "presentation" | "workshop";
}): string => {
  const hostnames = input.urls
    .map((value) => hostnameFromUrl(value) ?? "")
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
  const organizationContext =
    input.organization?.trim() &&
    (input.presentationFrame === "organization" ||
      input.presentationFrame === "mixed")
      ? input.organization.trim()
      : "";
  const includeTopic =
    normalizedTopic.length > 0 &&
    (
      organizationContext.length === 0 ||
      normalizeComparableSearchText(normalizedTopic) !==
        normalizeComparableSearchText(organizationContext)
    );

  return [
    ...siteFilters,
    organizationContext ? `"${organizationContext}"` : "",
    includeTopic ? normalizedTopic : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
};

export const searchAndSummarizeWebResearch = async (input: {
  query: string;
  maxResults: number;
  allowedHostnames?: string[];
}) => {
  const allowedHostnames = [...new Set(
    (input.allowedHostnames ?? [])
      .map((value) => normalizeHostname(value))
      .filter(Boolean),
  )];
  const cached = await readResearchCache({
    kind: "search",
    query: input.query,
    maxResults: input.maxResults,
    ...(allowedHostnames.length > 0 ? { allowedHostnames } : {}),
    ttlMs: 1000 * 60 * 60 * 6,
  });

  if (cached) {
    return cached;
  }

  const findings: ResearchFinding[] = [];
  const successfulResults: ResearchResult[] = [];
  const results = await appContext.webResearchProvider.search(input.query);
  const candidateResults = results
    .filter((result) =>
      allowedHostnames.length === 0
        ? true
        : hostMatchesAllowedHostnames(result.url, allowedHostnames),
    )
    .slice(0, Math.max(input.maxResults * 3, 5));

  for (const result of candidateResults) {
    if (successfulResults.some((existing) => existing.url === result.url)) {
      continue;
    }

    try {
      const finding = await fetchSanitizedRelevantFinding({
        query: input.query,
        url: result.url,
        allowedHostnames,
      });
      if (!finding) {
        continue;
      }
      findings.push(finding);
      successfulResults.push(result);

      if (successfulResults.length >= input.maxResults) {
        break;
      }
    } catch (error) {
      const snippetFinding = {
        url: result.url,
        title: result.title,
        content:
          result.snippet.trim().length > 0
            ? `Search result snippet: ${result.snippet}`
            : `Failed to fetch source content: ${(error as Error).message}`,
      };

      if (!findingLooksRelevant(input.query, snippetFinding)) {
        continue;
      }

      findings.push(snippetFinding);
      successfulResults.push(result);

      if (successfulResults.length >= input.maxResults) {
        break;
      }
    }
  }

  const summary = await appContext.webResearchProvider.summarizeFindings({
    query: input.query,
    findings: summarizeCandidateFindings(findings),
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
    ...(allowedHostnames.length > 0 ? { allowedHostnames } : {}),
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
  const findings: ResearchFinding[] = [];
  const results: ResearchResult[] = [];

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
    findings: summarizeCandidateFindings(findings),
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
