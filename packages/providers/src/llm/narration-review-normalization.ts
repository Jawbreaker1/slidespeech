import type {
  Deck,
  GenerateNarrationInput,
  PresentationReview,
  ReviewPresentationInput,
  Slide,
  SlideNarration,
} from "@slidespeech/types";

import { SlideNarrationSchema } from "@slidespeech/types";

import { splitTextIntoSegments } from "../shared";
import { toRecordArray } from "./structured-normalization";

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

const tokenizeSemanticText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const NARRATION_STOP_TOKENS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "because",
  "before",
  "between",
  "but",
  "can",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "och",
  "that",
  "the",
  "their",
  "this",
  "through",
  "till",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const salientNarrationTokens = (value: string): string[] =>
  [
    ...new Set(
      tokenizeSemanticText(value).filter(
        (token) =>
          (token.length >= 4 || /\p{N}/u.test(token)) &&
          !NARRATION_STOP_TOKENS.has(token),
      ),
    ),
  ];

const countSharedSalientTokens = (left: string, right: string): number => {
  const rightTokens = new Set(salientNarrationTokens(right));
  return salientNarrationTokens(left).filter((token) => rightTokens.has(token)).length;
};

const tokenOverlapRatio = (left: string, right: string): number => {
  const leftTokens = salientNarrationTokens(left);
  const rightTokens = salientNarrationTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightTokenSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightTokenSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
};

const normalizeSpokenSentence = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/^[\-\u2022*\d.)\s]+/, "");
  if (!normalized) {
    return "";
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const CONNECTED_SPEECH_MARKER_PATTERN =
  /^(?:first|second|third|next|then|from there|in practice|that means|this matters|taken together|finally|so|therefore|först|sedan|därefter|i praktiken|det betyder|sammantaget|slutligen)\b/i;

const META_NARRATION_PATTERN =
  /\b(?:this slide|on this slide|the slide|these bullets?|key points?|learning goal|speaker notes?|narration|presenter instruction|work order|den här sliden|på sliden|punkterna)\b/i;

const segmentLooksSentenceLike = (segment: string): boolean => {
  const normalized = segment.replace(/\s+/g, " ").trim();
  const tokens = tokenizeSemanticText(normalized);

  if (tokens.length < 6) {
    return false;
  }

  if (/^[^.!?]{2,42}:$/.test(normalized) || /[,;:]$/.test(normalized)) {
    return false;
  }

  return !META_NARRATION_PATTERN.test(normalized);
};

const tokenizeNarrationText = (value: string): string[] =>
  tokenizeSemanticText(value);

const plainTextNarrationLooksGrounded = (
  narration: string,
  slide: GenerateNarrationInput["slide"],
): boolean => {
  const narrationTokens = tokenizeNarrationText(narration);
  const slideTokens = new Set(
    tokenizeNarrationText(
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
  const overlap = narrationTokens.filter((token) => slideTokens.has(token));

  return overlap.length >= Math.min(4, Math.max(2, Math.floor(slideTokens.size / 8)));
};

const hasOpeningNarrationIntro = (value: string | undefined): boolean =>
  Boolean(
    value &&
      /\b(?:welcome everyone|welcome|today we|we will start|we'll start|let's start|välkomna|idag|vi börjar)\b/i.test(
        value,
      ),
  );

const hasClosingQuestionInvitation = (value: string): boolean =>
  /\b(?:question|questions|ask|q&a|discussion|fråga|frågor|undrar|diskussion)\b/i.test(
    value,
  );

const slideNarrationAnchorText = (slide: GenerateNarrationInput["slide"]): string =>
  [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    slide.advancedExplanation,
    ...slide.keyPoints,
    ...slide.examples,
    ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
    ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
    ...slide.visuals.diagramNodes.map((node) => node.label),
  ].join(" ");

const segmentIsGroundedInSlide = (
  segment: string,
  slide: GenerateNarrationInput["slide"],
): boolean =>
  countSharedSalientTokens(segment, slideNarrationAnchorText(slide)) >= 2;

const narrationSegmentsLookSpokenAndCoherent = (
  segments: string[],
  slide: GenerateNarrationInput["slide"],
  deck: Deck,
): boolean => {
  const cleanedSegments = segments
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const substantiveSegments = cleanedSegments.filter(
    (segment, index) =>
      !(slide.order === 0 && index === 0 && hasOpeningNarrationIntro(segment)) &&
      !(slide.order === deck.slides.length - 1 && hasClosingQuestionInvitation(segment)),
  );

  if (substantiveSegments.some((segment) => !segmentLooksSentenceLike(segment))) {
    return false;
  }

  if (
    substantiveSegments.some((segment) => !segmentIsGroundedInSlide(segment, slide))
  ) {
    return false;
  }

  const repeatedSegmentCount = substantiveSegments.filter((segment, index) =>
    substantiveSegments
      .slice(0, index)
      .some((previous) => tokenOverlapRatio(segment, previous) >= 0.78),
  ).length;
  if (repeatedSegmentCount > 0) {
    return false;
  }

  const abruptTransitions = substantiveSegments.slice(1).filter((segment, index) => {
    const previous = substantiveSegments[index] ?? "";
    return (
      !CONNECTED_SPEECH_MARKER_PATTERN.test(segment) &&
      countSharedSalientTokens(segment, previous) === 0
    );
  }).length;

  return abruptTransitions <= Math.max(0, substantiveSegments.length - 3);
};

const looksLikeReasoningLeak = (value: string): boolean =>
  /^\s*\{\s*["']?(?:thought|analysis|reasoning)/i.test(value) ||
  /<\/?(?:tool_call|function|arguments|parameter)(?:\b|=)/i.test(value) ||
  /\bthe user wants spoken narration\b/i.test(value) ||
  /\bdo not use json\b/i.test(value) ||
  /\bwrite exactly \d+ short\b/i.test(value);

export const buildNarrationFromPlainText = (
  text: string,
  slide: GenerateNarrationInput["slide"],
  deck: Deck,
) => {
  if (looksLikeReasoningLeak(text)) {
    return null;
  }

  const paragraphSegments = text
    .split(/\n{2,}/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const sentenceSegments = splitTextIntoSegments(text);
  const preferredSegments =
    paragraphSegments.length >= (slide.order === 0 ? 4 : 3)
      ? paragraphSegments
      : sentenceSegments;
  const normalizedSegments = preferredSegments
    .map((segment) => normalizeSpokenSentence(segment))
    .filter(Boolean)
    .slice(0, slide.order === 0 ? 6 : 5);
  const requiresOpeningIntro =
    slide.order === 0 && !hasOpeningNarrationIntro(normalizedSegments[0]);
  const requiresClosingInvitation =
    slide.order === deck.slides.length - 1 &&
    !hasClosingQuestionInvitation(normalizedSegments.join(" "));

  if (
    requiresOpeningIntro ||
    requiresClosingInvitation ||
    normalizedSegments.length < (slide.order === 0 ? 4 : 3) ||
    normalizedSegments.join(" ").trim().length < (slide.order === 0 ? 180 : 120) ||
    !plainTextNarrationLooksGrounded(normalizedSegments.join(" "), slide) ||
    !narrationSegmentsLookSpokenAndCoherent(normalizedSegments, slide, deck)
  ) {
    return null;
  }

  return SlideNarrationSchema.parse({
    slideId: slide.id,
    narration: normalizedSegments.join(" "),
    segments: normalizedSegments,
    summaryLine: slide.learningGoal,
    promptsForPauses: [],
    suggestedTransition:
      slide.order === deck.slides.length - 1
        ? "Close the presentation and invite questions."
        : `Bridge clearly into ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`,
  });
};

export const normalizePresentationReview = (
  value: unknown,
  input: ReviewPresentationInput,
): unknown => {
  if (!value || typeof value !== "object") {
    throw new Error("Presentation review returned an invalid payload.");
  }

  const candidate = value as Record<string, unknown>;

  return {
    approved: normalizeReviewApproved(
      candidate.approved,
      "Presentation review payload",
    ),
    overallScore: normalizeReviewScore(
      candidate.overallScore,
      "Presentation review payload",
    ),
    summary: normalizeReviewSummary(
      candidate.summary,
      "Presentation review payload",
    ),
    issues: normalizeReviewIssues(candidate.issues),
    repairedNarrations: [],
  };
};

const PRESENTATION_REVIEW_SEVERITIES = new Set([
  "info",
  "warning",
  "error",
]);

const PRESENTATION_REVIEW_DIMENSIONS = new Set([
  "deck",
  "visual",
  "narration",
  "coherence",
  "grounding",
]);

const normalizeReviewIssues = (
  value: unknown,
): PresentationReview["issues"] => {
  if (!Array.isArray(value)) {
    throw new Error("Presentation review payload is missing issues.");
  }

  return value.map((issue, index) => {
    if (!issue || typeof issue !== "object") {
      throw new Error(`Presentation review issue ${index + 1} is invalid.`);
    }

    const record = issue as Record<string, unknown>;
    if (typeof record.code !== "string" || !record.code.trim()) {
      throw new Error(`Presentation review issue ${index + 1} is missing code.`);
    }
    if (
      typeof record.severity !== "string" ||
      !PRESENTATION_REVIEW_SEVERITIES.has(record.severity)
    ) {
      throw new Error(`Presentation review issue ${index + 1} has invalid severity.`);
    }
    if (
      typeof record.dimension !== "string" ||
      !PRESENTATION_REVIEW_DIMENSIONS.has(record.dimension)
    ) {
      throw new Error(`Presentation review issue ${index + 1} has invalid dimension.`);
    }
    if (typeof record.message !== "string" || !record.message.trim()) {
      throw new Error(`Presentation review issue ${index + 1} is missing message.`);
    }

    return {
      code: record.code.trim(),
      severity: record.severity as PresentationReview["issues"][number]["severity"],
      dimension: record.dimension as PresentationReview["issues"][number]["dimension"],
      message: record.message.trim(),
      ...(typeof record.slideId === "string" && record.slideId.trim()
        ? { slideId: record.slideId.trim() }
        : {}),
    };
  });
};

const normalizeReviewApproved = (
  value: unknown,
  label: string,
): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is missing approved.`);
  }

  return value;
};

const normalizeReviewScore = (
  value: unknown,
  label: string,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`${label} has an invalid overallScore.`);
  }

  return value;
};

const normalizeReviewSummary = (
  value: unknown,
  label: string,
): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing summary.`);
  }

  return value.trim();
};

export const normalizeDeckReviewResult = (value: unknown) => {
  if (!value || typeof value !== "object") {
    throw new Error("Presentation deck review returned an invalid payload.");
  }

  const candidate = value as Record<string, unknown>;
  return {
    approved: normalizeReviewApproved(
      candidate.approved,
      "Presentation deck review payload",
    ),
    overallScore: normalizeReviewScore(
      candidate.overallScore,
      "Presentation deck review payload",
    ),
    summary: normalizeReviewSummary(
      candidate.summary,
      "Presentation deck review payload",
    ),
    issues: normalizeReviewIssues(candidate.issues),
  };
};

const tokenizeForReview = (value: string): string[] =>
  tokenizeSemanticText(value);

const slideTokensForReview = (slide: Slide): string[] =>
  [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    ...slide.keyPoints,
    ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
    ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
    ...slide.visuals.diagramNodes.map((node) => node.label),
  ].flatMap((part) => tokenizeForReview(part));

export const narrationNeedsDetailedReview = (
  _deck: Deck,
  slide: Slide,
  narration: SlideNarration | undefined,
): boolean => {
  if (!narration) {
    return true;
  }

  const minSegments = slide.order === 0 ? 4 : 3;
  const narrationText = [narration.narration, ...narration.segments].join(" ");
  const narrationTokens = tokenizeForReview(narrationText);
  const overlap = [...new Set(slideTokensForReview(slide))].filter((token) =>
    narrationTokens.includes(token),
  );

  return (
    narration.segments.length < minSegments ||
    narration.narration.trim().length < (slide.order === 0 ? 180 : 110) ||
    overlap.length < 3
  );
};

export const buildCompactDeckReviewSummary = (
  slide: Slide,
  options: { includeVisuals?: boolean } = {},
): string => {
  const visualLines = options.includeVisuals
    ? [
        slide.visuals.imagePrompt ? `Visual prompt: ${slide.visuals.imagePrompt}` : null,
        slide.visuals.imageSlots.length
          ? `Image slots: ${slide.visuals.imageSlots
              .map((slot) => slot.altText || slot.prompt)
              .filter(Boolean)
              .join(" | ")}`
          : null,
        slide.visuals.cards.length
          ? `Visual cards: ${slide.visuals.cards
              .map((card) => `${card.title}: ${card.body}`)
              .join(" | ")}`
          : null,
      ]
    : [];

  return [
    `Slide ${slide.order + 1} (${slide.id})`,
    slide.title,
    slide.learningGoal,
    ...slide.keyPoints.map((point) => `- ${point}`),
    ...visualLines,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
};

export const buildCompactNarrationReviewSummary = (
  slide: Slide,
  narration: SlideNarration | undefined,
): string =>
  [
    `Slide ${slide.order + 1}: ${slide.title}`,
    `Goal: ${slide.learningGoal}`,
    `Beginner explanation: ${slide.beginnerExplanation}`,
    `Visible cards: ${slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
    `Visible callouts: ${slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
    `Visible diagram nodes: ${slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
    `Narration summary: ${narration?.summaryLine ?? "None"}`,
    `Narration segments: ${narration?.segments.join(" | ") ?? "None"}`,
  ].join("\n");
