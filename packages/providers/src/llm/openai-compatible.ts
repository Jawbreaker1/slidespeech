import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PresentationPlan,
  PresentationReview,
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

const normalizePresentationPlan = (
  value: unknown,
  overrides?: { targetSlideCount?: number | undefined },
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;

  return {
    ...candidate,
    title:
      typeof candidate.title === "string"
        ? candidate.title
        : "Generated teaching plan",
    learningObjectives: (() => {
      const objectives = toStringArray(candidate.learningObjectives);
      return objectives.length > 0
        ? objectives
        : [
            "Understand the main idea.",
            "See how the idea is structured.",
            "Connect the idea to one concrete example.",
          ];
    })(),
    storyline: (() => {
      const storyline = toStringArray(candidate.storyline);
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

const normalizeDeck = (
  value: unknown,
  input: Pick<
    GenerateDeckInput,
    "topic" | "groundingSourceIds" | "groundingSourceType" | "targetDurationMinutes" | "plan" | "targetSlideCount"
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
        : `${title} should be explained in plain language with a tight connection to these points: ${inferredKeyPoints.slice(0, 3).join(", ")}.`;
    const advancedExplanation =
      typeof slideCandidate.advancedExplanation === "string" &&
      slideCandidate.advancedExplanation.trim().length > 0
        ? slideCandidate.advancedExplanation.trim()
        : `${title} should deepen the same thread by clarifying how the slide's ideas fit into the overall topic of ${topic}.`;

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
          : inferredKeyPoints.slice(0, 1).map(
              (point) => `Use ${point.toLowerCase()} as a concrete example anchor.`,
            ),
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
    slides: normalizedSlides,
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

  async planPresentation(input: {
    topic: string;
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
        `Create a teaching plan for the topic: ${input.topic}`,
        `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
        input.groundingSummary
          ? `External grounding summary: ${input.groundingSummary}`
          : "No external grounding summary was provided.",
        input.targetDurationMinutes
          ? `Target duration: about ${input.targetDurationMinutes} minutes.`
          : "No explicit target duration was provided.",
        input.targetSlideCount
          ? `Target slide count: about ${input.targetSlideCount} slides.`
          : "No explicit target slide count was provided.",
        "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
        "For beginner audiences, prefer a storyline like: motivation, mental model, structure, concrete example, recap.",
        "Keep the plan close to the requested duration and slide count when they are provided.",
        "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
      ].join("\n"),
      maxTokens: 500,
      parse: (value) =>
        PresentationPlanSchema.parse(
          normalizePresentationPlan(value, {
            targetSlideCount: input.targetSlideCount,
          }),
        ),
    });
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const attempts = [
      {
        label: "compact-structured",
        system:
          "You create coherent teaching decks as concise JSON. Return valid JSON only and no markdown.",
        user: this.buildCompactDeckPrompt(input, "compact"),
        maxTokens: 1800,
      },
      {
        label: "minimal-outline",
        system:
          "Return only JSON and keep it compact. Focus on slide coherence and grounded facts.",
        user: this.buildCompactDeckPrompt(input, "minimal"),
        maxTokens: 1200,
      },
    ] as const;

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        return await this.chatJson({
          schemaName: "Deck",
          system: attempt.system,
          user: attempt.user,
          maxTokens: attempt.maxTokens,
          parse: (value) => DeckSchema.parse(normalizeDeck(value, input)),
        });
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} deck attempt "${attempt.label}" failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error(`${this.name} deck generation failed.`);
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    const previousSlide = input.deck.slides[input.slide.order - 1];
    const nextSlide = input.deck.slides[input.slide.order + 1];

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
        maxTokens: input.slide.order === 0 ? 550 : 420,
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
        maxTokens: input.slide.order === 0 ? 420 : 320,
      },
    ] as const;

    let lastError: Error | null = null;

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
      const narrationText = await this.chatText(
        [
          {
            role: "system",
            content:
              "Write spoken narration for a presentation slide. Use English. Do not use JSON or markdown.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Slide title: ${input.slide.title}`,
              `Learning goal: ${input.slide.learningGoal}`,
              `Key points: ${input.slide.keyPoints.join("; ")}`,
              `Speaker notes: ${input.slide.speakerNotes.join("; ") || "None"}`,
              nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
              input.slide.order === 0
                ? "Write 4 short spoken segments for the opening. Sound like a presenter speaking to an audience, not like instructions about the presentation."
                : "Write 3 short spoken segments tightly aligned with this slide.",
            ].join("\n"),
          },
        ],
        { maxTokens: input.slide.order === 0 ? 900 : 700 },
      );

      const segments = splitTextIntoSegments(narrationText).slice(
        0,
        input.slide.order === 0 ? 5 : 4,
      );
      const normalizedSegments =
        segments.length > 0 ? segments : [narrationText.trim()].filter(Boolean);

      if (normalizedSegments.length > 0) {
        return SlideNarrationSchema.parse({
          slideId: input.slide.id,
          narration: normalizedSegments.join(" "),
          segments: normalizedSegments,
          summaryLine: input.slide.learningGoal,
          promptsForPauses: [
            "Pause me if you want that explained more simply.",
            "Ask for an example if you want something more concrete.",
          ],
          suggestedTransition: nextSlide
            ? `Bridge clearly into ${nextSlide.title}.`
            : "End with a concise recap and one understanding check.",
        });
      }
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
    ], { maxTokens: 320, timeoutMs: 45000 });

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
    ], { maxTokens: 220, timeoutMs: 30000 });

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
    ], { maxTokens: 260, timeoutMs: 35000 });

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
    ], { maxTokens: 220, timeoutMs: 30000 });

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
    ], { maxTokens: 260, timeoutMs: 30000 });

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
    },
  ): Promise<string> {
    const attempts = [
      options?.maxTokens ?? 600,
      Math.max(1200, Math.min(3200, (options?.maxTokens ?? 600) * 2)),
      Math.max(2400, Math.min(6400, (options?.maxTokens ?? 600) * 4)),
    ];

    let lastEmptyReasoning = false;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(messages, {
        maxTokens,
        timeoutMs: options?.timeoutMs,
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
      `Topic: ${input.topic}`,
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
        ? `Grounding summary: ${input.groundingSummary}`
        : "No external grounding summary was provided.",
      input.groundingSummary
        ? "Use the grounding summary as the factual source of truth. If details are sparse, stay generic rather than hallucinating."
        : "Avoid pretending to know current facts that were not provided.",
      "Keep every slide on the same main topic and make the sequence feel like one coherent talk.",
    ].filter((line): line is string => Boolean(line));

    if (mode === "compact") {
      return [
        ...header,
        "Return JSON with: title, summary, slides.",
        "Each slide should include: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
        "Use 3 to 4 key points per slide.",
        "Slide 1 must orient the audience and explain why the topic matters.",
        "Final slide must recap the same thread and give one next step.",
        "Use English and keep the language spoken, concrete, and audience-facing.",
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
