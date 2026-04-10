import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  SummarizeSectionInput,
  TransformExplanationInput,
  PresentationPlan,
  Deck,
  SlideNarration,
} from "@slidespeech/types";

import { createId, healthy, nowIso } from "../shared";

const makePlan = (topic: string): PresentationPlan => ({
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
  recommendedSlideCount: 4,
  audienceLevel: "beginner",
});

const buildDeck = (input: GenerateDeckInput): Deck => {
  const topic = input.topic.trim();
  const title = `${topic}: interactive introduction`;
  const createdAt = nowIso();

  const slides = [
    {
      id: createId("slide"),
      order: 0,
      title: `Why ${topic} is worth learning`,
      learningGoal: `Build motivation and a simple mental model for ${topic}.`,
      keyPoints: [
        `${topic} solves a concrete problem or unlocks a useful capability.`,
        "Start with intuition before terminology.",
        "The goal is understanding, not memorization.",
      ],
      requiredContext: [],
      speakerNotes: [
        "Start from the learner's everyday context and connect the topic to practical value.",
      ],
      beginnerExplanation: `${topic} can be seen as a tool for understanding and shaping a problem space in a more structured way.`,
      advancedExplanation: `${topic} combines a conceptual model, a method, and often an operational workflow that generalizes across multiple problems.`,
      examples: [
        `If you need to explain ${topic} to a colleague, start with why someone should care.`,
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
    },
  ];

  return {
    id: createId("deck"),
    title,
    topic,
    summary: `A pedagogical introduction to ${topic} focused on intuition, structure, and examples.`,
    pedagogicalProfile: input.pedagogicalProfile,
    source: {
      type: "topic",
      topic,
      sourceIds: [],
    },
    slides,
    createdAt,
    updatedAt: createdAt,
    metadata: {
      estimatedDurationMinutes: 6,
      tags: ["mvp", "teaching", "interactive-presentation"],
      language: "en",
    },
  };
};

const buildNarration = (input: GenerateNarrationInput): SlideNarration => ({
  slideId: input.slide.id,
  narration: [
    `${input.slide.title}.`,
    input.slide.beginnerExplanation,
    `Focus especially on: ${input.slide.keyPoints.join(", ")}.`,
  ].join(" "),
  summaryLine: input.slide.learningGoal,
  promptsForPauses: [
    "Say stop if you want to pause.",
    "Ask for a simpler example if something feels abstract.",
  ],
  suggestedTransition:
    input.slide.order === input.deck.slides.length - 1
      ? "End with a recap and a quick understanding check."
      : "Tie off the main idea and move to the next slide.",
});

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";

  async healthCheck() {
    return healthy(this.name, "Mock provider is always available.");
  }

  async planPresentation(input: { topic: string }): Promise<PresentationPlan> {
    return makePlan(input.topic);
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
