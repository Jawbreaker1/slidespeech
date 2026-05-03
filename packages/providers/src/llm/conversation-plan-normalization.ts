import { toStringArray } from "./structured-normalization";

const normalizeConversationNeeds = (value: unknown): string[] => {
  const validNeeds = new Set([
    "question",
    "confusion",
    "example",
    "deepen",
    "repeat",
    "navigation",
    "pause",
    "resume",
  ]);

  return toStringArray(value)
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((item) => validNeeds.has(item));
};

export const normalizeConversationPlan = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const runtimeEffects =
    candidate.runtimeEffects && typeof candidate.runtimeEffects === "object"
      ? (candidate.runtimeEffects as Record<string, unknown>)
      : {};

  const interruptionType =
    typeof candidate.interruptionType === "string"
      ? candidate.interruptionType.trim().toLowerCase()
      : "question";
  const responseMode =
    typeof candidate.responseMode === "string"
      ? candidate.responseMode.trim().toLowerCase()
      : interruptionType === "stop"
        ? "ack_pause"
        : interruptionType === "continue"
          ? "ack_resume"
          : interruptionType === "back"
            ? "ack_back"
            : interruptionType === "simplify"
              ? "simplify"
              : interruptionType === "example"
                ? "example"
                : interruptionType === "deepen"
                  ? "deepen"
                  : interruptionType === "repeat"
                    ? "repeat"
                    : "question";

  return {
    interruptionType,
    inferredNeeds: normalizeConversationNeeds(candidate.inferredNeeds),
    responseMode,
    runtimeEffects: {
      pause: runtimeEffects.pause === true,
      resume: runtimeEffects.resume === true,
      goToPreviousSlide: runtimeEffects.goToPreviousSlide === true,
      restartCurrentSlide: runtimeEffects.restartCurrentSlide === true,
      adaptDetailLevel:
        typeof runtimeEffects.adaptDetailLevel === "string"
          ? runtimeEffects.adaptDetailLevel.trim().toLowerCase()
          : undefined,
      adaptPace:
        typeof runtimeEffects.adaptPace === "string"
          ? runtimeEffects.adaptPace.trim().toLowerCase()
          : undefined,
    },
    confidence:
      typeof candidate.confidence === "number"
        ? candidate.confidence
        : 0.7,
    rationale:
      typeof candidate.rationale === "string"
        ? candidate.rationale
        : "Structured conversation plan generated from the current turn.",
  };
};
