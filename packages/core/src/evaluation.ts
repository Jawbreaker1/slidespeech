import type {
  Deck,
  DeckEvaluation,
  DeckEvaluationCheck,
  SlideNarration,
} from "@slidespeech/types";

const buildCheck = (
  code: string,
  status: DeckEvaluationCheck["status"],
  message: string,
  slideId?: string,
): DeckEvaluationCheck => ({
  code,
  status,
  message,
  ...(slideId ? { slideId } : {}),
});

export const evaluateDeckQuality = (
  deck: Deck,
  narrations: SlideNarration[] = [],
  options: { includeNarration?: boolean } = {},
): DeckEvaluation => {
  const checks: DeckEvaluationCheck[] = [];
  const persistedValidationErrors =
    deck.metadata.validation?.issues.filter((issue) => issue.severity === "error") ?? [];
  const persistedValidationFailed = deck.metadata.validation?.passed === false;

  checks.push(
    buildCheck(
      "persisted_validation_errors",
      !persistedValidationFailed && persistedValidationErrors.length === 0
        ? "pass"
        : "fail",
      !persistedValidationFailed && persistedValidationErrors.length === 0
        ? "Persisted deck validation has no blocking errors."
        : persistedValidationErrors.length > 0
          ? `Persisted validation still has ${persistedValidationErrors.length} blocking issue(s): ${persistedValidationErrors
              .slice(0, 2)
              .map((issue) => issue.message)
              .join(" | ")}`
          : "Persisted validation did not approve the deck.",
    ),
  );

  checks.push(
    buildCheck(
      "slide_structure",
      deck.slides.length > 0 && deck.slides.every((slide) => slide.title.trim())
        ? "pass"
        : "fail",
      deck.slides.length > 0 && deck.slides.every((slide) => slide.title.trim())
        ? "Deck contains addressable slides with titles."
        : "Deck is missing slides or slide titles.",
    ),
  );

  if (options.includeNarration !== false) {
    const narrationBySlideId = new Map(
      narrations.map((narration) => [narration.slideId, narration]),
    );
    const missingNarrationSlides = deck.slides.filter(
      (slide) => !narrationBySlideId.has(slide.id),
    );

    checks.push(
      buildCheck(
        "narration_completeness",
        missingNarrationSlides.length === 0 ? "pass" : "fail",
        missingNarrationSlides.length === 0
          ? "Every slide has generated narration."
          : `${missingNarrationSlides.length} slide(s) are missing generated narration.`,
      ),
    );
  }

  const visuallyEmptySlides = deck.slides.filter((slide) => {
    const visualWeight =
      slide.visuals.cards.length +
      slide.visuals.callouts.length +
      slide.visuals.diagramNodes.length +
      slide.visuals.imageSlots.length;
    return visualWeight === 0;
  });
  checks.push(
    buildCheck(
      "visual_structure",
      visuallyEmptySlides.length === 0 ? "pass" : "warning",
      visuallyEmptySlides.length === 0
        ? "Slides expose renderer-ready visual structure."
        : `${visuallyEmptySlides.length} slide(s) have no structured visual elements.`,
    ),
  );

  const deductions = checks.reduce((sum, check) => {
    if (check.status === "fail") {
      return sum + 0.25;
    }

    if (check.status === "warning") {
      return sum + 0.05;
    }

    return sum;
  }, 0);

  const overallScore = Math.max(0, Math.min(1, 1 - deductions));
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const summary =
    failCount === 0 && warningCount === 0
      ? "Deck passed local structural evaluation."
      : `Local structural evaluation found ${failCount} failing and ${warningCount} warning checks.`;

  return {
    evaluatedAt: new Date().toISOString(),
    overallScore,
    summary,
    checks,
  };
};
