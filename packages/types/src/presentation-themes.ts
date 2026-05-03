export const PRESENTATION_THEME_IDS = [
  "paper",
  "editorial",
  "signal",
] as const;

export type PresentationThemeId = (typeof PRESENTATION_THEME_IDS)[number];

export const PRESENTATION_THEME_OPTIONS: Array<{
  id: PresentationThemeId;
  label: string;
  description: string;
  preview: {
    background: string;
    accent: string;
    text: string;
  };
}> = [
  {
    id: "paper",
    label: "Paper",
    description: "Clean, neutral and presentation-safe.",
    preview: {
      background: "#F8FAFC",
      accent: "#1C7C7D",
      text: "#0F172A",
    },
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Warm, magazine-like and more distinctive.",
    preview: {
      background: "#FAF4EA",
      accent: "#B7791F",
      text: "#20180F",
    },
  },
  {
    id: "signal",
    label: "Signal",
    description: "Crisp, technical and high-contrast.",
    preview: {
      background: "#EFF6FF",
      accent: "#0284C7",
      text: "#0F172A",
    },
  },
];

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
