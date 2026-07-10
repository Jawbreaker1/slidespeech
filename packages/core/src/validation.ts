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

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

const tokenize = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const semanticKey = (value: string): string => tokenize(value).join(" ");

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const tokenOverlapRatio = (left: string, right: string): number => {
  const leftTokens = unique(tokenize(left));
  const rightTokens = unique(tokenize(right));

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
};

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

const GENERIC_VISUAL_CARD_TITLE_PATTERN =
  /^(?:key\s*(?:point|idea)|point|main\s*idea)\s*\d+$/i;

const uniqueStatements = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = semanticKey(value);
    if (!key || seen.has(key)) {
      continue;
    }

    const duplicatesExisting = result.some((existing) => {
      const existingKey = semanticKey(existing);
      return (
        existingKey === key ||
        existingKey.includes(key) ||
        key.includes(existingKey) ||
        tokenOverlapRatio(existing, value) >= 0.78
      );
    });

    if (duplicatesExisting) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
};

const hasSameMeaning = (existingValues: string[], candidate: string): boolean => {
  const candidateKey = semanticKey(candidate);
  if (!candidateKey) {
    return false;
  }

  return existingValues.some((existing) => {
    const existingKey = semanticKey(existing);
    return (
      Boolean(existingKey) &&
      (existingKey === candidateKey ||
        existingKey.includes(candidateKey) ||
        candidateKey.includes(existingKey) ||
        tokenOverlapRatio(existing, candidate) >= 0.78)
    );
  });
};

const repeatedSurfaceCluster = (slide: Slide): string | null => {
  const values = [
    { group: "learningGoal", value: slide.learningGoal },
    ...slide.keyPoints.map((value) => ({ group: "keyPoints", value })),
    { group: "beginnerExplanation", value: slide.beginnerExplanation },
    { group: "advancedExplanation", value: slide.advancedExplanation },
    { group: "heroStatement", value: slide.visuals.heroStatement ?? "" },
    ...slide.visuals.cards.map((card) => ({ group: "visualCards", value: card.body })),
    ...slide.visuals.callouts.map((callout) => ({ group: "callouts", value: callout.text })),
  ].filter((entry) => entry.value.trim().length > 0);

  for (const entry of values) {
    const matchingEntries = values.filter((candidate) =>
      hasSameMeaning([entry.value], candidate.value),
    );
    const matchingGroups = new Set(matchingEntries.map((candidate) => candidate.group));

    if (matchingEntries.length >= 5 || matchingGroups.size >= 3) {
      return entry.value;
    }
  }

  return null;
};

const hasOpeningNarrationIntro = (value: string | undefined): boolean =>
  Boolean(
    value &&
      /\b(?:welcome everyone|welcome|today we|we will start|we'll start|let's start|välkomna|idag|vi börjar)\b/i.test(
        value,
      ),
  );

const hasClosingQuestionInvitation = (value: string | undefined): boolean =>
  Boolean(
    value &&
      /\b(?:question|questions|ask|q&a|discussion|fråga|frågor|undrar|diskussion)\b/i.test(
        value,
      ),
  );

const narrationConnectionMarkerPattern =
  /^(?:first|second|third|next|then|from there|in practice|that means|this matters|taken together|finally|so|therefore|först|sedan|därefter|i praktiken|det betyder|sammantaget|slutligen)\b/i;

export const validateDeck = (deck: Deck): ValidationResult<Deck> => {
  const issues: ValidationIssue[] = [];
  let normalized = false;

  const slides = deck.slides.map((slide, index) => {
    let nextSlide = slide;

    if (slide.order !== index) {
      normalized = true;
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

    const distinctKeyPoints = uniqueStatements(nextSlide.keyPoints);
    if (distinctKeyPoints.length !== nextSlide.keyPoints.length) {
      issues.push({
        code: "duplicate_visible_points",
        message: `Slide "${slide.title}" repeats visible points and must be regenerated.`,
        severity: "error",
        slideId: slide.id,
      });
    }

    if (nextSlide.visuals.cards.length === 0 && nextSlide.keyPoints.length >= 2) {
      issues.push({
        code: "missing_visual_cards",
        message: `Slide "${slide.title}" has no visual cards; generation or rendering should handle the layout without local content repair.`,
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (
      nextSlide.visuals.cards.some((card) =>
        GENERIC_VISUAL_CARD_TITLE_PATTERN.test(card.title.trim()),
      )
    ) {
      issues.push({
        code: "generic_visual_card_titles",
        message: `Slide "${slide.title}" has generic visual card titles and should be regenerated or rendered without local title repair.`,
        severity: "info",
        slideId: slide.id,
      });
    }

    const repeatedClaim = repeatedSurfaceCluster(nextSlide);
    if (repeatedClaim) {
      issues.push({
        code: "repeated_slide_surface",
        message: `Slide "${slide.title}" repeats the same visible claim across several fields and needs regeneration.`,
        severity: "error",
        slideId: slide.id,
      });
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
          repaired: normalized,
          validatedAt: new Date().toISOString(),
          issues,
        },
      },
    },
    issues,
    repaired: normalized,
  };
};

export const validateNarrations = (
  deck: Deck,
  narrations: SlideNarration[],
  options?: {
    generateMissing?: boolean | undefined;
  },
): ValidationResult<SlideNarration[]> => {
  const issues: ValidationIssue[] = [];
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, narration]),
  );
  const generateMissing = options?.generateMissing ?? true;
  const validatedNarrations: SlideNarration[] = [];

  for (const slide of deck.slides) {
    const existing = narrationBySlideId.get(slide.id);
    if (!existing) {
      if (generateMissing) {
        issues.push({
          code: "narration_missing",
          message: `Narration for "${slide.title}" is missing and must be generated by the narration model.`,
          severity: "error",
          slideId: slide.id,
        });
      }
      continue;
    }

    validatedNarrations.push(existing);

    const minSegments = slide.order === 0 ? 4 : 3;
    const maxSegments = slide.order === 0 ? 6 : 5;
    const slideTokens = slideConceptTokens(slide);
    const narrationTokens = tokenize(
      [
        existing?.narration ?? "",
        ...(existing?.segments ?? []),
      ].join(" "),
    );
    const overlap = slideTokens.filter((token) => narrationTokens.includes(token));
    const visibleSlidePhrases = [
      slide.visuals.heroStatement ?? "",
      ...slide.keyPoints,
      ...slide.visuals.cards.map((card) => card.body),
      ...slide.visuals.callouts.map((callout) => callout.text),
    ]
      .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((value) => value.length >= 24);
    const normalizedNarration = (existing?.narration ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedSegments = (existing?.segments ?? [])
      .map((segment) => segment.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean);
    const nearLiteralSegmentMatches = normalizedSegments.filter((segment) =>
      visibleSlidePhrases.some((phrase) => tokenOverlapRatio(segment, phrase) >= 0.92),
    ).length;
    const exactVisiblePhraseMatches = visibleSlidePhrases.filter((phrase) =>
      normalizedNarration.includes(phrase),
    ).length;
    const readsVisualTextTooClosely =
      nearLiteralSegmentMatches >= 2 ||
      exactVisiblePhraseMatches >= 2;
    const lacksOpeningIntro =
      Boolean(existing) &&
      slide.order === 0 &&
      !hasOpeningNarrationIntro(existing?.segments[0] ?? existing?.narration);
    const lacksClosingInvitation =
      Boolean(existing) &&
      slide.order === deck.slides.length - 1 &&
      !hasClosingQuestionInvitation(existing?.narration);
    const narrationLacksSpokenFlow =
      normalizedSegments.length >= 3 &&
      normalizedSegments.slice(1).filter((segment, index) => {
        const previous = normalizedSegments[index] ?? "";
        const segmentTokenCount = new Set(tokenize(segment)).size;
        const slideTokenOverlap = tokenize(segment).filter((token) =>
          slideTokens.includes(token),
        ).length;
        const segmentIsGrounded =
          slideTokenOverlap >=
          Math.min(3, Math.max(1, Math.floor(segmentTokenCount / 5)));
        return (
          !narrationConnectionMarkerPattern.test(segment) &&
          tokenOverlapRatio(segment, previous) < 0.1 &&
          !segmentIsGrounded
        );
      }).length >= 2;

    if (existing.segments.length < minSegments) {
      issues.push({
        code: "narration_segment_count",
        message: `Narration for "${slide.title}" has too few spoken segments and should be regenerated by the narration model.`,
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (existing.segments.length > maxSegments) {
      issues.push({
        code: "narration_segment_count",
        message: `Narration for "${slide.title}" has too many spoken segments and should be regenerated by the narration model.`,
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (existing.narration.trim().length < (slide.order === 0 ? 180 : 110)) {
      issues.push({
        code: "narration_too_thin",
        message: `Narration for "${slide.title}" is too thin for presenter mode and should be regenerated by the narration model.`,
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (
      overlap.length < Math.min(3, Math.max(1, Math.floor(slideTokens.length / 6)))
    ) {
      issues.push({
        code: "narration_alignment",
        message: `Narration for "${slide.title}" is not sufficiently anchored to the slide content.`,
        severity: "error",
        slideId: slide.id,
      });
    }

    if (readsVisualTextTooClosely) {
      issues.push({
        code: "narration_verbatim",
        message: `Narration for "${slide.title}" reads visible slide text too closely.`,
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (lacksOpeningIntro) {
      issues.push({
        code: "narration_intro_missing",
        message: `Opening narration for "${slide.title}" lacks a presenter introduction.`,
        severity: "error",
        slideId: slide.id,
      });
    }

    if (lacksClosingInvitation) {
      issues.push({
        code: "narration_closing_missing",
        message: `Closing narration for "${slide.title}" does not invite audience questions.`,
        severity: "error",
        slideId: slide.id,
      });
    }

    if (narrationLacksSpokenFlow) {
      issues.push({
        code: "narration_spoken_flow",
        message: `Narration for "${slide.title}" reads like disconnected points rather than a presenter script.`,
        severity: "warning",
        slideId: slide.id,
      });
    }
  }

  return {
    value: validatedNarrations,
    issues,
    repaired: false,
  };
};
