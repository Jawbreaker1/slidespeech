import { Router } from "express";

import {
  GeneratePresentationRequestSchema,
  SelectSlideRequestSchema,
  SessionInteractionRequestSchema,
} from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  createPresentation,
  getSlideNarration,
  getSessionSnapshot,
  interactWithSession,
  selectSlide,
} from "../services/presentation-service";

export const presentationsRouter = Router();

presentationsRouter.get("/example", async (_request, response, next) => {
  try {
    const result = await createPresentation({
      topic: "How an interactive AI tutor works",
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post("/generate", async (request, response, next) => {
  try {
    const payload = GeneratePresentationRequestSchema.parse(request.body);
    const result = await createPresentation(
      payload.pedagogicalProfile
        ? {
            topic: payload.topic,
            pedagogicalProfile: Object.fromEntries(
              Object.entries(payload.pedagogicalProfile).filter(
                (entry): entry is [string, string | boolean] =>
                  entry[1] !== undefined,
              ),
            ),
          }
        : { topic: payload.topic },
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.get("/health", async (_request, response) => {
  const health = await appContext.llmProvider.healthCheck();

  response.json({
    api: "ok",
    llmProvider: appContext.llmProvider.name,
    llmHealth: health,
  });
});

presentationsRouter.get("/:sessionId", async (request, response, next) => {
  try {
    const snapshot = await getSessionSnapshot(request.params.sessionId);
    response.json(snapshot);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.get(
  "/:sessionId/slides/:slideId/narration",
  async (request, response, next) => {
    try {
      const narration = await getSlideNarration({
        sessionId: request.params.sessionId,
        slideId: request.params.slideId,
      });

      response.json(narration);
    } catch (error) {
      next(error);
    }
  },
);

presentationsRouter.post("/:sessionId/interact", async (request, response, next) => {
  try {
    const payload = SessionInteractionRequestSchema.parse(request.body);
    const result = await interactWithSession({
      sessionId: request.params.sessionId,
      text: payload.text,
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post(
  "/:sessionId/slides/select",
  async (request, response, next) => {
    try {
      const payload = SelectSlideRequestSchema.parse(request.body);
      const result = await selectSlide({
        sessionId: request.params.sessionId,
        slideId: payload.slideId,
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);
