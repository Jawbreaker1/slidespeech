import { SpeechSynthesisResponseSchema } from "@slidespeech/types";

import { appContext } from "../lib/context";

const getNarrationSegment = (input: {
  narrationText: string;
  segments: string[];
  narrationIndex: number;
}): { text: string; narrationIndex: number } => {
  const segments =
    input.segments.length > 0 ? input.segments : [input.narrationText];
  const narrationIndex = Math.max(
    0,
    Math.min(input.narrationIndex, segments.length - 1),
  );

  return {
    text: segments[narrationIndex] ?? input.narrationText,
    narrationIndex,
  };
};

const speakingRateForPace = (
  pace: "slow" | "balanced" | "fast",
): number => {
  switch (pace) {
    case "slow":
      return 0.9;
    case "fast":
      return 1.1;
    case "balanced":
    default:
      return 1;
  }
};

export const synthesizeSessionSpeech = async (input: {
  sessionId: string;
  text?: string | undefined;
  slideId?: string | undefined;
  narrationIndex?: number | undefined;
  style?: "narration" | "answer" | "summary" | undefined;
}) => {
  const snapshot = await appContext.sessionService.getSessionSnapshot(input.sessionId);
  const style = input.style ?? "narration";

  if (input.text?.trim()) {
    const text = input.text.trim();
    const audio = await appContext.ttsProvider.synthesize(text, {
      style,
      speakingRate: speakingRateForPace(snapshot.session.pedagogicalProfile.pace),
    });

    return SpeechSynthesisResponseSchema.parse({
      deck: snapshot.deck,
      session: snapshot.session,
      provider: appContext.llmProvider.name,
      ttsProvider: appContext.ttsProvider.name,
      source: {
        type: "text",
      },
      text,
      narration: snapshot.narration,
      audio,
    });
  }

  const slideId =
    input.slideId ??
    snapshot.session.currentSlideId ??
    snapshot.deck.slides[snapshot.session.currentSlideIndex]?.id;

  if (!slideId) {
    throw new Error("No active slide is available for speech synthesis.");
  }

  const narration = await appContext.sessionService.getOrGenerateNarration(
    input.sessionId,
    slideId,
  );
  const { text, narrationIndex } = getNarrationSegment({
    narrationText: narration.narration,
    segments: narration.segments,
    narrationIndex:
      input.narrationIndex ?? snapshot.session.currentNarrationIndex ?? 0,
  });
  const audio = await appContext.ttsProvider.synthesize(text, {
    style,
    speakingRate: speakingRateForPace(snapshot.session.pedagogicalProfile.pace),
  });

  return SpeechSynthesisResponseSchema.parse({
    deck: snapshot.deck,
    session: snapshot.session,
    provider: appContext.llmProvider.name,
    ttsProvider: appContext.ttsProvider.name,
    source: {
      type: "narration_segment",
      slideId,
      narrationIndex,
    },
    text,
    narration,
    audio,
  });
};
