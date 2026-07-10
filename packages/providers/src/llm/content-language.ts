import type { GenerateDeckInput } from "@slidespeech/types";

import { uniqueNonEmptyStrings } from "./deck-shape-text";

export type DeckContentLanguage = "en" | "sv";

type ContentLanguageInput = {
  topic?: string | undefined;
  presentationBrief?: string | undefined;
  intent?: Partial<NonNullable<GenerateDeckInput["intent"]>> | undefined;
  plan?: {
    title?: string | undefined;
    learningObjectives?: string[] | undefined;
    storyline?: string[] | undefined;
    recommendedSlideCount?: number | undefined;
    audienceLevel?: string | undefined;
  } | undefined;
};

export const inferContentLanguageFromInput = (
  input: ContentLanguageInput,
): DeckContentLanguage => {
  const sample = uniqueNonEmptyStrings([
    input.topic ?? "",
    input.presentationBrief ?? "",
    input.intent?.framing ?? "",
    input.intent?.subject ?? "",
    input.intent?.presentationGoal ?? "",
    input.plan?.title ?? "",
    ...(input.plan?.storyline ?? []),
    ...(input.plan?.learningObjectives ?? []),
  ])
    .join(" ")
    .toLocaleLowerCase();
  const swedishScore =
    (
      sample.match(
        /\b(?:skapa|gör|generera|skriv|presentation|översikt|om|för|och|att|som|med|till|mål|strategi|plan|arbete|beslut|frågor|hur)\b/gu,
      ) ?? []
    ).length + (/[åäö]/iu.test(sample) ? 1 : 0);
  const englishScore = (
    sample.match(
      /\b(?:create|make|generate|write|presentation\s+about|about|workshop|explain|describe|include|for|and|with|the)\b/gu,
    ) ?? []
  ).length;

  return swedishScore >= 2 && swedishScore > englishScore ? "sv" : "en";
};

export const contentLanguageInstruction = (
  language: DeckContentLanguage,
): string =>
  language === "sv"
    ? "Write the audience-facing title, storyline, and slide copy in Swedish. Proper nouns and source titles may stay in their original language."
    : "Write the audience-facing title, storyline, and slide copy in English. Proper nouns and source titles may stay in their original language.";

export const textAppearsOutsideContentLanguage = (
  value: string,
  language: DeckContentLanguage,
): boolean => {
  const normalized = value.toLocaleLowerCase();
  const swedishSignals =
    (normalized.match(/\b(?:att|av|det|den|en|ett|för|från|genom|hur|med|och|om|på|som|till|är)\b/gu) ?? []).length +
    (/[åäö]/u.test(normalized) ? 2 : 0);
  const englishSignals = (
    normalized.match(/\b(?:and|because|delivery|for|from|how|marketing|of|phase|phases|sales|strategy|structure|the|to|what|when|where|why|with)\b/gu) ?? []
  ).length;

  if (language === "sv") {
    return englishSignals >= 2 && englishSignals > swedishSignals;
  }

  return swedishSignals >= 3 && swedishSignals > englishSignals + 1;
};
