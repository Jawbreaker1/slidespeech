import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  PresentationIntent,
  RenderSlideIllustrationInput,
  SlideIllustrationAsset,
  SlideImageStyle,
  SlideLayoutTemplate,
} from "@slidespeech/types";

type CuratedFallbackCategory =
  | "organization_team"
  | "workshop_classroom"
  | "generic_editorial";

interface CuratedFallbackEntry {
  id: string;
  fileName: string;
  categories: CuratedFallbackCategory[];
  preferredStyles?: SlideImageStyle[];
  preferredLayouts?: SlideLayoutTemplate[];
}

const CURATED_FALLBACK_ENTRIES: CuratedFallbackEntry[] = [
  {
    id: "reading",
    fileName: "reading.svg",
    categories: ["workshop_classroom", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus", "two-column-callouts"],
  },
  {
    id: "reading-side",
    fileName: "reading-side.svg",
    categories: ["workshop_classroom", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["two-column-callouts"],
  },
  {
    id: "sitting-reading",
    fileName: "sitting-reading.svg",
    categories: ["workshop_classroom", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus", "two-column-callouts"],
  },
  {
    id: "strolling",
    fileName: "strolling.svg",
    categories: ["organization_team", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus"],
  },
  {
    id: "sitting",
    fileName: "sitting.svg",
    categories: ["organization_team", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus", "two-column-callouts"],
  },
  {
    id: "float",
    fileName: "float.svg",
    categories: ["organization_team", "generic_editorial"],
    preferredStyles: ["editorial", "abstract"],
    preferredLayouts: ["hero-focus"],
  },
  {
    id: "sleek",
    fileName: "sleek.svg",
    categories: ["organization_team", "generic_editorial"],
    preferredStyles: ["editorial", "abstract"],
    preferredLayouts: ["hero-focus"],
  },
  {
    id: "laying",
    fileName: "laying.svg",
    categories: ["generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus"],
  },
  {
    id: "unboxing",
    fileName: "unboxing.svg",
    categories: ["workshop_classroom", "generic_editorial"],
    preferredStyles: ["editorial"],
    preferredLayouts: ["hero-focus", "two-column-callouts"],
  },
  {
    id: "plant",
    fileName: "plant.svg",
    categories: ["organization_team", "generic_editorial"],
    preferredStyles: ["editorial", "abstract"],
    preferredLayouts: ["hero-focus"],
  },
];

const FALLBACK_ASSET_ROOT = path.resolve(
  __dirname,
  "../../assets/fallback-illustrations/opendoodles",
);

const svgDataUriCache = new Map<string, string>();

const hashString = (value: string) => {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const encodeSvgDataUri = (svg: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

const getDeckIntent = (
  input: RenderSlideIllustrationInput,
): PresentationIntent | undefined =>
  (
    input.deck as RenderSlideIllustrationInput["deck"] & {
      intent?: PresentationIntent;
    }
  ).intent;

const isOrganizationPresentation = (input: RenderSlideIllustrationInput) => {
  const intent = getDeckIntent(input);
  return (
    intent?.presentationFrame === "organization" ||
    (intent?.presentationFrame === "mixed" && Boolean(intent.organization))
  );
};

export const categorizeCuratedFallback = (
  input: RenderSlideIllustrationInput,
): CuratedFallbackCategory | null => {
  const slot = input.slide.visuals.imageSlots[0];
  const layout = input.slide.visuals.layoutTemplate;

  if (
    slot?.style === "diagram" ||
    slot?.style === "screenshot-like" ||
    layout === "three-step-flow" ||
    layout === "summary-board"
  ) {
    return null;
  }

  if (getDeckIntent(input)?.deliveryFormat === "workshop") {
    return "workshop_classroom";
  }

  if (isOrganizationPresentation(input)) {
    return "organization_team";
  }

  return "generic_editorial";
};

const scoreCuratedFallbackEntry = (
  entry: CuratedFallbackEntry,
  input: RenderSlideIllustrationInput,
  category: CuratedFallbackCategory,
) => {
  const slot = input.slide.visuals.imageSlots[0];
  const layout = input.slide.visuals.layoutTemplate;
  let score = 0;

  if (entry.categories.includes(category)) {
    score += 5;
  }

  if (slot?.style && entry.preferredStyles?.includes(slot.style)) {
    score += 3;
  }

  if (entry.preferredLayouts?.includes(layout)) {
    score += 2;
  }

  return score;
};

const chooseCuratedFallbackEntry = (
  input: RenderSlideIllustrationInput,
  category: CuratedFallbackCategory,
) => {
  const rankedEntries = CURATED_FALLBACK_ENTRIES.filter((entry) =>
    entry.categories.includes(category),
  ).sort(
    (left, right) =>
      scoreCuratedFallbackEntry(right, input, category) -
      scoreCuratedFallbackEntry(left, input, category),
  );

  if (rankedEntries.length === 0) {
    return null;
  }

  const seed = hashString(`${input.deck.id}:${input.slide.id}:${category}`);
  return rankedEntries[seed % rankedEntries.length] ?? rankedEntries[0] ?? null;
};

const loadCuratedSvgDataUri = async (fileName: string) => {
  const cached = svgDataUriCache.get(fileName);
  if (cached) {
    return cached;
  }

  const svg = await readFile(path.join(FALLBACK_ASSET_ROOT, fileName), "utf8");
  const dataUri = encodeSvgDataUri(svg);
  svgDataUriCache.set(fileName, dataUri);
  return dataUri;
};

export const buildCuratedFallbackIllustration = async (
  input: RenderSlideIllustrationInput,
): Promise<SlideIllustrationAsset | null> => {
  const slot = input.slide.visuals.imageSlots[0];
  if (!slot) {
    return null;
  }

  const category = categorizeCuratedFallback(input);
  if (!category) {
    return null;
  }

  const entry = chooseCuratedFallbackEntry(input, category);
  if (!entry) {
    return null;
  }

  const dataUri = await loadCuratedSvgDataUri(entry.fileName);
  const title = slot.altText || input.slide.title;

  return {
    slideId: input.slide.id,
    slotId: slot.id,
    kind: "curated",
    mimeType: "image/svg+xml",
    dataUri,
    altText: title,
    ...(slot.caption ? { caption: slot.caption } : {}),
  };
};
