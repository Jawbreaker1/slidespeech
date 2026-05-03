import {
  VoiceTurnResponseSchema,
} from "@slidespeech/types";
import type { AudioChunk } from "@slidespeech/types";

import { appContext } from "../lib/context";

const VOICE_WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

const tokenizeVoiceTranscript = (value: string): string[] =>
  Array.from(value.normalize("NFKC").matchAll(VOICE_WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);

const isLowSignalVoiceTranscript = (
  value: string,
  confidence?: number,
): boolean => {
  const normalized = value.replace(/\s+/g, " ").trim();
  const tokens = tokenizeVoiceTranscript(normalized);

  if (tokens.length === 0) {
    return true;
  }

  if (tokens.length === 1 && tokens[0]!.length <= 3) {
    return true;
  }

  if (normalized.length < 10 && tokens.length < 3) {
    return true;
  }

  const uniqueTokenCount = new Set(tokens.map((token) => token.toLowerCase())).size;
  if (uniqueTokenCount === 1 && tokens.length <= 2) {
    return true;
  }

  if (typeof confidence === "number" && confidence < 0.45 && tokens.length < 4) {
    return true;
  }

  return false;
};

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
  const transcriptText = transcript.text.trim();

  if (!transcriptText) {
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

  if (isLowSignalVoiceTranscript(transcriptText, transcript.confidence)) {
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
    transcriptText,
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
