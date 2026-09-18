import { resolve } from "node:path";

import {
  NarrationProgressResponseSchema,
  SelectSlideResponseSchema,
  SessionSnapshotResponseSchema,
  SlideIllustrationResponseSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";
import type { PedagogicalProfile, PresentationTheme } from "@slidespeech/types";

import { GeneratePresentationResponseSchema } from "@slidespeech/types";

import { appContext } from "../lib/context";
import { buildPresentationGenerationContext } from "./generation-context-service";
import {
  deckIsReadyForReuse,
  sessionIsReadyForPresentationExport,
} from "./presentation-readiness";

export const createPresentation = async (input: {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
  useWebResearch?: boolean | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
  theme?: PresentationTheme | undefined;
  skipBackgroundEnrichment?: boolean | undefined;
}) => {
  if (appContext.llmProvider.name === "mock") {
    throw new Error(
      "LLM_PROVIDER=mock is test-only and cannot generate user-facing presentations. Configure LLM_PROVIDER=lmstudio or another real provider.",
    );
  }

  const llmHealth = await appContext.llmProvider.healthCheck();
  if (!llmHealth.ok) {
    throw new Error(`LLM provider is not ready: ${llmHealth.detail}`);
  }

  const generationContext = await buildPresentationGenerationContext({
    topic: input.topic,
    useWebResearch: input.useWebResearch,
  });

  const result = await appContext.sessionService.createSession(
    {
      ...generationContext,
      ...(input.pedagogicalProfile
        ? { pedagogicalProfile: input.pedagogicalProfile }
        : {}),
      ...(input.targetDurationMinutes
        ? { targetDurationMinutes: input.targetDurationMinutes }
        : {}),
      ...(input.targetSlideCount ? { targetSlideCount: input.targetSlideCount } : {}),
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.skipBackgroundEnrichment
        ? { skipBackgroundEnrichment: input.skipBackgroundEnrichment }
        : {}),
    },
  );

  const deck = await appContext.deckRepository.getById(result.session.deckId);

  if (!deck) {
    throw new Error("Deck was not found after generation.");
  }

  return GeneratePresentationResponseSchema.parse({
    deck,
    session: result.session,
    narrations: result.narrations,
    provider: appContext.llmProvider.name,
  });
};

export const getSlideNarration = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const narration = await appContext.sessionService.getOrGenerateNarration(
    input.sessionId,
    input.slideId,
  );

  return SlideNarrationSchema.parse(narration);
};

export const getSlideIllustration = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const snapshot = await appContext.sessionService.getSessionSnapshot(input.sessionId);
  const slide = snapshot.deck.slides.find((candidate) => candidate.id === input.slideId);

  if (!slide) {
    throw new Error(`Slide ${input.slideId} was not found in session ${input.sessionId}.`);
  }

  const asset = await appContext.illustrationProvider.renderSlideIllustration({
    deck: snapshot.deck,
    slide,
  });

  return SlideIllustrationResponseSchema.parse({
    asset,
    provider: appContext.illustrationProvider.name,
  });
};


export const selectSlide = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const result = await appContext.sessionService.selectSlide(
    input.sessionId,
    input.slideId,
  );

  return SelectSlideResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    provider: appContext.llmProvider.name,
  });
};

export const updateNarrationProgress = async (input: {
  sessionId: string;
  slideId?: string | undefined;
  narrationIndex: number;
}) => {
  const result = await appContext.sessionService.updateNarrationProgress(
    input.sessionId,
    input.slideId,
    input.narrationIndex,
  );

  return NarrationProgressResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    provider: appContext.llmProvider.name,
  });
};

export const getSessionSnapshot = async (sessionId: string) => {
  const result = await appContext.sessionService.getSessionSnapshot(sessionId);

  return SessionSnapshotResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    transcripts: result.transcripts,
    provider: appContext.llmProvider.name,
  });
};

export const exportPresentationPptx = async (sessionId: string) => {
  const snapshot = await appContext.sessionService.getSessionSnapshot(sessionId);
  if (!sessionIsReadyForPresentationExport(snapshot.session.state)) {
    throw new Error(
      `Presentation ${sessionId} is not ready for export while session state is ${snapshot.session.state}.`,
    );
  }

  if (!deckIsReadyForReuse(snapshot.deck)) {
    throw new Error(
      "Presentation is still being prepared and cannot be exported yet.",
    );
  }

  const fileName = `${snapshot.deck.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || sessionId}.pptx`;
  const outputPath = resolve(appContext.exportRoot, `${sessionId}.pptx`);

  const filePath = await appContext.deckExporter.exportToPptx(
    snapshot.deck,
    outputPath,
  );

  return {
    filePath,
    fileName,
    deck: snapshot.deck,
  };
};
