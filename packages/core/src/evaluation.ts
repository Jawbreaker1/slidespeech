import type {
  Deck,
  DeckEvaluation,
  DeckEvaluationCheck,
  Slide,
  SlideNarration,
} from "@slidespeech/types";

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

const META_PATTERNS = [
  /\bthis slide\b/i,
  /\bslides?\b/i,
  /\bpresentation\b/i,
  /\bdeck\b/i,
  /\buse screenshots?\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\btext-heavy\b/i,
  /\bhigh-resolution\b/i,
  /\bfor every slide\b/i,
  /\bblueprint\b/i,
];

const PROMPT_CONTAMINATION_PATTERNS = [
  /\bcreate (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/i,
  /\bmake (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/i,
  /\bmore information is available at\b/i,
  /\buse google\b/i,
  /\bour company\b/i,
];

const TEMPLATE_LANGUAGE_PATTERNS = [
  /\bthis part of\b/i,
  /\bbroader goals? of\b/i,
  /\bday-to-day work\b/i,
  /\bdelivery work\b/i,
  /\bcustomer outcomes?\b/i,
  /\bin practical delivery work\b/i,
];

const PROMOTIONAL_NOISE_PATTERNS = [
  /\bsubscribe now\b/i,
  /\blearn more\b/i,
  /\b6-month subscription offer\b/i,
  /\bblaze through\b/i,
  /\bfree trial\b/i,
  /\bupgrade now\b/i,
];

const AWKWARD_LANGUAGE_PATTERNS = [
  /\bunderstand the role of\b/i,
  /\bthe role of .+ in .+\b/i,
  /^\s*use\b/i,
  /\b(?:due to|because|connected to|related to)\s+(?:a|an|the)?$/i,
  /\bas$/i,
];

const INFORMATIVE_VERB_PATTERN =
  /\b(is|are|was|were|helps?|support(?:s)?|show(?:s)?|mean(?:s)?|include(?:s)?|use(?:s|d)?|serve(?:s|d)?|function(?:s)?|operate(?:s)?|connect(?:s)?|explain(?:s|ed)?|confirm(?:s|ed)?|provide(?:s|d)?)\b/i;

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const slideText = (slide: Slide): string =>
  [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    slide.advancedExplanation,
    ...slide.keyPoints,
    ...slide.examples,
    ...slide.visualNotes,
    ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
    ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
    ...slide.visuals.diagramNodes.map((node) => node.label),
    ...slide.visuals.imageSlots.map((slot) => `${slot.prompt} ${slot.caption ?? ""}`),
  ].join(" ");

const narrationText = (narration?: SlideNarration): string =>
  narration ? [narration.narration, ...narration.segments].join(" ") : "";

const topicTokens = (deck: Deck): string[] =>
  unique(tokenize([deck.topic, deck.title, deck.summary].join(" ")));

const overlapRatio = (anchors: string[], candidate: string[]): number => {
  if (anchors.length === 0 || candidate.length === 0) {
    return 0;
  }

  const overlap = anchors.filter((token) => candidate.includes(token)).length;
  return overlap / anchors.length;
};

const normalizedImagePrompt = (slide: Slide): string => {
  const prompt =
    slide.visuals.imageSlots[0]?.prompt ??
    slide.visuals.imagePrompt ??
    "";

  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
};

const looksFragmentaryKeyPoint = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^[a-z]/.test(trimmed)) {
    return true;
  }

  const tokens = tokenize(trimmed);
  return tokens.length >= 6 && !INFORMATIVE_VERB_PATTERN.test(trimmed);
};

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
): DeckEvaluation => {
  const checks: DeckEvaluationCheck[] = [];
  const deckTopicTokens = topicTokens(deck);
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, narration]),
  );

  const introSlide = deck.slides[0];
  if (introSlide) {
    const introScore =
      (introSlide.keyPoints.length >= 3 ? 1 : 0) +
      (introSlide.beginnerExplanation.trim().length >= 90 ? 1 : 0) +
      (countMetaMatches(slideText(introSlide)) === 0 ? 1 : 0);

    checks.push(
      buildCheck(
        "intro_slide_substance",
        introScore >= 3 ? "pass" : introScore === 2 ? "warning" : "fail",
        introScore >= 3
          ? "Opening slide has enough substance to start the presentation."
          : "Opening slide still looks too thin or too meta for a strong opening.",
        introSlide.id,
      ),
    );
  }

  const metaSlides = deck.slides.filter((slide) => countMetaMatches(slideText(slide)) >= 2);
  checks.push(
    buildCheck(
      "meta_slide_language",
      metaSlides.length === 0
        ? "pass"
        : metaSlides.length >= Math.ceil(deck.slides.length / 2)
          ? "fail"
          : "warning",
      metaSlides.length === 0
        ? "Deck is audience-facing rather than slide-making advice."
        : `${metaSlides.length} slide(s) still look meta or presentation-instructional.`,
    ),
  );

  const lowAnchorSlides = deck.slides.filter((slide) => {
    const tokens = unique(tokenize(slideText(slide)));
    return overlapRatio(deckTopicTokens, tokens) < 0.16;
  });
  checks.push(
    buildCheck(
      "topic_alignment",
      lowAnchorSlides.length === 0
        ? "pass"
        : lowAnchorSlides.length >= Math.ceil(deck.slides.length / 2)
          ? "fail"
          : "warning",
      lowAnchorSlides.length === 0
        ? "Slides stay anchored to the requested topic."
        : `${lowAnchorSlides.length} slide(s) are weakly anchored to the requested topic.`,
    ),
  );

  const contaminatedStrings = [
    deck.topic,
    deck.title,
    ...deck.slides.flatMap((slide) => [slide.title, slide.learningGoal]),
  ];
  const contaminationHits = contaminatedStrings.filter((value) =>
    PROMPT_CONTAMINATION_PATTERNS.some((pattern) => pattern.test(value)),
  ).length;
  checks.push(
    buildCheck(
      "prompt_contamination",
      contaminationHits === 0 ? "pass" : contaminationHits >= 2 ? "fail" : "warning",
      contaminationHits === 0
        ? "Deck titles and learning goals are free from prompt-instruction leakage."
        : "Deck still contains prompt-like instruction text instead of a clean subject framing.",
    ),
  );

  const noisySlides = deck.slides.filter((slide) =>
    PROMOTIONAL_NOISE_PATTERNS.some((pattern) => pattern.test(slideText(slide))),
  );
  checks.push(
    buildCheck(
      "source_noise_contamination",
      noisySlides.length === 0
        ? "pass"
        : noisySlides.length >= Math.ceil(deck.slides.length / 3)
          ? "fail"
          : "warning",
      noisySlides.length === 0
        ? "Slides are free from obvious promotional or navigation noise from fetched sources."
        : `${noisySlides.length} slide(s) still contain promotional or navigation text from source pages.`,
    ),
  );

  const awkwardLanguageSlides = deck.slides.filter((slide) => {
    const text = [slide.title, slide.learningGoal, ...slide.keyPoints].join(" ");
    return (
      AWKWARD_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text)) ||
      slide.keyPoints.some((point) => looksFragmentaryKeyPoint(point))
    );
  });
  checks.push(
    buildCheck(
      "language_quality",
      awkwardLanguageSlides.length === 0
        ? "pass"
        : awkwardLanguageSlides.length >= Math.ceil(deck.slides.length / 3)
          ? "fail"
          : "warning",
      awkwardLanguageSlides.length === 0
        ? "Slides read as complete, topic-facing language rather than awkward fragments."
        : `${awkwardLanguageSlides.length} slide(s) still contain awkward learning goals or fragmentary key points.`,
    ),
  );

  const weakNarrationSlides = deck.slides.filter((slide) => {
    const narration = narrationBySlideId.get(slide.id);
    if (!narration) {
      return true;
    }

    const slideTokens = unique(tokenize(slideText(slide)));
    const spokenTokens = unique(tokenize(narrationText(narration)));
    return overlapRatio(slideTokens, spokenTokens) < 0.14;
  });
  checks.push(
    buildCheck(
      "narration_alignment",
      weakNarrationSlides.length === 0
        ? "pass"
        : weakNarrationSlides.length >= Math.ceil(deck.slides.length / 2)
          ? "fail"
          : "warning",
      weakNarrationSlides.length === 0
        ? "Narration appears tied to the visible slides."
        : `${weakNarrationSlides.length} slide(s) have weak narration-to-slide alignment.`,
    ),
  );

  const templatedSlides = deck.slides.filter((slide) => {
    const text = slideText(slide);
    const matches = TEMPLATE_LANGUAGE_PATTERNS.reduce(
      (count, pattern) => count + (pattern.test(text) ? 1 : 0),
      0,
    );

    return matches >= 2;
  });
  checks.push(
    buildCheck(
      "templated_slide_language",
      templatedSlides.length === 0
        ? "pass"
        : templatedSlides.length >= Math.ceil(deck.slides.length / 3)
          ? "fail"
          : "warning",
      templatedSlides.length === 0
        ? "Slides avoid generic repair-template language."
        : `${templatedSlides.length} slide(s) still read like generic template output rather than topic-specific explanation.`,
    ),
  );

  const visuallyThinSlides = deck.slides.filter((slide) => {
    const visualWeight =
      slide.visuals.cards.length +
      slide.visuals.callouts.length +
      slide.visuals.diagramNodes.length +
      slide.visuals.imageSlots.length;
    return visualWeight < 2;
  });
  checks.push(
    buildCheck(
      "visual_structure",
      visuallyThinSlides.length === 0
        ? "pass"
        : visuallyThinSlides.length >= Math.ceil(deck.slides.length / 2)
          ? "warning"
          : "warning",
      visuallyThinSlides.length === 0
        ? "Slides have enough visual structure to feel intentionally designed."
        : `${visuallyThinSlides.length} slide(s) are still visually thin.`,
    ),
  );

  const prompts = deck.slides
    .map(normalizedImagePrompt)
    .filter((prompt) => prompt.length > 0);
  const uniquePromptRatio =
    prompts.length > 0 ? unique(prompts).length / prompts.length : 1;
  checks.push(
    buildCheck(
      "image_diversity",
      uniquePromptRatio >= 0.8
        ? "pass"
        : uniquePromptRatio >= 0.5
          ? "warning"
          : "fail",
      uniquePromptRatio >= 0.8
        ? "Image prompts vary enough across slides."
        : "Image prompts are too repetitive across slides and may lead to repeated visuals.",
    ),
  );

  const deductions = checks.reduce((sum, check) => {
    if (check.status === "fail") {
      return sum + 0.2;
    }

    if (check.status === "warning") {
      return sum + 0.08;
    }

    return sum;
  }, 0);

  const overallScore = Math.max(0, Math.min(1, 1 - deductions));
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const summary =
    failCount === 0 && warningCount === 0
      ? "Deck passed automated quality evaluation without obvious issues."
      : `Deck evaluation found ${failCount} failing and ${warningCount} warning checks.`;

  return {
    evaluatedAt: new Date().toISOString(),
    overallScore,
    summary,
    checks,
  };
};

const countMetaMatches = (value: string): number =>
  META_PATTERNS.reduce(
    (sum, pattern) => sum + (pattern.test(value) ? 1 : 0),
    0,
  );
