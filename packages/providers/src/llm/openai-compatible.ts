import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PlanResearchInput,
  PresentationIntent,
  PresentationPlan,
  PresentationReview,
  ResearchPlanningSuggestion,
  ReviewPresentationInput,
  Slide,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
} from "@slidespeech/types";

import {
  ConversationTurnPlanSchema,
  DeckSchema,
  PresentationReviewSchema,
  PresentationPlanSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";

import {
  createId,
  extractJsonFromText,
  healthy,
  splitTextIntoSegments,
  unhealthy,
} from "../shared";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item] : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|•|-|;|\d+\.\s/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
};

const normalizeHexColor = (value: unknown, fallback = "1C7C7D"): string => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
};

const normalizeLayoutTemplate = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "hero-focus" ||
    normalized === "three-step-flow" ||
    normalized === "two-column-callouts" ||
    normalized === "summary-board"
  ) {
    return normalized;
  }

  return fallback;
};

const normalizeVisualTone = (value: unknown): "accent" | "neutral" | "success" | "warning" | "info" => {
  if (typeof value !== "string") {
    return "neutral";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "accent" ||
    normalized === "neutral" ||
    normalized === "success" ||
    normalized === "warning" ||
    normalized === "info"
  ) {
    return normalized;
  }

  return "neutral";
};

const deriveVisualCards = (
  slideCandidate: Record<string, unknown>,
  keyPoints: string[],
) =>
  keyPoints.slice(0, 3).map((point, index) => {
    const [head, ...rest] = point.split(":");
    const title =
      rest.length > 0 && typeof head === "string" && head.trim().length > 0
        ? head.trim()
        : `Key point ${index + 1}`;
    const body = (rest.length > 0 ? rest.join(":") : point).trim();

    return {
      id:
        typeof slideCandidate.id === "string"
          ? `${slideCandidate.id}-card-${index + 1}`
          : `card-${index + 1}`,
      title,
      body,
      tone:
        index === 0
          ? "accent"
          : index === keyPoints.length - 1
            ? "success"
            : "neutral",
    };
  });

const deriveVisuals = (
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
    ...options.likelyQuestions.slice(0, 1).map((text) => ({
      label: "Likely question",
      text,
      tone: "warning" as const,
    })),
  ];
  const providedCards = toRecordArray(provided.cards).map((card, index) => ({
    id:
      typeof card.id === "string"
        ? card.id
        : `${String(slideCandidate.id ?? "slide")}-card-${index + 1}`,
    title:
      typeof card.title === "string" && card.title.trim().length > 0
        ? card.title
        : `Card ${index + 1}`,
    body:
      typeof card.body === "string" && card.body.trim().length > 0
        ? card.body
        : options.keyPoints[index] ?? options.learningGoal,
    tone: normalizeVisualTone(card.tone),
  }));
  const providedCallouts = toRecordArray(provided.callouts).map(
    (callout, index) => ({
      id:
        typeof callout.id === "string"
          ? callout.id
          : `${String(slideCandidate.id ?? "slide")}-callout-${index + 1}`,
      label:
        typeof callout.label === "string" && callout.label.trim().length > 0
          ? callout.label
          : `Callout ${index + 1}`,
      text:
        typeof callout.text === "string" && callout.text.trim().length > 0
          ? callout.text
          : calloutSeed[index]?.text ?? options.learningGoal,
      tone: normalizeVisualTone(callout.tone ?? calloutSeed[index]?.tone),
    }),
  );
  const providedNodes = toRecordArray(provided.diagramNodes).map((node, index) => ({
    id:
      typeof node.id === "string"
        ? node.id
        : `${String(slideCandidate.id ?? "slide")}-node-${index + 1}`,
    label:
      typeof node.label === "string" && node.label.trim().length > 0
        ? node.label
        : options.keyPoints[index] ?? `Node ${index + 1}`,
    tone: normalizeVisualTone(node.tone),
  }));
  const providedImageSlots = toRecordArray(provided.imageSlots).map((slot, index) => ({
    id:
      typeof slot.id === "string"
        ? slot.id
        : `${String(slideCandidate.id ?? "slide")}-image-${index + 1}`,
    prompt:
      typeof slot.prompt === "string" && slot.prompt.trim().length > 0
        ? slot.prompt
        : typeof provided.imagePrompt === "string" && provided.imagePrompt.trim().length > 0
          ? provided.imagePrompt
          : `Create an educational illustration for ${options.title}.`,
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
    prompt:
      typeof provided.imagePrompt === "string" && provided.imagePrompt.trim().length > 0
        ? provided.imagePrompt
        : `Create an educational visual for ${options.title} that reinforces ${options.learningGoal}.`,
    caption:
      options.examples[0] ??
      options.likelyQuestions[0] ??
      "Use one clear visual to reinforce the main idea.",
    altText: `${options.title} illustration`,
    style:
      fallbackLayout === "three-step-flow"
        ? "diagram"
        : fallbackLayout === "summary-board"
          ? "abstract"
          : "editorial",
    tone: fallbackLayout === "summary-board" ? "success" : "accent",
  } as const;

  return {
    layoutTemplate: normalizeLayoutTemplate(provided.layoutTemplate, fallbackLayout),
    accentColor: normalizeHexColor(provided.accentColor),
    eyebrow:
      typeof provided.eyebrow === "string" && provided.eyebrow.trim().length > 0
        ? provided.eyebrow
        : options.title,
    heroStatement:
      typeof provided.heroStatement === "string" &&
      provided.heroStatement.trim().length > 0
        ? provided.heroStatement
        : options.learningGoal,
    cards:
      providedCards.length > 0 ? providedCards : deriveVisualCards(slideCandidate, options.keyPoints),
    callouts:
      providedCallouts.length > 0
        ? providedCallouts
        : calloutSeed.map((callout, index) => ({
            id: `${String(slideCandidate.id ?? "slide")}-callout-${index + 1}`,
            ...callout,
          })),
    diagramNodes:
      providedNodes.length > 0
        ? providedNodes
        : options.keyPoints.slice(0, 3).map((point, index) => ({
            id: `${String(slideCandidate.id ?? "slide")}-node-${index + 1}`,
            label: point.split(":")[0]?.trim() || point,
            tone:
              index === 0
                ? "info"
                : index === 1
                  ? "accent"
                  : "success",
          })),
    diagramEdges: toRecordArray(provided.diagramEdges).map((edge) => ({
      from: typeof edge.from === "string" ? edge.from : "",
      to: typeof edge.to === "string" ? edge.to : "",
      ...(typeof edge.label === "string" && edge.label.trim().length > 0
        ? { label: edge.label }
        : {}),
    })).filter((edge) => edge.from && edge.to),
    ...(typeof provided.imagePrompt === "string" && provided.imagePrompt.trim().length > 0
      ? { imagePrompt: provided.imagePrompt }
      : {}),
    imageSlots:
      providedImageSlots.length > 0 ? providedImageSlots : [fallbackImageSlot],
  };
};

const normalizeAudienceLevel = (value: unknown): string => {
  if (typeof value !== "string") {
    return "beginner";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "beginner" ||
    normalized === "intermediate" ||
    normalized === "advanced" ||
    normalized === "mixed"
  ) {
    return normalized;
  }

  return "beginner";
};

const normalizePace = (value: unknown): "slow" | "balanced" | "fast" => {
  if (typeof value !== "string") {
    return "balanced";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "slow" || normalized === "balanced" || normalized === "fast") {
    return normalized;
  }

  if (
    normalized === "self-paced" ||
    normalized === "self paced" ||
    normalized === "steady" ||
    normalized === "moderate"
  ) {
    return "balanced";
  }

  if (normalized === "quick" || normalized === "rapid" || normalized === "faster") {
    return "fast";
  }

  if (
    normalized === "gentle" ||
    normalized === "deliberate" ||
    normalized === "slower"
  ) {
    return "slow";
  }

  return "balanced";
};

const normalizePreferredExampleStyle = (
  value: unknown,
): "real_world" | "technical" | "analogy" => {
  if (typeof value !== "string") {
    return "real_world";
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");

  if (
    normalized === "real_world" ||
    normalized === "technical" ||
    normalized === "analogy"
  ) {
    return normalized;
  }

  if (normalized === "real-life" || normalized === "real_life" || normalized === "practical") {
    return "real_world";
  }

  return "real_world";
};

const normalizeDetailLevel = (value: unknown): "light" | "standard" | "deep" => {
  if (typeof value !== "string") {
    return "standard";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "light" || normalized === "standard" || normalized === "deep") {
    return normalized;
  }

  if (
    normalized === "simple" ||
    normalized === "concise" ||
    normalized === "brief"
  ) {
    return "light";
  }

  if (
    normalized === "detailed" ||
    normalized === "in-depth" ||
    normalized === "in_depth" ||
    normalized === "advanced"
  ) {
    return "deep";
  }

  return "standard";
};

const normalizePedagogicalProfile = (value: unknown) => {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
    tone:
      typeof candidate.tone === "string" && candidate.tone.trim().length > 0
        ? candidate.tone
        : "supportive and concrete",
    pace: normalizePace(candidate.pace),
    preferredExampleStyle: normalizePreferredExampleStyle(
      candidate.preferredExampleStyle,
    ),
    wantsFrequentChecks:
      typeof candidate.wantsFrequentChecks === "boolean"
        ? candidate.wantsFrequentChecks
        : true,
    detailLevel: normalizeDetailLevel(candidate.detailLevel),
  };
};

const sanitizePromptShapingText = (value: string, topic: string): string =>
  value
    .replace(/\bcreate (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/gi, " ")
    .replace(/\bmake (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/gi, " ")
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(
      /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi,
      topic,
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

const compactGroundingSummary = (value: string): string => {
  const lines = value
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^(Direct source grounding|Fallback web search after explicit source fetch failure|Search research \d+):\s*/i, "")
        .replace(/\bsubscribe now\b/gi, " ")
        .replace(/\blearn more\b/gi, " ")
        .replace(/\b6-month subscription offer\b/gi, " ")
        .replace(/\bblaze through\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(line)));

  const uniqueLines = uniqueNonEmptyStrings(lines);
  const compact = uniqueLines.slice(0, 6).join(" ");
  return compact.length > 1400 ? compact.slice(0, 1400).trim() : compact;
};

const normalizePresentationPlan = (
  value: unknown,
  overrides?: { targetSlideCount?: number | undefined; topic?: string | undefined },
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const topic = overrides?.topic ?? "the topic";

  return {
    ...candidate,
    title:
      typeof candidate.title === "string"
        ? sanitizePromptShapingText(candidate.title, topic)
        : "Generated teaching plan",
    learningObjectives: (() => {
      const objectives = toStringArray(candidate.learningObjectives).map((objective) =>
        sanitizePromptShapingText(objective, topic),
      );
      return objectives.length > 0
        ? objectives
        : [
            "Understand the main idea.",
            "See how the idea is structured.",
            "Connect the idea to one concrete example.",
          ];
    })(),
    storyline: (() => {
      const storyline = toStringArray(candidate.storyline).map((step) =>
        sanitizePromptShapingText(step, topic),
      );
      return storyline.length > 0
        ? storyline
        : ["motivation", "structure", "example", "recap"];
    })(),
    recommendedSlideCount:
      typeof candidate.recommendedSlideCount === "number"
        ? candidate.recommendedSlideCount
        : overrides?.targetSlideCount ?? 4,
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
  };
};

const normalizeSourceType = (
  value: unknown,
  fallback: "topic" | "document" | "pptx" | "mixed",
): "topic" | "document" | "pptx" | "mixed" => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "topic" ||
    normalized === "document" ||
    normalized === "pptx" ||
    normalized === "mixed"
  ) {
    return normalized;
  }

  if (normalized === "internal" || normalized === "generated" || normalized === "local") {
    return fallback;
  }

  return fallback;
};

const uniqueNonEmptyStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const looksAbstractForIntro = (value: string): boolean =>
  /\b(critical role|foundations|why this matters|why .* matters|importance of)\b/i.test(
    value,
  );

const DECK_SHAPE_META_PATTERNS = [
  /\bthis slide\b/i,
  /\bslides?\b/i,
  /\bpresentation\b/i,
  /\bdeck\b/i,
  /\baudience\b/i,
  /\bsession\b/i,
  /\bthis session\b/i,
  /\bblueprint\b/i,
  /\bour mission\b/i,
];

const DECK_SHAPE_INSTRUCTIONAL_PATTERNS = [
  /^\s*(walk through|review|direct|show|tell|emphasize|map out|validate|highlight|mention|note|point out|call out)\b/i,
  /^\s*use\b/i,
  /^\s*to wrap up\b/i,
  /^\s*welcome everyone\b/i,
  /^\s*we are here to\b/i,
  /^\s*this session orients?\b/i,
  /^\s*depending on your needs\b/i,
  /\buse screenshots?\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\btext-heavy\b/i,
  /\binternal portal\b/i,
  /\bcore messaging\b/i,
];

const DECK_SHAPE_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS = new Set([
  /^\s*use\b/i.source,
]);

const getActiveInstructionalPatterns = (
  input: Pick<GenerateDeckInput, "intent">,
): RegExp[] => {
  const allowsParticipantActionLanguage =
    input.intent?.deliveryFormat === "workshop" ||
    Boolean(input.intent?.activityRequirement);

  if (!allowsParticipantActionLanguage) {
    return DECK_SHAPE_INSTRUCTIONAL_PATTERNS;
  }

  return DECK_SHAPE_INSTRUCTIONAL_PATTERNS.filter(
    (pattern) => !DECK_SHAPE_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS.has(pattern.source),
  );
};

const DECK_SHAPE_SUMMARY_PATTERNS = [
  /\bsummary\b/i,
  /\brecap\b/i,
  /\bwrap(?: |-)?up\b/i,
  /\bnext steps?\b/i,
  /\bcarry forward\b/i,
  /\bconclusion\b/i,
];

const PROMOTIONAL_SOURCE_PATTERNS = [
  /\bsubscribe now\b/i,
  /\blearn more\b/i,
  /\b6-month subscription offer\b/i,
  /\bblaze through\b/i,
  /\bfree trial\b/i,
  /\bupgrade now\b/i,
  /\bby purchasing\b/i,
  /\bpurchase(?:d|s|ing)?\b/i,
  /\bstarter edition\b/i,
  /\bcharity\b/i,
  /\bdonation\b/i,
  /\bbundle\b/i,
];

const CONTRACT_AMBIGUOUS_PRONOUN_PATTERN = /\b(it|this|these|they|them)\b/i;

const tokenizeDeckShapeText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const hasMeaningfulAnchorOverlap = (value: string, anchor: string): boolean => {
  const left = [...new Set(tokenizeDeckShapeText(value))];
  const right = new Set(tokenizeDeckShapeText(anchor));

  if (left.length === 0 || right.size === 0) {
    return false;
  }

  const overlap = left.filter((token) => right.has(token));
  return overlap.length >= Math.min(3, Math.max(1, Math.floor(right.size / 5)));
};

const looksFragmentarySlidePoint = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  if (/^[a-z]/.test(trimmed)) {
    return true;
  }

  const tokens = tokenizeDeckShapeText(trimmed);
  if (tokens.length >= 7 && /[.!?]$/.test(trimmed)) {
    return false;
  }

  if (tokens.length < 4) {
    return true;
  }

  return !/\b(is|are|was|were|has|have|had|can|could|will|would|should|did|does|do|may|might|must)\b/i.test(
    trimmed,
  );
};

type SlideDraftAssessment = {
  retryable: boolean;
  reasons: string[];
};

const extractPlainTextSlideSection = (text: string, label: string): string => {
  const pattern = new RegExp(
    `^${label}:\\s*([\\s\\S]*?)(?=^TITLE:|^GOAL:|^POINTS:|^BEGINNER:|^ADVANCED:|^EXAMPLE:|^QUESTION:|$)`,
    "im",
  );
  return (
    text
      .match(pattern)?.[1]
      ?.replace(/\r\n/g, "\n")
      ?.replace(/\u00a0/g, " ")
      ?.trim() ?? ""
  );
};

const extractPlainTextSlideSectionAny = (text: string, labels: string[]): string => {
  for (const label of labels) {
    const value = extractPlainTextSlideSection(text, label);
    if (value) {
      return value;
    }
  }

  return "";
};

const buildSlideFromPlainText = (
  text: string,
  slide: Slide,
): Record<string, unknown> | null => {
  const normalizeInlineText = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

  const splitPlainTextSlidePoints = (value: string): string[] =>
    (() => {
      const normalized = value
        .replace(/\n(?=[^\n]*?:\s*$)/g, "\n")
        .replace(/\s+[•*-]\s+/g, "\n- ")
        .trim();
      const bulletLikeEntries = normalized
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=\.)\s+(?=[•*-]\s+|\d+[.)]\s+)/))
        .map((entry) => entry.replace(/^[\s\-*•\d.)]+/, ""))
        .map(normalizeInlineText)
        .filter(Boolean);

      if (bulletLikeEntries.length >= 3) {
        return bulletLikeEntries;
      }

      return normalized
        .split(/(?<=[.!?])\s+/)
        .map((entry) => entry.replace(/^[\s\-*•\d.)]+/, ""))
        .map(normalizeInlineText)
        .filter(Boolean);
    })();

  const collectSupplementalSentences = (values: string[]): string[] =>
    uniqueNonEmptyStrings(
      values
        .flatMap((value) =>
          value
            .split(/(?<=[.!?])\s+/)
            .map(normalizeInlineText)
            .filter((sentence) => sentence.length >= 24),
        ),
    );

  const title = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["TITLE", "SLIDE TITLE"]),
  );
  const learningGoal = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["GOAL", "LEARNING GOAL", "OBJECTIVE"]),
  );
  const pointsBlock = extractPlainTextSlideSectionAny(text, ["POINTS", "KEY POINTS"]);
  const beginnerExplanation = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["BEGINNER", "BEGINNER EXPLANATION"]),
  );
  const advancedExplanation = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["ADVANCED", "ADVANCED EXPLANATION"]),
  );
  const example = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["EXAMPLE", "EXAMPLES"]),
  );
  const question = normalizeInlineText(
    extractPlainTextSlideSectionAny(text, ["QUESTION", "LIKELY QUESTION"]),
  );
  const effectiveTitle = title || slide.title;
  const effectiveLearningGoal = learningGoal || slide.learningGoal;
  const pointCandidates = uniqueNonEmptyStrings([
    ...splitPlainTextSlidePoints(pointsBlock),
    ...collectSupplementalSentences([
      beginnerExplanation,
      advancedExplanation,
      example,
    ]),
  ]);
  const pointAnchor = [
    effectiveTitle,
    effectiveLearningGoal,
    slide.title,
    slide.learningGoal,
  ].join(" ");
  const rankedPointCandidates = pointCandidates
    .map((value) => ({
      value,
      score:
        countAnchorOverlap(value, pointAnchor) * 2 +
        (looksFragmentarySlidePoint(value) ? 0 : 3) +
        (/[.!?]$/.test(value) ? 1 : 0) +
        Math.min(2, Math.floor(tokenizeDeckShapeText(value).length / 6)),
    }))
    .sort((left, right) => right.score - left.score);
  const keyPoints = rankedPointCandidates
    .map((candidate) => candidate.value)
    .map((value) => toAudienceFacingSentence(value))
    .filter(Boolean)
    .slice(0, 3);

  if (!effectiveTitle || !effectiveLearningGoal || keyPoints.length < 3) {
    return null;
  }

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: effectiveTitle,
    learningGoal: effectiveLearningGoal,
    keyPoints,
    speakerNotes: [],
    examples: example ? [example] : [],
    likelyQuestions: question ? [question] : [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

const splitCoverageRequirement = (value: string): string[] => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
  if (!normalized) {
    return [];
  }

  const explainWhyMatch = normalized.match(/^(.*?)\s+and\s+explain why\s+(.+)$/i);
  if (explainWhyMatch?.[1] && explainWhyMatch[2]) {
    const subject = explainWhyMatch[1].trim();
    const whyClause = explainWhyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueNonEmptyStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  const whyMatch = normalized.match(/^(.*?)\s+and why\s+(.+)$/i);
  if (whyMatch?.[1] && whyMatch[2]) {
    const subject = whyMatch[1].trim();
    const whyClause = whyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueNonEmptyStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  return [normalized];
};

const extractCoverageRequirements = (value: string): string[] => {
  const descriptivePatterns = [
    /\binclude at least one slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\binclude a slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bfocus on\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bcover\s+([^.!?]+)(?:[.!?]|$)/gi,
  ];
  const explainWhyPattern = /\bexplain why\s+([^.!?]+)(?:[.!?]|$)/gi;

  const results: string[] = [];
  const anchorSubjects: string[] = [];

  for (const pattern of descriptivePatterns) {
    for (const match of value.matchAll(pattern)) {
      const captured = match[1]?.replace(/\s+/g, " ").trim();
      if (captured && captured.length > 8) {
        const requirements = splitCoverageRequirement(captured);
        results.push(...requirements);
        const anchorSubject = requirements.find((requirement) => !/^why\b/i.test(requirement));
        if (anchorSubject) {
          anchorSubjects.push(anchorSubject);
        }
      }
    }
  }

  for (const match of value.matchAll(explainWhyPattern)) {
    const captured = match[1]?.replace(/\s+/g, " ").trim();
    if (captured && captured.length > 8) {
      const anchorSubject = anchorSubjects.at(-1);
      const normalizedCaptured = anchorSubject
        ? captured.replace(/\bit\b/gi, anchorSubject)
        : captured;
      results.push(`Why ${normalizedCaptured}`);
    }
  }

  return uniqueNonEmptyStrings(results).slice(0, 4);
};

type SlideContract = {
  index: number;
  label: string;
  focus: string;
  objective?: string;
};

const resolveIntentSubject = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
): string => input.intent?.subject?.trim() || input.topic;

const splitContractCandidateClauses = (value: string): string[] =>
  value
    .split(/[,:;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const compressContractCandidate = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  candidate: string,
): string => {
  const subject = resolveIntentSubject(input);
  const normalized = sanitizeContractText(candidate, subject);
  if (!normalized) {
    return subject;
  }

  if (normalized.length <= 84) {
    return normalized;
  }

  const anchors = uniqueNonEmptyStrings([
    subject,
    ...(input.intent?.coverageRequirements ?? []),
  ]);
  const clauses = splitContractCandidateClauses(normalized);
  const anchoredClause = clauses.find((clause) =>
    anchors.some((anchor) => hasMeaningfulAnchorOverlap(clause, anchor)),
  );

  if (anchoredClause && anchoredClause.length <= 84) {
    return anchoredClause;
  }

  if (hasMeaningfulAnchorOverlap(normalized, subject)) {
    return subject;
  }

  return shortenTitlePhrase(normalized, 84);
};

const countAnchorOverlap = (value: string, anchor: string): number => {
  const left = [...new Set(tokenizeDeckShapeText(value))];
  const right = new Set(tokenizeDeckShapeText(anchor));

  if (left.length === 0 || right.size === 0) {
    return 0;
  }

  return left.filter((token) => right.has(token)).length;
};

const buildSlideEnrichmentPromptLines = (input: {
  deck: Deck;
  slide: Slide;
  contract: SlideContract;
  generationInput: GenerateDeckInput;
  priorAssessment?: SlideDraftAssessment | null;
}): string[] => {
  const subject = resolveIntentSubject(input.generationInput);
  const groundingSummaryCandidates = compactGroundingSummary(
    input.generationInput.groundingSummary ?? "",
  )
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 28);
  const previousSlide = input.deck.slides[input.slide.order - 1];
  const nextSlide = input.deck.slides[input.slide.order + 1];
  const relevanceAnchor = uniqueNonEmptyStrings([
    subject,
    input.slide.title,
    input.slide.learningGoal,
    input.contract.focus,
    input.contract.objective ?? "",
    ...(input.generationInput.groundingCoverageGoals ?? []),
  ]).join(" ");
  const contextCandidates = uniqueNonEmptyStrings([
    ...groundingSummaryCandidates,
    ...(input.generationInput.groundingHighlights ?? []),
    ...(input.generationInput.groundingCoverageGoals ?? []),
    ...(input.generationInput.plan?.learningObjectives ?? []),
    ...(input.generationInput.plan?.storyline ?? []),
    input.deck.summary,
    input.slide.title,
    input.slide.learningGoal,
    ...input.slide.keyPoints,
  ]).filter(
    (value) =>
      value.length >= 18 &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)) &&
      !PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value)),
  );
  const relevantContext = contextCandidates
    .map((value) => ({
      value,
      score: countAnchorOverlap(value, relevanceAnchor),
    }))
    .filter((candidate) => candidate.score > 0 || hasMeaningfulAnchorOverlap(candidate.value, subject))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((candidate) => candidate.value);

  return [
    `Subject: ${subject}`,
    input.generationInput.intent?.audienceCues?.length
      ? `Audience: ${input.generationInput.intent.audienceCues.join("; ")}`
      : null,
    input.generationInput.intent?.deliveryFormat
      ? `Format: ${input.generationInput.intent.deliveryFormat}`
      : null,
    input.generationInput.intent?.activityRequirement
      ? `Participant activity requirement: ${input.generationInput.intent.activityRequirement}`
      : null,
    `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
    `Slide role: ${input.contract.label}`,
    `Slide focus: ${input.contract.focus}`,
    input.contract.objective ? `Slide objective: ${input.contract.objective}` : null,
    `Draft title: ${input.slide.title}`,
    `Draft learning goal: ${input.slide.learningGoal}`,
    previousSlide ? `Previous slide title: ${previousSlide.title}` : "Previous slide title: none",
    nextSlide ? `Next slide title: ${nextSlide.title}` : "Next slide title: none",
    relevantContext.length > 0
      ? `Relevant grounding:\n${relevantContext.map((value) => `- ${value}`).join("\n")}`
      : "Relevant grounding: none",
    input.priorAssessment
      ? `Local quality feedback from earlier draft: ${input.priorAssessment.reasons.join(" ")}`
      : null,
    input.generationInput.revisionGuidance
      ? `Revision guidance: ${summarizeRevisionGuidance(input.generationInput.revisionGuidance)}`
      : null,
  ].filter((line): line is string => Boolean(line));
};

const CONTRACT_LEAD_IN_PATTERNS = [
  /^\s*by the time of\b/i,
  /^\s*although\b/i,
  /^\s*while\b/i,
  /^\s*when\b/i,
  /^\s*because\b/i,
  /^\s*if\b/i,
  /^\s*as soon as\b/i,
  /^\s*as\b/i,
];

const NON_SLIDEABLE_COVERAGE_PATTERNS = [
  /^\s*the specific case study or research angle requested in the prompt:\s*/i,
  /^\s*why the specific incident, case study, or research angle connected to\b/i,
  /^\s*what the case study reveals about behavior, systems, or real-world consequences\b/i,
];

const stripLeadingContractClause = (value: string): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  const clauses = trimmed
    .split(/,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (
    clauses.length >= 2 &&
    CONTRACT_LEAD_IN_PATTERNS.some((pattern) => pattern.test(clauses[0]!))
  ) {
    return clauses.slice(1).join(", ").trim();
  }

  return trimmed;
};

const sanitizeContractText = (value: string, topic: string): string => {
  const normalized = stripLeadingContractClause(
    value
    .replace(
      /^\s*the specific case study or research angle requested in the prompt:\s*/i,
      "",
    )
    .replace(
      /^\s*the main systems, parts, or focus areas that define\b.*$/i,
      "Core systems and focus areas",
    )
    .replace(
      /^\s*the main services, products, or focus areas connected to\b.*$/i,
      "Core systems and focus areas",
    )
    .replace(
      /^\s*a concrete example, consequence, or real-world application of\b.*$/i,
      "Real-world applications",
    )
    .replace(/^\s*application in\b.*$/i, "Real-world applications")
    .replace(/^\s*the most important lessons about\b.*$/i, "Key takeaways")
    .replace(/^\s*(?:the\s+)?role of\s+/i, "")
    .replace(/\bthis part of\s+[^\s].*?\s+focuses on\b/gi, " ")
    .replace(/\bthis part of\b/gi, " ")
    .replace(/\bthis session\b/gi, " ")
    .replace(/\bthe practical takeaway is\b/gi, " ")
    .replace(/\bthe broader story of\b/gi, " ")
    .replace(/\bhow it connects to\b/gi, " ")
    .replace(/\bour mission\b/gi, " ")
    .replace(/\bshould be explained with a clear connection back to\b.*$/gi, " ")
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(
      /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi,
      topic,
    )
    .replace(
      /^\s*(?:understand|appreciate|recognize|explain|describe|show|teach|define|identify|outline|summarize|review|explore)\s+/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim(),
  )
    .replace(/[.,;:!?]+$/g, "");

  return normalized || topic;
};

const toAudienceFacingSentence = (value: string): string => {
  const normalized = value
    .replace(/\bshould be explained with a clear connection back to\b.*$/gi, " ")
    .replace(
      /^\s*(?:explain|show|describe|teach|outline|review|walk through|highlight)\b[:\s-]*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "");

  if (!normalized) {
    return "";
  }

  const sentence =
    normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const compactGroundingHighlight = (value: string, topic: string): string => {
  const normalized = sanitizeContractText(value, topic)
    .replace(/^whether you need help with\b/i, "Flexible QA services cover")
    .replace(/\bregardless of what industry you.?re in\b/gi, "across industries")
    .replace(/^as [^,]+,\s*we\b/i, "We")
    .replace(/^our\b/i, "The team's")
    .replace(/^we\b/i, "The team")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 96) {
    return normalized;
  }

  const clauses = normalized
    .split(/,\s+|;\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24 && part.length <= 96);

  return clauses[0] ?? normalized.slice(0, 96).replace(/\s+\S*$/, "").trim();
};

const pickContractText = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  candidates: Array<string | undefined>,
  options?: {
    preferConcrete?: boolean | undefined;
  },
): string => {
  const subject = resolveIntentSubject(input);
  const sanitized = uniqueNonEmptyStrings(
    candidates
      .map((candidate) =>
        typeof candidate === "string" ? compressContractCandidate(input, candidate) : "",
      )
      .filter(
        (candidate) =>
          candidate.length > 0 &&
          !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(candidate)) &&
          !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(candidate)),
      ),
  );

  if (sanitized.length === 0) {
    return subject;
  }

  if (options?.preferConcrete) {
    const concrete = sanitized.find(
      (candidate) =>
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(candidate)) &&
        !CONTRACT_AMBIGUOUS_PRONOUN_PATTERN.test(candidate) &&
        !CONTRACT_LEAD_IN_PATTERNS.some((pattern) => pattern.test(candidate)),
    );
    if (concrete) {
      return concrete;
    }

    const fallbackConcrete = sanitized.find(
      (candidate) =>
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(candidate)) &&
        !CONTRACT_LEAD_IN_PATTERNS.some((pattern) => pattern.test(candidate)),
    );
    if (fallbackConcrete) {
      return fallbackConcrete;
    }
  }

  return sanitized[0]!;
};

const shortenTitlePhrase = (value: string, maxLength = 72): string => {
  const stripDanglingTitleTail = (input: string): string =>
    input
      .replace(/[.:!?]+$/g, "")
      .replace(/\s+(?:due to|because|as|with|for|from|connected to|related to)\s+(?:a|an|the)?$/i, "")
      .replace(/\s+(?:a|an|the|as)$/i, "")
      .trim();

  const trimmed = stripDanglingTitleTail(value);
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const shortened = stripDanglingTitleTail(
    trimmed.slice(0, maxLength).replace(/\s+\S*$/, "").trim(),
  );
  return shortened || stripDanglingTitleTail(trimmed.slice(0, maxLength).trim());
};

const isOrientationCoverageAnchor = (topic: string, value: string): boolean => {
  const normalized = sanitizeContractText(value, topic).toLowerCase();
  const openingAnchor = sanitizeContractText(
    `What ${topic} is and why it matters`,
    topic,
  ).toLowerCase();

  return (
    normalized === openingAnchor ||
    /^what\b.+\bis\b.+\bwhy\b.+\bmatters?\b/i.test(normalized)
  );
};

const buildSlideContracts = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  slideCount: number,
): SlideContract[] => {
  const subject = resolveIntentSubject(input);
  const explicitCoverageRequirements = uniqueNonEmptyStrings(
    (input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""))
      .map((requirement) => sanitizeContractText(requirement, subject)),
  );
  const coverageRequirements = uniqueNonEmptyStrings(
    explicitCoverageRequirements,
  );
  const coverageGoals = uniqueNonEmptyStrings(
    (input.groundingCoverageGoals ?? []).map((goal) =>
      sanitizeContractText(goal, subject),
    ),
  ).filter(
    (goal) =>
      goal.length > 0 &&
      !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(goal)) &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(goal)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(goal)),
  );
  const coverageAnchors = uniqueNonEmptyStrings(
    coverageRequirements.length > 0
      ? [...coverageRequirements, ...coverageGoals]
      : coverageGoals,
  ).filter((anchor) => !isOrientationCoverageAnchor(subject, anchor));
  const storyline = uniqueNonEmptyStrings(input.plan?.storyline ?? []);
  const learningObjectives = uniqueNonEmptyStrings(input.plan?.learningObjectives ?? []);
  const groundingHighlights = uniqueNonEmptyStrings(
    (input.groundingHighlights ?? []).map((highlight) =>
      compactGroundingHighlight(highlight, subject),
    ),
  ).filter(
    (highlight) =>
      highlight.length > 16 &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(highlight)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(highlight)),
  );
  const contracts: SlideContract[] = [];
  let highlightIndex = 0;

  const takeNextHighlight = () => {
    const next = groundingHighlights[highlightIndex];
    if (next) {
      highlightIndex += 1;
    }

    return next;
  };

  for (let index = 0; index < slideCount; index += 1) {
    if (index === 0) {
      const openingHighlight = takeNextHighlight();
      const focus = pickContractText(
        input,
        [
          `What ${subject} is and why it matters`,
          learningObjectives[0],
          openingHighlight,
        ],
      );
      contracts.push({
        index,
        label: "orientation",
        focus,
        ...((openingHighlight || learningObjectives[0])
          ? {
              objective: sanitizeContractText(
                openingHighlight ?? learningObjectives[0]!,
                subject,
              ),
            }
          : {}),
      });
      continue;
    }

    if (coverageAnchors[index - 1]) {
      const coverageAnchor = coverageAnchors[index - 1]!;
      const groundingHighlight = takeNextHighlight();
      const focus = pickContractText(
        input,
        [
          coverageAnchor,
          groundingHighlight,
          learningObjectives[index],
          storyline[index],
        ],
        { preferConcrete: true },
      );
      const objective = pickContractText(
        input,
        [
          learningObjectives[index],
          storyline[index],
          coverageAnchor,
        ],
      );
      contracts.push({
        index,
        label: "required coverage",
        focus,
        ...(objective && objective !== focus
          ? { objective: sanitizeContractText(objective, subject) }
          : {}),
      });
      continue;
    }

    if (index === slideCount - 1) {
      const groundingHighlight = takeNextHighlight();
      const focus = pickContractText(
        input,
        [
          learningObjectives.at(-1),
          storyline.at(-1),
          groundingHighlight,
          `The most important lessons about ${subject}`,
        ],
        { preferConcrete: true },
      );
      contracts.push({
        index,
        label: "synthesis",
        focus,
        ...((groundingHighlight || learningObjectives.at(-1))
          ? {
              objective: sanitizeContractText(
                groundingHighlight ?? learningObjectives.at(-1)!,
                subject,
              ),
            }
          : {}),
      });
      continue;
    }

    const groundingHighlight = takeNextHighlight();
    const focus = pickContractText(
      input,
      [
        learningObjectives[index],
        storyline[index],
        groundingHighlight,
        `The next meaningful part of ${subject}`,
      ],
      { preferConcrete: true },
    );
    const objective = pickContractText(
      input,
      [
        learningObjectives[index],
        storyline[index],
        groundingHighlight,
      ],
    );
    contracts.push({
      index,
      label: storyline[index] ?? `development ${index + 1}`,
      focus,
      ...((groundingHighlight || objective) && objective !== focus
        ? {
            objective: sanitizeContractText(
              groundingHighlight ?? objective!,
              subject,
            ),
          }
        : {}),
    });
  }

  return contracts;
};

const buildSlideContractPromptLines = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "targetSlideCount"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): string[] => {
  const slideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, (input.plan?.storyline?.length ?? 0) + 1);

  return buildSlideContracts(input, slideCount).map((contract) =>
    `Slide ${contract.index + 1}: ${contract.label}. Focus on ${contract.focus}${
      contract.objective ? ` Objective anchor: ${contract.objective}.` : "."
    }`,
  );
};

const buildContractTitle = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  if (contract.index === 0) {
    return `${subject} at a glance`;
  }

  const preferredSource = (() => {
    const focus = sanitizeContractText(contract.focus, subject);
    const objective = contract.objective
      ? sanitizeContractText(contract.objective, subject)
      : "";

    if (
      objective &&
      CONTRACT_AMBIGUOUS_PRONOUN_PATTERN.test(objective) &&
      !CONTRACT_AMBIGUOUS_PRONOUN_PATTERN.test(focus)
    ) {
      return focus;
    }

    if (
      objective &&
      CONTRACT_AMBIGUOUS_PRONOUN_PATTERN.test(focus) &&
      !CONTRACT_AMBIGUOUS_PRONOUN_PATTERN.test(objective)
    ) {
      return objective;
    }

    if (
      objective &&
      (DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(focus)) ||
        focus.length > 84)
    ) {
      return objective;
    }

    return focus || objective;
  })();

  const trimmed = shortenTitlePhrase(preferredSource);
  if (!trimmed) {
    return `Slide ${contract.index + 1}`;
  }

  const topicPrefixPattern = new RegExp(
    `^${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`,
    "i",
  );
  const withoutTopicPrefix = trimmed.replace(topicPrefixPattern, "").trim() || trimmed;
  const normalized =
    withoutTopicPrefix.charAt(0).toUpperCase() + withoutTopicPrefix.slice(1);

  if (normalized.length <= 72 && !/[.?!]/.test(normalized)) {
    return normalized;
  }

  return shortenTitlePhrase(normalized, 72);
};

const buildContractAnchoredKeyPoints = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  concretePointPool: string[],
): string[] => {
  const subject = resolveIntentSubject(input);

  return uniqueNonEmptyStrings([
    ...concretePointPool.filter(
      (point) =>
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)),
    ),
    contract.objective ? toAudienceFacingSentence(contract.objective) : null,
    toAudienceFacingSentence(`${contract.focus} helps explain how ${subject} works in practice`),
    contract.objective
      ? toAudienceFacingSentence(`${contract.objective} influences real outcomes connected to ${subject}`)
      : null,
    toAudienceFacingSentence(`${subject} becomes clearer when you look at ${contract.focus.toLowerCase()}`),
  ].filter((value): value is string => Boolean(value))).slice(0, 3);
};

const buildContractLearningGoal = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const focus = pickContractText(
    input,
    [contract.objective, contract.focus],
    { preferConcrete: true },
  );
  if (contract.index === 0) {
    return `Understand what ${subject} is, why it matters, and one concrete thing it is known for.`;
  }
  if (!focus) {
    return `Understand ${subject} more concretely.`;
  }

  if (
    focus.toLowerCase().includes(subject.toLowerCase()) ||
    /^(?:how|why|what|when|where|who)\b/i.test(focus)
  ) {
    return `Understand ${focus.charAt(0).toLowerCase() + focus.slice(1)}.`;
  }

  return hasMeaningfulAnchorOverlap(focus, subject)
    ? `Understand how ${focus.charAt(0).toLowerCase() + focus.slice(1)} matters in practice.`
    : `Understand how ${focus.charAt(0).toLowerCase() + focus.slice(1)} connects to ${subject}.`;
};

const buildOrientationCoveragePoint = (
  topic: string,
  anchor: string,
): string => {
  const normalized = sanitizeContractText(anchor, topic);
  if (!normalized) {
    return "";
  }

  if (/^why\b/i.test(normalized)) {
    return toAudienceFacingSentence(normalized.replace(/^why\s+/i, ""));
  }

  if (hasMeaningfulAnchorOverlap(normalized, topic)) {
    return toAudienceFacingSentence(normalized);
  }

  return toAudienceFacingSentence(
    `${normalized} is one concrete way to understand ${topic}`,
  );
};

const buildOrientationSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const title = `${subject}: why it matters in practice`;
  const coverageAnchors = uniqueNonEmptyStrings([
    ...(input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? "")),
    ...(input.groundingCoverageGoals ?? []),
  ])
    .map((value) => sanitizeContractText(value, subject))
    .filter(
      (value) =>
        value.length > 0 &&
        !isOrientationCoverageAnchor(subject, value) &&
        !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(value)) &&
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
    )
    .slice(0, 2);
  const keyPoints = uniqueNonEmptyStrings(
    [
      ...coverageAnchors.map((anchor) => buildOrientationCoveragePoint(subject, anchor)),
      input.plan?.learningObjectives?.[0]
        ? toAudienceFacingSentence(input.plan.learningObjectives[0])
        : null,
      deck.summary,
      toAudienceFacingSentence(
        `${subject} becomes easier to understand when you connect it to one concrete consequence, example, or responsibility`,
      ),
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 3);
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because it affects real decisions, behavior, or outcomes in practice`,
    );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal: `Understand what ${subject} is, why it matters, and one concrete way it shows up in practice.`,
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [`Why does ${subject} matter in practice?`],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

const OVERVIEW_SLIDE_TITLE_PATTERN = /^what .+ is and why it matters$/i;
const DETERMINISTIC_CONTRACT_TITLE_PATTERNS = [
  /^core systems and focus areas$/i,
  /^real-world applications$/i,
  /^key takeaways$/i,
];

const shouldUseDeterministicSubjectOverviewSlide = (
  input: GenerateDeckInput,
  slide: Slide,
  contract: SlideContract,
): boolean => {
  const subject = resolveIntentSubject(input);
  const title = slide.title.trim();
  if (
    DETERMINISTIC_CONTRACT_TITLE_PATTERNS.some((pattern) => pattern.test(title)) ||
    DETERMINISTIC_CONTRACT_TITLE_PATTERNS.some((pattern) => pattern.test(contract.focus))
  ) {
    return true;
  }

  if (slide.order !== 1) {
    return false;
  }

  return (
    OVERVIEW_SLIDE_TITLE_PATTERN.test(title) ||
    OVERVIEW_SLIDE_TITLE_PATTERN.test(contract.focus) ||
    /^overview$/i.test(title) ||
    /^overview$/i.test(contract.focus) ||
    hasMeaningfulAnchorOverlap(title, `${subject} what ${subject} is`)
  );
};

const buildSubjectOverviewSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const normalizedContractTitle = buildContractTitle(input, contract);
  const title = OVERVIEW_SLIDE_TITLE_PATTERN.test(slide.title.trim())
    ? slide.title.trim()
    : normalizedContractTitle;
  const isOverviewSlide = OVERVIEW_SLIDE_TITLE_PATTERN.test(title);
  const pointPool = uniqueNonEmptyStrings([
    ...(input.groundingHighlights ?? []),
    ...(input.groundingCoverageGoals ?? []),
    ...(input.plan?.learningObjectives ?? []),
    ...(input.plan?.storyline ?? []),
    deck.summary,
    contract.focus,
    contract.objective ?? "",
  ]).filter(
    (value) =>
      value.length > 24 &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
  );
  const keyPoints = uniqueNonEmptyStrings([
    ...buildContractAnchoredKeyPoints(input, contract, pointPool),
    toAudienceFacingSentence(`${subject} has distinct systems, examples, or behaviors that make it recognizable.`),
    toAudienceFacingSentence(`Looking at one concrete mechanism or event makes ${subject} easier to understand.`),
  ]).slice(0, 3);
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because its structure leads to real outcomes, examples, or decisions in practice`,
    );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal:
      isOverviewSlide
        ? `Understand what ${subject} is and why it matters.`
        : buildContractLearningGoal(input, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [
      `What makes ${subject} recognizable in practice?`,
      `Why do people still study or discuss ${subject}?`,
    ],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

const buildGroundedSlideRecoveryFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> | null => {
  const subject = resolveIntentSubject(input);
  const pointPool = uniqueNonEmptyStrings(
    [
      ...(input.groundingHighlights ?? []),
      ...(input.groundingCoverageGoals ?? []),
      contract.objective,
      contract.focus,
      ...slide.keyPoints,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...deck.summary.split(/(?<=[.!?])\s+/),
    ].filter((value): value is string => Boolean(value)),
  ).filter(
    (value) =>
      !PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
  );

  const anchoredPoints = buildContractAnchoredKeyPoints(
    input,
    contract,
    pointPool.filter((value) =>
      hasMeaningfulAnchorOverlap(
        value,
        `${subject} ${slide.title} ${contract.focus} ${contract.objective ?? ""}`,
      )
    ),
  );

  if (anchoredPoints.length < 3) {
    return null;
  }

  const example =
    pointPool.find((value) => value.length >= 40 && hasMeaningfulAnchorOverlap(value, anchoredPoints[0]!)) ??
    pointPool.find((value) => value.length >= 40) ??
    anchoredPoints[0]!;

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: slide.title,
    learningGoal: slide.learningGoal,
    keyPoints: anchoredPoints,
    speakerNotes: [],
    examples: [toAudienceFacingSentence(example)],
    likelyQuestions: [
      `Why does ${slide.title.charAt(0).toLowerCase() + slide.title.slice(1)} matter in ${subject}?`,
    ],
    beginnerExplanation: toAudienceFacingSentence(`${anchoredPoints[0]} ${anchoredPoints[1]}`),
    advancedExplanation: toAudienceFacingSentence(
      `${anchoredPoints[2]} This detail helps connect the slide back to ${subject}.`,
    ),
    id: slide.id,
    order: slide.order,
  };
};

const buildSlideDraftLocalAnchors = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  slide: Record<string, unknown>,
): string[] =>
  uniqueNonEmptyStrings([
    typeof slide.title === "string" ? slide.title.trim() : "",
    typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "",
    contract.focus,
    contract.objective ?? "",
    resolveIntentSubject(input),
  ]);

const matchesAnySlideAnchor = (value: string, anchors: string[]): boolean =>
  anchors.some(
    (anchor) =>
      countAnchorOverlap(value, anchor) >= 2 || hasMeaningfulAnchorOverlap(value, anchor),
  );

const assessGeneratedSlideDraft = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  slide: Record<string, unknown>,
): SlideDraftAssessment => {
  const title = typeof slide.title === "string" ? slide.title.trim() : "";
  const learningGoal =
    typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
  const keyPoints = toStringArray(slide.keyPoints);
  const explanations = [
    typeof slide.beginnerExplanation === "string"
      ? slide.beginnerExplanation.trim()
      : "",
    typeof slide.advancedExplanation === "string"
      ? slide.advancedExplanation.trim()
      : "",
  ].filter(Boolean);
  const allText = [title, learningGoal, ...keyPoints, ...explanations].join(" ");
  const localAnchors = buildSlideDraftLocalAnchors(input, contract, slide);
  const activeInstructionalPatterns = getActiveInstructionalPatterns(input);
  const reasons: string[] = [];

  if (PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(allText))) {
    reasons.push(
      "Remove promotional or navigation copy from the slide. Keep only subject content.",
    );
  }

  if (
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(allText)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(allText))
  ) {
    reasons.push(
      "Remove slide-making advice and presenter instructions. Teach the subject itself instead.",
    );
  }

  if (
    /^Understand the role of\b/i.test(learningGoal) ||
    !learningGoal ||
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(learningGoal)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(learningGoal))
  ) {
    reasons.push(
      "Rewrite the learning goal so it names a concrete part of the subject without awkward role-of phrasing.",
    );
  }

  if (
    !title ||
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(title)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(title)) ||
    PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(title)) ||
    !matchesAnySlideAnchor(title, localAnchors.filter((anchor) => anchor !== title))
  ) {
    reasons.push(
      "Rewrite the title so it clearly names the concrete subject area of this slide.",
    );
  }

  if (
    keyPoints.length < 3 ||
    keyPoints.some(
      (point) =>
        looksFragmentarySlidePoint(point) ||
        PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(point)) ||
        DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) ||
        activeInstructionalPatterns.some((pattern) => pattern.test(point)),
    ) ||
    keyPoints.filter((point) => matchesAnySlideAnchor(point, localAnchors)).length < 1
  ) {
    reasons.push(
      "Rewrite the key points as three complete, concrete claims tightly tied to this slide's subject.",
    );
  }

  return {
    retryable: reasons.length > 0,
    reasons: uniqueNonEmptyStrings(reasons),
  };
};

const buildOutlineDeckSummary = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): string => {
  const subject = resolveIntentSubject(input);
  const explicitCoverageRequirements = uniqueNonEmptyStrings(
    (input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? "")).map((requirement) =>
      sanitizeContractText(requirement, subject),
    ),
  );
  const bestAnchor = pickContractText(
    input,
    [
      explicitCoverageRequirements[0],
      input.groundingCoverageGoals?.[0],
      input.groundingHighlights?.[0],
      input.plan?.learningObjectives?.[0],
      input.plan?.storyline?.[0],
      input.presentationBrief,
      `A clear teaching presentation about ${subject}`,
    ],
    { preferConcrete: true },
  );

  return toAudienceFacingSentence(
    `${subject} becomes easier to understand when you focus on ${bestAnchor.toLowerCase()}`,
  );
};

const buildOutlineScaffoldDeck = (input: GenerateDeckInput): Deck => {
  const subject = resolveIntentSubject(input);
  const slideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, (input.plan?.storyline?.length ?? 0) + 1);
  const contracts = buildSlideContracts(input, slideCount);
  const rawDeck = {
    title: input.plan?.title ?? `${subject}: key ideas`,
    summary: buildOutlineDeckSummary(input),
    slides: contracts.map((contract) => ({
      title:
        contract.index === 0
          ? `${subject}: why it matters in practice`
          : buildContractTitle(input, contract),
      learningGoal: buildContractLearningGoal(input, contract),
      keyPoints: buildContractAnchoredKeyPoints(
        input,
        contract,
        input.groundingHighlights ?? [],
      ).slice(0, 3),
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    })),
  };

  return DeckSchema.parse(normalizeDeck(rawDeck, input));
};

const applyPlanDrivenDeckShape = (
  slides: Record<string, unknown>[],
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): Record<string, unknown>[] => {
  const contracts = buildSlideContracts(input, slides.length);

  return slides.map((slide, index) => {
    const contract = contracts[index];
    if (!slide || !contract) {
      return slide;
    }

    const title = typeof slide.title === "string" ? slide.title.trim() : "";
    const contractAnchor = [input.topic, contract.focus, contract.objective ?? ""].join(
      " ",
    );
    const keyPoints = toStringArray(slide.keyPoints);
    const concretePointPool = uniqueNonEmptyStrings(
      [
        ...keyPoints,
        typeof slide.beginnerExplanation === "string" ? slide.beginnerExplanation : "",
        typeof slide.advancedExplanation === "string" ? slide.advancedExplanation : "",
        ...toStringArray(slide.examples),
        ...toStringArray(slide.speakerNotes),
      ].filter(
        (value) =>
          value.length > 18 &&
          !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
          !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
      ),
    );

    const replacementPoints = buildContractAnchoredKeyPoints(
      input,
      contract,
      concretePointPool,
    );

    const introNeedsRepair =
      index === 0 &&
      (looksAbstractForIntro(title) ||
        !title ||
        /^(why this matters|welcome)$/i.test(title) ||
        /\bour mission\b/i.test(title) ||
        keyPoints.some(
          (point) =>
            DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)),
        ));

    const titleNeedsRepair =
      introNeedsRepair ||
      title.length > 84 ||
      /^(?:understanding|exploring|learning|appreciating)\s+/i.test(title) ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(title)) ||
      !hasMeaningfulAnchorOverlap(title, contractAnchor);

    const learningGoalText =
      typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
    const learningGoalNeedsRepair =
      !learningGoalText ||
      /^Understand the role of\b/i.test(learningGoalText) ||
      /^Understand\s+(?:understanding|appreciating|exploring|learning)\b/i.test(
        learningGoalText,
      ) ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      !hasMeaningfulAnchorOverlap(learningGoalText, contractAnchor);

    const alignedKeyPoints = keyPoints.filter(
      (point) =>
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)) &&
        hasMeaningfulAnchorOverlap(point, `${contractAnchor} ${title}`),
    );
    const keyPointsNeedRepair = keyPoints.length < 3 || alignedKeyPoints.length < 2;

    const nextTitle = titleNeedsRepair ? buildContractTitle(input, contract) : title;
    const learningGoal = learningGoalNeedsRepair
      ? buildContractLearningGoal(input, contract)
      : learningGoalText;
    const visuals =
      slide.visuals && typeof slide.visuals === "object"
        ? (slide.visuals as Record<string, unknown>)
        : {};
    const imagePrompt = `Editorial presentation visual about ${input.topic}: ${contract.focus}.`;
    const imageSlots = toRecordArray(visuals.imageSlots);
    const beginnerExplanationText =
      typeof slide.beginnerExplanation === "string"
        ? slide.beginnerExplanation.trim()
        : "";
    const beginnerExplanationNeedsRepair =
      beginnerExplanationText.length < 90 ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      !hasMeaningfulAnchorOverlap(beginnerExplanationText, contractAnchor);
    const advancedExplanationText =
      typeof slide.advancedExplanation === "string"
        ? slide.advancedExplanation.trim()
        : "";
    const advancedExplanationNeedsRepair =
      !advancedExplanationText ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      !hasMeaningfulAnchorOverlap(advancedExplanationText, contractAnchor);
    const heroStatementText =
      typeof visuals.heroStatement === "string" ? visuals.heroStatement.trim() : "";
    const heroStatementNeedsRepair =
      index === 0 &&
      (!heroStatementText || !hasMeaningfulAnchorOverlap(heroStatementText, contractAnchor));

    return {
      ...slide,
      title: nextTitle || buildContractTitle(input, contract),
      learningGoal,
      keyPoints: keyPointsNeedRepair ? replacementPoints : keyPoints.slice(0, 4),
      beginnerExplanation: beginnerExplanationNeedsRepair
        ? replacementPoints.join(" ")
        : beginnerExplanationText,
      advancedExplanation: advancedExplanationNeedsRepair
        ? toAudienceFacingSentence(
            `${contract.focus} matters because it shows how ${input.topic} works in practice`,
          )
        : advancedExplanationText,
      visuals: {
        ...visuals,
        ...(heroStatementNeedsRepair ? { heroStatement: replacementPoints[0] } : {}),
        imagePrompt:
          typeof visuals.imagePrompt === "string" && visuals.imagePrompt.trim().length > 0
            ? visuals.imagePrompt
            : imagePrompt,
        imageSlots:
          imageSlots.length > 0
            ? imageSlots.map((slot, imageIndex) => ({
                ...slot,
                id:
                  typeof slot.id === "string" && slot.id.trim().length > 0
                    ? slot.id
                    : `${String(slide.id ?? "slide")}-image-${imageIndex + 1}`,
                prompt:
                  typeof slot.prompt === "string" && slot.prompt.trim().length > 0
                    ? slot.prompt
                    : imagePrompt,
              }))
            : [
                {
                  id: `${String(slide.id ?? "slide")}-image-1`,
                  prompt: imagePrompt,
                  caption: contract.focus,
                  altText: `${input.topic} visual`,
                  style: "editorial",
                  tone: index === 0 ? "accent" : "neutral",
                },
              ],
      },
    };
  });
};

const normalizeDeck = (
  value: unknown,
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
    | "groundingSourceType"
    | "targetDurationMinutes"
    | "plan"
    | "targetSlideCount"
  >,
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const slides = Array.isArray(candidate.slides) ? candidate.slides : [];
  const topic = input.topic;
  const fallbackSourceIds = input.groundingSourceIds ?? [];
  const fallbackSourceType =
    input.groundingSourceType ??
    (fallbackSourceIds.length > 0 ? "mixed" : "topic");
  const now = new Date().toISOString();
  const sourceCandidate =
    candidate.source && typeof candidate.source === "object"
      ? (candidate.source as Record<string, unknown>)
      : null;
  const fallbackSlideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, slides.length || 4);

  const normalizedSlides = slides.map((slide, index) => {
    if (!slide || typeof slide !== "object") {
      return slide;
    }

    const slideCandidate = slide as Record<string, unknown>;
    const title =
      typeof slideCandidate.title === "string" && slideCandidate.title.trim().length > 0
        ? slideCandidate.title.trim()
        : `Slide ${index + 1}`;
    const learningGoal =
      typeof slideCandidate.learningGoal === "string" &&
      slideCandidate.learningGoal.trim().length > 0
        ? slideCandidate.learningGoal.trim()
        : `Explain ${title} clearly and keep it connected to ${topic}.`;
    const keyPoints = toStringArray(slideCandidate.keyPoints);
    const inferredKeyPoints =
      keyPoints.length > 0
        ? keyPoints
        : [
            learningGoal,
            `Keep this slide connected to the main topic: ${topic}.`,
            "Use one concrete point that the audience can remember.",
          ];
    const requiredContext = toStringArray(slideCandidate.requiredContext);
    const speakerNotes = toStringArray(slideCandidate.speakerNotes);
    const examples = toStringArray(slideCandidate.examples);
    const likelyQuestions = toStringArray(slideCandidate.likelyQuestions);
    const dependenciesOnOtherSlides = toStringArray(
      slideCandidate.dependenciesOnOtherSlides,
    );
    const visualNotes = toStringArray(slideCandidate.visualNotes);
    const beginnerExplanation =
      typeof slideCandidate.beginnerExplanation === "string" &&
      slideCandidate.beginnerExplanation.trim().length > 0
        ? slideCandidate.beginnerExplanation.trim()
        : inferredKeyPoints.slice(0, 2).join(" ");
    const advancedExplanation =
      typeof slideCandidate.advancedExplanation === "string" &&
      slideCandidate.advancedExplanation.trim().length > 0
        ? slideCandidate.advancedExplanation.trim()
        : `${inferredKeyPoints[0]} This matters in more complex settings because it shapes how ${topic} works in practice.`;

    return {
      ...slideCandidate,
      id:
        typeof slideCandidate.id === "string" && slideCandidate.id.trim().length > 0
          ? slideCandidate.id
          : createId("slide"),
      order: index,
      title,
      learningGoal,
      keyPoints: inferredKeyPoints,
      requiredContext,
      speakerNotes,
      beginnerExplanation,
      advancedExplanation,
      examples:
        examples.length > 0
          ? examples
          : inferredKeyPoints.slice(0, 1),
      likelyQuestions:
        likelyQuestions.length > 0
          ? likelyQuestions
          : [
              `What should the audience understand about ${title.toLowerCase()}?`,
              `How does ${title.toLowerCase()} connect to ${topic}?`,
            ],
      canSkip:
        typeof slideCandidate.canSkip === "boolean"
          ? slideCandidate.canSkip
          : index === fallbackSlideCount - 1,
      dependenciesOnOtherSlides,
      visualNotes:
        visualNotes.length > 0
          ? visualNotes
          : ["Keep the visual tightly aligned with the visible slide claims."],
      visuals: deriveVisuals(slideCandidate, {
        keyPoints: inferredKeyPoints,
        examples: examples.length > 0 ? examples : inferredKeyPoints.slice(0, 1),
        likelyQuestions:
          likelyQuestions.length > 0
            ? likelyQuestions
            : [
                `How does ${title.toLowerCase()} connect to the main topic?`,
              ],
        order: index,
        totalSlides: slides.length || fallbackSlideCount,
        learningGoal,
        title,
      }),
    };
  });

  const shapedSlides = applyPlanDrivenDeckShape(normalizedSlides, input);

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id
        : createId("deck"),
    pedagogicalProfile: normalizePedagogicalProfile(candidate.pedagogicalProfile),
    title:
      typeof candidate.title === "string" && candidate.title.trim().length > 0
        ? candidate.title
        : input.plan?.title ?? `${topic}: generated presentation`,
    topic:
      typeof candidate.topic === "string" && candidate.topic.trim().length > 0
        ? candidate.topic
        : topic,
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim().length > 0
        ? candidate.summary
        : `A coherent presentation about ${topic} built around a simple teaching arc.`,
    source:
      sourceCandidate
        ? {
            ...sourceCandidate,
            type: normalizeSourceType(sourceCandidate.type, fallbackSourceType),
            topic,
            // Never trust model-invented URLs. Only persist source ids that were
            // actually provided by the grounded research pipeline.
            sourceIds: fallbackSourceIds,
          }
        : {
            type: fallbackSourceType,
            topic,
            sourceIds: fallbackSourceIds,
          },
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? {
            estimatedDurationMinutes:
              typeof (candidate.metadata as Record<string, unknown>)
                .estimatedDurationMinutes === "number"
                ? (candidate.metadata as Record<string, unknown>)
                    .estimatedDurationMinutes
                : input.targetDurationMinutes ?? 6,
            tags: toStringArray(
              (candidate.metadata as Record<string, unknown>).tags,
            ),
            language:
              typeof (candidate.metadata as Record<string, unknown>).language ===
              "string"
                ? (candidate.metadata as Record<string, unknown>).language
                : "en",
          }
        : {
            estimatedDurationMinutes: input.targetDurationMinutes ?? 6,
            tags: [],
            language: "en",
          },
    slides: shapedSlides,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : now,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
        ? candidate.updatedAt
        : now,
  };
};

const buildFallbackNarration = (slide: GenerateNarrationInput["slide"], deck: Deck) => {
  const introSegments =
    slide.order === 0
      ? [
          `Today we are looking at ${deck.topic}, and this opening moment is about why the topic matters right away.`,
          slide.beginnerExplanation,
          `The first ideas to carry with us are: ${(slide.keyPoints.slice(0, 3) || []).join(", ")}.`,
          deck.slides[1]
            ? `From here, we can move naturally into ${deck.slides[1].title.toLowerCase()}.`
            : "From here, we can build on this foundation.",
        ]
      : [
          slide.beginnerExplanation,
          `The main ideas here are: ${(slide.keyPoints.slice(0, 3) || []).join(", ")}.`,
          slide.order < deck.slides.length - 1
            ? `This connects directly to ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`
            : "This leads us into the final recap.",
        ];

  const cleanedSegments = introSegments
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const narration = cleanedSegments.join(" ");

  return {
    slideId: slide.id,
    narration,
    segments: cleanedSegments,
    summaryLine: slide.learningGoal,
    promptsForPauses: [
      "Pause me if you want that framed more simply.",
      "Ask for an example if you want something concrete.",
    ],
    suggestedTransition:
      slide.order === deck.slides.length - 1
        ? "End with a concise recap and a quick understanding check."
        : `Bridge clearly into ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`,
  };
};

const NARRATION_STOP_WORDS = new Set([
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
  "with",
  "you",
  "your",
]);

const tokenizeNarrationText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !NARRATION_STOP_WORDS.has(token));

const narrationMetaPatterns = [
  /\bthis slide\b/i,
  /\bthis presentation\b/i,
  /\bfor every slide\b/i,
  /\bfollow key point\b/i,
  /\buse screenshots?\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\btext-heavy slide\b/i,
];

const plainTextNarrationLooksGrounded = (
  narration: string,
  slide: GenerateNarrationInput["slide"],
): boolean => {
  if (narrationMetaPatterns.some((pattern) => pattern.test(narration))) {
    return false;
  }

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

const buildNarrationFromPlainText = (
  text: string,
  slide: GenerateNarrationInput["slide"],
  deck: Deck,
) => {
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

  if (
    normalizedSegments.length < (slide.order === 0 ? 4 : 3) ||
    normalizedSegments.join(" ").trim().length < (slide.order === 0 ? 180 : 120) ||
    !plainTextNarrationLooksGrounded(normalizedSegments.join(" "), slide)
  ) {
    return null;
  }

  return SlideNarrationSchema.parse({
    slideId: slide.id,
    narration: normalizedSegments.join(" "),
    segments: normalizedSegments,
    summaryLine: slide.learningGoal,
    promptsForPauses: [
      "Pause me if you want that explained more simply.",
      "Ask for an example if you want something more concrete.",
    ],
    suggestedTransition:
      slide.order === deck.slides.length - 1
        ? "End with a concise recap and one understanding check."
        : `Bridge clearly into ${deck.slides[slide.order + 1]?.title ?? "the next slide"}.`,
  });
};

const normalizeNarrationForSlide = (
  value: unknown,
  slide: GenerateNarrationInput["slide"],
  deck?: Deck,
): unknown => {
  if (!value || typeof value !== "object") {
    return deck ? buildFallbackNarration(slide, deck) : value;
  }

  const candidate = value as Record<string, unknown>;
  const narration =
    typeof candidate.narration === "string" ? candidate.narration : "";
  const segments = (() => {
    const rawSegments = toStringArray(candidate.segments);
    return rawSegments.length > 0
      ? rawSegments
      : splitTextIntoSegments(narration);
  })();
  const needsFallbackExpansion =
    Boolean(deck) &&
    (narration.trim().length < (slide.order === 0 ? 180 : 120) ||
      segments.length < (slide.order === 0 ? 3 : 2));

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
        : "Generated narration summary",
    suggestedTransition:
      typeof candidate.suggestedTransition === "string"
      ? candidate.suggestedTransition
      : "Continue to the next slide.",
  };
};

const normalizeConversationNeeds = (value: unknown): string[] => {
  const validNeeds = new Set([
    "question",
    "confusion",
    "example",
    "deepen",
    "repeat",
    "navigation",
    "pause",
    "resume",
  ]);

  return toStringArray(value)
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((item) => validNeeds.has(item));
};

const normalizeConversationPlan = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const runtimeEffects =
    candidate.runtimeEffects && typeof candidate.runtimeEffects === "object"
      ? (candidate.runtimeEffects as Record<string, unknown>)
      : {};

  const interruptionType =
    typeof candidate.interruptionType === "string"
      ? candidate.interruptionType.trim().toLowerCase()
      : "question";
  const responseMode =
    typeof candidate.responseMode === "string"
      ? candidate.responseMode.trim().toLowerCase()
      : interruptionType === "stop"
        ? "ack_pause"
        : interruptionType === "continue"
          ? "ack_resume"
          : interruptionType === "back"
            ? "ack_back"
            : interruptionType === "simplify"
              ? "simplify"
              : interruptionType === "example"
                ? "example"
                : interruptionType === "deepen"
                  ? "deepen"
                  : interruptionType === "repeat"
                    ? "repeat"
                    : "question";

  return {
    interruptionType,
    inferredNeeds: normalizeConversationNeeds(candidate.inferredNeeds),
    responseMode,
    runtimeEffects: {
      pause: runtimeEffects.pause === true,
      resume: runtimeEffects.resume === true,
      goToPreviousSlide: runtimeEffects.goToPreviousSlide === true,
      restartCurrentSlide: runtimeEffects.restartCurrentSlide === true,
      adaptDetailLevel:
        typeof runtimeEffects.adaptDetailLevel === "string"
          ? runtimeEffects.adaptDetailLevel.trim().toLowerCase()
          : undefined,
      adaptPace:
        typeof runtimeEffects.adaptPace === "string"
          ? runtimeEffects.adaptPace.trim().toLowerCase()
          : undefined,
    },
    confidence:
      typeof candidate.confidence === "number"
        ? candidate.confidence
        : 0.7,
    rationale:
      typeof candidate.rationale === "string"
        ? candidate.rationale
        : "Structured conversation plan generated from the current turn.",
  };
};

const normalizePresentationReview = (
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

const reviewStopWords = new Set([
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
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "we",
  "with",
]);

const tokenizeForReview = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !reviewStopWords.has(token));

const slideTokensForReview = (slide: Slide): string[] =>
  [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    ...slide.keyPoints,
    ...slide.visuals.cards.map((card: Slide["visuals"]["cards"][number]) => `${card.title} ${card.body}`),
    ...slide.visuals.callouts.map((callout: Slide["visuals"]["callouts"][number]) => `${callout.label} ${callout.text}`),
    ...slide.visuals.diagramNodes.map((node: Slide["visuals"]["diagramNodes"][number]) => node.label),
  ].flatMap((part) => tokenizeForReview(part));

const narrationNeedsDetailedReview = (
  deck: Deck,
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

const compactVisualSummary = (slide: Slide): string =>
  [
    `layout=${slide.visuals.layoutTemplate}`,
    slide.visuals.heroStatement ? `hero=${slide.visuals.heroStatement}` : null,
    slide.visuals.cards.length > 0
      ? `cards=${slide.visuals.cards.slice(0, 3).map((card: Slide["visuals"]["cards"][number]) => card.title).join(", ")}`
      : null,
    slide.visuals.callouts.length > 0
      ? `callouts=${slide.visuals.callouts.slice(0, 2).map((callout: Slide["visuals"]["callouts"][number]) => callout.label).join(", ")}`
      : null,
    slide.visuals.imageSlots.length > 0
      ? `images=${slide.visuals.imageSlots.slice(0, 2).map((slot: Slide["visuals"]["imageSlots"][number]) => slot.prompt).join(" | ")}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("; ");

export interface OpenAICompatibleConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

const stripPlanningBulletPrefix = (value: string): string =>
  value.replace(/^[\-\u2022*]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();

const normalizeResearchPlanningSubject = (value: string): string | undefined => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:subject|topic)\s*[:\-]\s*/i, "")
    .replace(
      /^(?:create|make|build|generate|write|prepare)\s+(?:a|an|the)?\s*(?:presentation|deck|overview)\s+(?:about|on)\s+/i,
      "",
    )
    .replace(
      /\b(?:company profile(?: and service portfolio)?|service portfolio|company overview|corporate|profile|overview|presentation|deck|talk)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  return normalized.length >= 2 ? normalized : undefined;
};

const normalizeResearchPlanningQuery = (value: string): string | null => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:query|search|search query)\s*[:\-]\s*/i, "")
    .replace(/^search\s+for\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (normalized.length < 3 || normalized.length > 120) {
    return null;
  }

  return normalized;
};

const RESEARCH_GOAL_META_PATTERN =
  /\b(?:slide|slides|presentation|deck|speaker|narration|template|layout|design)\b/i;

const normalizeResearchCoverageGoal = (value: string): string | null => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:goal|coverage|coverage goal)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (
    normalized.length < 8 ||
    normalized.length > 160 ||
    RESEARCH_GOAL_META_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
};

const parseResearchPlanningText = (
  text: string,
  input: PlanResearchInput,
): ResearchPlanningSuggestion => {
  const sections: Record<"subject" | "queries" | "coverage" | "rationale", string[]> = {
    subject: [],
    queries: [],
    coverage: [],
    rationale: [],
  };
  let currentSection: keyof typeof sections | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headerMatch = line.match(
      /^(SUBJECT|SEARCH QUERIES|COVERAGE GOALS|RATIONALE)\s*:\s*(.*)$/i,
    );
    if (headerMatch) {
      const header = headerMatch[1]!.toLowerCase();
      currentSection =
        header === "subject"
          ? "subject"
          : header === "search queries"
            ? "queries"
            : header === "coverage goals"
              ? "coverage"
              : "rationale";
      const inlineValue = headerMatch[2]?.trim();
      if (inlineValue) {
        sections[currentSection].push(inlineValue);
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  const subject =
    sections.subject
      .map((value) => normalizeResearchPlanningSubject(value))
      .find((value): value is string => Boolean(value)) ??
    input.heuristicSubject;

  const searchQueries = [
    ...input.heuristicQueries,
    ...sections.queries
      .map((value) => normalizeResearchPlanningQuery(value))
      .filter((value): value is string => Boolean(value)),
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5);

  const coverageGoals = sections.coverage
    .map((value) => normalizeResearchCoverageGoal(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);

  const rationale = sections.rationale
    .map((value) => stripPlanningBulletPrefix(value).replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 8)
    .slice(0, 4);

  return {
    subject,
    searchQueries,
    coverageGoals,
    rationale,
  };
};

const summarizeRevisionGuidance = (value: string): string =>
  value
    .split(/\n|[.;]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .slice(0, 6)
    .join("; ");

const buildIntentPromptLines = (input: {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | undefined;
}): string[] => {
  const coreSubject = input.intent?.subject || input.topic;
  const framing = input.intent?.framing || input.presentationBrief;

  return [
    `Core subject: ${coreSubject}`,
    framing ? `Framing context: ${framing}` : "No additional framing context was provided.",
    input.intent?.audienceCues?.length
      ? `Audience cues: ${input.intent.audienceCues.join("; ")}`
      : null,
    input.intent?.deliveryFormat
      ? `Delivery format: ${input.intent.deliveryFormat}`
      : null,
    input.intent?.activityRequirement
      ? `Required participant activity: ${input.intent.activityRequirement}`
      : null,
    input.intent?.coverageRequirements?.length
      ? `Explicit coverage requirements: ${input.intent.coverageRequirements.join("; ")}`
      : null,
  ].filter((line): line is string => Boolean(line));
};

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;
  protected readonly baseUrl: string;
  protected readonly model: string;
  protected readonly apiKey: string | undefined;
  protected readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 45000;
  }

  private isLmStudioProvider(): boolean {
    return this.name === "lmstudio";
  }

  private raiseInitialTokenBudget(maxTokens: number): number {
    if (!this.isLmStudioProvider()) {
      return maxTokens;
    }

    if (maxTokens <= 300) {
      return 900;
    }

    if (maxTokens <= 600) {
      return 1400;
    }

    if (maxTokens <= 1200) {
      return 2200;
    }

    if (maxTokens <= 1800) {
      return 3000;
    }

    if (maxTokens <= 2400) {
      return 3600;
    }

    if (maxTokens <= 3200) {
      return 4400;
    }

    if (maxTokens <= 4200) {
      return 5600;
    }

    if (maxTokens <= 5200) {
      return 6800;
    }

    return Math.round(maxTokens * 1.15);
  }

  private normalizeTokenAttempts(options?: {
    maxTokens?: number | undefined;
    tokenAttempts?: number[] | undefined;
  }): number[] {
    const rawAttempts =
      options?.tokenAttempts && options.tokenAttempts.length > 0
        ? options.tokenAttempts
        : [
            options?.maxTokens ?? 1600,
            Math.max(
              3200,
              Math.min(6400, Math.round((options?.maxTokens ?? 1600) * 1.5)),
            ),
            Math.max(
              4800,
              Math.min(9600, Math.round((options?.maxTokens ?? 1600) * 2.2)),
            ),
          ];

    const adjustedAttempts = this.isLmStudioProvider()
      ? rawAttempts.map((attempt) => this.raiseInitialTokenBudget(attempt))
      : rawAttempts;

    return [...new Set(adjustedAttempts)].sort((left, right) => left - right);
  }

  private resolveRequestTimeout(
    requestedTimeoutMs: number | undefined,
    maxTokens: number | undefined,
  ): number {
    const baseTimeout = requestedTimeoutMs ?? this.timeoutMs;
    if (!this.isLmStudioProvider() || !maxTokens) {
      return baseTimeout;
    }

    const raisedBudget = this.raiseInitialTokenBudget(maxTokens);
    const additionalMs = Math.max(0, raisedBudget - 1800) * 6;
    return Math.min(90000, Math.max(baseTimeout, baseTimeout + additionalMs));
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        return unhealthy(
          this.name,
          `Health check failed with status ${response.status}.`,
        );
      }

      return healthy(this.name, `Connected to ${this.baseUrl}.`);
    } catch (error) {
      return unhealthy(this.name, `Connection failed: ${(error as Error).message}`);
    }
  }

  async planResearch(
    input: PlanResearchInput,
  ): Promise<ResearchPlanningSuggestion> {
    const text = await this.chatText(
      [
        {
          role: "system",
          content:
            "You refine web research plans for grounded presentation generation. Do not browse. Do not invent facts or URLs. Return only the requested plain-text sections.",
        },
        {
          role: "user",
          content: [
            `Prompt: ${input.topic}`,
            ...buildIntentPromptLines(input),
            `Heuristic subject: ${input.heuristicSubject}`,
            `Heuristic search queries: ${input.heuristicQueries.join(" | ") || "none"}`,
            input.explicitSourceUrls.length > 0
              ? `Explicit source URLs: ${input.explicitSourceUrls.join(" | ")}`
              : "No explicit source URLs were provided.",
            `Freshness sensitive: ${input.freshnessSensitive ? "yes" : "no"}`,
            `Grounded facts required: ${input.requiresGroundedFacts ? "yes" : "no"}`,
            "Refine the subject wording and search queries so backend fetch/search can gather stronger evidence.",
            "Prefer authoritative, official, or primary-source terminology.",
            "Coverage goals should describe facts or angles the presentation must substantiate.",
            "Do not mention slides, decks, templates, or presentation design.",
            "Return exactly these sections:",
            "SUBJECT: one short line",
            "SEARCH QUERIES:",
            "- query 1",
            "- query 2",
            "COVERAGE GOALS:",
            "- fact or angle to substantiate",
            "- fact or angle to substantiate",
            "RATIONALE:",
            "- short reason",
          ].join("\n"),
        },
      ],
      {
        maxTokens: 1400,
        timeoutMs: 25000,
        tokenAttempts: [1400, 2400, 3600],
      },
    );

    return parseResearchPlanningText(text, input);
  }

  async planPresentation(input: {
    topic: string;
    presentationBrief?: string;
    intent?: GenerateDeckInput["intent"];
    groundingHighlights?: string[];
    pedagogicalProfile: { audienceLevel: string };
    groundingSummary?: string;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
  }): Promise<PresentationPlan> {
    return this.chatJson({
      schemaName: "PresentationPlan",
      system:
        "You design concise teaching plans. Return valid JSON only and no markdown.",
      user: [
        ...buildIntentPromptLines(input),
        input.groundingHighlights?.length
          ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
          : "No grounding highlights were provided.",
        `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
        input.groundingSummary
          ? `External grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
          : "No external grounding summary was provided.",
        input.targetDurationMinutes
          ? `Target duration: about ${input.targetDurationMinutes} minutes.`
          : "No explicit target duration was provided.",
        input.targetSlideCount
          ? `Target slide count: about ${input.targetSlideCount} slides.`
          : "No explicit target slide count was provided.",
        "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
        "Use the core subject as the thing the audience is learning about. The presentation brief and intent fields only describe the intended angle, audience, or delivery context.",
        "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
        "For beginner audiences, prefer a storyline like: motivation, mental model, structure, concrete example, recap.",
        "Keep the plan close to the requested duration and slide count when they are provided.",
        "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
      ].join("\n"),
      maxTokens: 2200,
      parse: (value) =>
        PresentationPlanSchema.parse(
          normalizePresentationPlan(value, {
            targetSlideCount: input.targetSlideCount,
            topic: input.topic,
          }),
        ),
    });
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const attempts = [
      {
        label: "outline-enriched",
        run: async () => this.generateDeckFromOutline(input),
      },
      {
        label: "compact-structured",
        run: async () =>
          this.chatJson({
            schemaName: "Deck",
            system:
              "You create coherent teaching decks as concise JSON. Return valid JSON only and no markdown.",
            user: this.buildCompactDeckPrompt(input, "compact"),
            maxTokens: 5200,
            parse: (value) => DeckSchema.parse(normalizeDeck(value, input)),
          }),
      },
      {
        label: "minimal-outline",
        run: async () =>
          this.chatJson({
            schemaName: "Deck",
            system:
              "Return only JSON and keep it compact. Focus on slide coherence and grounded facts.",
            user: this.buildCompactDeckPrompt(input, "minimal"),
            maxTokens: 3600,
            parse: (value) => DeckSchema.parse(normalizeDeck(value, input)),
          }),
      },
    ] as const;

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        return await attempt.run();
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} deck attempt "${attempt.label}" failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error(`${this.name} deck generation failed.`);
  }

  private async generateDeckFromOutline(input: GenerateDeckInput): Promise<Deck> {
    const outlineDeck = buildOutlineScaffoldDeck(input);
    const contracts = buildSlideContracts(input, outlineDeck.slides.length);
    const enrichedSlides: Record<string, unknown>[] = [];

    for (const [index, slide] of outlineDeck.slides.entries()) {
      const contract = contracts[index];
      if (!contract) {
        throw new Error(`Missing slide contract for outline slide ${index + 1}.`);
      }

      const enrichedSlide = await this.generateSlideFromOutline(
        input,
        outlineDeck,
        slide,
        contract,
      );
      enrichedSlides.push(enrichedSlide);
    }

    return DeckSchema.parse(
      normalizeDeck(
        {
          ...outlineDeck,
          slides: enrichedSlides,
        },
        input,
      ),
    );
  }

  private async generateSlideFromOutline(
    input: GenerateDeckInput,
    deck: Deck,
    slide: Slide,
    contract: SlideContract,
  ): Promise<Record<string, unknown>> {
    let lastError: Error | null = null;
    let priorAssessment: SlideDraftAssessment | null = null;

    if (slide.order === 0) {
      return buildOrientationSlideFromContext(input, deck, slide, contract);
    }

    if (shouldUseDeterministicSubjectOverviewSlide(input, slide, contract)) {
      return buildSubjectOverviewSlideFromContext(input, deck, slide, contract);
    }

    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      const slideBriefLines = buildSlideEnrichmentPromptLines({
        deck,
        slide,
        contract,
        generationInput: input,
        priorAssessment,
      });

      try {
        const plainTextSlide = await this.chatText(
          [
            {
              role: "system",
              content:
                "Write one presentation slide in plain text. Teach the subject itself in audience-facing language. Do not use JSON or markdown tables. Follow the requested section labels exactly.",
            },
            {
              role: "user",
              content: [
                ...slideBriefLines,
                "Return plain text with exactly these labels:",
                "TITLE:",
                "GOAL:",
                "POINTS:",
                "- point one",
                "- point two",
                "- point three",
                "BEGINNER:",
                "ADVANCED:",
                "EXAMPLE:",
                "QUESTION:",
                "Write the three key points as exactly three separate bullet lines under POINTS, each starting with '- '.",
                "Do not join multiple key points in one sentence. Do not use semicolons instead of bullet lines.",
                "Keep all three key points as complete audience-facing sentences.",
                "Do not mention the deck, the presentation process, or what the presenter should do.",
              ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
            },
          ],
          {
            maxTokens: slide.order === 0 ? 3000 : 2400,
            timeoutMs: 35000,
            tokenAttempts: slide.order === 0 ? [3000, 4200] : [2400, 3400],
          },
        );

        const enrichedSlide = buildSlideFromPlainText(plainTextSlide, slide);
        if (!enrichedSlide) {
          throw new Error("Plain-text slide enrichment could not be parsed into a full slide.");
        }

        const assessment = assessGeneratedSlideDraft(input, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        console.warn(
          `[slidespeech] ${this.name} slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlide.title === "string" ? enrichedSlide.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlide.learningGoal === "string" ? enrichedSlide.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlide.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
      }
    }

    for (let attemptIndex = 0; attemptIndex < 1; attemptIndex += 1) {
      const slideBriefLines = buildSlideEnrichmentPromptLines({
        deck,
        slide,
        contract,
        generationInput: input,
        priorAssessment,
      });

      try {
        const enrichedSlide = await this.chatJson({
          schemaName: "Slide",
          system:
            "Write one presentation slide as valid JSON only. Teach the subject itself in audience-facing language. Do not mention the deck, session, slide design, or presenter instructions.",
          user: [
            ...slideBriefLines,
            "Return JSON with: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
            "Use exactly 3 key points and make each one a complete audience-facing sentence.",
            "Keep the slide concrete and topic-specific. Prefer mechanisms, roles, examples, consequences, or factual subareas.",
            "Never use presenter instructions or facilitator language such as 'begin by', 'discuss', 'explain', 'emphasize', 'to wrap up', 'this session', or 'next steps'.",
            "Do not tell the presenter what to do. Do not describe how the slide should be delivered.",
            "If the framing lens implies onboarding, keep the language beginner-friendly without addressing the audience as new hires or participants.",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
          maxTokens: slide.order === 0 ? 2600 : 2200,
          parse: (value) => {
            if (!value || typeof value !== "object") {
              throw new Error("Slide enrichment returned no structured object.");
            }

            return {
              ...(slide as unknown as Record<string, unknown>),
              ...(value as Record<string, unknown>),
              id: slide.id,
              order: slide.order,
            };
          },
        });

        const assessment = assessGeneratedSlideDraft(input, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        const enrichedSlideRecord = enrichedSlide as Record<string, unknown>;
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlideRecord.title === "string" ? enrichedSlideRecord.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlideRecord.learningGoal === "string" ? enrichedSlideRecord.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlideRecord.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
      }
    }

    const groundedRecovery = buildGroundedSlideRecoveryFromContext(
      input,
      deck,
      slide,
      contract,
    );
    if (groundedRecovery) {
      console.warn(
        `[slidespeech] ${this.name} recovered slide "${slide.title}" from grounded context after enrichment failures.`,
      );
      return groundedRecovery;
    }

    throw lastError ?? new Error(`Slide enrichment failed for "${slide.title}".`);
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    const previousSlide = input.deck.slides[input.slide.order - 1];
    const nextSlide = input.deck.slides[input.slide.order + 1];
    const tryPlainTextNarration = async (
      maxTokens: number,
      timeoutMs?: number,
      tokenAttempts?: number[],
    ): Promise<SlideNarration> => {
      const narrationText = await this.chatText(
        [
          {
            role: "system",
            content:
              "Write spoken narration for a presentation slide. Use English. Do not use JSON or markdown. Speak directly to an audience, stay tightly grounded in the visible slide, and avoid presentation-making advice.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
              `Slide title: ${input.slide.title}`,
              `Learning goal: ${input.slide.learningGoal}`,
              `Key points: ${input.slide.keyPoints.join("; ")}`,
              `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
              `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
              `Visible diagram nodes: ${input.slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
              `Speaker notes: ${input.slide.speakerNotes.join("; ") || "None"}`,
              previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
              nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
              input.slide.order === 0
                ? "Write exactly 4 short spoken paragraphs for the opening. Sound like a presenter speaking to a real audience."
                : "Write exactly 3 short spoken paragraphs for this slide. Each paragraph must clearly relate to the visible slide content.",
            ].join("\n"),
          },
        ],
        {
          maxTokens,
          ...(timeoutMs ? { timeoutMs } : {}),
          ...(tokenAttempts ? { tokenAttempts } : {}),
        },
      );

      const narration = buildNarrationFromPlainText(
        narrationText,
        input.slide,
        input.deck,
      );

      if (!narration) {
        throw new Error(
          "Plain-text narration did not pass local grounding and quality checks.",
        );
      }

      return narration;
    };

    const attempts = [
      {
        label: "structured",
        system:
          "You create narration text for teaching slides. Return valid JSON only and no markdown.",
        user: [
          `Deck topic: ${input.deck.topic}`,
          `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
          `Slide title: ${input.slide.title}`,
          `Learning goal: ${input.slide.learningGoal}`,
          `Key points: ${input.slide.keyPoints.join("; ")}`,
          `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
          `Speaker notes: ${input.slide.speakerNotes.join("; ") || "None"}`,
          `Examples: ${input.slide.examples.join("; ") || "None"}`,
          previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
          nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
          "Return fields: slideId, narration, segments, summaryLine, promptsForPauses, suggestedTransition.",
          "Keep every sentence tightly grounded in the visible slide content.",
          input.slide.order === 0
            ? "Speak like a real opening to an audience. Avoid meta phrases like 'this presentation will'."
            : "Stay on this slide. Do not drift into side topics.",
        ].join("\n"),
        maxTokens: input.slide.order === 0 ? 2600 : 1800,
      },
      {
        label: "compact",
        system:
          "Return valid JSON only. Keep the narration short, grounded, and audience-facing.",
        user: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Learning goal: ${input.slide.learningGoal}`,
          `Key points: ${input.slide.keyPoints.join("; ")}`,
          "Return JSON with: slideId, narration, segments, summaryLine, promptsForPauses, suggestedTransition.",
          input.slide.order === 0
            ? "Use 4 short segments for the opening."
            : "Use 3 short segments.",
        ].join("\n"),
        maxTokens: input.slide.order === 0 ? 1800 : 1400,
      },
    ] as const;

    let lastError: Error | null = null;

    if (input.slide.order > 0) {
      try {
        return await tryPlainTextNarration(1400, 20000, [1400, 2200]);
      } catch (plainTextError) {
        lastError = plainTextError as Error;
        console.warn(
          `[slidespeech] ${this.name} narration plain-text primary path failed for "${input.slide.title}": ${lastError.message}`,
        );
      }
    }

    for (const attempt of attempts) {
      try {
        return await this.chatJson({
          schemaName: "SlideNarration",
          system: attempt.system,
          user: attempt.user,
          maxTokens: attempt.maxTokens,
          parse: (value) =>
            SlideNarrationSchema.parse(
              normalizeNarrationForSlide(value, input.slide, input.deck),
            ),
        });
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} narration attempt "${attempt.label}" failed for "${input.slide.title}": ${lastError.message}`,
        );
      }
    }

    try {
      return await tryPlainTextNarration(
        input.slide.order === 0 ? 2400 : 1800,
        30000,
        input.slide.order === 0 ? [2400, 3600] : [1800, 2800],
      );
    } catch (plainTextError) {
      lastError = plainTextError as Error;
      console.warn(
        `[slidespeech] ${this.name} narration plain-text fallback failed for "${input.slide.title}": ${lastError.message}`,
      );
    }

    throw lastError ?? new Error(`${this.name} narration generation failed.`);
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "You are a patient AI teacher. Answer in English. Be concrete and pedagogical.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Slide learning goal: ${input.slide.learningGoal}`,
          `Visible key points: ${input.slide.keyPoints.join("; ")}`,
          `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
          `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
          `Question: ${input.question}`,
          `Beginner explanation: ${input.slide.beginnerExplanation}`,
          `Examples: ${input.slide.examples.join("; ")}`,
          "Answer using the current slide as the main frame of reference. Stay tied to what this slide is actually about.",
        ].join("\n"),
      },
    ], {
      maxTokens: 2200,
      timeoutMs: 18000,
      tokenAttempts: [2200, 3600],
    });

    return { text };
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Rewrite explanations in simpler English with short sentences and one analogy.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Current explanation: ${input.slide.beginnerExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Expand explanations for an advanced learner in English. Mention tradeoffs if relevant.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Advanced explanation seed: ${input.slide.advancedExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1800,
      timeoutMs: 18000,
      tokenAttempts: [1800, 3000],
    });

    return { text };
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Generate one concrete example in English for a teaching presentation.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Example seeds: ${input.slide.examples.join("; ")}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content: "Summarize teaching material in English using three short paragraphs.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slides: ${input.slides.map((slide) => `${slide.title}: ${slide.learningGoal}`).join(" | ")}`,
        ].join("\n"),
      },
    ], { maxTokens: 1400, timeoutMs: 30000 });

    return { text };
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    const narrationBySlideId = new Map(
      input.narrations.map((narration) => [narration.slideId, narration]),
    );
    const detailedSlides = input.deck.slides.filter((slide) =>
      narrationNeedsDetailedReview(
        input.deck,
        slide,
        narrationBySlideId.get(slide.id),
      ),
    );
    const slidesForDetailedReview =
      detailedSlides.length > 0 ? detailedSlides : input.deck.slides.slice(0, 2);

    return this.chatJson({
      schemaName: "PresentationReview",
      system: [
        "You are a strict presentation QA reviewer for an interactive AI teacher.",
        "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether each slide narration is clearly about the visible slide without reading it verbatim.",
        "If a narration is weak or drifts away from the slide, rewrite only that slide narration.",
        "Do not rewrite the whole deck. Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        `Deck title: ${input.deck.title}`,
        `Deck topic: ${input.deck.topic}`,
        `Deck summary: ${input.deck.summary}`,
        `Audience: ${input.pedagogicalProfile.audienceLevel}`,
        `Deck outline:\n${input.deck.slides
          .map((slide) => [
            `Slide ${slide.order + 1}: ${slide.title}`,
            `Learning goal: ${slide.learningGoal}`,
            `Key points: ${slide.keyPoints.join("; ")}`,
            `Visual summary: ${compactVisualSummary(slide) || "None"}`,
          ].join("\n"))
          .join("\n\n")}`,
        `Detailed review targets:\n${slidesForDetailedReview
          .map((slide) => {
            const narration = narrationBySlideId.get(slide.id);
            return [
              `Slide ${slide.order + 1}: ${slide.title}`,
              `Learning goal: ${slide.learningGoal}`,
              `Beginner explanation: ${slide.beginnerExplanation}`,
              `Visible cards: ${slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
              `Visible callouts: ${slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
              `Visible diagram nodes: ${slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
              `Narration summary: ${narration?.summaryLine ?? "None"}`,
              `Narration segments: ${narration?.segments.join(" | ") ?? "None"}`,
            ].join("\n");
          })
          .join("\n\n")}`,
        "Return fields: approved, overallScore, summary, issues, repairedNarrations.",
        "Issue fields: code, severity, dimension, message, optional slideId.",
        "Valid dimensions: deck, visual, narration, coherence, grounding.",
        "Only include repairedNarrations for slides whose narration should be replaced.",
        "Any repaired narration must stay tightly tied to that slide's visible content, use English, and keep 4 to 6 segments for slide 1 and 3 to 5 segments for other slides.",
      ].join("\n"),
      parse: (value) =>
        PresentationReviewSchema.parse(normalizePresentationReview(value, input)),
    });
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    const transcriptWindow = input.transcript
      .slice(-6)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n");

    return this.chatJson<ConversationTurnPlan>({
      schemaName: "ConversationTurnPlan",
      system: [
        "You are a conversation planner for an AI teacher runtime.",
        "Treat the learner's turn as freeform conversation first, not as a command parser.",
        "Infer both pedagogical needs and runtime side effects.",
        "Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        `Topic: ${input.deck.topic}`,
        `Current slide title: ${input.slide.title}`,
        `Current slide learning goal: ${input.slide.learningGoal}`,
        `Current session state: ${input.session.state}`,
        `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
        `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
        `User turn: ${input.text}`,
        "Return fields: interruptionType, inferredNeeds, responseMode, runtimeEffects, confidence, rationale.",
        "Valid interruptionType values: stop, question, simplify, deepen, example, back, repeat, continue, unknown.",
        "Valid responseMode values: ack_pause, ack_resume, ack_back, question, simplify, deepen, example, repeat.",
        "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
        "Use interruptionType=question by default for freeform learner input.",
      ].join("\n"),
      maxTokens: 220,
      timeoutMs: 20000,
      parse: (value) =>
        ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
    });
  }

  protected buildHeaders(): HeadersInit {
    return this.apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        }
      : {
          "Content-Type": "application/json",
        };
  }

  protected async chatText(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tokenAttempts?: number[] | undefined;
    },
  ): Promise<string> {
    const attempts = this.normalizeTokenAttempts(options);

    let lastEmptyReasoning = false;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(options?.timeoutMs, maxTokens),
      });

      const choice = json.choices?.[0];
      const content = choice?.message?.content?.trim();
      if (content) {
        return content;
      }

      const reasoningContent = choice?.message?.reasoning_content?.trim();
      lastEmptyReasoning = Boolean(reasoningContent);

      if (
        reasoningContent &&
        choice?.finish_reason === "length" &&
        attemptIndex < attempts.length - 1
      ) {
        console.warn(
          `[slidespeech] ${this.name} returned only reasoning content at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      break;
    }

    throw new Error(
      lastEmptyReasoning
        ? `${this.name} returned only reasoning content without a final answer.`
        : `${this.name} returned an empty response.`,
    );
  }

  protected async chatJson<T>(input: {
    schemaName: string;
    system: string;
    user: string;
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
  }): Promise<T> {
    const text = await this.chatText([
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ], {
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    });

    const jsonText = extractJsonFromText(text);
    const parsed = JSON.parse(jsonText) as unknown;
    return input.parse(parsed);
  }

  private async requestChatCompletion(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
    },
  ): Promise<ChatCompletionResponse> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.name} request timed out after ${options?.timeoutMs ?? this.timeoutMs}ms`,
        );
      }

      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.name} request failed with status ${response.status}${
          detail ? `: ${detail.slice(0, 400)}` : ""
        }`,
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  private buildCompactDeckPrompt(
    input: GenerateDeckInput,
    mode: "compact" | "minimal",
  ): string {
    const header = [
      ...buildIntentPromptLines(input),
      input.groundingHighlights?.length
        ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
        : "No grounding highlights were provided.",
      input.groundingCoverageGoals?.length
        ? `Research coverage goals: ${input.groundingCoverageGoals.join("; ")}`
        : "No explicit research coverage goals were provided.",
      `Audience: ${input.pedagogicalProfile.audienceLevel}`,
      `Title direction: ${input.plan?.title ?? input.topic}`,
      `Learning objectives: ${(input.plan?.learningObjectives ?? []).join("; ") || "Keep the audience oriented and concrete."}`,
      `Storyline: ${(input.plan?.storyline ?? []).join(" -> ") || "orientation -> structure -> example -> recap"}`,
      input.targetDurationMinutes
        ? `Target duration: about ${input.targetDurationMinutes} minutes.`
        : null,
      input.targetSlideCount
        ? `Target slide count: about ${input.targetSlideCount} slides.`
        : null,
      input.groundingSummary
        ? `Grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
        : "No external grounding summary was provided.",
      input.revisionGuidance
        ? `Revision guidance from the previous weak draft: ${summarizeRevisionGuidance(input.revisionGuidance)}`
        : null,
      input.groundingSummary
        ? "Use the grounding summary as the factual source of truth. If details are sparse, stay generic rather than hallucinating."
        : "Avoid pretending to know current facts that were not provided.",
      input.revisionGuidance
        ? "You are revising a weak prior draft. Fix the cited quality problems directly instead of rephrasing them."
        : null,
      "The core subject is what the audience is learning about. The presentation brief only defines framing or context.",
      "Use the framing context as a lens, not as a canned presentation template.",
      "Do not address the audience as participants, new hires, or attendees. Explain the subject itself.",
      "Do not leak instruction fragments like 'create a presentation', 'more information is available at', or 'use google' into slide titles, learning goals, or key points.",
      "This is not a talk about slide design or how to present. Never give advice about slides, screenshots, clutter, decks, key points, or presentation technique unless the core subject itself is presentation design.",
      "Avoid facilitator phrases like 'this session', 'welcome everyone', 'to wrap up', 'next steps', or 'our mission' unless the subject itself is about running a session.",
      "Keep every slide on the same main topic and make the sequence feel like one coherent talk.",
      "Each slide must teach something about the subject itself, not about how the presentation should be delivered.",
      "Prefer concrete facts, mechanisms, responsibilities, examples, or outcomes over generic slogans.",
      "Avoid imperative bullet points like 'walk through', 'emphasize', 'map out', 'review', 'validate that', or 'direct new hires'.",
      "Avoid unfinished fragments. Every key point must be a complete audience-facing sentence.",
      "Follow the slide contract below closely. It is a subject-facing teaching scaffold, not a rigid visual template.",
      ...buildSlideContractPromptLines(input),
    ].filter((line): line is string => Boolean(line));

    if (mode === "compact") {
      return [
        ...header,
        "Return JSON with: title, summary, slides.",
        "Each slide should include: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
        "Use 3 to 4 key points per slide.",
        "Slide 1 must name the subject directly and explain why the topic matters without using welcome/session language.",
        "Final slide must close the teaching arc with one more concrete subject insight or implication, not a generic recap or checklist.",
        "Use English and keep the language spoken, concrete, and audience-facing.",
        "Each slide should contain at least two concrete, subject-facing claims. Avoid filler phrasing.",
      ].join("\n");
    }

    return [
      ...header,
      "Return JSON with: title, summary, slides.",
      "Each slide should include only: title, learningGoal, keyPoints.",
      "Use 3 bullet-like key points per slide.",
      "Do not include markdown.",
      "Use English.",
    ].join("\n");
  }
}
