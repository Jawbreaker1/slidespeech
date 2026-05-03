import type { SlideVisualTone } from "@slidespeech/types";

import {
  countAnchorOverlap,
  hasMeaningfulAnchorOverlap,
  normalizeComparableText,
  shortenTitlePhrase,
  toAudienceFacingLearningGoal,
  tokenizeDeckShapeText,
} from "./deck-shape-text";
import {
  normalizeHexColor,
  normalizeLayoutTemplate,
  normalizeVisualTone,
  toRecordArray,
} from "./structured-normalization";
import {
  looksDanglingSlidePhrase,
  looksMalformedCandidatePoint,
} from "./slide-contract-text";

const deriveVisualCards = (
  slideCandidate: Record<string, unknown>,
  keyPoints: string[],
) => {
  const usedTitles = new Set<string>();
  const genericCardTitlePattern = /^(?:key\s*(?:point|idea)|point)\s*\d+$/i;
  const deriveCardTitleFromPoint = (point: string, index: number): string => {
    const normalizedPoint = point.replace(/\s+/g, " ").trim();
    const [head, ...rest] = normalizedPoint.split(":");
    const tail = rest.join(":").trim();
    const headText = typeof head === "string" ? head.trim() : "";
    const headTokens = [...new Set(tokenizeDeckShapeText(headText))];
    const tailTokens = [...new Set(tokenizeDeckShapeText(tail))];
    const hasExplicitCardTitle = tail.length > 0;
    const headCarriesEnoughInformation =
      hasExplicitCardTitle &&
      headText.length >= 8 &&
      headTokens.length >= 2 &&
      (headText.length >= Math.min(24, Math.round(tail.length * 0.4)) ||
        headTokens.length >= Math.max(3, Math.floor(tailTokens.length / 2)));
    const source = headCarriesEnoughInformation ? headText : normalizedPoint;
    const title = shortenTitlePhrase(source, 42);

    return title && !genericCardTitlePattern.test(title)
      ? title
      : "Main idea";
  };

  return keyPoints.slice(0, 3).map((point, index) => {
    const normalizedPoint = point.replace(/\s+/g, " ").trim();
    const [head, ...rest] = normalizedPoint.split(":");
    const tail = rest.join(":").trim();
    const headText = typeof head === "string" ? head.trim() : "";
    const headTokens = [...new Set(tokenizeDeckShapeText(headText))];
    const tailTokens = [...new Set(tokenizeDeckShapeText(tail))];
    const hasExplicitCardTitle = tail.length > 0;
    const headCarriesEnoughInformation =
      hasExplicitCardTitle &&
      headText.length >= 8 &&
      headTokens.length >= 2 &&
      (headText.length >= Math.min(24, Math.round(tail.length * 0.4)) ||
        headTokens.length >= Math.max(3, Math.floor(tailTokens.length / 2)));

    let title = deriveCardTitleFromPoint(point, index);
    const normalizedTitle = normalizeComparableText(title);

    if (!title || usedTitles.has(normalizedTitle)) {
      title = shortenTitlePhrase(normalizedPoint, 54) || "Main idea";
    }

    usedTitles.add(normalizeComparableText(title));

    return {
      id:
        typeof slideCandidate.id === "string"
          ? `${slideCandidate.id}-card-${index + 1}`
          : `card-${index + 1}`,
      title,
      body: (headCarriesEnoughInformation && tail ? tail : normalizedPoint).trim(),
      tone:
        index === 0
          ? "accent"
          : index === keyPoints.length - 1
            ? "success"
            : "neutral",
    };
  });
};

const hasDuplicateComparableValues = (values: string[]): boolean => {
  const normalized = values
    .map((value) => normalizeComparableText(value))
    .filter(Boolean);
  return new Set(normalized).size !== normalized.length;
};

const countAnchorAlignedVisualValues = (
  values: string[],
  anchor: string,
): number =>
  values.filter(
    (value) =>
      countAnchorOverlap(value, anchor) >= 2 ||
      hasMeaningfulAnchorOverlap(value, anchor),
  ).length;

export const shouldRefreshDerivedVisuals = (
  visuals: Record<string, unknown>,
  anchor: string,
): boolean => {
  const heroStatement =
    typeof visuals.heroStatement === "string" ? visuals.heroStatement.trim() : "";
  const cards = toRecordArray(visuals.cards);
  const diagramNodes = toRecordArray(visuals.diagramNodes);
  const cardTitles = cards
    .map((card) =>
      typeof card.title === "string" ? card.title.trim() : "",
    )
    .filter(Boolean);
  const cardTexts = cards
    .map((card) =>
      [
        typeof card.title === "string" ? card.title.trim() : "",
        typeof card.body === "string" ? card.body.trim() : "",
      ]
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
  const nodeLabels = diagramNodes
    .map((node) =>
      typeof node.label === "string" ? node.label.trim() : "",
    )
    .filter(Boolean);
  const imagePrompts = [
    typeof visuals.imagePrompt === "string" ? visuals.imagePrompt.trim() : "",
    ...toRecordArray(visuals.imageSlots).map((slot) =>
      typeof slot.prompt === "string" ? slot.prompt.trim() : "",
    ),
  ].filter(Boolean);

  if (
    heroStatement &&
    (visualPromptLooksLikeInstructionalScaffold(heroStatement) ||
      !hasMeaningfulAnchorOverlap(heroStatement, anchor))
  ) {
    return true;
  }

  if (imagePrompts.some(visualPromptLooksLikeInstructionalScaffold)) {
    return true;
  }

  if (
    (cardTitles.length >= 2 && hasDuplicateComparableValues(cardTitles)) ||
    (nodeLabels.length >= 2 && hasDuplicateComparableValues(nodeLabels))
  ) {
    return true;
  }

  if (
    cardTexts.length >= 2 &&
    countAnchorAlignedVisualValues(cardTexts, anchor) < Math.min(2, cardTexts.length)
  ) {
    return true;
  }

  if (
    nodeLabels.length >= 2 &&
    countAnchorAlignedVisualValues(nodeLabels, anchor) < Math.min(2, nodeLabels.length)
  ) {
    return true;
  }

  return false;
};

const filterAudienceVisualCallouts = (
  callouts: Array<{ id: string; label: string; text: string; tone: SlideVisualTone }>,
  options: {
    keyPoints: string[];
    cards: Array<{ body: string }>;
    diagramNodes: Array<{ label: string }>;
    likelyQuestions: string[];
    learningGoal: string;
    beginnerExplanation?: string | undefined;
  },
) =>
  callouts.filter((callout) => {
    const normalized = normalizeComparableText(callout.text);
    if (!normalized) {
      return false;
    }

    const likelyQuestionSet = new Set(
      options.likelyQuestions
        .map((value) => normalizeComparableText(value))
        .filter(Boolean),
    );
    if (likelyQuestionSet.has(normalized)) {
      return false;
    }

    const alreadyVisible = new Set(
      [
        ...options.keyPoints,
        ...options.cards.map((card) => card.body),
        ...options.diagramNodes.map((node) => node.label),
        options.learningGoal,
        options.beginnerExplanation ?? "",
      ]
        .map((value) => normalizeComparableText(value))
        .filter(Boolean),
    );

    return !alreadyVisible.has(normalized);
  });

const buildAudienceImagePrompt = (options: {
  title: string;
  learningGoal: string;
  keyPoints: string[];
}): string => {
  const anchor =
    options.keyPoints.find((point) => point.replace(/\s+/g, " ").trim().length >= 24) ??
    options.learningGoal;
  const compactAnchor = anchor.replace(/\s+/g, " ").trim();
  return ["Clean editorial scene", compactAnchor]
    .filter(Boolean)
    .join(": ")
    .replace(/[.]+$/g, "")
    .trim();
};

const visualPromptLooksLikeInstructionalScaffold = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  return [
    /\b(?:create|generate|make|use)\b.{0,80}\b(?:visual|image|illustration|picture|graphic)\b/i,
    /\b(?:visual|image|illustration|picture|graphic)\b.{0,80}\b(?:reinforces?|shows?|explains?)\b/i,
    /\bthat reinforces?\b/i,
    /\bshould\s+(?:explain|show|name|identify|describe|teach)\b/i,
    /\bmain ingredients or materials\b/i,
    /\bmain preparation steps\b/i,
    /\bwhich ingredients or materials\b/i,
    /\bwhich preparation steps\b/i,
    /\bwhich checks show\b/i,
    /\bchoose starting ingredients\b/i,
    /\bfollow the preparation sequence\b/i,
    /\bcheck\b.{0,80}\bbalance, texture\b/i,
    /\bfinish\b.{0,80}\bserving readiness\b/i,
    /\bstarting choices that shape the result\b/i,
    /\bpreparation sequence and checks\b/i,
    /\bfinal balance and readiness checks\b/i,
    /\bpractical cues that show\b/i,
    /\bbalanced, finished, and ready\b/i,
    /\bthe final takeaway from\b/i,
    /\bthe concrete role of\b/i,
    /\bmatters within\b/i,
    /\bthen bring final questions\b/i,
    /\bwithin the presentation\b/i,
    /\b(?:becomes concrete through|one concrete way to understand)\b/i,
    /,\s*\./,
  ].some((pattern) => pattern.test(normalized));
};

const visualHeroLooksLikeContractScaffold = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, " ").trim();

  return [
    /\bmain ingredients or materials\b/i,
    /\bmain preparation steps\b/i,
    /\bwhich ingredients or materials\b/i,
    /\bwhich preparation steps\b/i,
    /\bwhich checks show\b/i,
    /\bchoose starting ingredients\b/i,
    /\bfollow the preparation sequence\b/i,
    /\bcheck\b.{0,80}\bbalance, texture\b/i,
    /\bfinish\b.{0,80}\bserving readiness\b/i,
    /\bstarting choices that shape the result\b/i,
    /\bpreparation sequence and checks\b/i,
    /\bfinal balance and readiness checks\b/i,
    /\bpractical cues that show\b/i,
    /\bbalanced, finished, and ready\b/i,
    /\bthe final takeaway from\b/i,
    /\bthe concrete role of\b/i,
    /\bwithin how\b/i,
    /\bmatters within\b/i,
  ].some((pattern) => pattern.test(normalized));
};

const normalizeAudienceImagePrompt = (
  value: unknown,
  options: {
    title: string;
    learningGoal: string;
    keyPoints: string[];
  },
): string => {
  const candidate = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  return candidate &&
    !visualPromptLooksLikeInstructionalScaffold(candidate) &&
    !looksMalformedCandidatePoint(candidate) &&
    !looksDanglingSlidePhrase(candidate)
    ? candidate
    : buildAudienceImagePrompt(options);
};

export const deriveVisuals = (
  slideCandidate: Record<string, unknown>,
  options: {
    keyPoints: string[];
    examples: string[];
    likelyQuestions: string[];
    order: number;
    totalSlides: number;
    learningGoal: string;
    title: string;
  },
) => {
  const provided =
    slideCandidate.visuals && typeof slideCandidate.visuals === "object"
      ? (slideCandidate.visuals as Record<string, unknown>)
      : {};
  const normalizedImagePrompt = normalizeAudienceImagePrompt(
    provided.imagePrompt,
    options,
  );
  const learningGoalHero = toAudienceFacingLearningGoal(options.learningGoal);
  const firstConcretePoint = options.keyPoints.find(
    (point) =>
      point.replace(/\s+/g, " ").trim().length >= 24 &&
      !visualPromptLooksLikeInstructionalScaffold(point) &&
      !visualHeroLooksLikeContractScaffold(point),
  );
  const candidateHeroStatement =
    firstConcretePoint &&
    (visualPromptLooksLikeInstructionalScaffold(learningGoalHero) ||
      visualHeroLooksLikeContractScaffold(learningGoalHero))
      ? toAudienceFacingLearningGoal(firstConcretePoint)
      : visualPromptLooksLikeInstructionalScaffold(learningGoalHero) ||
          visualHeroLooksLikeContractScaffold(learningGoalHero)
        ? options.title
        : learningGoalHero;
  const normalizedCandidateHero = normalizeComparableText(candidateHeroStatement);
  const normalizedLearningGoalHero = normalizeComparableText(learningGoalHero);
  const normalizedFirstPoint = normalizeComparableText(options.keyPoints[0] ?? "");
  const heroStatement =
    candidateHeroStatement &&
    normalizedCandidateHero &&
    normalizedCandidateHero !== normalizedLearningGoalHero &&
    normalizedCandidateHero !== normalizedFirstPoint
      ? candidateHeroStatement
      : undefined;
  const fallbackLayout =
    options.order === 1
      ? "three-step-flow"
      : options.order === options.totalSlides - 1 || slideCandidate.canSkip === true
        ? "summary-board"
        : options.examples.length > 0 || options.likelyQuestions.length > 0
          ? "two-column-callouts"
          : "hero-focus";

  const calloutSeed = [
    ...options.examples.slice(0, 1).map((text) => ({
      label: "Example",
      text,
      tone: "info" as const,
    })),
  ];
  const providedImageSlots = toRecordArray(provided.imageSlots).map((slot, index) => ({
    id:
      typeof slot.id === "string"
        ? slot.id
        : `${String(slideCandidate.id ?? "slide")}-image-${index + 1}`,
    prompt:
      typeof slot.prompt === "string" && slot.prompt.trim().length > 0
        ? normalizeAudienceImagePrompt(slot.prompt, options)
        : normalizedImagePrompt,
    ...(typeof slot.caption === "string" && slot.caption.trim().length > 0
      ? { caption: slot.caption }
      : {}),
    ...(typeof slot.altText === "string" && slot.altText.trim().length > 0
      ? { altText: slot.altText }
      : { altText: `${options.title} illustration` }),
    style:
      slot.style === "diagram" ||
      slot.style === "editorial" ||
      slot.style === "abstract" ||
      slot.style === "screenshot-like"
        ? slot.style
        : fallbackLayout === "three-step-flow"
          ? "diagram"
          : "editorial",
    tone: normalizeVisualTone(slot.tone),
  }));
  const fallbackImageSlot = {
    id: `${String(slideCandidate.id ?? "slide")}-image-1`,
    prompt: normalizedImagePrompt,
    caption:
      options.keyPoints[0] ??
      options.learningGoal ??
      options.examples[0] ??
      options.likelyQuestions[0] ??
      options.title,
    altText: `${options.title} illustration`,
    style:
      fallbackLayout === "three-step-flow"
        ? "diagram"
        : fallbackLayout === "summary-board"
          ? "abstract"
          : "editorial",
    tone: fallbackLayout === "summary-board" ? "success" : "accent",
  } as const;
  const cards = deriveVisualCards(slideCandidate, options.keyPoints);
  const diagramNodes = cards.slice(0, 3).map((card, index) => ({
    id: `${String(slideCandidate.id ?? "slide")}-node-${index + 1}`,
    label: shortenTitlePhrase(card.title || card.body, 42),
    tone:
      index === 0
        ? "info"
        : index === 1
          ? "accent"
          : "success",
  }));
  const rawCallouts = calloutSeed.map((callout, index) => ({
    id: `${String(slideCandidate.id ?? "slide")}-callout-${index + 1}`,
    ...callout,
  }));

  return {
    layoutTemplate: normalizeLayoutTemplate(provided.layoutTemplate, fallbackLayout),
    accentColor: normalizeHexColor(provided.accentColor),
    eyebrow: options.title,
    ...(heroStatement ? { heroStatement } : {}),
    cards,
    callouts: filterAudienceVisualCallouts(rawCallouts, {
      keyPoints: options.keyPoints,
      cards,
      diagramNodes,
      likelyQuestions: options.likelyQuestions,
      learningGoal: options.learningGoal,
      beginnerExplanation:
        typeof slideCandidate.beginnerExplanation === "string"
          ? slideCandidate.beginnerExplanation
          : undefined,
    }),
    diagramNodes,
    diagramEdges: toRecordArray(provided.diagramEdges).map((edge) => ({
      from: typeof edge.from === "string" ? edge.from : "",
      to: typeof edge.to === "string" ? edge.to : "",
      ...(typeof edge.label === "string" && edge.label.trim().length > 0
        ? { label: edge.label }
        : {}),
    })).filter((edge) => edge.from && edge.to),
    ...(normalizedImagePrompt ? { imagePrompt: normalizedImagePrompt } : {}),
    imageSlots:
      providedImageSlots.length > 0 ? providedImageSlots : [fallbackImageSlot],
  };
};
