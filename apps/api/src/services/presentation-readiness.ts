import type { Deck } from "@slidespeech/types";

export const deckIsReadyForReuse = (deck: Pick<Deck, "metadata">): boolean => {
  const generation = deck.metadata.generation;
  const validation = deck.metadata.validation;

  if (!generation || validation?.passed !== true) {
    return false;
  }

  return (
    !generation.backgroundEnrichmentPending &&
    generation.narrationReadySlides >= generation.totalSlides
  );
};

export const sessionIsReadyForPresentationExport = (state: string): boolean =>
  state === "presenting" || state === "slide_paused" || state === "finished";
