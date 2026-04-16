import test from "node:test";
import assert from "node:assert/strict";

import { validateAndRepairDeck, validateAndRepairNarrations } from "@slidespeech/core";
import { DeckSchema, SlideNarrationSchema } from "@slidespeech/types";

test("deck validation normalizes slide order and records validation metadata", () => {
  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "Validation test",
    topic: "State machines",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "State machines",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_1",
        order: 3,
        title: "Intro",
        learningGoal: "Learn the basics.",
        keyPoints: ["State", "Transition", "Flow"],
        beginnerExplanation: "A state machine moves between states.",
        advancedExplanation: "Transitions define control flow.",
      },
    ],
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);

  assert.equal(result.value.slides[0]?.order, 0);
  assert.equal(result.value.metadata.validation?.repaired, true);
  assert.ok((result.value.metadata.validation?.issues.length ?? 0) > 0);
});

test("narration validation reanchors narration that is not tied to the slide", () => {
  const deck = DeckSchema.parse({
    id: "deck_2",
    title: "Volvo deck",
    topic: "Volvo Cars and Safety",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Volvo Cars and Safety",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_1",
        order: 0,
        title: "Why Volvo Safety Matters",
        learningGoal: "Understand why Volvo focuses on safety.",
        keyPoints: ["Cars protect people", "Seatbelts matter", "Safety is a core theme"],
        beginnerExplanation: "Volvo wants people in the car to stay safe.",
        advancedExplanation: "Safety engineering is central to the brand.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const badNarration = SlideNarrationSchema.parse({
    slideId: "slide_1",
    narration: "Let us discuss software deployment pipelines and Git branching.",
    segments: ["Let us discuss software deployment pipelines and Git branching."],
    summaryLine: "Wrong topic",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [badNarration]);

  assert.match(result.value[0]?.narration ?? "", /Volvo|safety|seatbelts|cars/i);
  assert.equal(result.repaired, true);
});

test("narration validation rebuilds audience-facing narration without slide-meta phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_style",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_style_1",
        order: 0,
        title: "Global Delivery and QA Operations",
        learningGoal: "Understand how global delivery and QA operations fit together.",
        keyPoints: [
          "Our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
          "Our reach is European but our delivery is unified.",
          "Whether you are in Sweden or Poland, QA Operations ensures the workflow remains consistent.",
        ],
        beginnerExplanation:
          "The company combines regional teams with one shared way of running QA operations.",
        advancedExplanation:
          "This operating model lets the company scale delivery without losing consistency or oversight.",
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_style_1",
    narration:
      "On this slide, the first key point is that our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
    segments: [
      "On this slide, the first key point is that our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
    ],
    summaryLine: "Weak narration",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration]);
  const narration = result.value[0]?.narration ?? "";

  assert.equal(result.repaired, true);
  assert.doesNotMatch(narration, /on this slide|first key point/i);
  assert.match(narration, /System Verification|QA operations|delivery/i);
});

test("deck validation rewrites meta presentation slides into topic-facing content", () => {
  const deck = DeckSchema.parse({
    id: "deck_3",
    title: "Warcraft onboarding",
    topic: "World of Warcraft onboarding",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft onboarding",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta",
        order: 0,
        title: "Visual Storytelling Over Text",
        learningGoal:
          "Select high-quality screenshots to enhance visual storytelling instead of using dense text.",
        keyPoints: [
          "Players remember images better than paragraphs of text.",
          "Use clear, high-resolution in-game screenshots for every slide.",
          "Avoid cluttering slides with too much information at once.",
        ],
        beginnerExplanation:
          "Use screenshots and avoid cluttering slides so the audience stays interested.",
        advancedExplanation:
          "This slide should explain how to design better slides for the rest of the deck.",
        examples: [
          "Compare a text-heavy slide about lore to a single image of a dragon fight.",
        ],
        likelyQuestions: [
          "Where can I find good screenshots?",
        ],
        visualNotes: [
          "Use screenshots instead of text on slides.",
        ],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [
            {
              id: "card_1",
              title: "Key point 1",
              body: "Players remember images better than paragraphs of text.",
              tone: "accent",
            },
          ],
          callouts: [
            {
              id: "callout_1",
              label: "Example",
              text: "Compare a text-heavy slide about lore to a single image.",
              tone: "info",
            },
          ],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-13T19:00:00.000Z",
    updatedAt: "2026-04-13T19:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.equal(result.repaired, true);
  assert.ok(
    result.issues.some((issue) => issue.code === "meta_presentation_slide_repaired"),
  );
  assert.ok(repairedSlide);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /for every slide|avoid clutter|text-heavy slide|use screenshots/i,
  );
  assert.match(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /World of Warcraft onboarding/i,
  );
});

test("deck validation does not allow generic presentation prompts to disable meta-slide repair", () => {
  const deck = DeckSchema.parse({
    id: "deck_4",
    title: "Company onboarding",
    topic: "Create an onboarding presentation about our company",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Create an onboarding presentation about our company",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_1",
        order: 0,
        title: "Welcome: Why This Matters",
        learningGoal: "Orient the audience to the importance of structured onboarding presentations.",
        keyPoints: [
          "Onboarding sets the tone for a new employee's entire journey.",
          "Clear introductions reduce early turnover and confusion.",
          "This session provides a blueprint for your first deck.",
        ],
        beginnerExplanation:
          "This slide explains why structured onboarding presentations should be used.",
        advancedExplanation:
          "Use this slide to frame the rest of the presentation process for the audience.",
        examples: ["Think of moving into a new house and getting the keys right away."],
        likelyQuestions: ["How long should this presentation be?"],
        visualNotes: ["Use a clean opening slide for the onboarding presentation."],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_meta_2",
        order: 1,
        title: "How to structure onboarding slides",
        learningGoal: "Show how to create slides that are easy to follow.",
        keyPoints: [
          "Keep every slide visually simple.",
          "Use a short opener before each section.",
          "Avoid clutter and long text blocks.",
        ],
        beginnerExplanation:
          "Good onboarding slides are easier to understand when you avoid clutter.",
        advancedExplanation:
          "This slide gives slide-building guidance instead of company-facing content.",
        examples: ["Replace a dense company slide with one strong image and three bullets."],
        likelyQuestions: ["What should every slide contain?"],
        visualNotes: ["Use clean slide design."],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-13T21:00:00.000Z",
    updatedAt: "2026-04-13T21:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);

  assert.equal(result.repaired, true);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "meta_presentation_slide_repaired" ||
        issue.code === "deck_wide_meta_presentation_repaired",
    ),
  );
  assert.doesNotMatch(
    result.value.slides.map((slide) => slide.keyPoints.join(" ")).join(" "),
    /blueprint for your first deck|what should every slide contain|avoid clutter/i,
  );
});

test("deck-wide meta repair preserves slide-specific facts when they exist", () => {
  const deck = DeckSchema.parse({
    id: "deck_5",
    title: "Foundations of System Verification for New Team Members",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "mixed",
      topic: "System Verification",
      sourceIds: ["https://www.systemverification.com/"],
    },
    slides: [
      {
        id: "slide_meta_3",
        order: 0,
        title: "Our Global QA Operations and Delivery Teams",
        learningGoal:
          "Keep the audience focused on System Verification itself rather than on how slides should be constructed.",
        keyPoints: [
          "System Verification should be understood through one clear audience-facing example, not as slide-building advice.",
          "The audience should leave this moment with a stronger understanding of System Verification, not instructions for how to design slides.",
          "Every visible element should reinforce the main subject: System Verification.",
        ],
        speakerNotes: [
          "Our QA Operations span Sweden, Germany, Poland, Denmark, and Bosnia and Herzegovina.",
        ],
        beginnerExplanation:
          "System Verification should be explained as a concrete subject for the audience, not as guidance about presentation technique.",
        advancedExplanation:
          "This slide should frame System Verification as the actual subject of the talk and remove meta-discussion about how slides are built.",
        examples: [
          "A test case created in Germany is executed by a team member in Poland using the same tools.",
        ],
        likelyQuestions: ["How do time zones affect our workflow?"],
        visualNotes: [
          "Use visuals that clarify System Verification itself rather than explaining presentation mechanics.",
        ],
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [
            {
              id: "callout_1",
              label: "Example",
              text: "A test case created in Germany is executed by a team member in Poland using the same tools.",
              tone: "info",
            },
          ],
          diagramNodes: [
            {
              id: "node_1",
              label: "Key locations include Sweden, Germany, Poland, Denmark, and Bosnia and Herzegovina.",
              tone: "accent",
            },
          ],
          diagramEdges: [],
          imageSlots: [
            {
              id: "image_1",
              prompt: "Create a topic-focused visual for System Verification that avoids presentation-design advice and reinforces the actual subject matter.",
            },
          ],
        },
      },
      {
        id: "slide_meta_4",
        order: 1,
        title: "Meta filler",
        learningGoal: "Use screenshots in every slide.",
        keyPoints: ["Use screenshots in every slide."],
        beginnerExplanation: "Use screenshots in every slide.",
        advancedExplanation: "Use screenshots in every slide.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T08:00:00.000Z",
    updatedAt: "2026-04-14T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "deck_wide_meta_presentation_repaired" ||
        issue.code === "meta_presentation_slide_repaired",
    ),
  );
  assert.match(repairedSlide?.keyPoints.join(" ") ?? "", /Sweden|Germany|Poland|Bosnia/i);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /slide-building advice|how to design slides|main subject/i,
  );
  assert.match(
    repairedSlide?.visuals.imagePrompt ?? "",
    /Global QA Operations|Germany|Poland|System Verification/i,
  );
});

test("meta-slide repair removes imperative onboarding instructions and restores three topic-facing points", () => {
  const deck = DeckSchema.parse({
    id: "deck_6",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_ops",
        order: 1,
        title: "Core Service Pillars and AI Acceleration",
        learningGoal: "Understand how core services work here.",
        keyPoints: [
          "These pillars function as integrated modules within our Quality Management solution, allowing scalable delivery.",
          "Walk through the two main pillars.",
          "Emphasize that this is one of our main differentiators in core messaging.",
        ],
        beginnerExplanation:
          "Use this slide to explain the two pillars before moving to the next slide.",
        advancedExplanation:
          "Direct new hires to review the internal portal for more details after the session.",
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.ok(repairedSlide);
  assert.equal(repairedSlide?.keyPoints.length, 3);
  assert.doesNotMatch(repairedSlide?.learningGoal ?? "", /understand the role of/i);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /walk through|direct new hires|internal portal|emphasize|core messaging|begin by|focus on|transition to|one concrete part of/i,
  );
  assert.match(repairedSlide?.keyPoints.join(" ") ?? "", /System Verification/i);
});

test("meta-slide repair fallback stays topic-neutral for non-business subjects", () => {
  const deck = DeckSchema.parse({
    id: "deck_7",
    title: "World of Warcraft science",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_wow",
        order: 1,
        title: "Corrupted Blood outbreak",
        learningGoal: "Show how to present the outbreak clearly.",
        keyPoints: [
          "Walk through the outbreak using one screenshot per slide.",
          "Avoid clutter and keep the audience focused on the deck.",
          "Use this section to set up the next slide.",
        ],
        beginnerExplanation:
          "This slide should explain how to talk about the outbreak rather than the outbreak itself.",
        advancedExplanation:
          "Direct the audience to the next section instead of explaining the event.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];
  const repairedText = [
    repairedSlide?.learningGoal ?? "",
    ...(repairedSlide?.keyPoints ?? []),
    repairedSlide?.beginnerExplanation ?? "",
  ].join(" ");

  assert.ok(repairedSlide);
  assert.match(repairedText, /World of Warcraft|Corrupted Blood/i);
  assert.doesNotMatch(
    repairedText,
    /delivery work|customer outcomes|day-to-day work/i,
  );
});

test("meta-slide repair prefers specific diagram facts over generic filler phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_8",
    title: "World of Warcraft science",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_wow_facts",
        order: 1,
        title: "Mechanics of the Corrupted Blood Incident",
        learningGoal: "Show why the incident matters.",
        keyPoints: [
          "Mechanics of the Corrupted Blood Incident helps explain how World of Warcraft works in practice.",
          "In practice, mechanics of the corrupted blood incident shapes how World of Warcraft works.",
          "A useful takeaway is that mechanics of the corrupted blood incident affects real decisions, risks, or outcomes.",
        ],
        beginnerExplanation:
          "This slide should explain how to talk about the outbreak rather than the outbreak itself.",
        advancedExplanation:
          "Direct the audience to the next section instead of explaining the event.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [
            {
              id: "node_1",
              label:
                "In 2005, a boss ability leaked from Zul'Gurub into the wider game population and spread rapidly.",
              tone: "info",
            },
            {
              id: "node_2",
              label:
                "Researchers later studied the incident as a model for contagion and quarantine behavior.",
              tone: "accent",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-15T08:00:00.000Z",
    updatedAt: "2026-04-15T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];
  const repairedText = repairedSlide?.keyPoints.join(" ") ?? "";

  assert.match(repairedText, /2005|Zul'Gurub|researchers|contagion/i);
  assert.doesNotMatch(
    repairedText,
    /helps explain how World of Warcraft works in practice|affects real decisions, risks, or outcomes/i,
  );
});

test("language repair normalizes awkward learning goals and fragmentary key points", () => {
  const deck = DeckSchema.parse({
    id: "deck_language_repair",
    title: "World of Warcraft",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro_anchor",
        order: 0,
        title: "World of Warcraft Overview",
        learningGoal: "Understand what World of Warcraft is and why it matters.",
        keyPoints: [
          "World of Warcraft is a long-running online role-playing game.",
          "Players share a persistent world with combat, travel, and social structures.",
          "Some in-game events later became useful research examples.",
        ],
        beginnerExplanation:
          "World of Warcraft is a long-running online role-playing game with a persistent world.",
        advancedExplanation:
          "Its systems and player behavior also made it interesting to researchers.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_language_repair",
        order: 1,
        title: "What World of Warcraft is and why it matters",
        learningGoal: "Understand how why World of Warcraft matters contributes to World of Warcraft.",
        keyPoints: [
          "Mention that the world continues existing even when players log off.",
          "Players logging in weekly for updates like Midnight Now Live.",
          "Character classes define specific roles such as healing, damage dealing, or tanking during group activities.",
        ],
        beginnerExplanation:
          "Players navigate distinct zones that represent different environments and difficulty levels within the game world.",
        advancedExplanation:
          "Guilds organize players into persistent social groups for cooperative content completion.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [
            {
              id: "node_1",
              label:
                "Players navigate distinct zones that represent different environments and difficulty levels within the game world.",
              tone: "info",
            },
            {
              id: "node_2",
              label:
                "Character classes define specific roles such as healing, damage dealing, or tanking during group activities.",
              tone: "accent",
            },
            {
              id: "node_3",
              label:
                "Guilds organize players into persistent social groups for cooperative content completion.",
              tone: "success",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-15T08:00:00.000Z",
    updatedAt: "2026-04-15T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.equal(
    repairedSlide?.learningGoal,
    "Understand what World of Warcraft is and why it matters.",
  );
  assert.doesNotMatch(repairedSlide?.keyPoints.join(" ") ?? "", /^Mention that\b/i);
  assert.doesNotMatch(repairedSlide?.keyPoints.join(" ") ?? "", /Players logging in weekly/i);
  assert.match(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /World of Warcraft|persistent world|research examples/i,
  );
});
