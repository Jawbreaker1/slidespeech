import { Router } from "express";

import {
  WebFetchRequestSchema,
  WebSearchRequestSchema,
} from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  fetchWebPage,
  searchAndSummarizeWebResearch,
} from "../services/web-research-service";

export const researchRouter = Router();

researchRouter.get("/health", async (_request, response) => {
  const health = await appContext.webResearchProvider.healthCheck();

  response.json({
    api: "ok",
    webResearchProvider: appContext.webResearchProvider.name,
    webResearchHealth: health,
  });
});

researchRouter.post("/query", async (request, response, next) => {
  try {
    const payload = WebSearchRequestSchema.parse(request.body);
    const result = await searchAndSummarizeWebResearch(payload);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

researchRouter.post("/fetch", async (request, response, next) => {
  try {
    const payload = WebFetchRequestSchema.parse(request.body);
    const result = await fetchWebPage(payload.url);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
