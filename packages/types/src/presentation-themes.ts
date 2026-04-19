export const PRESENTATION_THEME_IDS = [
  "paper",
  "editorial",
  "signal",
] as const;

type PresentationThemeId = (typeof PRESENTATION_THEME_IDS)[number];

const hashSeed = (value: string) => {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

export const pickPresentationTheme = (seed: string): PresentationThemeId => {
  const normalizedSeed = seed.trim();
  const hash = hashSeed(normalizedSeed.length > 0 ? normalizedSeed : "paper");
  return PRESENTATION_THEME_IDS[hash % PRESENTATION_THEME_IDS.length] ?? "paper";
};

export const resolvePresentationTheme = (
  value: string | undefined,
  seed?: string,
): PresentationThemeId => {
  if (value && PRESENTATION_THEME_IDS.includes(value as PresentationThemeId)) {
    return value as PresentationThemeId;
  }

  return pickPresentationTheme(seed ?? "");
};
