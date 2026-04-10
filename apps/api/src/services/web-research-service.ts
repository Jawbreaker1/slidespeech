import {
  WebFetchResponseSchema,
  WebResearchQueryResponseSchema,
} from "@slidespeech/types";

import { appContext } from "../lib/context";

export const searchAndSummarizeWebResearch = async (input: {
  query: string;
  maxResults: number;
}) => {
  const results = await appContext.webResearchProvider.search(input.query);
  const limitedResults = results.slice(0, input.maxResults);
  const findings = [];

  for (const result of limitedResults) {
    try {
      findings.push(await appContext.webResearchProvider.fetch(result.url));
    } catch (error) {
      findings.push({
        url: result.url,
        title: result.title,
        content: `Failed to fetch source content: ${(error as Error).message}`,
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
    results: limitedResults,
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
