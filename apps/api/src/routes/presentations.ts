import { Router } from "express";

import {
  GeneratePresentationRequestSchema,
  NarrationProgressRequestSchema,
  PresentationGenerationJobStatusResponseSchema,
  SpeechSynthesisRequestSchema,
  SelectSlideRequestSchema,
} from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  createPresentation,
  exportPresentationPptx,
  getSlideIllustration,
  getSlideNarration,
  getSessionSnapshot,
  selectSlide,
  updateNarrationProgress,
} from "../services/presentation-service";
import { presentationGenerationQueue } from "../services/generation-queue";
import { synthesizeSessionSpeech } from "../services/tts-service";

export const presentationsRouter = Router();

const normalizeGeneratePresentationInput = (
  payload: ReturnType<typeof GeneratePresentationRequestSchema.parse>,
) => ({
  topic: payload.topic,
  ...(payload.pedagogicalProfile
    ? {
        pedagogicalProfile: Object.fromEntries(
          Object.entries(payload.pedagogicalProfile).filter(
            (entry): entry is [string, string | boolean] => entry[1] !== undefined,
          ),
        ),
      }
    : {}),
  ...(payload.useWebResearch !== undefined
    ? { useWebResearch: payload.useWebResearch }
    : {}),
  ...(payload.targetDurationMinutes !== undefined
    ? { targetDurationMinutes: payload.targetDurationMinutes }
    : {}),
  ...(payload.targetSlideCount !== undefined
    ? { targetSlideCount: payload.targetSlideCount }
    : {}),
  ...(payload.theme !== undefined ? { theme: payload.theme } : {}),
});

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
    const result = await createPresentation(normalizeGeneratePresentationInput(payload));
    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post("/generate-jobs", async (request, response, next) => {
  try {
    const payload = GeneratePresentationRequestSchema.parse(request.body);
    const result = presentationGenerationQueue.enqueue(
      normalizeGeneratePresentationInput(payload),
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.get("/generate-jobs/:jobId", async (request, response, next) => {
  try {
    const result = presentationGenerationQueue.getStatus(request.params.jobId);

    if (!result) {
      response.status(404).json({
        error: `Generation job ${request.params.jobId} was not found.`,
      });
      return;
    }

    response.json(PresentationGenerationJobStatusResponseSchema.parse(result));
  } catch (error) {
    next(error);
  }
});

presentationsRouter.get("/", (_request, response) => {
  response.status(410).json({ error: "The old library has been retired. Use the V2 presentation library." });
});

presentationsRouter.get("/health", async (_request, response) => {
  const [llmHealth, illustrationHealth, visionHealth, sttHealth, ttsHealth, vadHealth] = await Promise.all([
    appContext.llmProvider.healthCheck(),
    appContext.illustrationProvider.healthCheck(),
    appContext.visionProvider.healthCheck(),
    appContext.sttProvider.healthCheck(),
    appContext.ttsProvider.healthCheck(),
    appContext.vadProvider.healthCheck(),
  ]);

  response.json({
    api: "ok",
    llmProvider: appContext.llmProvider.name,
    llmHealth,
    illustrationProvider: appContext.illustrationProvider.name,
    illustrationHealth,
    visionProvider: appContext.visionProvider.name,
    visionHealth,
    sttProvider: appContext.sttProvider.name,
    sttHealth,
    ttsProvider: appContext.ttsProvider.name,
    ttsHealth,
    vadProvider: appContext.vadProvider.name,
    vadHealth,
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

presentationsRouter.delete("/:sessionId", (_request, response) => {
  response.status(410).json({ error: "The old library has been retired. Archive presentations in the V2 library." });
});

presentationsRouter.get("/:sessionId/export/pptx", async (request, response, next) => {
  try {
    const result = await exportPresentationPptx(request.params.sessionId);
    response.download(result.filePath, result.fileName);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.get(
  "/:sessionId/slides/:slideId/illustration",
  async (request, response, next) => {
    try {
      const illustration = await getSlideIllustration({
        sessionId: request.params.sessionId,
        slideId: request.params.slideId,
      });

      response.json(illustration);
    } catch (error) {
      next(error);
    }
  },
);

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

presentationsRouter.post(["/:sessionId/interact", "/:sessionId/voice-turn"], (_request, response) => {
  response.status(410).json({ error: "Legacy questions have been retired. Generate and open a V2 presentation to use the new Q&A flow." });
});

presentationsRouter.post("/:sessionId/speech", async (request, response, next) => {
  try {
    const payload = SpeechSynthesisRequestSchema.parse(request.body);
    const result = await synthesizeSessionSpeech({
      sessionId: request.params.sessionId,
      text: payload.text,
      slideId: payload.slideId,
      narrationIndex: payload.narrationIndex,
      style: payload.style,
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post(
  "/:sessionId/narration/progress",
  async (request, response, next) => {
    try {
      const payload = NarrationProgressRequestSchema.parse(request.body);
      const result = await updateNarrationProgress({
        sessionId: request.params.sessionId,
        slideId: payload.slideId,
        narrationIndex: payload.narrationIndex,
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);

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
