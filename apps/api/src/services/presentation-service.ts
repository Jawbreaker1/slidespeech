import { resolve } from "node:path";

import {
  DeletePresentationResponseSchema,
  ListSavedPresentationsResponseSchema,
  NarrationProgressResponseSchema,
  SelectSlideResponseSchema,
  SessionSnapshotResponseSchema,
  SessionInteractionResponseSchema,
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

export const interactWithSession = async (input: {
  sessionId: string;
  text: string;
}) => {
  const result = await appContext.sessionService.interact(
    input.sessionId,
    input.text,
  );

  return SessionInteractionResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    interruption: result.interruption,
    turnDecision: result.turnDecision,
    resumePlan: result.resumePlan,
    assistantMessage: result.assistantMessage,
    narration: result.narration,
    provider: appContext.llmProvider.name,
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

export const listSavedPresentations = async (input?: {
  limit?: number;
  offset?: number;
  readyOnly?: boolean;
}) => {
  const normalizedLimit =
    input?.limit !== undefined && Number.isFinite(input.limit) ? input.limit : 12;
  const normalizedOffset =
    input?.offset !== undefined && Number.isFinite(input.offset) ? input.offset : 0;
  const limit = Math.max(1, Math.min(normalizedLimit, 50));
  const offset = Math.max(0, normalizedOffset);
  const readyOnly = input?.readyOnly ?? true;
  const [sessions, decks] = await Promise.all([
    appContext.sessionRepository.list(),
    appContext.deckRepository.list(),
  ]);
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));

  const items = sessions
    .map((session) => {
      const deck = deckById.get(session.deckId);

      if (!deck) {
        return null;
      }

      const ready = deckIsReadyForReuse(deck);

      if (readyOnly && !ready) {
        return null;
      }

      return {
        sessionId: session.id,
        deckId: deck.id,
        title: deck.title,
        summary: deck.summary,
        topic: deck.topic,
        slideCount: deck.slides.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sourceType: deck.source.type,
        generation: deck.metadata.generation,
        validation: deck.metadata.validation,
        evaluation: deck.metadata.evaluation,
        ready,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return ListSavedPresentationsResponseSchema.parse({
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    readyOnly,
    hasMore: offset + limit < items.length,
  });
};

export const deleteSavedPresentation = async (sessionId: string) => {
  const session = await appContext.sessionRepository.getById(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  const deck = await appContext.deckRepository.getById(session.deckId);

  if (!deck) {
    throw new Error(`Deck ${session.deckId} was not found.`);
  }

  if (!deckIsReadyForReuse(deck)) {
    throw new Error(
      "Only fully prepared presentations can be deleted from the library.",
    );
  }

  const allSessions = await appContext.sessionRepository.list();
  const deckStillReferencedByOtherSessions = allSessions.some(
    (candidate) => candidate.id !== sessionId && candidate.deckId === session.deckId,
  );

  await appContext.transcriptRepository.deleteBySessionId(sessionId);
  await appContext.sessionRepository.delete(sessionId);

  if (!deckStillReferencedByOtherSessions) {
    await appContext.deckRepository.delete(session.deckId);
  }

  return DeletePresentationResponseSchema.parse({
    deletedSessionId: sessionId,
    ...(deckStillReferencedByOtherSessions ? {} : { deletedDeckId: session.deckId }),
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
