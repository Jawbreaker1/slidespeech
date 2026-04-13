import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PresentationReview,
  SummarizeSectionInput,
  TransformExplanationInput,
  PresentationPlan,
  ReviewPresentationInput,
  Deck,
  SlideNarration,
} from "@slidespeech/types";

import { createId, healthy, nowIso, splitTextIntoSegments } from "../shared";

const makePlan = (
  topic: string,
  options?: { targetDurationMinutes?: number; targetSlideCount?: number },
): PresentationPlan => ({
  title: `${topic}: from basics to intuition`,
  learningObjectives: [
    `Understand the core idea behind ${topic}`,
    `See how ${topic} is used in practice`,
    `Explain ${topic} in your own words`,
  ],
  storyline: [
    "Why the topic matters",
    "How it works step by step",
    "Examples, pitfalls, and recap",
  ],
  recommendedSlideCount:
    options?.targetSlideCount ??
    (options?.targetDurationMinutes
      ? Math.max(4, Math.min(12, Math.round(options.targetDurationMinutes * 1.25)))
      : 4),
  audienceLevel: "beginner",
});

const resolveTargetSlideCount = (input: GenerateDeckInput): number =>
  input.targetSlideCount ??
  input.plan?.recommendedSlideCount ??
  (input.targetDurationMinutes
    ? Math.max(4, Math.min(12, Math.round(input.targetDurationMinutes * 1.25)))
    : 4);

const makeCards = (
  points: string[],
  tones: Array<"accent" | "neutral" | "success" | "warning" | "info">,
) =>
  points.slice(0, 3).map((point, index) => {
    const [head, ...rest] = point.split(":");
    const title =
      rest.length > 0 && typeof head === "string" && head.trim().length > 0
        ? head.trim()
        : `Point ${index + 1}`;
    const body = (rest.length > 0 ? rest.join(":") : point).trim();

    return {
      id: createId("card"),
      title,
      body,
      tone: tones[index] ?? "neutral",
    };
  });

const buildDeck = (input: GenerateDeckInput): Deck => {
  const topic = input.topic.trim();
  const title = `${topic}: interactive introduction`;
  const createdAt = nowIso();
  const wasGrounded = Boolean(input.groundingSummary?.trim());

  const baseSlides: Deck["slides"] = [
    {
      id: createId("slide"),
      order: 0,
      title: `Why ${topic} matters and what you will learn`,
      learningGoal: `Build motivation, scope, and a clear mental model for ${topic}.`,
      keyPoints: [
        `${topic} solves a concrete problem or unlocks a useful capability.`,
        `This presentation will move from intuition to structure to concrete examples.`,
        "Start with intuition before terminology.",
        "The goal is understanding, not memorization.",
      ],
      requiredContext: [],
      speakerNotes: [
        "Start from the learner's everyday context, explain why the topic matters now, and preview the path through the presentation.",
      ],
      beginnerExplanation: `${topic} matters because it helps someone move from vague intuition to a clearer way of thinking and acting. In this presentation, we will first build a simple mental model, then break the topic into parts, and finally connect it to a concrete example. The goal is that the learner understands not just what ${topic} is, but why it is useful and how the pieces fit together.`,
      advancedExplanation: `${topic} combines a conceptual model, a method, and often an operational workflow that generalizes across multiple problems. A strong introduction should establish motivation, scope, and the sequence of ideas that follow so later slides feel like a logical expansion rather than a topic switch.`,
      examples: [
        `If you need to explain ${topic} to a colleague, start with why someone should care.`,
        `A good introduction to ${topic} sounds like: why it matters, how we will break it down, and what example will make it concrete.`,
      ],
      likelyQuestions: [
        `What is ${topic} used for in practice?`,
        `Do I need a technical background to understand ${topic}?`,
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: [
        "Show the value of the topic first, then add details.",
      ],
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "0F766E",
        eyebrow: "Why it matters",
        heroStatement: `${topic} becomes easier to trust and apply when the learner can see its value before the details.`,
        cards: makeCards(
          [
            "Practical value: connect the topic to a real learner need.",
            "Mental model: build intuition before terminology.",
            "Teaching goal: understanding beats memorization.",
          ],
          ["accent", "info", "success"],
        ),
        callouts: [
          {
            id: createId("callout"),
            label: "Teaching cue",
            text: "Open with the learner's problem, not the system's architecture.",
            tone: "warning",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A clean educational keynote-style slide about why ${topic} matters, with warm accent color and simple cards.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create an editorial-style visual that shows why ${topic} matters to a learner before any technical detail is introduced.`,
            caption: "Lead with motivation, then structure.",
            altText: `${topic} value illustration`,
            style: "editorial",
            tone: "accent",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 1,
      title: `${topic} in three building blocks`,
      learningGoal: `Break ${topic} into simple components.`,
      keyPoints: [
        "Input: what the system receives.",
        "Processing: how understanding or transformation happens.",
        "Output: what the user gets back.",
      ],
      requiredContext: [`The overall value of ${topic}.`],
      speakerNotes: [
        "Use simple words before jargon and compare the flow to something familiar.",
      ],
      beginnerExplanation: `${topic} becomes easier to understand if we split it into what goes in, what happens in the middle, and what comes out.`,
      advancedExplanation: `${topic} can often be described as a pipeline with clear interfaces between ingestion, processing, and delivery.`,
      examples: [
        `Think of ${topic} like a kitchen: ingredients come in, cooking happens in the middle, and a finished dish is served.`,
      ],
      likelyQuestions: [
        "Which part is hardest to build first?",
        "Can one part be replaced without rebuilding everything?",
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: ["Three blocks with clear arrows between the steps."],
      visuals: {
        layoutTemplate: "three-step-flow",
        accentColor: "2563EB",
        eyebrow: "Core structure",
        heroStatement: `${topic} is easiest to learn when the learner can track a simple flow from input to output.`,
        cards: makeCards(
          [
            "Input: what enters the system or lesson.",
            "Processing: where reasoning, transformation, or teaching happens.",
            "Output: what the learner or user gets back.",
          ],
          ["info", "accent", "success"],
        ),
        callouts: [
          {
            id: createId("callout"),
            label: "Design principle",
            text: "Keep interfaces visible so the learner can swap one part mentally without losing the whole system.",
            tone: "neutral",
          },
        ],
        diagramNodes: [
          { id: "input", label: "Input", tone: "info" },
          { id: "processing", label: "Processing", tone: "accent" },
          { id: "output", label: "Output", tone: "success" },
        ],
        diagramEdges: [
          { from: "input", to: "processing", label: "enters" },
          { from: "processing", to: "output", label: "becomes" },
        ],
        imagePrompt: `A clear three-step process diagram for ${topic}, with modern boxes and directional arrows.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a process-oriented diagram for ${topic} with three clear stages and strong directional flow.`,
            caption: "Three visible stages make the system teachable.",
            altText: `${topic} flow diagram`,
            style: "diagram",
            tone: "info",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 2,
      title: `A concrete example of ${topic}`,
      learningGoal: `Ground the topic in a concrete scenario.`,
      keyPoints: [
        "Start from a clear user scenario.",
        "Follow the data or decisions through the flow.",
        "Point out what the user notices about system quality.",
      ],
      requiredContext: [`The three building blocks of ${topic}.`],
      speakerNotes: [
        "Keep the example consistent and tie it back to the building blocks.",
      ],
      beginnerExplanation: `When ${topic} is tied to a concrete use case, it becomes clearer why each part of the solution exists.`,
      advancedExplanation: `Following a realistic use case makes it possible to reason about tradeoffs, failure modes, and responsibility boundaries between modules.`,
      examples: [
        `If the topic is machine learning, the example could be a system that sorts incoming support tickets.`,
      ],
      likelyQuestions: [
        "What happens if the input quality is poor?",
        "How do you know the result is good?",
      ],
      canSkip: false,
      dependenciesOnOtherSlides: [],
      visualNotes: ["A scenario with input, a decision point, and an outcome."],
      visuals: {
        layoutTemplate: "two-column-callouts",
        accentColor: "B45309",
        eyebrow: "Concrete scenario",
        heroStatement: `A believable example makes ${topic} easier to remember and critique.`,
        cards: makeCards(
          [
            "Scenario: pick one learner-facing use case.",
            "Decision point: show what the system or teacher must choose.",
            "Outcome: explain what quality feels like to the user.",
          ],
          ["accent", "warning", "success"],
        ),
        callouts: [
          {
            id: createId("callout"),
            label: "Example",
            text: `Imagine using ${topic} in a support workflow where the system must make one clear decision before producing an answer.`,
            tone: "info",
          },
          {
            id: createId("callout"),
            label: "Learner check",
            text: "Ask what would break first if the input became noisy or incomplete.",
            tone: "warning",
          },
        ],
        diagramNodes: [
          { id: "scenario", label: "Scenario", tone: "info" },
          { id: "decision", label: "Decision", tone: "warning" },
          { id: "outcome", label: "Outcome", tone: "success" },
        ],
        diagramEdges: [
          { from: "scenario", to: "decision", label: "triggers" },
          { from: "decision", to: "outcome", label: "shapes" },
        ],
        imagePrompt: `A polished case-study slide for ${topic} with a scenario panel and highlighted decision point.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a case-study illustration for ${topic} with one realistic scenario, a highlighted decision point, and a visible outcome.`,
            caption: "Concrete scenarios make abstract systems memorable.",
            altText: `${topic} case-study illustration`,
            style: "editorial",
            tone: "warning",
          },
        ],
      },
    },
    {
      id: createId("slide"),
      order: 3,
      title: `Summary and next steps`,
      learningGoal: `Tie the topic together and give a clear path forward.`,
      keyPoints: [
        "Return to the value of the topic.",
        "Repeat the model and the example.",
        "Give one concrete next step for continued learning.",
      ],
      requiredContext: [`The full introduction to ${topic}.`],
      speakerNotes: [
        "End with a short recap and one question that checks understanding.",
      ],
      beginnerExplanation: `A good summary helps the most important ideas stick even if the details fade.`,
      advancedExplanation: `The closing synthesis should reduce cognitive load while opening the door to deeper study.`,
      examples: [
        `Ask the learner to describe the topic in one sentence and give their own example.`,
      ],
      likelyQuestions: [
        "What should I try on my own after this?",
      ],
      canSkip: true,
      dependenciesOnOtherSlides: [],
      visualNotes: ["A short checklist and one clear next step."],
      visuals: {
        layoutTemplate: "summary-board",
        accentColor: "7C3AED",
        eyebrow: "Wrap-up",
        heroStatement: `A strong finish compresses ${topic} into a few reusable ideas and one next action.`,
        cards: makeCards(
          [
            "Core value: why the topic matters.",
            "Working model: the simple structure to remember.",
            "Next step: one concrete action after the lesson.",
          ],
          ["accent", "neutral", "success"],
        ),
        callouts: [
          {
            id: createId("callout"),
            label: "Prompt",
            text: "Can the learner restate the topic in one sentence and add their own example?",
            tone: "info",
          },
          {
            id: createId("callout"),
            label: "Next move",
            text: `Try explaining ${topic} aloud using only the three most important ideas.`,
            tone: "success",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: `A summary slide for ${topic} with a checklist board, one highlighted next step, and refined editorial styling.`,
        imageSlots: [
          {
            id: createId("image"),
            prompt: `Create a refined summary board for ${topic} with a checklist feel and one highlighted next step.`,
            caption: "End with a picture the learner can remember.",
            altText: `${topic} summary visual`,
            style: "abstract",
            tone: "success",
          },
        ],
      },
    },
  ];

  const targetSlideCount = resolveTargetSlideCount(input);
  const slides =
    targetSlideCount <= baseSlides.length
      ? baseSlides.slice(0, targetSlideCount).map((slide, index) => ({
          ...slide,
          order: index,
        }))
      : [
          ...baseSlides.map((slide, index) => ({
            ...slide,
            order: index,
          })),
          ...Array.from({ length: targetSlideCount - baseSlides.length }, (_, extraIndex) => {
            const order = baseSlides.length + extraIndex;
            return {
              id: createId("slide"),
              order,
              title: `${topic}: focused teaching point ${extraIndex + 1}`,
              learningGoal: `Expand ${topic} with one additional teaching step.`,
              keyPoints: [
                `Extend the learner's mental model of ${topic}.`,
                "Add one more concrete point without changing the main storyline.",
                "Keep the presentation pacing smooth and coherent.",
              ],
              requiredContext: [`The earlier explanation of ${topic}.`],
              speakerNotes: [
                "Use this slide only when the requested presentation length needs more depth or pacing.",
              ],
              beginnerExplanation: `This extra slide adds one more teaching beat so the presentation matches the requested length without changing the main story.`,
              advancedExplanation: `This slide exists to expand pacing and coverage while staying aligned with the same topic and structure.`,
              examples: [
                `Use an extra example, comparison, or recap element to deepen understanding of ${topic}.`,
              ],
              likelyQuestions: [
                `How does this extra point strengthen understanding of ${topic}?`,
              ],
              canSkip: true,
              dependenciesOnOtherSlides: [],
              visualNotes: ["Keep the visual simple and consistent with the surrounding slides."],
              visuals: {
                layoutTemplate: "two-column-callouts" as const,
                accentColor: "1C7C7D",
                eyebrow: "Extended pacing",
                heroStatement: `An extra teaching beat keeps the presentation aligned with the requested duration.`,
                cards: makeCards(
                  [
                    "Depth: add one more clear point.",
                    "Pacing: give the learner time to absorb the topic.",
                    "Coherence: stay on the same main thread.",
                  ],
                  ["accent", "info", "success"],
                ),
                callouts: [],
                diagramNodes: [],
                diagramEdges: [],
                imagePrompt: `An editorial teaching visual for an extra pacing slide about ${topic}.`,
                imageSlots: [
                  {
                    id: createId("image"),
                    prompt: `Create a consistent editorial visual for an additional pacing slide about ${topic}.`,
                    caption: "Extra depth without changing the story.",
                    altText: `${topic} extended pacing illustration`,
                    style: "editorial" as const,
                    tone: "accent" as const,
                  },
                ],
              },
            };
          }),
        ];

  return {
    id: createId("deck"),
    title,
    topic,
    summary: `A pedagogical introduction to ${topic} focused on intuition, structure, and examples.`,
    pedagogicalProfile: input.pedagogicalProfile,
    source: {
      type: input.groundingSourceType ?? (wasGrounded ? "mixed" : "topic"),
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
        "mvp",
        "teaching",
        "interactive-presentation",
        ...(wasGrounded ? ["externally-augmented"] : []),
      ],
      language: "en",
    },
  };
};

const buildNarration = (input: GenerateNarrationInput): SlideNarration => {
  const narration =
    input.slide.order === 0
      ? [
          `${input.slide.title}.`,
          `First, let us establish why ${input.deck.topic} matters to the learner.`,
          input.slide.beginnerExplanation,
          `As you listen, keep these anchors in mind: ${input.slide.keyPoints.slice(0, 3).join(", ")}.`,
          `In the next slide, we will turn that motivation into a clearer structure.`,
        ].join(" ")
      : [
          `${input.slide.title}.`,
          input.slide.beginnerExplanation,
          `Focus especially on: ${input.slide.keyPoints.join(", ")}.`,
        ].join(" ");

  return {
    slideId: input.slide.id,
    narration,
    segments: splitTextIntoSegments(narration),
    summaryLine: input.slide.learningGoal,
    promptsForPauses: [
      "Say stop if you want to pause.",
      "Ask for a simpler example if something feels abstract.",
    ],
    suggestedTransition:
      input.slide.order === input.deck.slides.length - 1
        ? "End with a recap and a quick understanding check."
        : "Tie off the main idea and move to the next slide.",
  };
};

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  async healthCheck() {
    return healthy(this.name, "Mock provider is always available.");
  }

  async planPresentation(input: {
    topic: string;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
  }): Promise<PresentationPlan> {
    return makePlan(input.topic, {
      ...(input.targetDurationMinutes !== undefined
        ? { targetDurationMinutes: input.targetDurationMinutes }
        : {}),
      ...(input.targetSlideCount !== undefined
        ? { targetSlideCount: input.targetSlideCount }
        : {}),
    });
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    return buildDeck(input);
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    return buildNarration(input);
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    return {
      text: `Short answer to "${input.question}": ${input.slide.beginnerExplanation} A concrete example is: ${input.slide.examples[0] ?? "start with a simple user scenario."}`,
      followUpPrompt: "Do you want a simpler explanation or a deeper one?",
    };
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return {
      text: input.slide.beginnerExplanation,
      followUpPrompt: "Do you want a more everyday example too?",
    };
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return {
      text: input.slide.advancedExplanation,
      followUpPrompt: "Should I connect this back to the architecture as well?",
    };
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return {
      text: input.slide.examples.join(" "),
      followUpPrompt: "Do you want an even more concrete scenario?",
    };
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    return {
      text: input.slides
        .map((slide) => `${slide.title}: ${slide.learningGoal}`)
        .join(" "),
      followUpPrompt: "Do you want to continue or revisit a slide?",
    };
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    const repairedNarrations = input.deck.slides.flatMap((slide) => {
      const narration = input.narrations.find(
        (candidate) => candidate.slideId === slide.id,
      );
      const narrationWords = [
        narration?.narration ?? "",
        ...(narration?.segments ?? []),
      ]
        .join(" ")
        .toLowerCase();

      if (
        narration &&
        narration.segments.length >= (slide.order === 0 ? 4 : 3) &&
        slide.keyPoints.some((point) =>
          narrationWords.includes(point.split(" ")[0]?.toLowerCase() ?? ""),
        )
      ) {
        return [];
      }

      return [
        buildNarration({
          deck: input.deck,
          slide,
          pedagogicalProfile: input.pedagogicalProfile,
        }),
      ];
    });

    return {
      approved: repairedNarrations.length === 0,
      overallScore: repairedNarrations.length === 0 ? 0.92 : 0.74,
      summary:
        repairedNarrations.length === 0
          ? "The deck and narrations are coherent enough to present."
          : "Some narrations were too weakly anchored to their slides and were rewritten.",
      issues: repairedNarrations.map((narration) => ({
        code: "narration_alignment_repair",
        severity: "warning" as const,
        dimension: "narration" as const,
        message: "Narration was rewritten to align more tightly with the current slide.",
        slideId: narration.slideId,
      })),
      repairedNarrations,
    };
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    const plan = (value: ConversationTurnPlan): ConversationTurnPlan => value;
    const text = input.text.trim();
    const lowerText = text.toLowerCase();

    if (/^(stop|pause|hold on)\b/i.test(text)) {
      return plan({
        interruptionType: "stop",
        inferredNeeds: ["pause", "navigation"],
        responseMode: "ack_pause",
        runtimeEffects: { pause: true },
        confidence: 0.96,
        rationale: "Direct pause language was used.",
      });
    }

    if (/^(continue|resume|go on)\b/i.test(text)) {
      return plan({
        interruptionType: "continue",
        inferredNeeds: ["resume", "navigation"],
        responseMode: "ack_resume",
        runtimeEffects: { resume: true },
        confidence: 0.96,
        rationale: "Direct resume language was used.",
      });
    }

    if (/^(back)\b/i.test(text) || /go back|previous slide/i.test(text)) {
      return plan({
        interruptionType: "back",
        inferredNeeds: ["navigation"],
        responseMode: "ack_back",
        runtimeEffects: { goToPreviousSlide: true },
        confidence: 0.93,
        rationale: "The user asked to move backward in the presentation.",
      });
    }

    const confusion =
      /explain simpler|simpler|make it simpler|i don't get|i do not get|confused|i'm lost|im lost|too hard|not following|unclear/i.test(
        lowerText,
      );
    const wantsExample =
      /give .*example|\bexample\b|show me an example|concrete example/i.test(
        lowerText,
      );
    const wantsDepth =
      /go deeper|deepen|more detail|under the hood|advanced|technical detail/i.test(
        lowerText,
      );
    const wantsRepeat =
      /^repeat\b|say that again|repeat that|restate|again/i.test(lowerText);
    const soundsLikeQuestion =
      text.endsWith("?") ||
      /\b(what|why|how|when|where|which|who)\b/i.test(lowerText) ||
      /\b(can you|could you|would you|help me understand)\b/i.test(lowerText);

    if (wantsExample && !soundsLikeQuestion) {
      return plan({
        interruptionType: "example",
        inferredNeeds: ["example"],
        responseMode: "example",
        runtimeEffects: {},
        confidence: 0.9,
        rationale: "The user directly asked for an example.",
      });
    }

    if (wantsDepth && !soundsLikeQuestion) {
      return plan({
        interruptionType: "deepen",
        inferredNeeds: ["deepen"],
        responseMode: "deepen",
        runtimeEffects: {},
        confidence: 0.88,
        rationale: "The user directly asked for a deeper explanation.",
      });
    }

    if (wantsRepeat && !soundsLikeQuestion) {
      return plan({
        interruptionType: "repeat",
        inferredNeeds: ["repeat"],
        responseMode: "repeat",
        runtimeEffects: { restartCurrentSlide: true },
        confidence: 0.92,
        rationale: "The user asked to hear the explanation again.",
      });
    }

    if (confusion && !soundsLikeQuestion) {
      return plan({
        interruptionType: "simplify",
        inferredNeeds: ["confusion"],
        responseMode: "simplify",
        runtimeEffects: {
          adaptDetailLevel: "light",
          adaptPace: "slow",
          restartCurrentSlide: true,
        },
        confidence: 0.84,
        rationale: "The user expressed confusion and needs a simpler explanation.",
      });
    }

    return plan({
      interruptionType: "question",
      inferredNeeds: confusion ? ["confusion", "question"] : ["question"],
      responseMode: "question",
      runtimeEffects: confusion
        ? {
            adaptDetailLevel: "light",
            adaptPace: "slow",
            restartCurrentSlide: true,
          }
        : {},
      confidence: confusion ? 0.78 : 0.74,
      rationale: confusion
        ? "The turn sounds like a real question plus a sign of confusion."
        : "Treat freeform learner input as a question by default.",
    });
  }
}
