export const normalizeAudienceLevel = (value: unknown): string => {
  if (typeof value !== "string") {
    return "beginner";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "beginner" ||
    normalized === "intermediate" ||
    normalized === "advanced" ||
    normalized === "mixed"
  ) {
    return normalized;
  }

  return "beginner";
};

const normalizePace = (value: unknown): "slow" | "balanced" | "fast" => {
  if (typeof value !== "string") {
    return "balanced";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "slow" || normalized === "balanced" || normalized === "fast") {
    return normalized;
  }

  if (
    normalized === "self-paced" ||
    normalized === "self paced" ||
    normalized === "steady" ||
    normalized === "moderate"
  ) {
    return "balanced";
  }

  if (normalized === "quick" || normalized === "rapid" || normalized === "faster") {
    return "fast";
  }

  if (
    normalized === "gentle" ||
    normalized === "deliberate" ||
    normalized === "slower"
  ) {
    return "slow";
  }

  return "balanced";
};

const normalizePreferredExampleStyle = (
  value: unknown,
): "real_world" | "technical" | "analogy" => {
  if (typeof value !== "string") {
    return "real_world";
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");

  if (
    normalized === "real_world" ||
    normalized === "technical" ||
    normalized === "analogy"
  ) {
    return normalized;
  }

  if (normalized === "real-life" || normalized === "real_life" || normalized === "practical") {
    return "real_world";
  }

  return "real_world";
};

const normalizeDetailLevel = (value: unknown): "light" | "standard" | "deep" => {
  if (typeof value !== "string") {
    return "standard";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "light" || normalized === "standard" || normalized === "deep") {
    return normalized;
  }

  if (
    normalized === "simple" ||
    normalized === "concise" ||
    normalized === "brief"
  ) {
    return "light";
  }

  if (
    normalized === "detailed" ||
    normalized === "in-depth" ||
    normalized === "in_depth" ||
    normalized === "advanced"
  ) {
    return "deep";
  }

  return "standard";
};

export const normalizePedagogicalProfile = (value: unknown) => {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
    tone:
      typeof candidate.tone === "string" && candidate.tone.trim().length > 0
        ? candidate.tone
        : "supportive and concrete",
    pace: normalizePace(candidate.pace),
    preferredExampleStyle: normalizePreferredExampleStyle(
      candidate.preferredExampleStyle,
    ),
    wantsFrequentChecks:
      typeof candidate.wantsFrequentChecks === "boolean"
        ? candidate.wantsFrequentChecks
        : true,
    detailLevel: normalizeDetailLevel(candidate.detailLevel),
  };
};
