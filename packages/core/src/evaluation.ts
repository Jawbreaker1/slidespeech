import type {
  Deck,
  DeckEvaluation,
  DeckEvaluationCheck,
  Slide,
  SlideNarration,
} from "@slidespeech/types";

import {
  AWKWARD_LANGUAGE_PATTERNS,
  countTextGuardMatches,
  IMPERATIVE_KEY_POINT_PATTERNS,
  PRESENTATION_META_PATTERNS,
  PROMPT_CONTAMINATION_PATTERNS,
  SOURCE_NOISE_PATTERNS,
  TEMPLATE_LANGUAGE_PATTERNS,
} from "./text-quality-guards";

const INFORMATIVE_VERB_PATTERN =
  /\b(is|are|was|were|helps?|support(?:s)?|show(?:s)?|mean(?:s)?|include(?:s)?|use(?:s|d)?|serve(?:s|d)?|function(?:s)?|operate(?:s)?|connect(?:s)?|explain(?:s|ed)?|confirm(?:s|ed)?|provide(?:s|d)?)\b/i;

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

const tokenize = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

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

const audienceFacingSlideText = (slide: Slide): string =>
  [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    slide.advancedExplanation,
    ...slide.keyPoints,
    ...slide.examples,
    ...slide.likelyQuestions,
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
  if (/^\s*(?:generating|leveraging|focusing)\b/i.test(trimmed)) {
    return true;
  }

  const tokens = tokenize(trimmed);
  if (tokens.length < 5) {
    return true;
  }
  if (tokens.length >= 7 && /[.!?]$/.test(trimmed)) {
    return false;
  }

  return tokens.length >= 6 && !INFORMATIVE_VERB_PATTERN.test(trimmed);
};

const hasNearDuplicateVisiblePoints = (values: string[]): boolean => {
  const tokenSets = values
    .map((value) => unique(tokenize(value)))
    .filter((tokens) => tokens.length >= 6);

  for (let index = 0; index < tokenSets.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < tokenSets.length; otherIndex += 1) {
      const left = tokenSets[index]!;
      const right = tokenSets[otherIndex]!;
      const overlap = overlapRatio(left, right);
      if (overlap >= 0.78 || overlapRatio(right, left) >= 0.78) {
        return true;
      }
    }
  }

  return false;
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
  const proceduralDeck = deck.metadata.tags.some(
    (tag) => tag.toLowerCase() === "procedural",
  );
  const deckTopicTokens = topicTokens(deck);
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, narration]),
  );

  const introSlide = deck.slides[0];
  if (introSlide) {
    const introScore =
      (introSlide.keyPoints.length >= 3 ? 1 : 0) +
      ((introSlide.beginnerExplanation.trim().length >= 90 ||
        introSlide.learningGoal.trim().length >= 70)
        ? 1
        : 0) +
      (countMetaMatches(audienceFacingSlideText(introSlide)) === 0 ? 1 : 0);

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

  const metaSlides = deck.slides.filter(
    (slide) => countMetaMatches(audienceFacingSlideText(slide)) >= 2,
  );
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
    ...deck.slides.flatMap((slide) => [
      slide.title,
      slide.learningGoal,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...slide.keyPoints,
      ...slide.examples,
    ]),
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
    SOURCE_NOISE_PATTERNS.some((pattern) => pattern.test(slideText(slide))),
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
    const textFields = [
      slide.title,
      slide.learningGoal,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...slide.keyPoints,
      ...slide.examples,
    ];
    const text = textFields.join(" ");
    return (
      AWKWARD_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text)) ||
      textFields.some((field) =>
        AWKWARD_LANGUAGE_PATTERNS.some((pattern) => pattern.test(field)),
      ) ||
      (!proceduralDeck &&
        slide.keyPoints.some((point) =>
          IMPERATIVE_KEY_POINT_PATTERNS.some((pattern) => pattern.test(point)),
        )) ||
      slide.keyPoints.some((point) => point.length > 280) ||
      slide.examples.some((example) => example.length > 280) ||
      slide.keyPoints.some((point) => looksFragmentaryKeyPoint(point)) ||
      slide.examples.some((example) => looksFragmentaryKeyPoint(example)) ||
      hasNearDuplicateVisiblePoints(slide.keyPoints)
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

    return matches >= 1;
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

  const repetitiveSlidePairs = deck.slides.flatMap((slide, index) =>
    deck.slides.slice(index + 1).flatMap((otherSlide) => {
      const leftTokens = unique(
        tokenize(
          [
            slide.learningGoal,
            slide.beginnerExplanation,
            ...slide.keyPoints,
          ].join(" "),
        ),
      );
      const rightTokens = unique(
        tokenize(
          [
            otherSlide.learningGoal,
            otherSlide.beginnerExplanation,
            ...otherSlide.keyPoints,
          ].join(" "),
        ),
      );

      if (leftTokens.length < 8 || rightTokens.length < 8) {
        return [];
      }

      const overlap = overlapRatio(leftTokens, rightTokens);
      return overlap >= 0.72 ? [{ left: slide, right: otherSlide, overlap }] : [];
    }),
  );
  const maxRepetitiveOverlap = repetitiveSlidePairs.reduce(
    (max, pair) => Math.max(max, pair.overlap),
    0,
  );
  const repetitiveDistinctnessStatus =
    repetitiveSlidePairs.length === 0
      ? "pass"
      : repetitiveSlidePairs.length === 1 && maxRepetitiveOverlap < 0.82
        ? "warning"
        : "fail";
  checks.push(
    buildCheck(
      "cross_slide_distinctness",
      repetitiveDistinctnessStatus,
      repetitiveSlidePairs.length === 0
        ? "Slides stay distinct instead of repeating the same explanation across the deck."
        : repetitiveDistinctnessStatus === "warning"
          ? `${repetitiveSlidePairs.length} slide pair(s) still overlap noticeably, but the deck does not look globally repetitive.`
          : `${repetitiveSlidePairs.length} slide pair(s) reuse nearly the same explanation instead of advancing the story.`,
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
  countTextGuardMatches(value, PRESENTATION_META_PATTERNS);
