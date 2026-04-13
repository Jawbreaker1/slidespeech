import type { Deck, Slide, SlideNarration } from "@slidespeech/types";

type ValidationIssue = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  slideId?: string;
};

type ValidationResult<T> = {
  value: T;
  issues: ValidationIssue[];
  repaired: boolean;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const slideConceptTokens = (slide: Slide): string[] =>
  unique(
    tokenize(
      [
        slide.title,
        slide.learningGoal,
        slide.beginnerExplanation,
        ...slide.keyPoints,
        ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
        ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
        ...slide.visuals.diagramNodes.map((node) => node.label),
      ].join(" "),
    ),
  );

const buildAnchoredNarration = (
  deck: Deck,
  slide: Slide,
  existing: SlideNarration | undefined,
): SlideNarration => {
  const nextSlide = deck.slides[slide.order + 1];
  const isIntro = slide.order === 0;
  const segments = isIntro
    ? [
        `On this opening slide, we are introducing ${slide.title}.`,
        slide.beginnerExplanation,
        `Focus on these ideas on the slide: ${slide.keyPoints.slice(0, 3).join(", ")}.`,
        nextSlide
          ? `This sets us up for ${nextSlide.title.toLowerCase()}.`
          : "This gives us a clear starting point for the rest of the presentation.",
      ]
    : [
        `This slide focuses on ${slide.title}.`,
        slide.beginnerExplanation,
        `The visible takeaways here are ${slide.keyPoints.slice(0, 3).join(", ")}.`,
        nextSlide
          ? `From here, we move into ${nextSlide.title.toLowerCase()}.`
          : "This slide brings the presentation to a clear close.",
      ];

  return {
    slideId: slide.id,
    narration: segments.join(" "),
    segments,
    summaryLine: existing?.summaryLine ?? slide.learningGoal,
    promptsForPauses:
      existing?.promptsForPauses.length
        ? existing.promptsForPauses
        : [
            "Pause me if you want this explained more simply.",
            "Ask for an example if you want something more concrete.",
          ],
    suggestedTransition:
      existing?.suggestedTransition ??
      (nextSlide
        ? `Bridge clearly into ${nextSlide.title}.`
        : "Finish with a concise recap of the final slide."),
  };
};

export const validateAndRepairDeck = (deck: Deck): ValidationResult<Deck> => {
  const issues: ValidationIssue[] = [];
  let repaired = false;

  const slides = deck.slides.map((slide, index) => {
    let nextSlide = slide;

    if (slide.order !== index) {
      repaired = true;
      issues.push({
        code: "slide_order_normalized",
        message: `Slide order for "${slide.title}" was normalized to match deck position.`,
        severity: "warning",
        slideId: slide.id,
      });
      nextSlide = {
        ...nextSlide,
        order: index,
      };
    }

    if (nextSlide.visuals.cards.length === 0 && nextSlide.keyPoints.length > 0) {
      repaired = true;
      issues.push({
        code: "missing_visual_cards_repaired",
        message: `Slide "${slide.title}" had no visual cards and was repaired from key points.`,
        severity: "warning",
        slideId: slide.id,
      });
      nextSlide = {
        ...nextSlide,
        visuals: {
          ...nextSlide.visuals,
          cards: nextSlide.keyPoints.slice(0, 3).map((point, keyPointIndex) => ({
            id: `${slide.id}-auto-card-${keyPointIndex + 1}`,
            title: `Key point ${keyPointIndex + 1}`,
            body: point,
            tone:
              keyPointIndex === 0
                ? "accent"
                : keyPointIndex === 1
                  ? "neutral"
                  : "success",
          })),
        },
      };
    }

    return nextSlide;
  });

  const introSlide = slides[0];
  if (introSlide && introSlide.keyPoints.length < 3) {
    issues.push({
      code: "intro_slide_thin",
      message: "The opening slide is thinner than expected and may feel weak.",
      severity: "warning",
      slideId: introSlide.id,
    });
  }

  return {
    value: {
      ...deck,
      slides,
      metadata: {
        ...deck.metadata,
        validation: {
          passed: !issues.some((issue) => issue.severity === "error"),
          repaired,
          validatedAt: new Date().toISOString(),
          issues,
        },
      },
    },
    issues,
    repaired,
  };
};

export const validateAndRepairNarrations = (
  deck: Deck,
  narrations: SlideNarration[],
): ValidationResult<SlideNarration[]> => {
  const issues: ValidationIssue[] = [];
  let repaired = false;
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, narration]),
  );

  const validatedNarrations = deck.slides.map((slide) => {
    const existing = narrationBySlideId.get(slide.id);
    const minSegments = slide.order === 0 ? 4 : 3;
    const slideTokens = slideConceptTokens(slide);
    const narrationTokens = tokenize(
      [
        existing?.narration ?? "",
        ...(existing?.segments ?? []),
      ].join(" "),
    );
    const overlap = slideTokens.filter((token) => narrationTokens.includes(token));
    const needsRepair =
      !existing ||
      existing.segments.length < minSegments ||
      existing.narration.trim().length < (slide.order === 0 ? 180 : 110) ||
      overlap.length < Math.min(3, Math.max(1, Math.floor(slideTokens.length / 6)));

    if (!needsRepair) {
      return existing;
    }

    repaired = true;
    issues.push({
      code: existing ? "narration_reanchored" : "narration_generated_fallback",
      message: existing
        ? `Narration for "${slide.title}" was repaired to align more tightly with the slide.`
        : `Narration for "${slide.title}" was generated from deterministic slide anchors.`,
      severity: "warning",
      slideId: slide.id,
    });

    return buildAnchoredNarration(deck, slide, existing);
  });

  return {
    value: validatedNarrations,
    issues,
    repaired,
  };
};

