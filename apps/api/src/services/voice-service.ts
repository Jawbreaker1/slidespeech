import {
  VoiceTurnResponseSchema,
} from "@slidespeech/types";
import type { AudioChunk } from "@slidespeech/types";

import { appContext } from "../lib/context";

export const processVoiceTurn = async (input: {
  sessionId: string;
  mimeType: string;
  dataBase64: string;
}) => {
  const audioChunk: AudioChunk = {
    chunkId: `voice_${Date.now()}`,
    mimeType: input.mimeType,
    dataBase64: input.dataBase64,
  };

  const speechEvent = await appContext.vadProvider.detectSpeech(audioChunk);
  const snapshot = await appContext.sessionService.getSessionSnapshot(input.sessionId);

  if (!speechEvent.hasSpeech) {
    return VoiceTurnResponseSchema.parse({
      deck: snapshot.deck,
      session: snapshot.session,
      provider: appContext.llmProvider.name,
      sttProvider: appContext.sttProvider.name,
      vadProvider: appContext.vadProvider.name,
      speechEvent,
      interactionApplied: false,
      narration: snapshot.narration,
    });
  }

  const transcript = await appContext.sttProvider.transcribe(audioChunk);
  if (!transcript.text.trim()) {
    return VoiceTurnResponseSchema.parse({
      deck: snapshot.deck,
      session: snapshot.session,
      provider: appContext.llmProvider.name,
      sttProvider: appContext.sttProvider.name,
      vadProvider: appContext.vadProvider.name,
      speechEvent,
      transcript,
      interactionApplied: false,
      narration: snapshot.narration,
    });
  }

  const interaction = await appContext.sessionService.interact(
    input.sessionId,
    transcript.text,
  );

  return VoiceTurnResponseSchema.parse({
    deck: interaction.deck,
    session: interaction.session,
    provider: appContext.llmProvider.name,
    sttProvider: appContext.sttProvider.name,
    vadProvider: appContext.vadProvider.name,
    speechEvent,
    transcript,
    interactionApplied: true,
    interruption: interaction.interruption,
    turnDecision: interaction.turnDecision,
    resumePlan: interaction.resumePlan,
    assistantMessage: interaction.assistantMessage,
    narration: interaction.narration,
  });
};
