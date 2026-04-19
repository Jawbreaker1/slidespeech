import type {
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  PresentationIntent,
  PresentationPlan,
  PresentationQualityIssue,
  PresentationReview,
  Slide,
  SlideNarration,
} from "@slidespeech/types";

import { createId, nowIso } from "./utils";

const extractGroundingHighlights = (
  groundingSummary: string | undefined,
  maxItems = 8,
): string[] => {
  if (!groundingSummary?.trim()) {
    return [];
  }

  const seen = new Set<string>();

  return groundingSummary
    .split(/\n+|(?<=[.!?])\s+/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length >= 30)
    .filter((chunk) => {
      const normalized = chunk.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .slice(0, maxItems);
};

const resolveTargetSlideCount = (input: GenerateDeckInput): number =>
  Math.max(
    4,
    input.targetSlideCount ??
      input.plan?.recommendedSlideCount ??
      (input.targetDurationMinutes
        ? Math.max(4, Math.min(12, Math.round(input.targetDurationMinutes * 1.25)))
        : 4),
  );

const makeCards = (
  slideId: string,
  points: string[],
  tones: Array<"accent" | "neutral" | "success" | "warning" | "info">,
) =>
  points.slice(0, 3).map((point, index) => ({
    id: `${slideId}-card-${index + 1}`,
    title: `Key point ${index + 1}`,
    body: point,
    tone: tones[index] ?? "neutral",
  }));

const pickGroundedPoints = (
  highlights: string[],
  offset: number,
  fallbackPoints: string[],
): string[] => {
  const grounded = highlights.slice(offset, offset + 3);
  return grounded.length > 0 ? grounded : fallbackPoints;
};

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const joinHumanList = (values: string[]): string => {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const resolveIntentSubject = (topic: string, intent?: PresentationIntent): string =>
  intent?.subject?.trim() || topic.trim();

const normalizeTeachingFocus = (value: string): string =>
  value
    .replace(/^how\s+they\s+can\s+/i, "using ")
    .replace(/^how\s+to\s+/i, "")
    .replace(/^use\s+/i, "Using ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/g, "");

export const buildDeterministicPresentationPlan = (input: {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | undefined;
  audienceLevel: "beginner" | "intermediate" | "advanced" | "mixed";
  targetSlideCount?: number | undefined;
}): PresentationPlan => {
  const recommendedSlideCount = Math.max(4, input.targetSlideCount ?? 4);
  const subject = resolveIntentSubject(input.topic, input.intent);
  const framing = input.intent?.framing ?? input.presentationBrief ?? "";
  const onboardingLike = /\bonboarding\b/i.test(framing);
  const workshopLike = input.intent?.deliveryFormat === "workshop";
  const audienceLabel = joinHumanList(input.intent?.audienceCues ?? []);
  const audienceStorylineBeat =
    audienceLabel.length > 0
      ? `How ${normalizeTeachingFocus(subject)} fits the daily work of ${audienceLabel}`
      : "";
  const activityStorylineBeat = input.intent?.activityRequirement
    ? `Hands-on exercise: ${normalizeTeachingFocus(input.intent.activityRequirement)}`
    : "";
  const coverageStoryline = (input.intent?.coverageRequirements ?? [])
    .map((value) => normalizeTeachingFocus(value))
    .filter((value) => value.length > 0)
    .slice(0, Math.max(0, recommendedSlideCount - 2));
  const defaultClosingBeat = workshopLike
    ? `Applying ${normalizeTeachingFocus(subject)} after the workshop`
    : `Applying ${normalizeTeachingFocus(subject)} in practice`;
  const openingBeat = workshopLike
    ? `Why ${normalizeTeachingFocus(subject)} matters in this workshop`
    : onboardingLike
      ? `Why ${normalizeTeachingFocus(subject)} matters for onboarding`
      : `Why ${normalizeTeachingFocus(subject)} matters`;
  const mandatoryTailBeats = uniqueNonEmptyStrings([activityStorylineBeat]);
  const remainingSlots = Math.max(0, Math.max(4, Math.min(6, recommendedSlideCount)) - 1);
  const reservedTailSlots =
    mandatoryTailBeats.length > 0 ? Math.min(mandatoryTailBeats.length, remainingSlots) : 0;
  const middleSlots = Math.max(0, remainingSlots - reservedTailSlots);
  const middleBeats = uniqueNonEmptyStrings([
    ...coverageStoryline,
    audienceStorylineBeat,
  ]).slice(0, middleSlots);
  const optionalTailBeats =
    middleBeats.length + mandatoryTailBeats.length < remainingSlots
      ? uniqueNonEmptyStrings([defaultClosingBeat])
      : [];
  const storyline = uniqueNonEmptyStrings([
    openingBeat,
    ...middleBeats,
    ...mandatoryTailBeats.slice(0, remainingSlots - middleBeats.length),
    ...optionalTailBeats.slice(
      0,
      remainingSlots - middleBeats.length - mandatoryTailBeats.length,
    ),
  ]);

  return {
    title: onboardingLike
      ? `${subject}: onboarding teaching path`
      : workshopLike
        ? `${subject}: workshop teaching path`
        : `${subject}: coherent teaching path`,
    learningObjectives: [
      onboardingLike
        ? `Understand ${subject} in a way that helps a new colleague get oriented quickly.`
        : workshopLike
          ? `Understand how ${normalizeTeachingFocus(subject)} can support day-to-day work.`
          : `Understand the main idea behind ${subject}.`,
      audienceLabel.length > 0
        ? `See how ${normalizeTeachingFocus(subject)} connects to the responsibilities of ${audienceLabel}.`
        : onboardingLike
          ? `See how to explain ${subject} as part of a clear onboarding story.`
          : `See how ${subject} is structured and applied.`,
      input.intent?.activityRequirement
        ? `Leave with one concrete way to practice ${normalizeTeachingFocus(subject)} through the workshop exercise.`
        : onboardingLike
          ? `Leave with one practical way to introduce ${subject} to a newcomer.`
          : `Leave with one practical way to explain ${subject}.`,
    ],
    storyline,
    recommendedSlideCount,
    audienceLevel:
      input.audienceLevel === "mixed" ? "beginner" : input.audienceLevel,
  };
};

export const buildDeterministicDeck = (input: GenerateDeckInput): Deck => {
  const createdAt = nowIso();
  const topic = input.topic.trim();
  const onboardingLike = /\bonboarding\b/i.test(input.presentationBrief ?? "");
  const groundedHighlights = extractGroundingHighlights(input.groundingSummary);
  const targetSlideCount = resolveTargetSlideCount(input);
  const storyline = input.plan?.storyline ?? [
    "orientation",
    "structure",
    "example",
    "recap",
  ];
  const sourceType =
    input.groundingSourceType ??
    ((input.groundingSourceIds?.length ?? 0) > 0 ? "mixed" : "topic");

  const baseSlides: Slide[] = [
    {
      id: createId("slide"),
      order: 0,
      title: onboardingLike ? `Welcome to ${topic}` : `Welcome to ${topic}`,
      learningGoal: onboardingLike
        ? `Orient new team members to ${topic}, why it matters, and what they should notice first.`
        : `Understand what ${topic} is, why it matters, and what the audience should notice first.`,
      keyPoints: pickGroundedPoints(groundedHighlights, 0, [
        `${topic} matters because it connects to a real user or business need.`,
        `The presentation will build a clear mental model before adding detail.`,
        "The goal is understanding the main thread, not memorizing isolated facts.",
      ]),
      requiredContext: [],
      speakerNotes: [
        "Open directly to the audience and explain the topic in plain language.",
      ],
      beginnerExplanation: `${topic} becomes easier to understand when we start from the main idea, then move into structure, and only then look at examples and details.`,
      advancedExplanation: `${topic} should be introduced as one coherent thread so the audience understands the relationship between purpose, structure, and concrete application.`,
      examples: groundedHighlights.slice(0, 2),
      likelyQuestions: [
          onboardingLike
            ? `Why does ${topic} matter to a new team member?`
            : `Why should someone care about ${topic}?`,
        `What will the audience understand by the end?`,
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Use a clean opening slide with a clear value statement."],
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "C96F4A",
        eyebrow: "Opening",
        heroStatement: `${topic} should feel immediately relevant, concrete, and easy to follow.`,
        cards: makeCards(createId("tmp"), pickGroundedPoints(groundedHighlights, 0, [
          "Start with the main value of the topic.",
          "Set a clear mental model for the audience.",
          "Keep the opening concrete and audience-facing.",
        ]), ["accent", "info", "success"]),
        callouts: [
          {
            id: createId("callout"),
            label: "Opening cue",
            text: "Speak to the audience, not about the presentation process.",
            tone: "warning",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A refined opening visual for ${topic} with strong editorial composition and audience-facing energy.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a polished opening illustration for ${topic} that communicates relevance and clarity.`,
            caption: "Start with meaning, then move into structure.",
            altText: `${topic} opening illustration`,
            style: "editorial",
            tone: "accent",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 1,
      title: `The core structure of ${topic}`,
      learningGoal: `Explain the main components or service areas that define ${topic}.`,
      keyPoints: pickGroundedPoints(groundedHighlights, 3, [
        "Break the topic into a few stable building blocks.",
        "Show how the parts connect instead of listing disconnected facts.",
        "Keep the audience oriented around the same main thread.",
      ]),
      requiredContext: [`The opening explanation of ${topic}.`],
      speakerNotes: ["Use a visual structure that makes the topic easier to reason about."],
      beginnerExplanation: `This slide turns the opening idea into a clearer structure, so the audience can see the main parts and how they fit together.`,
      advancedExplanation: `A stable structure reduces cognitive load and makes later examples easier to interpret correctly.`,
      examples: groundedHighlights.slice(1, 3),
      likelyQuestions: [
        `Which parts of ${topic} matter most?`,
        "How do the main elements fit together?",
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Use a flow or structured board rather than a text wall."],
      visuals: {
        layoutTemplate: "three-step-flow",
        accentColor: "2B6CF0",
        eyebrow: "Structure",
        heroStatement: `${topic} becomes clearer when the audience can track a few visible parts and their relationships.`,
        cards: makeCards(createId("tmp"), pickGroundedPoints(groundedHighlights, 3, [
          "Identify the main elements.",
          "Explain how they connect.",
          "Keep the story coherent across slides.",
        ]), ["info", "accent", "success"]),
        callouts: [],
        diagramNodes: [
          { id: "structure-1", label: "Context", tone: "info" },
          { id: "structure-2", label: "Core", tone: "accent" },
          { id: "structure-3", label: "Outcome", tone: "success" },
        ],
        diagramEdges: [
          { from: "structure-1", to: "structure-2", label: "frames" },
          { from: "structure-2", to: "structure-3", label: "drives" },
        ],
        imagePrompt: `A modern structural diagram for ${topic} with a clear flow and restrained styling.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a diagram-led visual for ${topic} that makes the core structure easy to follow.`,
            caption: "Show the structure, not just the labels.",
            altText: `${topic} structure illustration`,
            style: "diagram",
            tone: "info",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 2,
      title: `${topic} in practice`,
      learningGoal: `Connect the topic to a concrete scenario, example, or use case.`,
      keyPoints: pickGroundedPoints(groundedHighlights, 6, [
        `Show one realistic scenario where ${topic} becomes tangible.`,
        "Tie the example back to the structure from the previous slide.",
        "Make the audience see what quality looks like in practice.",
      ]),
      requiredContext: [`The core structure of ${topic}.`],
      speakerNotes: ["Stay concrete and keep the example aligned with the slide visuals."],
      beginnerExplanation: `A concrete example helps the audience connect the abstract idea to something they can picture and remember.`,
      advancedExplanation: `Applied context reveals tradeoffs, user impact, and the practical meaning of the structure introduced earlier.`,
      examples: groundedHighlights.slice(2, 4),
      likelyQuestions: [
        `What does ${topic} look like in a real situation?`,
        "What would a good outcome feel like to the user?",
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Use an example-led layout with one clear scenario."],
      visuals: {
        layoutTemplate: "two-column-callouts",
        accentColor: "B7821D",
        eyebrow: "Example",
        heroStatement: `The audience should now see ${topic} as something concrete, not abstract.`,
        cards: makeCards(createId("tmp"), pickGroundedPoints(groundedHighlights, 6, [
          "Start from a concrete scenario.",
          "Explain the turning point or decision.",
          "Make the result visible to the audience.",
        ]), ["accent", "warning", "success"]),
        callouts: [
          {
            id: createId("callout"),
            label: "Concrete takeaway",
            text: "If the audience can picture one realistic scenario, the concept is more likely to stick.",
            tone: "info",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A polished scenario illustration for ${topic} with a clear real-world context.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create an editorial case-style illustration for ${topic} with one realistic scenario and visible outcome.`,
            caption: "Ground the concept in one believable example.",
            altText: `${topic} practical example illustration`,
            style: "editorial",
            tone: "warning",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 3,
      title: `Key takeaways and next steps`,
      learningGoal: `Close the presentation by reinforcing the core thread and giving the audience one next action.`,
      keyPoints: [
        `Return to the main value of ${topic}.`,
        "Repeat the structure in a compressed form.",
        "End with one clear next step or reflection prompt.",
      ],
      requiredContext: [`The earlier explanation of ${topic}.`],
      speakerNotes: ["Finish crisply and avoid introducing a brand new idea."],
      beginnerExplanation: `A good ending should help the audience remember the main idea and know what to do with it next.`,
      advancedExplanation: `The close should compress the presentation into a reusable model, not reopen the scope.`,
      examples: groundedHighlights.slice(0, 2),
      likelyQuestions: [
        `What should the audience remember about ${topic}?`,
      ],
      canSkip: true,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Use a summary board rather than another dense content slide."],
      visuals: {
        layoutTemplate: "summary-board",
        accentColor: "8D64D6",
        eyebrow: "Recap",
        heroStatement: `${topic} should end as one memorable thread with one clear next step.`,
        cards: makeCards(createId("tmp"), [
          `Main idea: ${topic} should now feel easier to explain.`,
          "Working model: remember the structure and the example together.",
          "Next step: ask what you would show or explain first to another person.",
        ], ["accent", "neutral", "success"]),
        callouts: [
          {
            id: createId("callout"),
            label: "Audience check",
            text: `Can you now explain ${topic} in a few sentences and connect it to one concrete example?`,
            tone: "info",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A refined recap board for ${topic} with memory cues and a clear next action.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a recap-style visual for ${topic} with a polished summary board and one highlighted next step.`,
            caption: "End with a visual the audience can remember.",
            altText: `${topic} recap illustration`,
            style: "abstract",
            tone: "success",
          },
        ],
      },
    },
  ];

  const slides: Slide[] = Array.from({ length: targetSlideCount }, (_, index) => {
    if (index < baseSlides.length) {
      const slide = baseSlides[index]!;
      return {
        ...slide,
        order: index,
      };
    }

    const storylineLabel = storyline[index] ?? `extra teaching beat ${index - baseSlides.length + 1}`;
    const extraHighlights = pickGroundedPoints(groundedHighlights, index * 2, [
      `Add one more concrete angle on ${topic} without changing the main thread.`,
      "Use the extra time to deepen understanding, not to introduce a new topic.",
      "Keep the pacing smooth and visually consistent.",
    ]);
    return {
      id: createId("slide"),
      order: index,
      title: `${topic}: ${storylineLabel}`,
      learningGoal: `Extend the audience's understanding of ${topic} while staying on the same storyline.`,
      keyPoints: extraHighlights,
      requiredContext: [`The earlier slides about ${topic}.`],
      speakerNotes: ["Use this extension slide to deepen or reinforce, not to branch into a side topic."],
      beginnerExplanation: `This slide adds one more coherent teaching beat so the pacing matches the requested length without breaking the storyline.`,
      advancedExplanation: `This extension slide reinforces the same conceptual thread and keeps the deck aligned with the requested duration.`,
      examples: groundedHighlights.slice(index, index + 2),
      likelyQuestions: [`How does this deepen the main story about ${topic}?`],
      canSkip: true,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Keep the design aligned with the rest of the deck."],
      visuals: {
        layoutTemplate: index % 2 === 0 ? "two-column-callouts" : "summary-board",
        accentColor: index % 2 === 0 ? "1C7C7D" : "8D64D6",
        eyebrow: "Extended depth",
        heroStatement: `This slide adds depth while staying inside the same narrative about ${topic}.`,
        cards: makeCards(createId("tmp"), extraHighlights, ["accent", "info", "success"]),
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A consistent editorial visual for an extended teaching slide about ${topic}.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a varied but stylistically consistent illustration for an extended teaching slide about ${topic}.`,
            caption: "Extend the idea without changing the storyline.",
            altText: `${topic} extended depth illustration`,
            style: "editorial",
            tone: "accent",
          },
        ],
      },
    };
  });

  return {
    id: createId("deck"),
    title: input.plan?.title || `${topic}: interactive introduction`,
    topic,
    summary:
      groundedHighlights[0] ??
      `A coherent, beginner-friendly presentation about ${topic}.`,
    pedagogicalProfile: input.pedagogicalProfile,
    source: {
      type: sourceType,
      topic,
      sourceIds: input.groundingSourceIds ?? [],
    },
    slides,
    createdAt,
    updatedAt: createdAt,
    metadata: {
      estimatedDurationMinutes:
        input.targetDurationMinutes ??
        Math.max(3, Math.round(targetSlideCount / 1.25)),
      tags: [
        "deterministic-fallback",
        "teaching",
        "interactive-presentation",
        ...(input.groundingSummary ? ["externally-grounded"] : []),
      ],
      language: "en",
    },
  };
};

export const buildDeterministicNarration = (
  input: GenerateNarrationInput,
): SlideNarration => {
  const nextSlide = input.deck.slides[input.slide.order + 1];
  const prefersBeginnerFriendlyLanguage =
    input.deck.pedagogicalProfile.audienceLevel === "beginner";
  const normalizeNarrationSentence = (value: string): string => {
    const normalized = value.replace(/\s+/g, " ").trim().replace(/^[\-\u2022*\d.)\s]+/, "");
    if (!normalized) {
      return "";
    }

    return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  };

  const prefixNarrationSentence = (prefix: string, value: string): string => {
    const normalized = normalizeNarrationSentence(value).replace(/[.!?]+$/g, "");
    if (!normalized) {
      return "";
    }

    const lowered = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    return `${prefix}${lowered}.`;
  };

  const segments =
    input.slide.order === 0
      ? [
          `${input.deck.topic} matters because it connects to a concrete need, not just an abstract idea.`,
          normalizeNarrationSentence(input.slide.beginnerExplanation),
          prefixNarrationSentence(
            "One thing to hold onto immediately is that ",
            input.slide.keyPoints[0] ??
              input.slide.examples[0] ??
              input.slide.beginnerExplanation,
          ),
          prefixNarrationSentence(
            "Another point to carry forward is that ",
            input.slide.keyPoints[1] ??
              input.slide.examples[0] ??
              input.slide.keyPoints[2] ??
              (prefersBeginnerFriendlyLanguage
                ? input.slide.beginnerExplanation
                : input.slide.advancedExplanation),
          ),
        ]
      : [
          `${input.slide.title} makes this part of the topic more concrete and easier to follow.`,
          normalizeNarrationSentence(input.slide.beginnerExplanation),
          prefixNarrationSentence(
            "One practical takeaway here is that ",
            input.slide.keyPoints[0] ??
              input.slide.examples[0] ??
              (prefersBeginnerFriendlyLanguage
                ? input.slide.beginnerExplanation
                : input.slide.advancedExplanation),
          ),
        ];

  const narration = segments.join(" ");

  return {
    slideId: input.slide.id,
    narration,
    segments,
    summaryLine: input.slide.learningGoal,
    promptsForPauses: [
      "Pause me if you want that explained more simply.",
      "Ask for a concrete example if you want something less abstract.",
    ],
    suggestedTransition:
      nextSlide
        ? `Bridge directly into ${nextSlide.title}.`
        : "End with a concise recap and one understanding check.",
  };
};

export const buildDeterministicReview = (input: {
  deck: Deck;
  validationIssues: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
    slideId?: string;
  }>;
  repairedNarrations?: SlideNarration[] | undefined;
  note?: string | undefined;
}): PresentationReview => {
  const issues: PresentationQualityIssue[] = input.validationIssues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    dimension:
      issue.code.includes("narration")
        ? "narration"
        : issue.code.includes("visual")
          ? "visual"
          : issue.code.includes("ground")
            ? "grounding"
            : "coherence",
    message: issue.message,
    ...(issue.slideId ? { slideId: issue.slideId } : {}),
  }));

  const hasError = issues.some((issue) => issue.severity === "error");
  const scorePenalty = issues.reduce((sum, issue) => {
    switch (issue.severity) {
      case "error":
        return sum + 0.18;
      case "warning":
        return sum + 0.06;
      case "info":
      default:
        return sum + 0.02;
    }
  }, 0);

  return {
    approved: !hasError,
    overallScore: Math.max(0.55, Number((0.92 - scorePenalty).toFixed(2))),
    summary:
      input.note ??
      "Deterministic quality review used because the LLM review step was unavailable.",
    issues,
    repairedNarrations: input.repairedNarrations ?? [],
  };
};
