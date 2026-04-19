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
  SlideVisualTone,
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
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
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

const normalizeComparableText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  const cards =
    providedCards.length > 0 ? providedCards : deriveVisualCards(slideCandidate, options.keyPoints);
  const diagramNodes =
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
        }));
  const rawCallouts =
    providedCallouts.length > 0
      ? providedCallouts
      : calloutSeed.map((callout, index) => ({
          id: `${String(slideCandidate.id ?? "slide")}-callout-${index + 1}`,
          ...callout,
        }));

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

const sanitizePromptShapingText = (value: string, topic: string): string => {
  const normalized = value
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(
      /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi,
      topic,
    )
    .replace(
      /\b(?:create|make|build|generate|write|prepare)\s+(?:an?|the)?\s*(onboarding|orientation|overview|introduction)\s+presentation\b/gi,
      "$1",
    )
    .replace(/\b(?:create|make|build|generate|write|prepare)\s+(?:an?|the)?\s*presentation\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  return normalized;
};

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
  overrides?: {
    targetSlideCount?: number | undefined;
    topic?: string | undefined;
    subject?: string | undefined;
    intent?: ArcPolicyInput["intent"];
    groundingHighlights?: string[] | undefined;
    groundingCoverageGoals?: string[] | undefined;
    groundingSourceIds?: string[] | undefined;
  },
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const topic = overrides?.topic ?? "the topic";
  const subject = overrides?.subject ?? topic;
  const recommendedSlideCount =
    typeof candidate.recommendedSlideCount === "number"
      ? candidate.recommendedSlideCount
      : overrides?.targetSlideCount ?? 4;
  const arcInput: ArcPolicyInput = {
    intent: overrides?.intent,
    groundingHighlights: overrides?.groundingHighlights,
    groundingCoverageGoals: overrides?.groundingCoverageGoals,
    groundingSourceIds: overrides?.groundingSourceIds,
  };
  const workshop = isWorkshopPresentation(arcInput as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = arcInput.intent?.focusAnchor?.trim();
  const defaultStorylineForArc = (() => {
    switch (deriveSlideArcPolicy(arcInput)) {
      case "procedural":
        return [
          `What ${subject} depends on`,
          `How ${subject} comes together`,
          `What changes the final quality`,
          `How to recognize the finished result`,
        ];
      case "organization-overview":
        return [
          `Who ${subject} is`,
          `What ${subject} offers`,
          `How ${subject} works`,
          workshop
            ? `Practical exercise using ${subject}`
            : `One concrete outcome from ${subject}`,
        ];
      case "source-backed-subject":
        return [
          `What ${subject} is`,
          focusAnchor || `One concrete detail or event`,
          workshop
            ? `Practical exercise using the case`
            : `Why the detail matters`,
          workshop ? `Applied takeaway` : `What it teaches`,
        ];
      default:
        return [
          `What ${subject} is`,
          `One concrete detail`,
          workshop ? `Practical exercise` : `Why it matters`,
          workshop ? `Applied takeaway` : `Key takeaway`,
        ];
    }
  })().slice(0, Math.max(4, recommendedSlideCount));
  const normalizedStoryline = toStringArray(candidate.storyline).map((step) =>
    sanitizePromptShapingText(step, topic),
  );
  const storyline = normalizedStoryline.length > 0
    ? normalizedStoryline.map((step, index) => {
        const previousAccepted = normalizedStoryline.slice(0, index);
        const tooMeta =
          DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(step)) ||
          DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(step));
        const tooAbstract = looksAbstractForIntro(step) && index > 0;
        const tooSimilar = previousAccepted.some(
          (previousStep) =>
            contractTextSimilarity(step, previousStep) >= 0.72,
        );
        return tooMeta || tooAbstract || tooSimilar
          ? defaultStorylineForArc[index] ?? step
          : step;
      })
    : defaultStorylineForArc;

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
      return storyline.length > 0
        ? storyline
        : defaultStorylineForArc;
    })(),
    recommendedSlideCount,
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

const looksAbstractForIntro = (value: string): boolean => {
  const tokens = [...new Set(tokenizeDeckShapeText(value))];
  return tokens.length > 0 && tokens.length <= 3;
};

const DECK_SHAPE_META_PATTERNS = [
  /\bthis slide\b/i,
  /\bslides?\b/i,
  /\bpresentation\b/i,
  /\bdeck\b/i,
  /\baudience\b/i,
  /\bsession\b/i,
  /\bthis session\b/i,
  /\bblueprint\b/i,
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

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

const tokenizeSemanticText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const tokenizeDeckShapeText = (value: string): string[] =>
  tokenizeSemanticText(value);

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

  const tokens = tokenizeDeckShapeText(trimmed);
  if (tokens.length >= 7 && /[.!?]$/.test(trimmed)) {
    return false;
  }

  if (tokens.length < 3) {
    return true;
  }

  if (/[.!?]$/.test(trimmed)) {
    return false;
  }

  const clauseLikeParts = trimmed
    .split(/[,:;–—]/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return tokens.length < 5 && clauseLikeParts.length <= 1;
};

type SlideDraftAssessment = {
  retryable: boolean;
  reasons: string[];
};

const PLAIN_TEXT_SLIDE_SECTION_ALIASES = {
  title: ["TITLE", "SLIDE TITLE"],
  goal: ["GOAL", "LEARNING GOAL", "OBJECTIVE"],
  points: ["POINTS", "KEY POINTS"],
  beginner: ["BEGINNER", "BEGINNER EXPLANATION"],
  advanced: ["ADVANCED", "ADVANCED EXPLANATION"],
  example: ["EXAMPLE", "EXAMPLES"],
  question: ["QUESTION", "LIKELY QUESTION"],
} as const;

type PlainTextSlideSectionKey = keyof typeof PLAIN_TEXT_SLIDE_SECTION_ALIASES;

const PLAIN_TEXT_SLIDE_HEADER_TO_SECTION = new Map<string, PlainTextSlideSectionKey>(
  Object.entries(PLAIN_TEXT_SLIDE_SECTION_ALIASES).flatMap(([section, aliases]) =>
    aliases.map((alias) => [alias, section as PlainTextSlideSectionKey]),
  ),
);

const parsePlainTextSlideSections = (
  text: string,
): Record<PlainTextSlideSectionKey, string> => {
  const sections: Record<PlainTextSlideSectionKey, string[]> = {
    title: [],
    goal: [],
    points: [],
    beginner: [],
    advanced: [],
    example: [],
    question: [],
  };
  let currentSection: PlainTextSlideSectionKey | null = null;

  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").split("\n")) {
    const line = rawLine.trimEnd();
    const headerMatch = line.match(/^\s*([\p{L}][\p{L} ]{1,40})\s*:\s*(.*)$/u);
    if (headerMatch) {
      const normalizedHeader = headerMatch[1]!.replace(/\s+/g, " ").trim().toUpperCase();
      const section = PLAIN_TEXT_SLIDE_HEADER_TO_SECTION.get(normalizedHeader) ?? null;
      if (section) {
        currentSection = section;
        const inlineValue = headerMatch[2]?.trim();
        if (inlineValue) {
          sections[section].push(inlineValue);
        }
        continue;
      }
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  return {
    title: sections.title.join("\n").trim(),
    goal: sections.goal.join("\n").trim(),
    points: sections.points.join("\n").trim(),
    beginner: sections.beginner.join("\n").trim(),
    advanced: sections.advanced.join("\n").trim(),
    example: sections.example.join("\n").trim(),
    question: sections.question.join("\n").trim(),
  };
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

  const sections = parsePlainTextSlideSections(text);
  const title = normalizeInlineText(sections.title);
  const learningGoal = normalizeInlineText(sections.goal);
  const pointsBlock = sections.points;
  const beginnerExplanation = normalizeInlineText(sections.beginner);
  const advancedExplanation = normalizeInlineText(sections.advanced);
  const example = normalizeInlineText(sections.example);
  const question = normalizeInlineText(sections.question);
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
  kind:
    | "orientation"
    | "coverage"
    | "development"
    | "synthesis"
    | "subject-detail"
    | "subject-implication"
    | "subject-takeaway"
    | "entity-capabilities"
    | "entity-operations"
    | "entity-value"
    | "workshop-practice"
    | "procedural-ingredients"
    | "procedural-steps"
    | "procedural-quality";
  focus: string;
  objective?: string;
  evidence?: string;
  distinctFrom?: string[];
};

type ContractSeedSource =
  | "focusAnchor"
  | "presentationGoal"
  | "coverageRequirement"
  | "coverageGoal"
  | "learningObjective"
  | "storyline"
  | "groundingHighlight"
  | "activityRequirement";

type ContractSeed = {
  id: string;
  text: string;
  source: ContractSeedSource;
  order: number;
};

type SlideArcPolicy =
  | "procedural"
  | "organization-overview"
  | "source-backed-subject"
  | "subject-explainer";

type ArcPolicyInput = {
  intent?: Pick<
    NonNullable<GenerateDeckInput["intent"]>,
    | "contentMode"
    | "presentationFrame"
    | "organization"
    | "explicitSourceUrls"
    | "focusAnchor"
    | "deliveryFormat"
    | "activityRequirement"
  > | undefined;
  groundingHighlights?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
};

const resolveIntentSubject = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
): string => input.intent?.subject?.trim() || input.topic;

const resolveIntentFocusAnchor = (
  input: Pick<GenerateDeckInput, "intent">,
): string | undefined => {
  const focusAnchor = input.intent?.focusAnchor?.trim();
  return focusAnchor && focusAnchor.length > 0 ? focusAnchor : undefined;
};

const hasSourceBackedGrounding = (input: ArcPolicyInput): boolean =>
  Boolean(
    input.intent?.explicitSourceUrls?.length ||
      input.groundingSourceIds?.length ||
      input.groundingCoverageGoals?.length ||
      (input.groundingHighlights?.length ?? 0) >= 2,
  );

const deriveSlideArcPolicy = (input: ArcPolicyInput): SlideArcPolicy => {
  if (input.intent?.contentMode === "procedural") {
    return "procedural";
  }

  if (
    input.intent?.presentationFrame === "organization" ||
    (input.intent?.presentationFrame === "mixed" && Boolean(input.intent.organization))
  ) {
    return "organization-overview";
  }

  if (hasSourceBackedGrounding(input)) {
    return "source-backed-subject";
  }

  return "subject-explainer";
};

const buildArcPolicyPromptLines = (input: ArcPolicyInput): string[] => {
  const focusAnchor = input.intent?.focusAnchor?.trim();

  switch (deriveSlideArcPolicy(input)) {
    case "organization-overview":
      return [
        isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
          ? "Use an organization-grounded workshop arc: why this matters for the audience's daily work, where it helps, which constraints shape safe use, and one practical exercise."
          : "Use an organization overview arc: who the organization is, what it offers, how it works, and one concrete outcome or customer example.",
        "Do not drift into mission, vision, or broad slogans unless that material is explicitly grounded and central to the request.",
      ];
    case "source-backed-subject":
      return [
        "Use a sourced teaching arc that separates the concrete detail or case, why it matters, and the takeaway.",
        focusAnchor
          ? `Treat ${JSON.stringify(focusAnchor)} as the concrete case anchor for the detail slide and keep later slides building on it rather than collapsing back to the broad subject alone.`
          : null,
        "Later slides must not restate the same description; each one needs a different explanatory role.",
      ].filter((line): line is string => Boolean(line));
    case "subject-explainer":
      return [
        "Use a teaching arc that separates the concrete detail, the implication, and the takeaway.",
        "Later slides must not restate the same description; each one needs a different explanatory role.",
      ];
    default:
      return [];
  }
};

const splitContractCandidateClauses = (value: string): string[] =>
  value
    .split(/[:;]+/)
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
    resolveIntentFocusAnchor(input) ?? "",
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
    const subjectTokens = new Set(tokenizeDeckShapeText(subject));
    const candidateTokens = [...new Set(tokenizeDeckShapeText(normalized))];
    const novelTokenCount = candidateTokens.filter((token) => !subjectTokens.has(token)).length;

    if (novelTokenCount >= 2) {
      return shortenTitlePhrase(normalized, 84);
    }

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
  const focusAnchor = resolveIntentFocusAnchor(input.generationInput);
  const groundingSummaryCandidates = compactGroundingSummary(
    input.generationInput.groundingSummary ?? "",
  )
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 28);
  const previousSlide = input.deck.slides[input.slide.order - 1];
  const nextSlide = input.deck.slides[input.slide.order + 1];
  const organizationArc = deriveSlideArcPolicy(input.generationInput) === "organization-overview";
  const earlierSlideDigest = input.deck.slides
    .slice(0, input.slide.order)
    .map((priorSlide) =>
      [priorSlide.title, priorSlide.learningGoal].filter(Boolean).join(": "),
    )
    .filter(Boolean)
    .slice(-3);
  const relevanceAnchor = uniqueNonEmptyStrings([
    subject,
    focusAnchor ?? "",
    input.contract.focus,
    input.contract.objective ?? "",
    input.contract.evidence ?? "",
    input.generationInput.intent?.presentationGoal ?? "",
    input.generationInput.plan?.learningObjectives?.[input.slide.order] ?? "",
    input.generationInput.plan?.storyline?.[input.slide.order] ?? "",
    input.slide.title,
    input.slide.learningGoal,
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

  const claimStyleGuidance = (() => {
    switch (input.contract.kind) {
      case "orientation":
        return `State concrete subject-facing claims about ${subject}. Name what it is, what changes because of it, or what makes it recognizable. Do not describe the presentation or the presenter.`;
      case "subject-detail":
        return `Keep this slide concrete. Explain one defining detail, event, mechanism, or subarea within ${subject} itself. Do not jump ahead to summary or broad significance language.`;
      case "subject-implication":
        return `Explain why the earlier detail matters. Focus on consequence, significance, lesson, or interpretation instead of re-describing the same detail.`;
      case "subject-takeaway":
        return `Synthesize the strongest takeaway from ${subject}. Connect the earlier concrete detail and implication without introducing a brand-new subtopic.`;
      case "procedural-ingredients":
        return `Explain what the main inputs contribute to the final result in ${subject.toLowerCase()}. Phrase each point as a descriptive claim about balance, texture, flavor, or another visible effect. Do not give recipe-like or step-by-step instructions, and do not address the audience directly.`;
      case "procedural-steps":
        return `Explain what each main step changes in ${subject.toLowerCase()} and why that change matters. Treat the steps as explanatory topics, not commands for the audience to follow. Avoid second-person phrasing and avoid telling someone what to do.`;
      case "procedural-quality":
        return `Explain how balance, texture, or final adjustments change the quality of ${subject.toLowerCase()}. Keep the points observational and evaluative, not imperative. Every key point should describe a cue, effect, or relationship, not an action for the cook or audience.`;
      case "entity-capabilities":
        return `Explain what ${subject} does through concrete capabilities, services, responsibilities, or focus areas. Keep the language factual and organization-facing rather than abstract or promotional.`;
      case "entity-operations":
        return `Explain how ${subject} works in practice through delivery, customer work, operating methods, or concrete processes. Prefer operational detail over slogans.`;
      case "entity-value":
        return `Explain one concrete outcome, customer example, or practical consequence that shows why ${subject} matters. Tie the slide to one recognizable evidence anchor and avoid broad value or mission language.`;
      case "workshop-practice":
        return `Design this slide around one practical task, exercise, or applied scenario. The audience should use the slide to apply the ideas, not just hear them restated. Include a concrete task, one starting material or scenario, one constraint or review check, and one expected output or decision.`;
      case "synthesis":
        return `State what should be remembered about ${subject}. Connect the strongest ideas, consequences, or examples without turning the slide into facilitation or wrap-up meta language.`;
      default:
        return `Write complete declarative claims about ${subject}. Prefer mechanisms, roles, consequences, or concrete subareas over advice about what someone should do.`;
    }
  })();

  return [
    `Subject: ${subject}`,
    focusAnchor ? `Concrete focus anchor: ${focusAnchor}` : null,
    input.generationInput.intent?.organization
      ? `Organization context: ${input.generationInput.intent.organization}`
      : null,
    input.generationInput.intent?.framing
      ? `Framing context: ${input.generationInput.intent.framing}`
      : input.generationInput.presentationBrief
        ? `Framing context: ${input.generationInput.presentationBrief}`
        : null,
    input.generationInput.intent?.presentationFrame
      ? `Presentation frame: ${input.generationInput.intent.presentationFrame}`
      : null,
    input.generationInput.intent?.audienceCues?.length
      ? `Audience: ${input.generationInput.intent.audienceCues.join("; ")}`
      : null,
    input.generationInput.intent?.presentationGoal
      ? `Presentation goal: ${input.generationInput.intent.presentationGoal}`
      : null,
    input.generationInput.intent?.deliveryFormat
      ? `Format: ${input.generationInput.intent.deliveryFormat}`
      : null,
    ...buildArcPolicyPromptLines(input.generationInput),
    input.generationInput.intent?.activityRequirement
      ? `Participant activity requirement: ${input.generationInput.intent.activityRequirement}`
      : null,
    `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
    `Slide role: ${input.contract.label}`,
    `Slide kind: ${input.contract.kind}`,
    `Slide focus: ${input.contract.focus}`,
    input.contract.objective ? `Slide objective: ${input.contract.objective}` : null,
    input.contract.evidence ? `Slide evidence anchor: ${input.contract.evidence}` : null,
    input.contract.evidence
      ? "Use the evidence anchor concretely. Do not replace it with broader abstract company messaging, history, or mission language unless the slide explicitly requires that."
      : null,
    `Claim style guidance: ${claimStyleGuidance}`,
    `Draft title: ${input.slide.title}`,
    `Draft learning goal: ${input.slide.learningGoal}`,
    previousSlide ? `Previous slide title: ${previousSlide.title}` : "Previous slide title: none",
    nextSlide ? `Next slide title: ${nextSlide.title}` : "Next slide title: none",
    earlierSlideDigest.length > 0
      ? `Earlier slides already cover:\n${earlierSlideDigest.map((value) => `- ${value}`).join("\n")}`
      : null,
    input.contract.distinctFrom?.length
      ? `Do not reuse these earlier slide anchors:\n${input.contract.distinctFrom
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    relevantContext.length > 0
      ? `Relevant grounding:\n${relevantContext.map((value) => `- ${value}`).join("\n")}`
      : "Relevant grounding: none",
    "This slide must add a distinct explanatory center. Do not restate the same explanation, role, or takeaway used on earlier slides.",
    organizationArc
      ? "Teach the organization/entity itself, not the abstract generic concept behind its name."
      : null,
    organizationArc &&
    (input.generationInput.intent?.framing || input.generationInput.presentationBrief)
      ? "Keep the slide inside the framing scope. If the framing implies onboarding, orientation, introduction, or overview, orient a newcomer to the organization itself rather than broadening into a generic guide to the wider field."
      : null,
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

const lowerCaseFirstCharacter = (value: string): string =>
  value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

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

const looksGenericEntityReference = (value: string): boolean =>
  /^(?:our|my|the)\s+(?:company|organisation|organization|business|employer|client)$/i.test(
    value.trim(),
  ) ||
  /^(?:company|organisation|organization|business|employer|client)$/i.test(
    value.trim(),
  );

const resolveOrganizationEntityName = (
  input: Pick<GenerateDeckInput, "topic" | "intent" | "plan">,
): string => {
  if (input.intent?.organization?.trim()) {
    return input.intent.organization.trim();
  }

  const subject = resolveIntentSubject(input);
  if (!looksGenericEntityReference(subject)) {
    return subject;
  }

  return subject;
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

const shouldLeadWithGroundingHighlight = (
  subject: string,
  highlight: string | undefined,
  anchors: Array<string | undefined>,
): boolean => {
  if (!highlight) {
    return false;
  }

  const anchorContext = uniqueNonEmptyStrings([
    subject,
    ...anchors.filter((anchor): anchor is string => Boolean(anchor)),
  ]).join(" ");
  return (
    hasMeaningfulAnchorOverlap(highlight, anchorContext) ||
    countAnchorOverlap(highlight, anchorContext) >= 2
  );
};

const resolveSourceBackedCaseAnchor = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
): string | undefined => {
  const explicitFocusAnchor = resolveIntentFocusAnchor(input);
  if (explicitFocusAnchor) {
    return explicitFocusAnchor;
  }

  if (deriveSlideArcPolicy(input) !== "source-backed-subject") {
    return undefined;
  }

  const subject = resolveIntentSubject(input);
  const subjectTokens = new Set(tokenizeDeckShapeText(subject));
  const contextAnchor = uniqueNonEmptyStrings([
    subject,
    ...(input.groundingCoverageGoals ?? []),
  ]).join(" ");
  const candidates = [
    ...(input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""))
      .map((value) => ({
        source: "coverageRequirement" as const,
        text: sanitizeContractText(value, subject),
      })),
    ...(input.groundingCoverageGoals ?? []).map((value) => ({
      source: "coverageGoal" as const,
      text: sanitizeContractText(value, subject),
    })),
    ...(input.groundingHighlights ?? []).map((value) => ({
      source: "groundingHighlight" as const,
      text: compactGroundingHighlight(value, subject),
    })),
  ].filter((candidate) => candidate.text.length > 0);

  const ranked = uniqueNonEmptyStrings(candidates.map((candidate) => candidate.text))
    .map((candidate) => {
      const source =
        candidates.find((entry) => normalizeComparableText(entry.text) === normalizeComparableText(candidate))
          ?.source ?? "coverageGoal";
      const candidateTokens = [...new Set(tokenizeDeckShapeText(candidate))];
      const novelTokenCount = candidateTokens.filter((token) => !subjectTokens.has(token)).length;
      const overlapScore = countAnchorOverlap(candidate, contextAnchor);
      const meaningfulOverlap = hasMeaningfulAnchorOverlap(candidate, contextAnchor) ? 3 : 0;
      const summaryPenalty = isGenericOpeningFocus(subject, candidate) ? -4 : 0;
      const specificityScore = Math.min(4, candidateTokens.length);
      const sourceBonus =
        source === "groundingHighlight" ? 4 : source === "coverageRequirement" ? 3 : 1;
      return {
        candidate,
        source,
        score:
          sourceBonus +
          overlapScore * 2 +
          meaningfulOverlap +
          novelTokenCount * 2 +
          specificityScore +
          (/\p{N}/u.test(candidate) ? 1 : 0) +
          summaryPenalty,
      };
    })
    .sort((left, right) => {
      const sourceRank = (source: "coverageRequirement" | "coverageGoal" | "groundingHighlight") =>
        source === "coverageRequirement" ? 0 : source === "groundingHighlight" ? 1 : 2;
      if (sourceRank(left.source) !== sourceRank(right.source)) {
        return sourceRank(left.source) - sourceRank(right.source);
      }
      return right.score - left.score;
    });

  const selected = ranked[0]?.candidate;
  return selected ? compressContractCandidate(input, selected) : undefined;
};

const shortenTitlePhrase = (value: string, maxLength = 72): string => {
  const stripDanglingTitleTail = (input: string): string =>
    input
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/[.:!?]+$/g, "")
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

const isGenericOpeningFocus = (subject: string, value: string): boolean => {
  const normalized = sanitizeContractText(value, subject);
  if (!normalized) {
    return true;
  }

  return (
    isOrientationCoverageAnchor(subject, normalized) ||
    DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    /^why\b.+\bmatters?\b/i.test(normalized)
  );
};

const pickOpeningFocus = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  openingHighlight?: string,
): string => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const entityName =
    input.intent?.presentationFrame === "organization"
      ? input.intent.organization ?? subject
      : subject;
  const explicitCoverageRequirements = uniqueNonEmptyStrings(
    (input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""))
      .map((requirement) => sanitizeContractText(requirement, subject)),
  ).filter((value) => !isGenericOpeningFocus(subject, value));
  const coverageGoals = uniqueNonEmptyStrings(
    (input.groundingCoverageGoals ?? []).map((goal) =>
      sanitizeContractText(goal, subject),
    ),
  ).filter((value) => !isGenericOpeningFocus(subject, value));
  const learningObjectives = uniqueNonEmptyStrings(input.plan?.learningObjectives ?? []).filter(
    (value) => !isGenericOpeningFocus(subject, value),
  );
  const presentationGoal = input.intent?.presentationGoal
    ? sanitizeContractText(input.intent.presentationGoal, subject)
    : "";
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const audienceLabel = uniqueNonEmptyStrings(input.intent?.audienceCues ?? [])
    .slice(0, 3)
    .join(", ");
  const highlight = openingHighlight ? compactGroundingHighlight(openingHighlight, subject) : "";
  const openingAnchors = [explicitCoverageRequirements[0], coverageGoals[0], learningObjectives[0]];
  const leadingHighlight = shouldLeadWithGroundingHighlight(subject, highlight, openingAnchors)
    ? highlight
    : undefined;
  const workshopOpeningAnchor = workshop
    ? pickContractText(
        input,
        [
          input.plan?.learningObjectives?.[0],
          input.intent?.presentationGoal,
          input.plan?.storyline?.[0],
          audienceLabel
            ? `How ${audienceLabel} use ${subject} in daily work`
            : `How ${subject} supports daily work`,
          subject,
        ],
        { preferConcrete: true },
      )
    : undefined;
  const candidate = pickContractText(
    input,
    arcPolicy === "source-backed-subject"
      ? [
          focusAnchor,
          explicitCoverageRequirements[0],
          coverageGoals[0],
          leadingHighlight,
          highlight,
          learningObjectives[0],
          input.plan?.storyline?.[0],
          presentationGoal,
          subject,
        ]
      : arcPolicy === "organization-overview"
        ? workshop
          ? [
              learningObjectives[0],
              presentationGoal,
              input.plan?.storyline?.[0],
              workshopOpeningAnchor,
              audienceLabel
                ? `How ${audienceLabel} use ${subject} in daily work`
                : `How ${subject} supports daily work`,
              subject,
              explicitCoverageRequirements[0],
              leadingHighlight,
            ]
          : [
              `Who ${entityName} is`,
              input.plan?.learningObjectives?.[0],
              input.plan?.storyline?.[0],
              presentationGoal,
              subject,
              explicitCoverageRequirements[0],
              coverageGoals[0],
              leadingHighlight,
              highlight,
            ]
      : [
          leadingHighlight,
          explicitCoverageRequirements[0],
          coverageGoals[0],
          learningObjectives[0],
          presentationGoal,
          input.intent?.presentationFrame === "organization"
            ? `What ${entityName} does and why it matters`
            : undefined,
          highlight,
          subject,
          `What ${subject} is and why it matters`,
        ],
    { preferConcrete: true },
  );

  return candidate || subject;
};

const pickOpeningObjective = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  openingHighlight?: string,
): string | undefined => {
  const subject = resolveIntentSubject(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const candidate = pickContractText(
    input,
    arcPolicy === "source-backed-subject"
      ? [
          focusAnchor,
          input.groundingCoverageGoals?.[0],
          input.plan?.learningObjectives?.[0],
          input.plan?.storyline?.[0],
          openingHighlight,
          input.intent?.presentationGoal,
        ]
      : arcPolicy === "organization-overview" && workshop
        ? [
            input.plan?.learningObjectives?.[0],
            input.intent?.presentationGoal,
            input.plan?.storyline?.[0],
            input.intent?.coverageRequirements?.[0],
          ]
        : arcPolicy === "organization-overview"
          ? [
              input.plan?.learningObjectives?.[0],
              input.plan?.storyline?.[0],
              input.intent?.presentationGoal,
              input.intent?.coverageRequirements?.[0],
              input.groundingCoverageGoals?.[0],
            ]
      : [
          input.intent?.presentationGoal,
          input.intent?.activityRequirement,
          input.plan?.learningObjectives?.[0],
          openingHighlight,
          ...(input.intent?.coverageRequirements ?? []),
          ...(input.groundingCoverageGoals ?? []),
        ],
    { preferConcrete: true },
  );

  const normalized = candidate ? sanitizeContractText(candidate, subject) : "";
  return normalized || undefined;
};

const buildContractSeeds = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): ContractSeed[] => {
  const subject = resolveIntentSubject(input);
  const seeds: ContractSeed[] = [];
  const seen = new Set<string>();
  const derivedFocusAnchor = resolveSourceBackedCaseAnchor(input);

  const addSeeds = (
    source: ContractSeedSource,
    values: string[],
    normalize: (value: string) => string = (value) => sanitizeContractText(value, subject),
  ) => {
    values.forEach((value, order) => {
      const normalized = normalize(value);
      if (
        !normalized ||
        isOrientationCoverageAnchor(subject, normalized) ||
        NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized))
      ) {
        return;
      }

      const key = normalizeComparableText(normalized);
      if (!normalized || seen.has(key)) {
        return;
      }

      seen.add(key);
      seeds.push({
        id: `${source}:${order}:${key}`,
        text: normalized,
        source,
        order,
      });
    });
  };

  if (derivedFocusAnchor) {
    addSeeds("focusAnchor", [derivedFocusAnchor]);
  }
  if (input.intent?.presentationGoal) {
    addSeeds("presentationGoal", [input.intent.presentationGoal]);
  }
  addSeeds(
    "coverageRequirement",
    input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""),
  );
  addSeeds("coverageGoal", input.groundingCoverageGoals ?? []);
  addSeeds("learningObjective", input.plan?.learningObjectives ?? []);
  addSeeds("storyline", input.plan?.storyline ?? []);
  addSeeds(
    "groundingHighlight",
    (input.groundingHighlights ?? []).map((highlight) =>
      compactGroundingHighlight(highlight, subject),
    ),
    (value) => value,
  );
  if (input.intent?.activityRequirement) {
    addSeeds("activityRequirement", [input.intent.activityRequirement]);
  }

  return seeds;
};

const contractTextSimilarity = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeDeckShapeText(left))];
  const rightTokens = new Set(tokenizeDeckShapeText(right));

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.size);
};

const selectDistinctContractSeed = (options: {
  seeds: ContractSeed[];
  usedSeedIds: Set<string>;
  usedTexts: string[];
  preferredSources: ContractSeedSource[];
  fallbackSources?: ContractSeedSource[];
}): ContractSeed | undefined => {
  const fallbackSources = options.fallbackSources ?? options.preferredSources;
  const allowedSources = new Set([...options.preferredSources, ...fallbackSources]);
  const sourceRank = new Map<ContractSeedSource, number>();

  options.preferredSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, index);
    }
  });
  fallbackSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, options.preferredSources.length + index);
    }
  });

  const ranked = options.seeds
    .filter((seed) => !options.usedSeedIds.has(seed.id) && allowedSources.has(seed.source))
    .map((seed) => {
      const similarity = options.usedTexts.reduce(
        (max, usedText) => Math.max(max, contractTextSimilarity(seed.text, usedText)),
        0,
      );
      const distinctnessBucket =
        seed.source === "focusAnchor"
          ? 0
          : similarity >= 0.72
            ? 2
            : similarity >= 0.58
              ? 1
              : 0;
      const specificity = tokenizeDeckShapeText(seed.text).length;
      return {
        seed,
        distinctnessBucket,
        sourceOrder: sourceRank.get(seed.source) ?? Number.MAX_SAFE_INTEGER,
        specificity,
        similarity,
      };
    })
    .sort((left, right) => {
      if (left.distinctnessBucket !== right.distinctnessBucket) {
        return left.distinctnessBucket - right.distinctnessBucket;
      }
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }
      if (left.specificity !== right.specificity) {
        return right.specificity - left.specificity;
      }
      if (left.similarity !== right.similarity) {
        return left.similarity - right.similarity;
      }
      return left.seed.order - right.seed.order;
    });

  return ranked[0]?.seed;
};

const selectAlignedContractSeed = (options: {
  seeds: ContractSeed[];
  usedSeedIds: Set<string>;
  preferredSources: ContractSeedSource[];
  referenceTexts: string[];
}): ContractSeed | undefined => {
  const allowedSources = new Set(options.preferredSources);
  const sourceRank = new Map<ContractSeedSource, number>();
  options.preferredSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, index);
    }
  });

  const ranked = options.seeds
    .filter((seed) => !options.usedSeedIds.has(seed.id) && allowedSources.has(seed.source))
    .map((seed) => {
      const alignment = options.referenceTexts.reduce(
        (max, reference) =>
          Math.max(
            max,
            countAnchorOverlap(seed.text, reference) * 2 +
              (hasMeaningfulAnchorOverlap(seed.text, reference) ? 3 : 0),
          ),
        0,
      );
      const specificity = tokenizeDeckShapeText(seed.text).length;
      return {
        seed,
        alignment,
        specificity,
        sourceOrder: sourceRank.get(seed.source) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.alignment !== right.alignment) {
        return right.alignment - left.alignment;
      }
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }
      return right.specificity - left.specificity;
    });

  return ranked[0]?.seed;
};

const isWorkshopPresentation = (
  input: Pick<GenerateDeckInput, "intent">,
): boolean =>
  input.intent?.deliveryFormat === "workshop" ||
  Boolean(input.intent?.activityRequirement);

const buildSlideContractKinds = (
  input: Pick<
    GenerateDeckInput,
    "intent" | "groundingHighlights" | "groundingCoverageGoals" | "groundingSourceIds"
  >,
  slideCount: number,
): SlideContract["kind"][] => {
  if (slideCount <= 0) {
    return [];
  }

  const remainingSlideCount = Math.max(0, slideCount - 1);
  const workshop = isWorkshopPresentation(input);
  const arcPolicy = deriveSlideArcPolicy(input);

  if (remainingSlideCount === 0) {
    return ["orientation"];
  }

  if (arcPolicy === "procedural") {
    return [
      "orientation",
      ...Array.from({ length: remainingSlideCount }, (_, index) =>
        index === 0
          ? "procedural-ingredients"
          : index === 1
            ? "procedural-steps"
            : "procedural-quality",
      ),
    ];
  }

  if (arcPolicy === "organization-overview") {
    if (workshop) {
      if (remainingSlideCount === 1) {
        return ["orientation", "workshop-practice"];
      }
      if (remainingSlideCount === 2) {
        return ["orientation", "entity-capabilities", "workshop-practice"];
      }
      return [
        "orientation",
        "entity-capabilities",
        ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
          index === remainingSlideCount - 2 ? "workshop-practice" : "entity-operations",
        ),
      ];
    }

    if (remainingSlideCount === 1) {
      return ["orientation", "entity-value"];
    }
    if (remainingSlideCount === 2) {
      return ["orientation", "entity-capabilities", "entity-value"];
    }

    return [
      "orientation",
      "entity-capabilities",
      ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
        index === remainingSlideCount - 2 ? "entity-value" : "entity-operations",
      ),
    ];
  }

  if (workshop) {
    if (remainingSlideCount === 1) {
      return ["orientation", "workshop-practice"];
    }
    if (remainingSlideCount === 2) {
      return ["orientation", "subject-detail", "workshop-practice"];
    }
    return [
      "orientation",
      "subject-detail",
      ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
        index === remainingSlideCount - 2 ? "workshop-practice" : "subject-implication",
      ),
    ];
  }

  if (remainingSlideCount === 1) {
    return ["orientation", "subject-takeaway"];
  }
  if (remainingSlideCount === 2) {
    return ["orientation", "subject-detail", "subject-takeaway"];
  }

  return [
    "orientation",
    "subject-detail",
    ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
      index === remainingSlideCount - 2 ? "subject-takeaway" : "subject-implication",
    ),
  ];
};

const buildContractFallbackFocus = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  kind: SlideContract["kind"],
): string => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const entityName =
    input.intent?.presentationFrame === "organization"
      ? input.intent.organization ?? subject
      : subject;

  switch (kind) {
    case "subject-detail":
      return focusAnchor ?? `One concrete detail, event, mechanism, or defining part of ${subject}`;
    case "subject-implication":
      return `One consequence, interpretation, or lesson revealed by ${subject}`;
    case "subject-takeaway":
      return `The strongest takeaway from ${subject}`;
    case "entity-capabilities":
      return workshop
        ? `Where ${subject} helps in daily work`
        : `What ${entityName} does and where it creates value`;
    case "entity-operations":
      return workshop
        ? `Which guardrails and review steps keep ${subject} safe in practice`
        : `How ${entityName} works in practice`;
    case "entity-value":
      return `One concrete example or outcome showing how ${entityName} creates value`;
    case "workshop-practice":
      return input.intent?.activityRequirement
        ? sanitizeContractText(input.intent.activityRequirement, subject)
        : `One practical exercise that applies ${subject}`;
    case "coverage":
      return `One concrete part of ${subject}`;
    case "development":
      return `The next meaningful part of ${subject}`;
    case "synthesis":
      return `The most important lessons about ${subject}`;
    default:
      return subject;
  }
};

const buildContractFallbackObjective = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  kind: SlideContract["kind"],
): string | undefined => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);

  switch (kind) {
    case "subject-detail":
      return focusAnchor
        ? `How ${focusAnchor} makes ${subject} concrete`
        : `A concrete detail or defining part that keeps ${subject} specific`;
    case "subject-implication":
      return `Why that concrete detail matters, what it changes, or what it reveals`;
    case "subject-takeaway":
      return `The clearest lesson or takeaway the audience should retain`;
    case "entity-capabilities":
      return workshop
        ? `Which daily tasks and role-based use cases benefit most from ${subject}`
        : `What ${subject} offers through concrete capabilities, services, or responsibilities`;
    case "entity-operations":
      return workshop
        ? `Which review steps, approved tools, and policy boundaries keep ${subject} safe in daily work`
        : `How ${subject} operates through delivery, teamwork, or concrete processes`;
    case "entity-value":
      return `Which customer outcome, example, or consequence makes ${subject} matter in practice`;
    case "workshop-practice":
      return input.intent?.activityRequirement
        ? sanitizeContractText(input.intent.activityRequirement, subject)
        : `One practical exercise that helps people apply ${subject}`;
    case "coverage":
      return `A required coverage area that keeps the deck specific`;
    case "development":
      return `A distinct mechanism, role, or consequence that advances the story`;
    case "synthesis":
      return `The strongest takeaway the audience should remember`;
    default:
      return undefined;
  }
};

const contractSeedPriorities = (
  kind: SlideContract["kind"],
  input?: ArcPolicyInput,
): {
  focus: ContractSeedSource[];
  objective: ContractSeedSource[];
  evidence: ContractSeedSource[];
} => {
  const sourceBackedSubject = input
    ? deriveSlideArcPolicy(input) === "source-backed-subject"
    : false;

  switch (kind) {
    case "subject-detail":
      if (sourceBackedSubject) {
        return {
          focus: [
            "focusAnchor",
            "coverageRequirement",
            "coverageGoal",
            "learningObjective",
            "storyline",
            "groundingHighlight",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
            "focusAnchor",
          ],
          evidence: [
            "groundingHighlight",
            "coverageGoal",
            "focusAnchor",
            "learningObjective",
            "storyline",
          ],
        };
      }
      return {
        focus: ["focusAnchor", "coverageRequirement", "groundingHighlight", "coverageGoal", "storyline", "learningObjective", "presentationGoal"],
        objective: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "presentationGoal", "focusAnchor"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline", "focusAnchor"],
      };
    case "subject-implication":
      if (sourceBackedSubject) {
        return {
          focus: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "coverageRequirement",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
          ],
          evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
        };
      }
      return {
        focus: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "subject-takeaway":
      if (sourceBackedSubject) {
        return {
          focus: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "coverageRequirement",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
          ],
          evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
        };
      }
      return {
        focus: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal"],
      };
    case "entity-capabilities":
      return {
        focus: ["coverageRequirement", "coverageGoal", "groundingHighlight", "learningObjective", "storyline", "presentationGoal"],
        objective: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "entity-operations":
      return {
        focus: ["storyline", "learningObjective", "coverageGoal", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "storyline", "learningObjective"],
      };
    case "entity-value":
      return {
        focus: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "workshop-practice":
      return {
        focus: ["activityRequirement", "learningObjective", "coverageGoal", "groundingHighlight", "storyline", "coverageRequirement", "presentationGoal"],
        objective: ["activityRequirement", "learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "activityRequirement", "learningObjective", "storyline"],
      };
    case "coverage":
      return {
        focus: ["coverageRequirement", "coverageGoal", "learningObjective", "storyline", "groundingHighlight", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "development":
      return {
        focus: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["storyline", "learningObjective", "groundingHighlight", "coverageGoal", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "synthesis":
      return {
        focus: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "presentationGoal"],
        evidence: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal"],
      };
    default:
      return {
        focus: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
  }
};

const buildSlideContractLabel = (
  kind: SlideContract["kind"],
  storylineValue: string | undefined,
): string => {
  switch (kind) {
    case "orientation":
      return "orientation";
    case "subject-detail":
      return storylineValue ?? "concrete detail";
    case "subject-implication":
      return storylineValue ?? "why it matters";
    case "subject-takeaway":
      return "takeaway";
    case "entity-capabilities":
      return "core capabilities";
    case "entity-operations":
      return storylineValue ?? "how it works";
    case "entity-value":
      return "practical value";
    case "workshop-practice":
      return "practical exercise";
    case "coverage":
      return storylineValue ?? "required coverage";
    case "development":
      return storylineValue ?? "development";
    case "synthesis":
      return "synthesis";
    case "procedural-ingredients":
      return "ingredients";
    case "procedural-steps":
      return "steps";
    case "procedural-quality":
      return "quality";
  }
};

const contractRequiresEvidence = (kind: SlideContract["kind"]): boolean =>
  kind === "entity-value" ||
  kind === "workshop-practice" ||
  kind === "subject-detail" ||
  kind === "subject-implication";

const openingSeedPriorities = (
  input: Pick<
    GenerateDeckInput,
    "intent" | "groundingHighlights" | "groundingCoverageGoals" | "groundingSourceIds"
  >,
): ContractSeedSource[] => {
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  switch (deriveSlideArcPolicy(input)) {
    case "source-backed-subject":
      return [
        "focusAnchor",
        "coverageRequirement",
        "coverageGoal",
        "groundingHighlight",
        "learningObjective",
        "storyline",
        "presentationGoal",
      ];
    case "organization-overview":
      return workshop
        ? [
            "learningObjective",
            "storyline",
            "presentationGoal",
            "coverageRequirement",
            "coverageGoal",
            "groundingHighlight",
          ]
        : [
            "learningObjective",
            "storyline",
            "presentationGoal",
            "coverageRequirement",
            "coverageGoal",
            "groundingHighlight",
          ];
    default:
      return [
        "coverageRequirement",
        "coverageGoal",
        "groundingHighlight",
        "learningObjective",
        "storyline",
        "presentationGoal",
      ];
  }
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
  const storyline = uniqueNonEmptyStrings(input.plan?.storyline ?? []);
  const learningObjectives = uniqueNonEmptyStrings(input.plan?.learningObjectives ?? []);
  const seeds = buildContractSeeds(input);
  const contractKinds = buildSlideContractKinds(input, slideCount);
  const arcPolicy = deriveSlideArcPolicy(input);
  const contracts: SlideContract[] = [];
  const usedSeedIds = new Set<string>();
  const usedTexts: string[] = [];

  for (let index = 0; index < slideCount; index += 1) {
    if (index === 0) {
      const openingPriority = openingSeedPriorities(input);
      const openingHighlight = selectDistinctContractSeed({
        seeds,
        usedSeedIds,
        usedTexts,
        preferredSources: openingPriority,
      })?.text;
      const focus = pickOpeningFocus(input, openingHighlight);
      const openingObjective = pickOpeningObjective(input, openingHighlight);
      contracts.push({
        index,
        label: "orientation",
        kind: "orientation",
        focus,
        ...(openingObjective && openingObjective !== focus
          ? { objective: openingObjective }
          : {}),
      });
      if (openingHighlight) {
        const openingSeed = seeds.find((seed) => seed.text === openingHighlight);
        if (openingSeed && openingSeed.source !== "focusAnchor") {
          usedSeedIds.add(openingSeed.id);
        }
      }
      usedTexts.push(focus);
      if (openingObjective && openingObjective !== focus) {
        usedTexts.push(openingObjective);
      }
      continue;
    }

    const kind = contractKinds[index] ?? "subject-implication";
    const priorities = contractSeedPriorities(kind, input);
    const distinctFrom = uniqueNonEmptyStrings(usedTexts.slice(-4));
    const focusSeed = selectDistinctContractSeed({
      seeds,
      usedSeedIds,
      usedTexts,
      preferredSources: priorities.focus,
    });
    if (focusSeed) {
      usedSeedIds.add(focusSeed.id);
    }
    const focus = pickContractText(
      input,
      arcPolicy === "source-backed-subject"
        ? [
            learningObjectives[index],
            storyline[index],
            focusSeed?.text,
            buildContractFallbackFocus(input, kind),
          ]
        : [
            focusSeed?.text,
            learningObjectives[index],
            storyline[index],
            buildContractFallbackFocus(input, kind),
          ],
      { preferConcrete: true },
    );
    const objectiveSeed = selectDistinctContractSeed({
      seeds,
      usedSeedIds,
      usedTexts: [...usedTexts, focus],
      preferredSources: priorities.objective,
      fallbackSources: priorities.focus,
    });
    if (objectiveSeed) {
      usedSeedIds.add(objectiveSeed.id);
    }
    const objective = pickContractText(
      input,
      (
        arcPolicy === "source-backed-subject"
          ? [
              storyline[index],
              learningObjectives[index],
              objectiveSeed?.text,
              buildContractFallbackObjective(input, kind),
            ]
          : [
              objectiveSeed?.text,
              buildContractFallbackObjective(input, kind),
            ]
      ).filter(
        (candidate) => candidate && normalizeComparableText(candidate) !== normalizeComparableText(focus),
      ),
      { preferConcrete: true },
    );
    const evidenceSeed = contractRequiresEvidence(kind)
      ? arcPolicy === "source-backed-subject"
        ? selectAlignedContractSeed({
            seeds,
            usedSeedIds,
            preferredSources: priorities.evidence,
            referenceTexts: [focus, objective].filter((value): value is string => Boolean(value)),
          }) ??
          selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts: [...usedTexts, focus, objective].filter(
              (value): value is string => Boolean(value),
            ),
            preferredSources: priorities.evidence,
            fallbackSources: priorities.focus,
          })
        : selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts: [...usedTexts, focus, objective].filter(
              (value): value is string => Boolean(value),
            ),
            preferredSources: priorities.evidence,
            fallbackSources: priorities.focus,
          })
      : undefined;
    if (evidenceSeed) {
      usedSeedIds.add(evidenceSeed.id);
    }
    const evidence =
      evidenceSeed &&
      normalizeComparableText(evidenceSeed.text) !== normalizeComparableText(focus) &&
      normalizeComparableText(evidenceSeed.text) !== normalizeComparableText(objective)
        ? evidenceSeed.text
        : undefined;

    contracts.push({
      index,
      label: buildSlideContractLabel(kind, storyline[index]),
      kind,
      focus,
      ...(objective && objective !== focus
        ? { objective: sanitizeContractText(objective, subject) }
        : {}),
      ...(evidence ? { evidence } : {}),
      ...(distinctFrom.length > 0 ? { distinctFrom } : {}),
    });
    usedTexts.push(focus);
    if (objective && objective !== focus) {
      usedTexts.push(objective);
    }
    if (evidence) {
      usedTexts.push(evidence);
    }
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
    }${contract.evidence ? ` Evidence anchor: ${contract.evidence}.` : ""}`,
  );
};

const buildContractTitle = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const fallbackTitle = (() => {
    switch (contract.kind) {
      case "procedural-ingredients":
        return "Essential ingredients";
      case "procedural-steps":
        return "Key preparation steps";
      case "procedural-quality":
        return "Taste, texture, and adjustment";
      case "subject-detail":
        return "Concrete detail";
      case "subject-implication":
        return "Why it matters";
      case "subject-takeaway":
        return "Key takeaway";
      case "entity-capabilities":
        return workshop ? "Role-based AI use cases" : "Core capabilities and focus areas";
      case "entity-operations":
        return workshop ? "Constraints and safe use" : "How it works in practice";
      case "entity-value":
        return "Where it creates value";
      case "workshop-practice":
        return "Practical exercise";
      default:
        return "";
    }
  })();

  if (contract.kind === "procedural-ingredients") {
    return "Essential ingredients";
  }
  if (contract.kind === "procedural-steps") {
    return "Key preparation steps";
  }
  if (contract.kind === "procedural-quality") {
    return "Taste, texture, and adjustment";
  }
  if (contract.index === 0) {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus, focusAnchor],
      { preferConcrete: true },
    );
    if (
      focus &&
      !isGenericOpeningFocus(subject, focus) &&
      focus.length <= 72 &&
      !/[.?!]/.test(focus)
    ) {
      return shortenTitlePhrase(focus, 72);
    }

    if (arcPolicy === "source-backed-subject" && focusAnchor) {
      const fallbackFocus = shortenTitlePhrase(focusAnchor, 72);
      if (fallbackFocus && !/[.?!]/.test(fallbackFocus)) {
        return fallbackFocus;
      }
    }

    return shortenTitlePhrase(subject, 72);
  }

  const preferredSource = (() => {
    const focus = sanitizeContractText(contract.focus, subject);
    const objective = contract.objective
      ? sanitizeContractText(contract.objective, subject)
      : "";

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
    return fallbackTitle || `Slide ${contract.index + 1}`;
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

  return fallbackTitle || shortenTitlePhrase(normalized, 72);
};

const scoreContractConcretePoint = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  point: string,
): number => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const anchors = uniqueNonEmptyStrings([
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    contract.kind === "subject-detail" ||
    contract.kind === "subject-implication" ||
    contract.kind === "subject-takeaway"
      ? focusAnchor ?? ""
      : "",
    subject,
  ]);
  const pointTokens = [...new Set(tokenizeDeckShapeText(point))];
  const contractEchoPenalty = [contract.focus, contract.objective ?? "", contract.evidence ?? ""]
    .filter((anchor) => anchor.length > 0)
    .reduce((penalty, anchor) => {
      const anchorTokens = new Set(tokenizeDeckShapeText(anchor));
      if (anchorTokens.size === 0 || pointTokens.length === 0) {
        return penalty;
      }

      const similarity = contractTextSimilarity(point, anchor);
      const novelTokenCount = pointTokens.filter((token) => !anchorTokens.has(token)).length;
      return similarity >= 0.82 && novelTokenCount <= 1 ? Math.min(penalty, -8) : penalty;
    }, 0);

  const focusOverlap = countAnchorOverlap(point, contract.focus);
  const objectiveOverlap = contract.objective
    ? countAnchorOverlap(point, contract.objective)
    : 0;
  const evidenceOverlap = contract.evidence
    ? countAnchorOverlap(point, contract.evidence)
    : 0;
  const totalOverlap = anchors.reduce(
    (sum, anchor) => sum + countAnchorOverlap(point, anchor),
    0,
  );
  const meaningfulOverlap = anchors.some((anchor) =>
    hasMeaningfulAnchorOverlap(point, anchor),
  )
    ? 3
    : 0;
  const lengthScore = point.length >= 52 ? 2 : point.length >= 36 ? 1 : 0;
  const summaryPenalty = DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point))
    ? -4
    : 0;
  const promoPenalty = PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(point))
    ? -6
    : 0;

  switch (contract.kind) {
    case "entity-value":
      return (
        evidenceOverlap * 6 +
        objectiveOverlap * 3 +
        focusOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty
      );
    case "workshop-practice":
      return (
        objectiveOverlap * 5 +
        evidenceOverlap * 4 +
        focusOverlap * 3 +
        totalOverlap +
        meaningfulOverlap +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty
      );
    case "entity-operations":
      return (
        objectiveOverlap * 4 +
        focusOverlap * 3 +
        evidenceOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty
      );
    default:
      return (
        focusOverlap * 3 +
        objectiveOverlap * 2 +
        evidenceOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty
      );
  }
};

const isWeakContractEchoPoint = (
  contract: SlideContract,
  point: string,
): boolean => {
  const pointTokens = [...new Set(tokenizeDeckShapeText(point))];
  if (pointTokens.length === 0) {
    return false;
  }

  return [contract.focus, contract.objective ?? "", contract.evidence ?? ""]
    .filter((anchor) => anchor.length > 0)
    .some((anchor) => {
      const anchorTokens = new Set(tokenizeDeckShapeText(anchor));
      if (anchorTokens.size === 0) {
        return false;
      }

      const similarity = contractTextSimilarity(point, anchor);
      const novelTokenCount = pointTokens.filter((token) => !anchorTokens.has(token)).length;
      return similarity >= 0.82 && novelTokenCount <= 1;
    });
};

const rankContractConcretePoints = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  concretePointPool: string[],
): string[] =>
  uniqueNonEmptyStrings(concretePointPool)
    .filter(
      (point) =>
        !looksFragmentarySlidePoint(point) &&
        !(contract.kind === "orientation" && isWeakContractEchoPoint(contract, point)) &&
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)),
    )
    .map((point, index) => ({
      point,
      index,
      score: scoreContractConcretePoint(input, contract, point),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.point.length !== right.point.length) {
        return right.point.length - left.point.length;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.point);

const buildContractAnchoredKeyPoints = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  concretePointPool: string[],
): string[] => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const focus = sanitizeContractText(contract.focus, subject);
  const objective = contract.objective
    ? sanitizeContractText(contract.objective, subject)
    : "";
  const evidence = contract.evidence
    ? sanitizeContractText(contract.evidence, subject)
    : "";
  const lowerFocus = lowerCaseFirstCharacter(focus);
  const anchorStatements = (() => {
    switch (contract.kind) {
      case "orientation":
        return [];
      case "subject-detail":
        return [
          focus
            ? `${focus} is one concrete detail that makes ${subject} specific.`
            : focusAnchor
              ? `${focusAnchor} is one concrete detail that makes ${subject} specific.`
              : "",
          objective && objective !== focus
            ? `${objective} becomes clearer when that concrete detail is examined closely.`
            : "",
        ];
      case "subject-implication":
        return [
          focus
            ? `${focus} explains what the earlier detail changes, reveals, or means within ${subject}.`
            : "",
          objective && objective !== focus
            ? `${objective} should interpret the detail rather than restate it.`
            : "",
          focusAnchor
            ? `The explanation should build on ${focusAnchor} instead of reopening the broad subject from scratch.`
            : "",
        ];
      case "subject-takeaway":
        return [
          focus
            ? `${focus} ties the strongest lesson from ${subject} to the earlier concrete detail.`
            : "",
          objective && objective !== focus
            ? `${objective} becomes clearer when the main detail and implication are brought together.`
            : "",
          focusAnchor
            ? `The main takeaway should grow out of ${focusAnchor} rather than introducing a different case.`
            : "",
        ];
      case "coverage":
      case "development":
        return [
          focus ? `${focus} is one concrete part of ${subject}.` : "",
          objective && objective !== focus
            ? `${objective} becomes clearer when ${lowerFocus || "this area"} is examined closely.`
            : "",
        ];
      case "procedural-ingredients":
        return [
          focus
            ? `${focus} shape the balance, texture, or overall character of ${subject.toLowerCase()}.`
            : "",
          objective && objective !== focus
            ? `${objective} depends on how those inputs work together.`
            : "",
        ];
      case "procedural-steps":
        return [
          focus
            ? `${focus} changes texture, consistency, or how evenly the result comes together.`
            : "",
          objective && objective !== focus
            ? `${objective} depends on what each step changes in the mixture.`
            : "",
        ];
      case "procedural-quality":
        return [
          focus
            ? `${focus} show whether ${subject.toLowerCase()} feels balanced or uneven.`
            : "",
          objective && objective !== focus
            ? `${objective} comes from small changes that can be checked and adjusted.`
            : "",
        ];
      case "synthesis":
        return [
          focus ? `${focus} captures one of the strongest takeaways from ${subject}.` : "",
          objective && objective !== focus
            ? `${objective} is easier to remember when the main ideas are tied together clearly.`
            : "",
        ];
      case "entity-capabilities":
        return [
          workshop
            ? focus
              ? `${focus} show where ${subject} fits into real day-to-day work rather than abstract tool talk.`
              : ""
            : focus
              ? `${focus} show what ${subject} offers through concrete capabilities, services, or responsibilities.`
              : "",
          objective && objective !== focus
            ? workshop
              ? `${objective} becomes clearer when the slide stays close to role-based tasks and outputs.`
              : `${objective} becomes clearer when those capabilities are made explicit.`
            : "",
        ];
      case "entity-operations":
        return [
          workshop
            ? focus
              ? `${focus} reveal how ${subject} stays safe, reviewable, and policy-aware in day-to-day use.`
              : ""
            : focus
              ? `${focus} reveal how ${subject} works through delivery, teamwork, or day-to-day operating methods.`
              : "",
          objective && objective !== focus
            ? workshop
              ? `${objective} depends on concrete guardrails, review steps, or approved-tool boundaries rather than broad benefits.`
              : `${objective} depends on concrete operating detail rather than broad slogans.`
            : "",
        ];
      case "entity-value":
        return [
          focus
            ? `${focus} show the practical value or outcome created by ${subject}.`
            : "",
          objective && objective !== focus
            ? `${objective} becomes clearer when the slide stays close to one concrete example or consequence.`
            : "",
        ];
      case "workshop-practice":
        return [
          focus
            ? `${focus} gives the audience one concrete way to apply the ideas from ${subject}.`
            : "",
          objective && objective !== focus
            ? `${objective} should turn the slide into applied practice rather than summary.`
            : "",
        ];
      default:
        return [];
    }
  })();
  const fallbackStatements = (() => {
    switch (contract.kind) {
      case "orientation":
        return organizationArc
          ? workshop
            ? [
                `Role-based daily work becomes easier to understand when the opening names where ${subject} fits and what it helps people produce.`,
                `A concrete workflow example shows how ${subject} connects to planning, coordination, analysis, or testing work.`,
                `The opening becomes clearer when it ties the organization context to one recognizable use case instead of jumping straight to policy.`,
              ]
            : [
                `${subject} becomes easier to understand when the opening names what the organization is, what it offers, and one recognizable example.`,
                `Concrete services and customer-facing outcomes show where ${subject} creates value more clearly than broad company language does.`,
                `An onboarding opening works best when it identifies the organization before it expands into capabilities or outcomes.`,
              ]
          : [
              `${subject} is easier to understand when its purpose, structure, and one concrete example are visible together.`,
              `A concrete consequence, responsibility, or example shows why ${subject} matters.`,
              `${subject} becomes clearer when people can name what it is and what it changes.`,
            ];
      case "subject-detail":
        return [
          `A strong detail slide stays close to one concrete part, event, or mechanism instead of trying to summarize everything at once.`,
          `Specific evidence makes ${subject} easier to understand than broad restatement does.`,
          `One recognizable detail gives the rest of the explanation something concrete to build on.`,
        ];
      case "subject-implication":
        return [
          `An implication slide should explain what the earlier detail changes, reveals, or teaches.`,
          `Consequence and significance make the subject clearer than repeating the same description.`,
          `A strong explanatory slide interprets the concrete detail instead of naming it again.`,
        ];
      case "subject-takeaway":
        return [
          `The clearest takeaway ties the concrete detail to the larger lesson the audience should retain.`,
          `A strong final subject slide should connect earlier evidence and implication instead of reopening the same description.`,
          `The takeaway is easier to remember when it names what the subject teaches, not just what happened.`,
        ];
      case "procedural-ingredients":
        return [
          `The starting inputs determine the balance, texture, and final character of ${subject.toLowerCase()}.`,
          `Different inputs change different parts of the final result.`,
          `A strong result depends on inputs that support the same overall goal.`,
        ];
      case "procedural-steps":
        return [
          `The order of the main steps changes texture, consistency, or reliability in ${subject.toLowerCase()}.`,
          `Each step alters the final result in a specific way.`,
          `Preparation is easier to control when each step has a clear purpose.`,
        ];
      case "procedural-quality":
        return [
          `Final quality depends on balance, texture, and small adjustments.`,
          `Small adjustments can change whether ${subject.toLowerCase()} feels balanced or uneven.`,
          `A finished result is easier to recognize when you know what good balance looks like.`,
        ];
      case "synthesis":
        return [
          `The most important lessons about ${subject} are easier to retain when they are tied together clearly.`,
          `The key ideas from ${subject} reinforce one another instead of standing alone.`,
          `A strong summary of ${subject} connects value, structure, and example.`,
        ];
      case "entity-capabilities":
        return [
          workshop
            ? `A strong workshop use-case slide names real daily tasks, role situations, or outputs instead of broad tool claims.`
            : `Specific capabilities and service areas explain what ${subject} actually does.`,
          workshop
            ? `Role-based examples make ${subject} easier to apply than abstract tool language does.`
            : `Concrete responsibilities make ${subject} easier to recognize than broad company language does.`,
          workshop
            ? `The clearest use-case slide stays close to planning, documentation, analysis, prioritization, or testing work.`
            : `A strong capability slide names real areas of work instead of repeating general value claims.`,
        ];
      case "entity-operations":
        return [
          workshop
            ? `Guardrails, review steps, and approved-tool boundaries show how ${subject} can be used safely in practice.`
            : `Operational detail shows how ${subject} works beyond slogans or broad claims.`,
          workshop
            ? `A practical constraint slide should show what must be checked before an AI-assisted result is trusted or shared.`
            : `Delivery methods, customer collaboration, or internal process make the operating model visible.`,
          workshop
            ? `Safe day-to-day use becomes clearer when policy, privacy, and review are treated as part of the workflow.`
            : `A practical operating slide should show how the work is carried out, not only why it matters.`,
        ];
      case "entity-value":
        return [
          `A concrete customer outcome or example shows why ${subject} matters in practice.`,
          `Specific consequences make the value of ${subject} clearer than broad marketing language does.`,
          `The strongest value slide ties the organization to one recognizable result or scenario.`,
        ];
      case "workshop-practice":
        return [
          `A practical task helps the audience apply the central ideas from ${subject}.`,
          `The exercise should produce a concrete output, decision, or discussion rather than another summary.`,
          `Applied practice makes it easier to retain the main ideas from the presentation.`,
        ];
      default:
        return [
          focus
            ? `${focus} is one concrete part of ${subject}.`
            : `One concrete area makes ${subject} easier to understand.`,
          focus
            ? `${focus} changes what people notice, decide, or do around ${subject}.`
            : `${subject} becomes clearer when one concrete mechanism or consequence is examined closely.`,
          objective && objective !== focus
            ? `${objective} is one practical reason this part of ${subject} matters.`
            : `${subject} becomes clearer when its mechanisms, roles, or consequences are made explicit.`,
        ];
    }
  })();
  const rankedConcretePoints = rankContractConcretePoints(
    input,
    contract,
    concretePointPool,
  );
  const orientationConcretePoints =
    contract.kind === "orientation"
      ? rankedConcretePoints.filter(
          (point) =>
            ![focus, objective]
              .filter((anchor) => anchor.length > 0)
              .some((anchor) => contractTextSimilarity(point, anchor) >= 0.6),
        )
      : rankedConcretePoints;

  return uniqueNonEmptyStrings(
    [
      ...(orientationConcretePoints.length > 0
        ? orientationConcretePoints
        : rankedConcretePoints
      ).map((point) => toAudienceFacingSentence(point)),
      ...anchorStatements
        .filter((statement) => statement.length > 0)
        .map((statement) => toAudienceFacingSentence(statement)),
      evidence && !looksFragmentarySlidePoint(evidence)
        ? toAudienceFacingSentence(evidence)
        : null,
      objective && !looksFragmentarySlidePoint(objective)
        ? toAudienceFacingSentence(objective)
        : null,
      focus && !looksFragmentarySlidePoint(focus) ? toAudienceFacingSentence(focus) : null,
      ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 3);
};

const buildContractLearningGoal = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  if (input.intent?.contentMode === "procedural" && contract.index === 0) {
    return `See which ingredients, steps, and final adjustments define ${subject.toLowerCase()}.`;
  }
  if (contract.kind === "procedural-ingredients") {
    return `See which inputs shape the flavor, balance, and texture of ${subject.toLowerCase()}.`;
  }
  if (contract.kind === "procedural-steps") {
    return `See what the main preparation steps change in ${subject.toLowerCase()}.`;
  }
  if (contract.kind === "procedural-quality") {
    return `See which cues show whether ${subject.toLowerCase()} is balanced and finished.`;
  }
  if (contract.kind === "subject-detail") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See one concrete detail that defines ${subject}.`
      : `See how ${lowerCaseFirstCharacter(focus)} makes ${subject} concrete.`;
  }
  if (contract.kind === "subject-implication") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See why ${subject} matters and what it reveals.`
      : `See why ${lowerCaseFirstCharacter(focus)} matters within ${subject}.`;
  }
  if (contract.kind === "subject-takeaway") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See the strongest takeaway from ${subject}.`
      : `See what ${lowerCaseFirstCharacter(focus)} teaches about ${subject}.`;
  }
  if (contract.kind === "entity-capabilities") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? workshop
        ? `See where ${subject} helps in daily work for different roles.`
        : `See what ${subject} does and which capabilities define it.`
      : workshop
        ? `See where ${lowerCaseFirstCharacter(focus)} helps in daily work.`
        : `See how ${lowerCaseFirstCharacter(focus)} shows what ${subject} offers.`;
  }
  if (contract.kind === "entity-operations") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? workshop
        ? `See which constraints and review steps keep ${subject} safe in daily work.`
        : `See how ${subject} works in practice.`
      : workshop
        ? `See how ${lowerCaseFirstCharacter(focus)} keeps ${subject} safe in daily work.`
        : `See how ${lowerCaseFirstCharacter(focus)} shows how ${subject} works in practice.`;
  }
  if (contract.kind === "entity-value") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See one concrete example of how ${subject} creates value.`
      : `See how ${lowerCaseFirstCharacter(focus)} shows where ${subject} creates value.`;
  }
  if (contract.kind === "workshop-practice") {
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `Practice one concrete way to apply ${subject}.`
      : `Practice ${lowerCaseFirstCharacter(focus)}.`;
  }
  const focus = pickContractText(
    input,
    [contract.objective, contract.focus],
    { preferConcrete: true },
  );
  if (contract.index === 0) {
    if (focus && !isGenericOpeningFocus(subject, focus)) {
      if (arcPolicy === "source-backed-subject") {
        return normalizeComparableText(focus) === normalizeComparableText(subject)
          ? focusAnchor
            ? `See how ${lowerCaseFirstCharacter(focusAnchor)} frames the concrete case within ${subject}.`
            : `See the concrete setup that anchors ${subject}.`
          : `See how ${lowerCaseFirstCharacter(focus)} frames the concrete case within ${subject}.`;
      }
      return hasMeaningfulAnchorOverlap(focus, subject)
        ? `See ${lowerCaseFirstCharacter(focus)} and why it matters.`
        : `See how ${lowerCaseFirstCharacter(focus)} matters within ${subject}.`;
    }

    if (arcPolicy === "source-backed-subject" && focusAnchor) {
      return `See how ${lowerCaseFirstCharacter(focusAnchor)} anchors the story of ${subject}.`;
    }

    return `See what ${subject} is, why it matters, and one concrete way to recognize it.`;
  }
  if (!focus) {
    return `See one concrete part of ${subject}.`;
  }

  if (
    focus.toLowerCase().includes(subject.toLowerCase()) ||
    /^(?:how|why|what|when|where|who)\b/i.test(focus)
  ) {
    return `See ${lowerCaseFirstCharacter(focus)}.`;
  }

  return hasMeaningfulAnchorOverlap(focus, subject)
    ? `See how ${lowerCaseFirstCharacter(focus)} shapes ${subject}.`
    : `See how ${lowerCaseFirstCharacter(focus)} fits within ${subject}.`;
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

const buildProceduralOrientationKeyPoints = (subject: string): string[] =>
  uniqueNonEmptyStrings([
    toAudienceFacingSentence(
      `The starting ingredients and inputs shape ${subject.toLowerCase()} before any main steps begin`,
    ),
    toAudienceFacingSentence(
      `The sequence of preparation steps changes texture, balance, and consistency`,
    ),
    toAudienceFacingSentence(
      `Final tasting and adjustment determine when ${subject.toLowerCase()} is ready`,
    ),
  ]).slice(0, 3);

const buildOrientationSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const title = buildContractTitle(input, contract);
  if (input.intent?.contentMode === "procedural") {
    const keyPoints = buildProceduralOrientationKeyPoints(subject);
  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal: buildContractLearningGoal(input, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [],
    beginnerExplanation: keyPoints.slice(0, 2).join(" "),
    advancedExplanation: keyPoints[2] ?? "",
    id: slide.id,
    order: slide.order,
  };
  }
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
  const laterSlideSupport = uniqueNonEmptyStrings(
    deck.slides
      .slice(1)
      .flatMap((candidateSlide) => [
        ...candidateSlide.keyPoints,
        ...candidateSlide.examples,
        candidateSlide.beginnerExplanation,
      ])
      .filter(
        (value) =>
          value.length >= 28 &&
          !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
          !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)) &&
          !PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value)),
      ),
  ).slice(0, 2);
  const keyPoints = uniqueNonEmptyStrings(
    [
      ...laterSlideSupport,
      ...coverageAnchors.map((anchor) => buildOrientationCoveragePoint(subject, anchor)),
      input.plan?.learningObjectives?.[0]
        ? toAudienceFacingSentence(input.plan.learningObjectives[0])
        : null,
      deck.summary,
      toAudienceFacingSentence(
        `${subject} becomes easier to recognize when one concrete consequence, example, or responsibility is visible`,
      ),
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 3);
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because it changes real decisions, behavior, or outcomes`,
    );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal: buildContractLearningGoal(input, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

const shouldUseDeterministicSubjectOverviewSlide = (
  input: GenerateDeckInput,
  slide: Slide,
  contract: SlideContract,
): boolean => {
  if (input.intent?.presentationFrame === "organization") {
    return false;
  }

  if (slide.order !== 1) {
    return false;
  }

  if (deriveSlideArcPolicy(input) === "source-backed-subject") {
    return false;
  }

  if (
    resolveIntentFocusAnchor(input) ||
    (input.groundingHighlights?.length ?? 0) > 0 ||
    (input.groundingCoverageGoals?.length ?? 0) > 0
  ) {
    return false;
  }

  const subject = resolveIntentSubject(input);
  const contractAnchor = [subject, contract.focus, contract.objective ?? ""].join(" ");
  const title = slide.title.trim();
  const learningGoal = slide.learningGoal.trim();
  const titleLooksGeneric =
    tokenizeDeckShapeText(title).length <= 3 &&
    !hasMeaningfulAnchorOverlap(title, contractAnchor);
  const goalLooksGeneric =
    tokenizeDeckShapeText(learningGoal).length <= 6 &&
    !hasMeaningfulAnchorOverlap(learningGoal, contractAnchor);
  const anchoredKeyPoints = slide.keyPoints.filter((point) =>
    hasMeaningfulAnchorOverlap(point, contractAnchor),
  );

  return titleLooksGeneric && goalLooksGeneric && anchoredKeyPoints.length < 2;
};

const buildSubjectOverviewSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const normalizedContractTitle = buildContractTitle(input, contract);
  const title = hasMeaningfulAnchorOverlap(
    slide.title,
    `${subject} ${contract.focus} ${contract.objective ?? ""}`,
  )
    ? slide.title.trim()
    : normalizedContractTitle;
  const isOverviewSlide = slide.order === 1;
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
    toAudienceFacingSentence(`One concrete mechanism or event reveals how ${subject} behaves in practice.`),
  ]).slice(0, 3);
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because its structure leads to real outcomes, examples, or decisions`,
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
    likelyQuestions: [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

const buildRoleSpecificSlideRecoveryFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> | null => {
  if (
    contract.kind !== "entity-capabilities" &&
    contract.kind !== "entity-operations" &&
    contract.kind !== "entity-value" &&
    contract.kind !== "subject-detail" &&
    contract.kind !== "workshop-practice" &&
    contract.kind !== "subject-implication" &&
    contract.kind !== "subject-takeaway"
  ) {
    return null;
  }

  const subject = resolveIntentSubject(input);
  const roleAnchor = [contract.focus, contract.objective ?? "", contract.evidence ?? ""].join(" ");
  const pointPool = uniqueNonEmptyStrings(
    [
      contract.evidence,
      contract.objective,
      contract.focus,
      ...(input.groundingHighlights ?? []),
      ...(input.groundingCoverageGoals ?? []),
      ...(input.plan?.learningObjectives ?? []),
      ...(input.plan?.storyline ?? []),
      ...deck.slides
        .slice(0, slide.order)
        .flatMap((candidateSlide) => [
          ...candidateSlide.examples,
          ...candidateSlide.keyPoints,
        ]),
    ].filter((value): value is string => Boolean(value)),
  ).filter(
    (value) =>
      value.length >= 24 &&
      !PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)) &&
      hasMeaningfulAnchorOverlap(value, `${subject} ${roleAnchor}`),
  );

  const anchoredPoints = buildContractAnchoredKeyPoints(
    input,
    contract,
    pointPool,
  );

  if (anchoredPoints.length < 3) {
    return null;
  }

  const examplePool = pointPool.filter((value) => value.length >= 40);
  const examples =
    contract.kind === "workshop-practice"
      ? uniqueNonEmptyStrings([
          contract.evidence ?? "",
          ...examplePool,
        ]).slice(0, 3)
      : uniqueNonEmptyStrings([
          contract.evidence ?? "",
          ...examplePool,
        ]).slice(0, 2);
  const beginnerExplanation = toAudienceFacingSentence(
    `${anchoredPoints[0]} ${anchoredPoints[1]}`,
  );
  const advancedExplanation = toAudienceFacingSentence(
    contract.kind === "workshop-practice"
      ? `${anchoredPoints[2]} This keeps the slide focused on one applied task rather than another summary.`
      : contract.kind === "entity-capabilities"
        ? `${anchoredPoints[2]} This keeps the slide focused on concrete capabilities instead of broad organization messaging.`
      : contract.kind === "entity-operations"
        ? `${anchoredPoints[2]} This keeps the slide focused on operating detail instead of repeating a general value claim.`
      : contract.kind === "subject-detail"
        ? `${anchoredPoints[2]} This keeps the slide focused on one concrete detail instead of jumping straight to interpretation.`
      : contract.kind === "subject-implication"
        ? `${anchoredPoints[2]} This keeps the slide focused on grounded consequence or significance instead of repeating the same detail or expanding into unsupported broader claims.`
      : contract.kind === "subject-takeaway"
        ? `${anchoredPoints[2]} This keeps the slide focused on the lesson the audience should retain without drifting beyond the grounded case.`
      : `${anchoredPoints[2]} This keeps the slide grounded in one concrete outcome instead of broad organization messaging.`,
  );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: buildContractTitle(input, contract),
    learningGoal: buildContractLearningGoal(input, contract),
    keyPoints: anchoredPoints,
    speakerNotes: [],
    examples,
    likelyQuestions: [],
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
      contract.evidence,
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
    likelyQuestions: [],
    beginnerExplanation: toAudienceFacingSentence(`${anchoredPoints[0]} ${anchoredPoints[1]}`),
    advancedExplanation: toAudienceFacingSentence(
      `${anchoredPoints[2]} This detail shows why the slide matters within ${subject}.`,
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
    contract.evidence ?? "",
    resolveIntentSubject(input),
  ]);

const matchesAnySlideAnchor = (value: string, anchors: string[]): boolean =>
  anchors.some(
    (anchor) =>
      countAnchorOverlap(value, anchor) >= 2 || hasMeaningfulAnchorOverlap(value, anchor),
  );

const buildContractRoleAnchors = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string[] => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  return uniqueNonEmptyStrings([
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    organizationArc && contract.kind === "orientation"
      ? input.intent?.presentationGoal ?? ""
      : "",
    ...(organizationArc && contract.kind === "orientation"
      ? input.intent?.audienceCues ?? []
      : []),
    contract.kind === "subject-detail" ||
    contract.kind === "subject-implication" ||
    contract.kind === "subject-takeaway"
      ? focusAnchor ?? ""
      : "",
  ]).filter((anchor) => normalizeComparableText(anchor) !== normalizeComparableText(subject));
};

const buildSourceBackedGroundingAnchors = (
  input: Pick<
    GenerateDeckInput,
    "topic" | "intent" | "groundingHighlights" | "groundingCoverageGoals"
  >,
  contract: SlideContract,
): string[] => {
  if (deriveSlideArcPolicy(input) !== "source-backed-subject") {
    return [];
  }

  return uniqueNonEmptyStrings([
    contract.evidence ?? "",
    resolveIntentFocusAnchor(input) ?? "",
    ...(input.groundingCoverageGoals ?? []),
    ...(input.groundingHighlights ?? []).slice(0, 5),
  ]).filter(
    (anchor) =>
      normalizeComparableText(anchor) !== normalizeComparableText(resolveIntentSubject(input)),
  );
};

const countSalientAnchorOverlap = (value: string, anchor: string): number => {
  const left = [...new Set(tokenizeDeckShapeText(value))].filter(
    (token) => token.length >= 4 || /\p{N}/u.test(token),
  );
  const right = new Set(
    tokenizeDeckShapeText(anchor).filter(
      (token) => token.length >= 4 || /\p{N}/u.test(token),
    ),
  );

  if (left.length === 0 || right.size === 0) {
    return 0;
  }

  return left.filter((token) => right.has(token)).length;
};

const matchesStrictGroundedAnchor = (value: string, anchors: string[]): boolean =>
  anchors.some((anchor) => countSalientAnchorOverlap(value, anchor) >= 2);

const slideDraftDistinctnessText = (slide: Record<string, unknown> | Slide): string =>
  [
    typeof slide.title === "string" ? slide.title : "",
    typeof slide.learningGoal === "string" ? slide.learningGoal : "",
    ...toStringArray(slide.keyPoints),
    typeof slide.beginnerExplanation === "string" ? slide.beginnerExplanation : "",
    typeof slide.advancedExplanation === "string" ? slide.advancedExplanation : "",
    ...toStringArray(slide.examples),
  ].join(" ");

const slideDistinctnessOverlapRatio = (
  leftSlide: Record<string, unknown> | Slide,
  rightSlide: Record<string, unknown> | Slide,
): number => {
  const leftTokens = [...new Set(tokenizeDeckShapeText(slideDraftDistinctnessText(leftSlide)))];
  const rightTokens = [...new Set(tokenizeDeckShapeText(slideDraftDistinctnessText(rightSlide)))];

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
};

const assessGeneratedSlideDraft = (
  input: Pick<
    GenerateDeckInput,
    "topic" | "intent" | "groundingHighlights" | "groundingCoverageGoals"
  >,
  deck: Deck,
  contract: SlideContract,
  slide: Record<string, unknown>,
): SlideDraftAssessment => {
  const title = typeof slide.title === "string" ? slide.title.trim() : "";
  const learningGoal =
    typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
  const expectedTitle = buildContractTitle(input, contract);
  const expectedLearningGoal = buildContractLearningGoal(input, contract);
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
  const roleAnchors = buildContractRoleAnchors(input, contract);
  const sourceBackedGroundingAnchors = buildSourceBackedGroundingAnchors(input, contract);
  const activeInstructionalPatterns = getActiveInstructionalPatterns(input);
  const instructionalKeyPoints = keyPoints.filter((point) =>
    activeInstructionalPatterns.some((pattern) => pattern.test(point)),
  );
  const fragmentaryKeyPoints = keyPoints.filter((point) =>
    looksFragmentarySlidePoint(point),
  );
  const weaklyAnchoredKeyPoints = keyPoints.filter(
    (point) => !matchesAnySlideAnchor(point, localAnchors),
  );
  const earlierSlides = deck.slides.slice(0, contract.index);
  const repetitiveEarlierSlides = earlierSlides.filter(
    (previousSlide) => slideDistinctnessOverlapRatio(slide, previousSlide) >= 0.72,
  );
  const roleAlignedKeyPointCount = keyPoints.filter((point) =>
    matchesAnySlideAnchor(point, roleAnchors),
  ).length;
  const examples = toStringArray(slide.examples);
  const roleAlignedExampleCount = examples.filter((example) =>
    matchesAnySlideAnchor(example, roleAnchors),
  ).length;
  const enforceOrientationRoleAlignment =
    contract.kind === "orientation" &&
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const workshopOrientationAudienceAnchors =
    enforceOrientationRoleAlignment &&
    isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
      ? uniqueNonEmptyStrings(input.intent?.audienceCues ?? [])
      : [];
  const matchesAudienceAnchor = (value: string): boolean =>
    workshopOrientationAudienceAnchors.some((anchor) => {
      const anchorTokenCount = new Set(
        tokenizeDeckShapeText(anchor).filter(
          (token) => token.length >= 4 || /\p{N}/u.test(token),
        ),
      ).size;
      if (anchorTokenCount === 0) {
        return false;
      }

      return countSalientAnchorOverlap(value, anchor) >= Math.min(2, anchorTokenCount);
    });
  const audienceAlignedKeyPointCount = workshopOrientationAudienceAnchors.length
    ? keyPoints.filter((point) =>
        matchesAudienceAnchor(point),
      ).length
    : 0;
  const audienceAlignedExampleCount = workshopOrientationAudienceAnchors.length
    ? examples.filter((example) =>
        matchesAudienceAnchor(example),
      ).length
    : 0;
  const titleOrGoalMatchesRole =
    matchesAnySlideAnchor(title, roleAnchors) ||
    matchesAnySlideAnchor(learningGoal, roleAnchors);
  const evidenceAnchorMatched =
    !contract.evidence ||
    matchesAnySlideAnchor(title, [contract.evidence]) ||
    matchesAnySlideAnchor(learningGoal, [contract.evidence]) ||
    keyPoints.some((point) => matchesAnySlideAnchor(point, [contract.evidence!])) ||
    examples.some((example) =>
      matchesAnySlideAnchor(example, [contract.evidence!]),
    );
  const evidenceAlignedExampleCount = contract.evidence
    ? examples.filter((example) => matchesAnySlideAnchor(example, [contract.evidence!])).length
    : 0;
  const evidenceAlignedKeyPointCount = contract.evidence
    ? keyPoints.filter((point) => matchesAnySlideAnchor(point, [contract.evidence!])).length
    : 0;
  const sourceGroundedKeyPointCount = keyPoints.filter((point) =>
    matchesStrictGroundedAnchor(point, sourceBackedGroundingAnchors),
  ).length;
  const sourceGroundedExampleCount = examples.filter((example) =>
    matchesStrictGroundedAnchor(example, sourceBackedGroundingAnchors),
  ).length;
  const titleOrGoalMatchesGrounding =
    matchesStrictGroundedAnchor(title, sourceBackedGroundingAnchors) ||
    matchesStrictGroundedAnchor(learningGoal, sourceBackedGroundingAnchors);
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
    (!matchesAnySlideAnchor(title, localAnchors.filter((anchor) => anchor !== title)) &&
      title.toLowerCase() !== expectedTitle.toLowerCase())
  ) {
    reasons.push(
      "Rewrite the title so it clearly names the concrete subject area of this slide.",
    );
  }

  if (
    learningGoal &&
    learningGoal.toLowerCase() === expectedLearningGoal.toLowerCase()
  ) {
    const awkwardLearningGoalReasonIndex = reasons.findIndex((reason) =>
      reason.includes("Rewrite the learning goal"),
    );
    if (awkwardLearningGoalReasonIndex >= 0) {
      reasons.splice(awkwardLearningGoalReasonIndex, 1);
    }
  }

  if (
    keyPoints.length < 3 ||
    keyPoints.some(
      (point) =>
        PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(point)) ||
        DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)),
    ) ||
    keyPoints.filter((point) => matchesAnySlideAnchor(point, localAnchors)).length < 1
  ) {
    reasons.push(
      "Rewrite the key points as three complete, concrete claims tightly tied to this slide's subject.",
    );
  }

  if (instructionalKeyPoints.length > 0) {
    reasons.push(
      "One or more key points still read like commands. Rewrite them as observations, mechanisms, or cues rather than actions for the audience to take.",
    );
  }

  if (fragmentaryKeyPoints.length > 0) {
    reasons.push(
      "At least one key point is still fragmentary. Rewrite every key point as a full explanatory sentence.",
    );
  }

  if (weaklyAnchoredKeyPoints.length >= 2) {
    reasons.push(
      "The key points are not specific enough to this slide. Tie them more directly to the slide title, focus, and learning goal.",
    );
  }

  if (
    (contract.kind !== "orientation" || enforceOrientationRoleAlignment) &&
    roleAnchors.length > 0 &&
    !titleOrGoalMatchesRole
  ) {
    reasons.push(
      "The title and learning goal drift away from the slide's assigned role. Keep them anchored to the contract focus and objective for this slide.",
    );
  }

  if (
    (contract.kind !== "orientation" || enforceOrientationRoleAlignment) &&
    roleAnchors.length > 0 &&
    roleAlignedKeyPointCount < Math.min(2, keyPoints.length)
  ) {
    reasons.push(
      "The key points do not stay close enough to the slide's assigned role. Keep at least two of them anchored to this slide's focus, objective, or evidence.",
    );
  }

  if (
    workshopOrientationAudienceAnchors.length > 0 &&
    audienceAlignedKeyPointCount + audienceAlignedExampleCount === 0
  ) {
    reasons.push(
      "The workshop opening needs at least one role-based example or audience-specific task so the audience can recognize where the topic fits into their daily work.",
    );
  }

  if (!evidenceAnchorMatched) {
    reasons.push(
      "The slide lost the concrete evidence anchor that should make this role specific. Rebuild it around the assigned evidence rather than broad restatement.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    contract.evidence &&
    evidenceAlignedKeyPointCount + evidenceAlignedExampleCount < 2
  ) {
    reasons.push(
      "A value slide must stay centered on one concrete example or outcome. Tie at least two visible elements to the assigned evidence anchor.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    contract.evidence &&
    !matchesAnySlideAnchor(title, [contract.evidence, contract.objective ?? "", contract.focus]) &&
    !matchesAnySlideAnchor(learningGoal, [contract.evidence, contract.objective ?? "", contract.focus])
  ) {
    reasons.push(
      "The value slide heading drifts away from the concrete example. Keep the title or learning goal anchored to the example or outcome, not a general value claim.",
    );
  }

  if (contract.kind === "workshop-practice" && roleAlignedExampleCount === 0) {
    reasons.push(
      "A workshop practice slide needs one concrete exercise prompt, scenario, or sample artifact in the example slot so the audience can actually perform the task.",
    );
  }

  if (
    contract.kind === "workshop-practice" &&
    contract.evidence &&
    evidenceAlignedKeyPointCount + evidenceAlignedExampleCount === 0
  ) {
    reasons.push(
      "The workshop practice slide lost its practical scenario anchor. Rebuild it around the assigned evidence so it feels like an exercise, not another summary slide.",
    );
  }

  if (
    sourceBackedGroundingAnchors.length > 0 &&
    (contract.kind === "orientation" || contract.kind === "subject-detail") &&
    (!titleOrGoalMatchesGrounding ||
      sourceGroundedKeyPointCount + sourceGroundedExampleCount < 1)
  ) {
    reasons.push(
      "Keep the setup anchored to supported source details. The title, goal, and visible points should establish the concrete grounded case instead of broad subject generalities.",
    );
  }

  if (
    sourceBackedGroundingAnchors.length > 0 &&
    (contract.kind === "subject-implication" || contract.kind === "subject-takeaway") &&
    !titleOrGoalMatchesGrounding &&
    sourceGroundedKeyPointCount + sourceGroundedExampleCount < 2
  ) {
    reasons.push(
      "This slide drifts beyond the grounded case. Keep the implication or takeaway anchored to supported source details instead of expanding into broader unsupported claims.",
    );
  }

  if (repetitiveEarlierSlides.length > 0) {
    reasons.push(
      "This slide repeats earlier slides too closely. Advance the story with a distinct mechanism, example, responsibility, or consequence.",
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
      input.intent?.presentationGoal,
      input.intent?.focusAnchor,
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
    `${subject} is presented through ${bestAnchor.toLowerCase()} so the audience can see the clearest ideas, examples, or consequences.`,
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
      title: buildContractTitle(input, contract),
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
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): Record<string, unknown>[] => {
  const contracts = buildSlideContracts(input, slides.length);
  const subject = resolveIntentSubject(input);

  return slides.map((slide, index) => {
    const contract = contracts[index];
    if (!slide || !contract) {
      return slide;
    }

    const title = typeof slide.title === "string" ? slide.title.trim() : "";
    const contractAnchor = [subject, contract.focus, contract.objective ?? "", contract.evidence ?? ""].join(
      " ",
    );
    const roleAnchors = buildContractRoleAnchors(input, contract);
    const keyPoints = toStringArray(slide.keyPoints);
    const examples = toStringArray(slide.examples);
    const roleAlignedExampleCount = examples.filter((example) =>
      matchesAnySlideAnchor(example, roleAnchors),
    ).length;
    const evidenceAlignedKeyPointCount = contract.evidence
      ? keyPoints.filter((point) => matchesAnySlideAnchor(point, [contract.evidence!])).length
      : 0;
    const evidenceAlignedExampleCount = contract.evidence
      ? examples.filter((example) => matchesAnySlideAnchor(example, [contract.evidence!])).length
      : 0;
    const concretePointPool = uniqueNonEmptyStrings(
      [
        ...keyPoints,
        typeof slide.beginnerExplanation === "string" ? slide.beginnerExplanation : "",
        typeof slide.advancedExplanation === "string" ? slide.advancedExplanation : "",
        ...examples,
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
        keyPoints.some(
          (point) =>
            DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)),
        ));

    const titleNeedsRepair =
      introNeedsRepair ||
      title.length > 84 ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(title)) ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        !matchesAnySlideAnchor(title, [contract.evidence, contract.objective ?? "", contract.focus])) ||
      (contract.kind === "workshop-practice" &&
        !matchesAnySlideAnchor(title, [contract.objective ?? contract.focus, contract.evidence ?? ""])) ||
      (index > 0 &&
        roleAnchors.length > 0 &&
        !matchesAnySlideAnchor(title, roleAnchors)) ||
      !hasMeaningfulAnchorOverlap(title, contractAnchor);

    const learningGoalText =
      typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
    const learningGoalNeedsRepair =
      !learningGoalText ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        !matchesAnySlideAnchor(learningGoalText, [contract.evidence, contract.objective ?? "", contract.focus])) ||
      (contract.kind === "workshop-practice" &&
        !matchesAnySlideAnchor(learningGoalText, [contract.objective ?? contract.focus, contract.evidence ?? ""])) ||
      (index > 0 &&
        roleAnchors.length > 0 &&
        !matchesAnySlideAnchor(learningGoalText, roleAnchors)) ||
      !hasMeaningfulAnchorOverlap(learningGoalText, contractAnchor);

    const alignedKeyPoints = keyPoints.filter(
      (point) =>
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)) &&
        hasMeaningfulAnchorOverlap(
          point,
          `${roleAnchors.join(" ")} ${contractAnchor} ${title}`,
        ),
    );
    const keyPointsNeedRepair =
      keyPoints.length < 3 ||
      alignedKeyPoints.length < 2 ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        evidenceAlignedKeyPointCount + evidenceAlignedExampleCount < 2) ||
      (contract.kind === "workshop-practice" &&
        (roleAlignedExampleCount === 0 ||
          (contract.evidence &&
            evidenceAlignedKeyPointCount + evidenceAlignedExampleCount === 0)));

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
    const nextKeyPoints = keyPointsNeedRepair ? replacementPoints : keyPoints.slice(0, 4);
    const nextBeginnerExplanation = beginnerExplanationNeedsRepair
      ? replacementPoints.join(" ")
      : beginnerExplanationText;
    const nextAdvancedExplanation = advancedExplanationNeedsRepair
      ? toAudienceFacingSentence(
          `${contract.focus} matters because it changes how ${input.topic} behaves, is understood, or is judged in practice`,
        )
      : advancedExplanationText;
    const nextExamples =
      contract.kind === "entity-value"
        ? uniqueNonEmptyStrings([contract.evidence ?? "", ...examples]).slice(0, 3)
        : contract.kind === "workshop-practice"
          ? uniqueNonEmptyStrings([contract.evidence ?? "", contract.objective ?? "", ...examples]).slice(0, 3)
          : examples;
    const contentNeedsVisualRefresh =
      titleNeedsRepair ||
      learningGoalNeedsRepair ||
      keyPointsNeedRepair ||
      beginnerExplanationNeedsRepair ||
      advancedExplanationNeedsRepair ||
      heroStatementNeedsRepair;
    const nextVisuals = contentNeedsVisualRefresh
      ? deriveVisuals(
          {
            ...slide,
            title: nextTitle || buildContractTitle(input, contract),
            learningGoal,
            keyPoints: nextKeyPoints,
            examples: nextExamples,
            beginnerExplanation: nextBeginnerExplanation,
            advancedExplanation: nextAdvancedExplanation,
            visuals: {
              ...(typeof visuals.layoutTemplate === "string"
                ? { layoutTemplate: visuals.layoutTemplate }
                : {}),
              ...(typeof visuals.accentColor === "string"
                ? { accentColor: visuals.accentColor }
                : {}),
              ...(typeof visuals.imagePrompt === "string"
                ? { imagePrompt: visuals.imagePrompt }
                : {}),
              ...(Array.isArray(visuals.imageSlots)
                ? { imageSlots: visuals.imageSlots }
                : {}),
            },
          },
          {
            keyPoints: nextKeyPoints,
            examples: nextExamples,
            likelyQuestions: toStringArray(slide.likelyQuestions),
            order: index,
            totalSlides: slides.length,
            learningGoal,
            title: nextTitle || buildContractTitle(input, contract),
          },
        )
      : {
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
        };

    return {
      ...slide,
      title: nextTitle || buildContractTitle(input, contract),
      learningGoal,
      keyPoints: nextKeyPoints,
      examples: nextExamples,
      beginnerExplanation: nextBeginnerExplanation,
      advancedExplanation: nextAdvancedExplanation,
      visuals: nextVisuals,
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
      likelyQuestions: likelyQuestions,
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
          likelyQuestions,
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

  const segments = cleanedSegments.slice(0, minSegmentCount);
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
    promptsForPauses: [],
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

const normalizeDeckReviewResult = (value: unknown) => {
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

const normalizeNarrationRepairResult = (
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

const buildCompactDeckReviewSummary = (slide: Slide): string =>
  [
    `Slide ${slide.order + 1}: ${slide.title}`,
    `Goal: ${slide.learningGoal}`,
    `Points: ${slide.keyPoints.join("; ")}`,
    compactVisualSummary(slide)
      ? `Visual: ${compactVisualSummary(slide)}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

const buildCompactNarrationRepairSummary = (
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
    input.intent?.focusAnchor
      ? `Concrete focus anchor: ${input.intent.focusAnchor}`
      : null,
    framing ? `Framing context: ${framing}` : "No additional framing context was provided.",
    input.intent?.presentationFrame
      ? `Presentation frame: ${input.intent.presentationFrame}`
      : null,
    ...buildArcPolicyPromptLines(input),
    input.intent?.organization
      ? `Organization context: ${input.intent.organization}`
      : null,
    input.intent?.audienceCues?.length
      ? `Audience cues: ${input.intent.audienceCues.join("; ")}`
      : null,
    input.intent?.presentationGoal
      ? `Presentation goal: ${input.intent.presentationGoal}`
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

export const __testables = {
  assessGeneratedSlideDraft,
  applyPlanDrivenDeckShape,
  buildSlideFromPlainText,
  buildSlideContracts,
  resolveSourceBackedCaseAnchor,
  buildContractAnchoredKeyPoints,
  buildContractLearningGoal,
  buildOutlineDeckSummary,
  buildProceduralOrientationKeyPoints,
  buildRoleSpecificSlideRecoveryFromContext,
  normalizePresentationPlan,
  shouldUseDeterministicSubjectOverviewSlide,
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
    disableLmStudioBudgetLift?: boolean | undefined;
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

    const adjustedAttempts = this.isLmStudioProvider() && !options?.disableLmStudioBudgetLift
      ? rawAttempts.map((attempt) => this.raiseInitialTokenBudget(attempt))
      : rawAttempts;

    return [...new Set(adjustedAttempts)].sort((left, right) => left - right);
  }

  private resolveRequestTimeout(
    requestedTimeoutMs: number | undefined,
    maxTokens: number | undefined,
    disableLmStudioBudgetLift: boolean | undefined,
  ): number {
    const baseTimeout = requestedTimeoutMs ?? this.timeoutMs;
    if (!this.isLmStudioProvider() || !maxTokens || disableLmStudioBudgetLift) {
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
    const system =
      "You design concise teaching plans. Call the provided tool and do not answer in plain text.";
    const user = [
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
      ...buildArcPolicyPromptLines(input),
      input.intent?.presentationFrame === "organization" &&
      (input.intent?.framing || input.presentationBrief)
        ? "Treat the framing context as binding scope for the organization plan. If it implies onboarding, orientation, introduction, or overview, keep the title and storyline focused on helping a newcomer understand the organization itself."
        : null,
      "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
      "For beginner audiences, prefer a storyline like: motivation, mental model, structure, concrete example, recap.",
      "Keep the plan close to the requested duration and slide count when they are provided.",
      "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
    ].join("\n");

    try {
      return await this.chatToolCall({
        functionName: "return_presentation_plan",
        functionDescription:
          "Return the structured teaching plan for the requested presentation.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "learningObjectives",
            "storyline",
            "recommendedSlideCount",
            "audienceLevel",
          ],
          properties: {
            title: {
              type: "string",
            },
            learningObjectives: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            storyline: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            recommendedSlideCount: {
              type: "integer",
              minimum: 1,
            },
            audienceLevel: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced", "mixed"],
            },
          },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 900,
        timeoutMs: 6000,
        tokenAttempts: [900, 1400],
        parse: (value) =>
          PresentationPlanSchema.parse(
            normalizePresentationPlan(value, {
              targetSlideCount: input.targetSlideCount,
              topic: input.topic,
              subject: input.intent?.subject ?? input.topic,
              intent: input.intent,
              groundingHighlights: input.groundingHighlights,
              groundingCoverageGoals: undefined,
            }),
          ),
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call presentation plan path failed: ${(error as Error).message}`,
      );
    }

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
        ...buildArcPolicyPromptLines(input),
        input.intent?.presentationFrame === "organization" &&
        (input.intent?.framing || input.presentationBrief)
          ? "Treat the framing context as binding scope for the organization plan. If it implies onboarding, orientation, introduction, or overview, keep the title and storyline focused on helping a newcomer understand the organization itself."
          : null,
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
            subject: input.intent?.subject ?? input.topic,
            intent: input.intent,
            groundingHighlights: input.groundingHighlights,
            groundingCoverageGoals: undefined,
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
    const workingSlides = [...outlineDeck.slides];
    const generationOrder = [
      ...outlineDeck.slides
        .map((_, index) => index)
        .filter((index) => index !== 0),
      0,
    ];

    for (const index of generationOrder) {
      const slide = outlineDeck.slides[index];
      if (!slide) {
        throw new Error(`Missing outline slide ${index + 1}.`);
      }

      const contract = contracts[index];
      if (!contract) {
        throw new Error(`Missing slide contract for outline slide ${index + 1}.`);
      }

      const currentDeck = DeckSchema.parse({
        ...outlineDeck,
        slides: workingSlides,
      });
      const enrichedSlide = await this.generateSlideFromOutline(
        input,
        currentDeck,
        currentDeck.slides[index] ?? slide,
        contract,
      );
      workingSlides[index] = {
        ...(currentDeck.slides[index] ?? slide),
        ...(enrichedSlide as Record<string, unknown>),
        id: slide.id,
        order: slide.order,
      } as Slide;
    }

    return DeckSchema.parse(
      normalizeDeck(
        {
          ...outlineDeck,
          slides: workingSlides,
        },
        input,
      ),
    );
  }

  private async generateStructuredSlideFromOutline(
    input: GenerateDeckInput,
    deck: Deck,
    slide: Slide,
    contract: SlideContract,
    priorAssessment: SlideDraftAssessment | null,
  ): Promise<Record<string, unknown>> {
    const slideBriefLines = buildSlideEnrichmentPromptLines({
      deck,
      slide,
      contract,
      generationInput: input,
      priorAssessment,
    });

    return await this.chatToolCall({
      functionName: "return_presentation_slide",
      functionDescription:
        "Return one structured presentation slide that teaches the subject itself in audience-facing language.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "learningGoal",
          "keyPoints",
          "beginnerExplanation",
          "advancedExplanation",
          "examples",
          "likelyQuestions",
          "speakerNotes",
        ],
        properties: {
          title: { type: "string" },
          learningGoal: { type: "string" },
          keyPoints: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
          },
          speakerNotes: {
            type: "array",
            items: { type: "string" },
          },
          examples: {
            type: "array",
            items: { type: "string" },
          },
          likelyQuestions: {
            type: "array",
            items: { type: "string" },
          },
          beginnerExplanation: { type: "string" },
          advancedExplanation: { type: "string" },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Write one structured presentation slide. Call the provided tool and do not answer in plain text. Teach the subject itself in audience-facing language. Do not mention the deck, session, slide design, or presenter instructions.",
        },
        {
          role: "user",
          content: [
            ...slideBriefLines,
            "Return fields: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
            "Use exactly 3 key points and make each one a complete audience-facing sentence.",
            "Keep the slide concrete and topic-specific. Prefer mechanisms, roles, examples, consequences, or factual subareas.",
            "Keep one consistent content language. Match the language already implied by the prompt and grounding instead of switching languages mid-deck.",
            "Avoid facilitator, presenter, or session-management language.",
            "Do not tell the presenter what to do. Do not describe how the slide should be delivered.",
            "If the framing lens implies onboarding, orientation, introduction, or overview, keep the language beginner-friendly and organization-facing. It may orient a newcomer to the organization, but it must not turn into facilitator talk or direct second-person instructions.",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        },
      ],
      maxTokens: slide.order === 0 ? 3200 : 2800,
      timeoutMs: 24000,
      tokenAttempts:
        slide.order === 0 ? [3200, 4800, 6400] : [2800, 4200, 5600],
      parse: (value) => {
        if (!value || typeof value !== "object") {
          throw new Error("Structured slide enrichment returned no object.");
        }

        return {
          ...(slide as unknown as Record<string, unknown>),
          ...(value as Record<string, unknown>),
          id: slide.id,
          order: slide.order,
        };
      },
    });
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

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      try {
        const enrichedSlide = await this.generateStructuredSlideFromOutline(
          input,
          deck,
          slide,
          contract,
          priorAssessment,
        );

        const assessment = assessGeneratedSlideDraft(input, deck, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlide.title === "string" ? enrichedSlide.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlide.learningGoal === "string" ? enrichedSlide.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlide.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
      }
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

        const assessment = assessGeneratedSlideDraft(input, deck, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        const enrichedSlideRecord = enrichedSlide as Record<string, unknown>;
        console.warn(
          `[slidespeech] ${this.name} plain-text slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlideRecord.title === "string" ? enrichedSlideRecord.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlideRecord.learningGoal === "string" ? enrichedSlideRecord.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlideRecord.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} plain-text slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
      }
    }

    const roleSpecificRecovery = buildRoleSpecificSlideRecoveryFromContext(
      input,
      deck,
      slide,
      contract,
    );
    if (roleSpecificRecovery) {
      console.warn(
        `[slidespeech] ${this.name} recovered slide "${slide.title}" from role-specific context after enrichment failures.`,
      );
      return roleSpecificRecovery;
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
              "Write spoken narration for a presentation slide. Do not use JSON or markdown. Speak directly to an audience, stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Deck language: ${input.deck.metadata.language}`,
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
                ? `Write exactly 4 short spoken paragraphs for the opening in ${input.deck.metadata.language}. Separate them with blank lines. Sound like a presenter speaking to a real audience and present the idea directly.`
                : `Write exactly 3 short spoken paragraphs for this slide in ${input.deck.metadata.language}. Separate them with blank lines. Each paragraph must clearly relate to the visible slide content and present the idea directly.`,
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

    let lastError: Error | null = null;
    const narrationStrategies: Array<{
      label: string;
      run: () => Promise<SlideNarration>;
    }> =
      input.slide.order === 0
        ? [
            {
              label: "plain-text primary",
              run: () => tryPlainTextNarration(3000, 40000, [3000, 4200, 5600]),
            },
            {
              label: "plain-text retry",
              run: () => tryPlainTextNarration(3600, 50000, [3600, 5200, 6800]),
            },
          ]
        : [
            {
              label: "plain-text primary",
              run: () => tryPlainTextNarration(2200, 30000, [2200, 3200, 4400]),
            },
          ];

    for (const strategy of narrationStrategies) {
      try {
        return await strategy.run();
      } catch (plainTextError) {
        lastError = plainTextError as Error;
        console.warn(
          `[slidespeech] ${this.name} narration ${strategy.label} path failed for "${input.slide.title}": ${lastError.message}`,
        );
      }
    }

    try {
      const compactNarrationText = await this.chatText(
        [
          {
            role: "system",
            content:
              "Write concise spoken narration for one teaching slide. Do not use JSON. Stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Deck language: ${input.deck.metadata.language}`,
              `Slide title: ${input.slide.title}`,
              `Learning goal: ${input.slide.learningGoal}`,
              `Key points: ${input.slide.keyPoints.join("; ")}`,
              `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
              `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
              previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
              nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
              input.slide.order === 0
                ? `Write exactly 4 short spoken lines in ${input.deck.metadata.language}, one per line, for the opening.`
                : `Write exactly 3 short spoken lines in ${input.deck.metadata.language}, one per line, for this slide.`,
            ].join("\n"),
          },
        ],
        {
          maxTokens: input.slide.order === 0 ? 1800 : 1400,
          timeoutMs: 25000,
          tokenAttempts: input.slide.order === 0 ? [1800, 2600] : [1400, 2200],
        },
      );

      const compactNarration = buildNarrationFromPlainText(
        compactNarrationText,
        input.slide,
        input.deck,
      );

      if (!compactNarration) {
        throw new Error(
          "Compact plain-text narration did not pass local grounding and quality checks.",
        );
      }

      return compactNarration;
    } catch (compactPlainTextError) {
      lastError = compactPlainTextError as Error;
      console.warn(
        `[slidespeech] ${this.name} narration compact plain-text path failed for "${input.slide.title}": ${lastError.message}`,
      );
    }

    try {
      return SlideNarrationSchema.parse(
        normalizeNarrationForSlide({}, input.slide, input.deck),
      );
    } catch (fallbackError) {
      lastError = fallbackError as Error;
      console.warn(
        `[slidespeech] ${this.name} narration deterministic fallback failed for "${input.slide.title}": ${lastError.message}`,
      );
    }

    try {
      return buildFallbackNarration(input.slide, input.deck);
    } catch (finalFallbackError) {
      lastError = finalFallbackError as Error;
    }

    throw lastError ?? new Error(`${this.name} narration generation failed.`);
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    const visibleCards = input.slide.visuals.cards
      .slice(0, 2)
      .map((card) => `${card.title}: ${card.body}`)
      .join(" | ");
    const visibleCallouts = input.slide.visuals.callouts
      .slice(0, 2)
      .map((callout) => `${callout.label}: ${callout.text}`)
      .join(" | ");
    const slideExample = input.slide.examples[0]?.trim() || "None";
    const answerInstruction =
      input.answerMode === "example"
        ? "Give one concrete example. Do not just restate the slide."
        : input.answerMode === "grounded_factual"
          ? "Answer only if the available grounded context supports it. If not, say that briefly."
          : input.answerMode === "summarize_current_slide"
            ? "State the main point of the current slide in direct language."
            : "Answer the user's question directly. Prefer concrete wording over abstract framing.";
    const text = await this.chatText([
      {
        role: "system",
        content:
          "You are a fast AI presentation assistant. Answer in English using at most 4 short sentences. Prefer the current slide, but use broader deck context or source grounding when they clearly answer the question better. If the available context still does not support the answer, say that briefly instead of bluffing.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Slide learning goal: ${input.slide.learningGoal}`,
          `Visible key points: ${input.slide.keyPoints.join("; ")}`,
          `Visible cards: ${visibleCards || "None"}`,
          `Visible callouts: ${visibleCallouts || "None"}`,
          `Example on this slide: ${slideExample}`,
          `Question: ${input.question}`,
          `Beginner explanation: ${input.slide.beginnerExplanation}`,
          input.broaderDeckContext
            ? `Broader deck context: ${input.broaderDeckContext}`
            : null,
          input.sourceGroundingContext
            ? `Source grounding context: ${input.sourceGroundingContext}`
            : null,
          answerInstruction,
          "Do not mention the presentation, deck, or slide unless the user asks about them.",
        ].join("\n"),
      },
    ], {
      maxTokens: 1200,
      timeoutMs: 18000,
      tokenAttempts: [1200, 1600],
      disableLmStudioBudgetLift: true,
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
    const slidesForDetailedReview = (
      detailedSlides.length > 0 ? detailedSlides : input.deck.slides.slice(0, 2)
    ).slice(0, 2);

    const deckReviewSystem = [
      "You are a strict presentation QA reviewer for an interactive AI teacher.",
      "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether the slides form a strong teaching sequence.",
      "Judge the deck itself in this step. Do not rewrite narration here.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");

    const deckReviewUser = [
      `Deck title: ${input.deck.title}`,
      `Deck topic: ${input.deck.topic}`,
      `Deck summary: ${input.deck.summary}`,
      `Audience: ${input.pedagogicalProfile.audienceLevel}`,
      `Deck outline:\n${input.deck.slides
        .map((slide) => buildCompactDeckReviewSummary(slide))
        .join("\n\n")}`,
      "Return fields: approved, overallScore, summary, issues.",
      "Issue fields: code, severity, dimension, message, optional slideId.",
      "Valid dimensions: deck, visual, coherence, grounding.",
    ].join("\n");

    try {
      const deckReview = await this.chatToolCall({
        functionName: "return_presentation_deck_review",
        functionDescription:
          "Return the structured QA review for the deck itself, excluding narration rewrites.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["approved", "overallScore", "summary", "issues"],
          properties: {
            approved: {
              type: "boolean",
            },
            overallScore: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            summary: {
              type: "string",
            },
            issues: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "severity", "dimension", "message"],
                properties: {
                  code: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["info", "warning", "error"],
                  },
                  dimension: {
                    type: "string",
                    enum: ["deck", "visual", "coherence", "grounding"],
                  },
                  message: { type: "string" },
                  slideId: { type: "string" },
                },
              },
            },
          },
        },
        messages: [
          { role: "system", content: deckReviewSystem },
          { role: "user", content: deckReviewUser },
        ],
        maxTokens: 2600,
        timeoutMs: 18000,
        tokenAttempts: [2600, 3600, 5200],
        parse: (value) => normalizeDeckReviewResult(value),
      });

      let repairedNarrations: SlideNarration[] = [];

      if (slidesForDetailedReview.length > 0) {
        const narrationRepairSystem = [
          "You repair slide narration for an interactive AI teacher.",
          "Only rewrite narration for the provided target slides.",
          "Keep each repair tightly tied to the slide's visible content without reading the slide verbatim.",
          "Do not talk about the slide itself, its title, or the presentation process.",
          "Call the provided tool and do not answer in plain text.",
        ].join(" ");

        const narrationRepairUser = [
          `Deck topic: ${input.deck.topic}`,
          `Deck language: ${input.deck.metadata.language}`,
          `Narration repair targets:\n${slidesForDetailedReview
            .map((slide) =>
              buildCompactNarrationRepairSummary(
                slide,
                narrationBySlideId.get(slide.id),
              ),
            )
            .join("\n\n")}`,
          `Any repaired narration must stay tightly tied to that slide's visible content, stay in the deck language (${input.deck.metadata.language}), and keep 4 to 6 segments for slide 1 and 3 to 5 segments for other slides.`,
          "Return fields: repairedNarrations.",
          "Only include repairedNarrations for slides whose narration should be replaced.",
        ].join("\n");

        try {
          repairedNarrations = await this.chatToolCall({
            functionName: "return_narration_repairs",
            functionDescription:
              "Return only the narration repairs needed for the provided target slides.",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["repairedNarrations"],
              properties: {
                repairedNarrations: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "slideId",
                      "narration",
                      "segments",
                      "summaryLine",
                      "promptsForPauses",
                      "suggestedTransition",
                    ],
                    properties: {
                      slideId: { type: "string" },
                      narration: { type: "string" },
                      segments: {
                        type: "array",
                        items: { type: "string" },
                      },
                      summaryLine: { type: "string" },
                      promptsForPauses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      suggestedTransition: { type: "string" },
                    },
                  },
                },
              },
            },
            messages: [
              { role: "system", content: narrationRepairSystem },
              { role: "user", content: narrationRepairUser },
            ],
            maxTokens: 2400,
            timeoutMs: 18000,
            tokenAttempts: [2400, 3600, 5200],
            parse: (value) => normalizeNarrationRepairResult(value, input),
          });
        } catch (error) {
          console.warn(
            `[slidespeech] ${this.name} narration repair path failed: ${(error as Error).message}`,
          );
        }
      }

      return PresentationReviewSchema.parse({
        ...deckReview,
        repairedNarrations,
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call review path failed: ${(error as Error).message}`,
      );
    }

    return this.chatJson({
      schemaName: "PresentationReview",
      system: [
        "You are a strict presentation QA reviewer for an interactive AI teacher.",
        "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether each slide narration is clearly about the visible slide without reading it verbatim.",
        "If a narration is weak or drifts away from the slide, rewrite only that slide narration.",
        "Do not rewrite the whole deck. Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        deckReviewUser,
        `Detailed review targets:\n${slidesForDetailedReview
          .map((slide) =>
            buildCompactNarrationRepairSummary(
              slide,
              narrationBySlideId.get(slide.id),
            ),
          )
          .join("\n\n")}`,
        "Return fields: approved, overallScore, summary, issues, repairedNarrations.",
        "Valid dimensions: deck, visual, narration, coherence, grounding.",
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

    const system = [
      "You are a conversation planner for an AI teacher runtime.",
      "Treat the learner's turn as freeform conversation first, not as a command parser.",
      "Infer both pedagogical needs and runtime side effects.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");
    const user = [
      `Topic: ${input.deck.topic}`,
      `Current slide title: ${input.slide.title}`,
      `Current slide learning goal: ${input.slide.learningGoal}`,
      `Current session state: ${input.session.state}`,
      `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
      `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
      `User turn: ${input.text}`,
      "Return a structured conversation plan through the tool.",
      "Use interruptionType=question by default for freeform learner input.",
      "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
      "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
      "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
      "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
    ].join("\n");

    try {
      return await this.chatToolCall({
        functionName: "return_turn_plan",
        functionDescription:
          "Return the structured learner-turn classification for the teaching runtime.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [
            "interruptionType",
            "inferredNeeds",
            "responseMode",
            "runtimeEffects",
            "confidence",
            "rationale",
          ],
          properties: {
            interruptionType: {
              type: "string",
              enum: [
                "stop",
                "question",
                "simplify",
                "deepen",
                "example",
                "back",
                "repeat",
                "continue",
                "unknown",
              ],
            },
            inferredNeeds: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "question",
                  "confusion",
                  "example",
                  "deepen",
                  "repeat",
                  "navigation",
                  "pause",
                  "resume",
                ],
              },
            },
            responseMode: {
              type: "string",
              enum: [
                "ack_pause",
                "ack_resume",
                "ack_back",
                "question",
                "summarize_current_slide",
                "general_contextual",
                "grounded_factual",
                "simplify",
                "deepen",
                "example",
                "repeat",
              ],
            },
            runtimeEffects: {
              type: "object",
              additionalProperties: false,
              properties: {
                pause: { type: "boolean" },
                resume: { type: "boolean" },
                goToPreviousSlide: { type: "boolean" },
                restartCurrentSlide: { type: "boolean" },
                adaptDetailLevel: {
                  type: "string",
                  enum: ["light", "standard", "deep"],
                },
                adaptPace: {
                  type: "string",
                  enum: ["slow", "balanced", "fast"],
                },
              },
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            rationale: {
              type: "string",
            },
          },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 600,
        timeoutMs: 5000,
        parse: (value) =>
          ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call planner path failed: ${(error as Error).message}`,
      );
    }

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
        "Valid responseMode values: ack_pause, ack_resume, ack_back, question, summarize_current_slide, general_contextual, grounded_factual, simplify, deepen, example, repeat.",
        "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
        "Use interruptionType=question by default for freeform learner input.",
        "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
        "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
        "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
        "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
      ].join("\n"),
      maxTokens: 220,
      timeoutMs: 4000,
      tokenAttempts: [220],
      disableLmStudioBudgetLift: true,
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
      disableLmStudioBudgetLift?: boolean | undefined;
    },
  ): Promise<string> {
    const attempts = this.normalizeTokenAttempts(options);

    let lastEmptyReasoning = false;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          options?.timeoutMs,
          maxTokens,
          options?.disableLmStudioBudgetLift,
        ),
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
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const text = await this.chatText([
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ], {
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.tokenAttempts ? { tokenAttempts: input.tokenAttempts } : {}),
      ...(input.disableLmStudioBudgetLift
        ? { disableLmStudioBudgetLift: input.disableLmStudioBudgetLift }
        : {}),
    });

    const jsonText = extractJsonFromText(text);
    const parsed = JSON.parse(jsonText) as unknown;
    return input.parse(parsed);
  }

  protected async chatToolCall<T>(input: {
    functionName: string;
    functionDescription: string;
    parameters: Record<string, unknown>;
    messages: ChatMessage[];
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const attempts =
      input.tokenAttempts && input.tokenAttempts.length > 0
        ? [...new Set(input.tokenAttempts.filter((value) => Number.isFinite(value) && value > 0))]
        : [input.maxTokens ?? 800];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(input.messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          input.timeoutMs,
          maxTokens,
          input.disableLmStudioBudgetLift,
        ),
        tools: [
          {
            type: "function",
            function: {
              name: input.functionName,
              description: input.functionDescription,
              parameters: input.parameters,
            },
          },
        ],
        toolChoice: "required",
        extraBody: this.isLmStudioProvider()
          ? {
              chat_template_kwargs: {
                enable_thinking: false,
              },
            }
          : undefined,
      });

      const choice = json.choices?.[0];
      const toolArguments =
        choice?.message?.tool_calls?.[0]?.function?.arguments?.trim();

      if (toolArguments) {
        return input.parse(JSON.parse(toolArguments));
      }

      const shouldRetry =
        attemptIndex < attempts.length - 1 &&
        (choice?.finish_reason === "length" ||
          Boolean(choice?.message?.reasoning_content?.trim()) ||
          Boolean(choice?.message?.content?.trim()));

      if (shouldRetry) {
        console.warn(
          `[slidespeech] ${this.name} returned no tool arguments for ${input.functionName} at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      const finishReason = choice?.finish_reason
        ? ` finish_reason=${choice.finish_reason}.`
        : "";
      throw new Error(
        `${this.name} returned no tool arguments for ${input.functionName}.${finishReason}`,
      );
    }

    throw new Error(
      `${this.name} returned no tool arguments for ${input.functionName} after exhausting token attempts.`,
    );
  }

  private async requestChatCompletion(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tools?: unknown;
      toolChoice?: string | undefined;
      extraBody?: Record<string, unknown> | undefined;
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
          ...(options?.tools ? { tools: options.tools } : {}),
          ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          ...(options?.extraBody ?? {}),
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
      input.intent?.presentationFrame === "organization"
        ? "This prompt is about an organization/entity, not about the generic abstract concept behind its name."
        : null,
      input.intent?.presentationFrame === "organization"
        ? "Teach who the organization is, what it does, how it works, and where it creates value."
        : null,
      input.intent?.presentationFrame === "organization" &&
      (input.intent?.framing || input.presentationBrief)
        ? "If the framing implies onboarding, orientation, introduction, or overview, keep that scope visible. Orient a newcomer to the organization itself without switching into facilitator talk or second-person audience management."
        : null,
      "Do not use facilitator talk or audience-management language. Explain the subject itself.",
      "Do not leak instruction fragments like 'create a presentation', 'more information is available at', or 'use google' into slide titles, learning goals, or key points.",
      "This is not a talk about slide design or how to present. Never give advice about slides, screenshots, clutter, decks, key points, or presentation technique unless the core subject itself is presentation design.",
      "Avoid facilitator framing that talks about running the session instead of teaching the subject, unless the subject itself is session facilitation.",
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
        "Use one consistent language across the whole deck. Match the language implied by the topic, title direction, brief, and grounding.",
        "Each slide should contain at least two concrete, subject-facing claims. Avoid filler phrasing.",
        "Each slide must advance the story with a distinct explanatory center. Do not restate the same explanation on multiple slides.",
      ].join("\n");
    }

    return [
      ...header,
      "Return JSON with: title, summary, slides.",
      "Each slide should include only: title, learningGoal, keyPoints.",
      "Use 3 bullet-like key points per slide.",
      "Do not include markdown.",
      "Use one consistent language that matches the request.",
      "Make each slide distinct from the others. Do not reuse the same explanation across slides.",
    ].join("\n");
  }
}
