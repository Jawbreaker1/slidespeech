import {
  SelectSlideResponseSchema,
  SessionSnapshotResponseSchema,
  SessionInteractionResponseSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";
import type { PedagogicalProfile } from "@slidespeech/types";

import { GeneratePresentationResponseSchema } from "@slidespeech/types";

import { appContext } from "../lib/context";

export const createPresentation = async (input: {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
}) => {
  const result = await appContext.sessionService.createSession(
    input.pedagogicalProfile
      ? {
          topic: input.topic,
          pedagogicalProfile: input.pedagogicalProfile,
        }
      : { topic: input.topic },
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
