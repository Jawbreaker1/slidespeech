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
import { toRecordArray, toStringArray } from "./structured-normalization";

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

const tokenizeSemanticText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const buildFallbackNarration = (slide: GenerateNarrationInput["slide"], deck: Deck) => {
  const prefersBeginnerFriendlyLanguage =
    deck.pedagogicalProfile.audienceLevel === "beginner";
  const minSegmentCount = slide.order === 0 ? 4 : 3;
  const normalizeNarrationSentence = (value: string): string => {
    const normalized = value.replace(/\s+/g, " ").trim().replace(/^[\-\u2022*\d.)\s]+/, "");
    if (!normalized) {
      return "";
    }

    return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  };

  const contentSegments = [
    normalizeNarrationSentence(slide.beginnerExplanation),
    ...slide.speakerNotes.map((note) => normalizeNarrationSentence(note)),
    ...slide.examples.slice(0, 1).map((example) => normalizeNarrationSentence(example)),
    normalizeNarrationSentence(
      prefersBeginnerFriendlyLanguage
        ? slide.learningGoal
        : slide.advancedExplanation,
    ),
    ...slide.keyPoints.map((point) => normalizeNarrationSentence(point)),
  ];

  const cleanedSegments = [...new Set(contentSegments)]
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const segments =
    slide.order === 0
      ? withOpeningNarrationIntro(cleanedSegments.slice(0, 5), deck)
      : cleanedSegments.slice(0, minSegmentCount);
  const narration = segments.join(" ");

  if (
    segments.length < minSegmentCount ||
    narration.length < (slide.order === 0 ? 180 : 120)
  ) {
    throw new Error(
      "Deterministic fallback narration did not yield enough slide-grounded content.",
    );
  }

  return {
    slideId: slide.id,
    narration,
    segments,
    summaryLine: slide.learningGoal,
    promptsForPauses: [],
    suggestedTransition:
      slide.order === deck.slides.length - 1
        ? "End with a concise recap and a quick understanding check."
        : `Bridge clearly into ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`,
  };
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

const isSwedishDeckLanguage = (deck: Pick<Deck, "metadata">): boolean =>
  /^sv\b/i.test(deck.metadata.language);

const buildOpeningNarrationIntro = (deck: Pick<Deck, "metadata" | "topic">): string =>
  isSwedishDeckLanguage(deck)
    ? `Välkomna. Vi börjar med att rama in ${deck.topic} så att resten av genomgången får en tydlig kontext.`
    : `Welcome everyone. We will start by framing ${deck.topic} so the rest of this talk has a clear context.`;

const hasOpeningNarrationIntro = (value: string | undefined): boolean =>
  Boolean(
    value &&
      /\b(?:welcome everyone|welcome|today we|we will start|we'll start|let's start|välkomna|idag|vi börjar)\b/i.test(
        value,
      ),
  );

const withOpeningNarrationIntro = (
  segments: string[],
  deck: Pick<Deck, "metadata" | "topic">,
): string[] => {
  const cleanedSegments = segments
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (hasOpeningNarrationIntro(cleanedSegments[0])) {
    return cleanedSegments.slice(0, 6);
  }

  return [buildOpeningNarrationIntro(deck), ...cleanedSegments].slice(0, 6);
};

const looksLikeReasoningLeak = (value: string): boolean =>
  /^\s*\{\s*["']?(?:thought|analysis|reasoning)/i.test(value) ||
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
    .map((segment) => segment.replace(/^[\-\u2022*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, slide.order === 0 ? 5 : 4);
  const narrationSegments =
    slide.order === 0
      ? withOpeningNarrationIntro(normalizedSegments, deck)
      : normalizedSegments;

  if (
    narrationSegments.length < (slide.order === 0 ? 4 : 3) ||
    narrationSegments.join(" ").trim().length < (slide.order === 0 ? 180 : 120) ||
    !plainTextNarrationLooksGrounded(narrationSegments.join(" "), slide)
  ) {
    return null;
  }

  return SlideNarrationSchema.parse({
    slideId: slide.id,
    narration: narrationSegments.join(" "),
    segments: narrationSegments,
    summaryLine: slide.learningGoal,
    promptsForPauses: [],
    suggestedTransition:
      slide.order === deck.slides.length - 1
        ? "End with a concise recap and one understanding check."
        : `Bridge clearly into ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`,
  });
};

export const normalizeNarrationForSlide = (
  value: unknown,
  slide: GenerateNarrationInput["slide"],
  deck?: Deck,
): unknown => {
  if (!value || typeof value !== "object") {
    return deck ? buildFallbackNarration(slide, deck) : value;
  }

  const candidate = value as Record<string, unknown>;
  const rawNarration =
    typeof candidate.narration === "string" ? candidate.narration : "";
  const rawSegments = (() => {
    const rawSegments = toStringArray(candidate.segments);
    return rawSegments.length > 0
      ? rawSegments
      : splitTextIntoSegments(rawNarration);
  })();
  const segments =
    slide.order === 0 && deck
      ? withOpeningNarrationIntro(rawSegments, deck)
      : rawSegments;
  const narration = segments.length > 0 ? segments.join(" ") : rawNarration;
  const needsFallbackExpansion =
    Boolean(deck) &&
    (narration.trim().length < (slide.order === 0 ? 180 : 120) ||
      segments.length < (slide.order === 0 ? 4 : 3));

  if (needsFallbackExpansion && deck) {
    return buildFallbackNarration(slide, deck);
  }

  return {
    ...candidate,
    slideId: slide.id,
    narration,
    segments,
    promptsForPauses: toStringArray(candidate.promptsForPauses),
    summaryLine:
      typeof candidate.summaryLine === "string"
        ? candidate.summaryLine
        : slide.learningGoal,
    suggestedTransition:
      typeof candidate.suggestedTransition === "string"
        ? candidate.suggestedTransition
        : deck
          ? (deck.slides[slide.order + 1]?.title ?? "")
          : "",
  };
};

export const buildFallbackNarrationForSlide = buildFallbackNarration;

export const normalizePresentationReview = (
  value: unknown,
  input: ReviewPresentationInput,
): unknown => {
  if (!value || typeof value !== "object") {
    return {
      approved: true,
      overallScore: 0.7,
      summary: "Presentation review returned no structured issues.",
      issues: [],
      repairedNarrations: [],
    };
  }

  const candidate = value as Record<string, unknown>;
  const repairedNarrations = toRecordArray(candidate.repairedNarrations)
    .map((narrationCandidate) => {
      const slideId =
        typeof narrationCandidate.slideId === "string"
          ? narrationCandidate.slideId
          : "";
      const slide = input.deck.slides.find((item) => item.id === slideId);

      if (!slide) {
        return null;
      }

      return SlideNarrationSchema.parse(
        normalizeNarrationForSlide(narrationCandidate, slide, input.deck),
      );
    })
    .filter((value): value is SlideNarration => Boolean(value));

  return {
    approved:
      typeof candidate.approved === "boolean" ? candidate.approved : true,
    overallScore:
      typeof candidate.overallScore === "number"
        ? Math.max(0, Math.min(candidate.overallScore, 1))
        : 0.7,
    summary:
      typeof candidate.summary === "string"
        ? candidate.summary
        : "Presentation review completed.",
    issues: toRecordArray(candidate.issues).map((issue) => ({
      code:
        typeof issue.code === "string" && issue.code.trim().length > 0
          ? issue.code
          : "review_issue",
      severity:
        issue.severity === "info" ||
        issue.severity === "warning" ||
        issue.severity === "error"
          ? issue.severity
          : "warning",
      dimension:
        issue.dimension === "deck" ||
        issue.dimension === "visual" ||
        issue.dimension === "narration" ||
        issue.dimension === "coherence" ||
        issue.dimension === "grounding"
          ? issue.dimension
          : "coherence",
      message:
        typeof issue.message === "string"
          ? issue.message
          : "Presentation review flagged a quality issue.",
      ...(typeof issue.slideId === "string" ? { slideId: issue.slideId } : {}),
    })),
    repairedNarrations,
  };
};

const normalizeReviewIssues = (
  value: unknown,
): PresentationReview["issues"] =>
  toRecordArray(value).map((issue) => ({
    code:
      typeof issue.code === "string" && issue.code.trim().length > 0
        ? issue.code
        : "review_issue",
    severity:
      issue.severity === "info" ||
      issue.severity === "warning" ||
      issue.severity === "error"
        ? issue.severity
        : "warning",
    dimension:
      issue.dimension === "deck" ||
      issue.dimension === "visual" ||
      issue.dimension === "narration" ||
      issue.dimension === "coherence" ||
      issue.dimension === "grounding"
        ? issue.dimension
        : "coherence",
    message:
      typeof issue.message === "string"
        ? issue.message
        : "Presentation review flagged a quality issue.",
    ...(typeof issue.slideId === "string" ? { slideId: issue.slideId } : {}),
  }));

export const normalizeDeckReviewResult = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return {
      approved: true,
      overallScore: 0.7,
      summary: "Presentation review returned no structured issues.",
      issues: [] as PresentationReview["issues"],
    };
  }

  const candidate = value as Record<string, unknown>;
  return {
    approved:
      typeof candidate.approved === "boolean" ? candidate.approved : true,
    overallScore:
      typeof candidate.overallScore === "number"
        ? Math.max(0, Math.min(candidate.overallScore, 1))
        : 0.7,
    summary:
      typeof candidate.summary === "string"
        ? candidate.summary
        : "Presentation review completed.",
    issues: normalizeReviewIssues(candidate.issues),
  };
};

export const normalizeNarrationRepairResult = (
  value: unknown,
  input: ReviewPresentationInput,
): SlideNarration[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  return toRecordArray(candidate.repairedNarrations)
    .map((narrationCandidate) => {
      const slideId =
        typeof narrationCandidate.slideId === "string"
          ? narrationCandidate.slideId
          : "";
      const slide = input.deck.slides.find((item) => item.id === slideId);

      if (!slide) {
        return null;
      }

      return SlideNarrationSchema.parse(
        normalizeNarrationForSlide(narrationCandidate, slide, input.deck),
      );
    })
    .filter((repair): repair is SlideNarration => Boolean(repair));
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

export const buildCompactDeckReviewSummary = (slide: Slide): string =>
  [
    `Slide ${slide.order + 1}: ${slide.title}`,
    `Visible subtitle: ${slide.learningGoal}`,
    `Visible points: ${slide.keyPoints.join("; ")}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

export const buildCompactNarrationRepairSummary = (
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
