import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDeckQuality } from "@slidespeech/core";
import { DeckSchema, SlideNarrationSchema } from "@slidespeech/types";

test("deck evaluation flags systemic meta language and repetitive image prompts", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_1",
    title: "Create an onboarding presentation about our company",
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
        id: "slide_1",
        order: 0,
        title: "Welcome: Why This Matters",
        learningGoal: "Orient the audience to the importance of structured onboarding presentations.",
        keyPoints: [
          "This session provides a blueprint for your first deck.",
          "Use a short opener before every slide.",
          "Avoid clutter and long text blocks.",
        ],
        beginnerExplanation: "This slide explains how the presentation should be introduced.",
        advancedExplanation: "This slide is about how to present the topic rather than the topic itself.",
        examples: ["Think of moving into a new house and getting the keys right away."],
        likelyQuestions: ["How long should the presentation be?"],
        visualNotes: ["Use a simple slide layout."],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          imagePrompt: "office team around laptop",
          imageSlots: [
            {
              id: "image_1",
              prompt: "office team around laptop",
            },
          ],
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
        },
      },
      {
        id: "slide_2",
        order: 1,
        title: "How to structure onboarding slides",
        learningGoal: "Teach how to build slides.",
        keyPoints: [
          "Use screenshots in every slide.",
          "Keep the deck short.",
          "Avoid clutter.",
        ],
        beginnerExplanation: "Use screenshots and avoid clutter.",
        advancedExplanation: "This is still slide-building advice.",
        examples: ["Replace a dense slide with one strong image."],
        likelyQuestions: ["What should each slide contain?"],
        visualNotes: ["Use the same opening image again."],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          imagePrompt: "office team around laptop",
          imageSlots: [
            {
              id: "image_2",
              prompt: "office team around laptop",
            },
          ],
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
        },
      },
    ],
    createdAt: "2026-04-13T22:00:00.000Z",
    updatedAt: "2026-04-13T22:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const narrations = deck.slides.map((slide) =>
    SlideNarrationSchema.parse({
      slideId: slide.id,
      narration: "This presentation explains how each slide should be structured.",
      segments: ["This presentation explains how each slide should be structured."],
      summaryLine: "Meta narration",
      promptsForPauses: [],
      suggestedTransition: "Continue.",
    }),
  );

  const evaluation = evaluateDeckQuality(deck, narrations);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "prompt_contamination" && check.status === "fail",
    ),
  );
  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "image_diversity" && check.status !== "pass",
    ),
  );
  assert.ok(evaluation.overallScore < 0.8);
});

test("deck evaluation flags generic template language left by repair-like phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_2",
    title: "World of Warcraft: Virtual Worlds and Real Science",
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
        id: "wow_1",
        order: 0,
        title: "The Corrupted Blood incident",
        learningGoal: "Understand the outbreak and why it mattered.",
        keyPoints: [
          "This part of World of Warcraft focuses on the outbreak and why it matters.",
          "The incident connects to the broader goals of World of Warcraft.",
          "The practical takeaway is what the outbreak reveals for day-to-day work.",
        ],
        beginnerExplanation:
          "This part of the deck focuses on the outbreak and customer outcomes.",
        advancedExplanation:
          "The practical takeaway is how the incident shapes day-to-day work.",
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
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) =>
        check.code === "templated_slide_language" && check.status !== "pass",
    ),
  );
});

test("deck evaluation allows procedural decks to use action-oriented key points", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_procedural",
    title: "Making salsa dip",
    topic: "Making salsa dip",
    summary: "A practical how-to deck.",
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
      topic: "Making salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "procedural_1",
        order: 0,
        title: "Key preparation steps",
        learningGoal: "See how the main preparation steps affect texture and flavor.",
        keyPoints: [
          "Chop tomatoes and onion evenly so each bite has the same texture.",
          "Mix lime, salt, and cilantro after chopping so the seasoning spreads evenly.",
          "Taste after resting because salt and acid become clearer after a few minutes.",
        ],
        beginnerExplanation:
          "A practical salsa process is easier to follow when each action has a visible effect.",
        advancedExplanation:
          "Cut size, seasoning order, and resting time all change the final texture and flavor.",
        examples: ["A bowl that tastes flat after resting usually needs more salt or acid."],
        likelyQuestions: ["How long should salsa rest before serving?"],
        visualNotes: [],
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
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: ["procedural"],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status === "pass",
    ),
  );
});

test("deck evaluation flags prompt-scaffold and truncated fallback text inside slide bodies", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_scaffold_body",
    title: "SpongeBob first episode",
    topic: "SpongeBob first episode",
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
      topic: "SpongeBob first episode",
      sourceIds: [],
    },
    slides: [
      {
        id: "scaffold_1",
        order: 0,
        title: "May 1, 1999 sneak peek airing",
        learningGoal: "See what the first episode was and why it mattered.",
        keyPoints: [
          "SpongeBob SquarePants first aired as a sneak peek on May 1, 1999, after the Kids.",
          "SpongeBob first episode is easier to understand when its purpose, structure, and one concrete example are visible together.",
          "This initial broadcast introduced Help Wanted before the official July premiere.",
        ],
        beginnerExplanation:
          "SpongeBob first episode is easier to understand when its purpose, structure, and one concrete example are visible together.",
        advancedExplanation:
          "A concrete consequence, responsibility, or example shows why SpongeBob first episode matters.",
        examples: [],
        likelyQuestions: [],
        visualNotes: [],
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
        id: "scaffold_2",
        order: 1,
        title: "The strongest takeaway",
        learningGoal:
          "See what one concrete detail teaches about SpongeBob first episode, then bring final questions into the discussion.",
        keyPoints: [
          "The specific case study or research angle requested in the prompt: SpongeBob first episode.",
          "A concrete example, consequence, or real-world application of SpongeBob first episode.",
          "Questions are welcome before we close, especially about how the main takeaway applies in practice.",
        ],
        beginnerExplanation:
          "The specific case study or research angle requested in the prompt: SpongeBob first episode.",
        advancedExplanation:
          "A concrete example, consequence, or real-world application of SpongeBob first episode.",
        examples: ["At least one practical exercise for the audience to complete during the workshop."],
        likelyQuestions: [],
        visualNotes: [],
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
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "prompt_contamination" && check.status !== "pass",
    ),
  );
  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "templated_slide_language" && check.status !== "pass",
    ),
  );
  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
  assert.ok(evaluation.overallScore < 1);
});

test("deck evaluation flags slides that repeat nearly the same explanation across the deck", () => {
  const repeated = [
    "Wherever you are in your quality journey, our solutions help you strengthen software testing, align your strategy with business goals, and move forward more safely.",
    "Whether you need expert support, project-specific QA, or strategic insight, we help you improve software quality and long-term outcomes.",
    "Flexible QA services help teams reduce risk and improve reliability across industries.",
  ];

  const deck = DeckSchema.parse({
    id: "deck_eval_repetition",
    title: "System Verification",
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
        id: "repeat_1",
        order: 0,
        title: "System Verification",
        learningGoal: "See what System Verification is and why it matters.",
        keyPoints: repeated,
        beginnerExplanation: repeated.slice(0, 2).join(" "),
        advancedExplanation: repeated[2] ?? "",
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
        id: "repeat_2",
        order: 1,
        title: "Core systems and focus areas",
        learningGoal: "See the core components and focus areas of System Verification.",
        keyPoints: repeated,
        beginnerExplanation: repeated.slice(0, 2).join(" "),
        advancedExplanation: repeated[2] ?? "",
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
        id: "repeat_3",
        order: 2,
        title: "Real-world applications",
        learningGoal: "See how System Verification appears in practice.",
        keyPoints: [
          "Verification catches risky data changes before they spread into production.",
          "Automated checks provide repeatable evidence instead of one-off judgement.",
          "Teams can spot drift earlier when checks run continuously.",
        ],
        beginnerExplanation:
          "This slide should move from general framing into a concrete operational example.",
        advancedExplanation:
          "Distinct application examples make the story advance instead of repeating itself.",
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
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) =>
        check.code === "cross_slide_distinctness" && check.status !== "pass",
    ),
  );
});

test("deck evaluation does not automatically fail a deck for one moderately repetitive pair", () => {
  const firstSlidePoints = [
    "AI tools help teams summarize dense material into shorter working notes.",
    "The same assistant can draft first-pass artifacts that still need human review.",
    "A careful review step keeps the result grounded in the team's own judgement.",
  ];
  const secondSlidePoints = [
    "AI tools can summarize dense project material into shorter working notes for daily follow-up.",
    "First-pass drafts still need human review before they become part of official project work.",
    "A structured review step keeps the output grounded in the team's own judgement.",
  ];

  const deck = DeckSchema.parse({
    id: "deck_eval_repetition_warning",
    title: "AI tools in daily work",
    topic: "AI tools in daily work",
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
      topic: "AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "warning_1",
        order: 0,
        title: "Why AI helps",
        learningGoal: "See why AI tools help with dense everyday work.",
        keyPoints: firstSlidePoints,
        beginnerExplanation: firstSlidePoints.slice(0, 2).join(" "),
        advancedExplanation: firstSlidePoints[2] ?? "",
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
        id: "warning_2",
        order: 1,
        title: "Daily use cases",
        learningGoal: "See which recurring tasks benefit from AI support.",
        keyPoints: secondSlidePoints,
        beginnerExplanation: secondSlidePoints.slice(0, 2).join(" "),
        advancedExplanation: secondSlidePoints[2] ?? "",
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
        id: "warning_3",
        order: 2,
        title: "Constraints and review",
        learningGoal: "See which checks keep AI-supported work trustworthy.",
        keyPoints: [
          "Sensitive project or personal data must stay out of public AI systems.",
          "Human review is required before AI-supported output is shared or acted on.",
          "Approved tools and documented review steps keep the workflow accountable.",
        ],
        beginnerExplanation:
          "Constraint and review are part of the workflow, not an afterthought.",
        advancedExplanation:
          "Safe use depends on approved tools, review steps, and clear accountability.",
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
        id: "warning_4",
        order: 3,
        title: "Practical exercise",
        learningGoal: "Practice one concrete AI-assisted workflow.",
        keyPoints: [
          "Use one current project artifact as the starting material for the exercise.",
          "Apply one prompt, one review step, and one safety check before keeping the result.",
          "Compare the AI-supported draft with the original version and decide what to keep.",
        ],
        beginnerExplanation:
          "The exercise should produce a concrete result that can be reviewed together.",
        advancedExplanation:
          "Applied practice makes the workflow more memorable than another summary slide.",
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
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.notEqual(
    evaluation.checks.find((check) => check.code === "cross_slide_distinctness")?.status,
    "fail",
  );
});

test("deck evaluation flags repeated explanations in Swedish too", () => {
  const repeated = [
    "Systemverifiering hjälper team att minska risk genom att stoppa fel innan de når produktion.",
    "Automatiska kontroller ger repeterbara bevis i stället för engångsbedömningar.",
    "Samma verifieringsmönster gör drift och förändringar mer förutsägbara över tid.",
  ];

  const deck = DeckSchema.parse({
    id: "deck_eval_repetition_sv",
    title: "Systemverifiering",
    topic: "Systemverifiering",
    summary: "Sammanfattning",
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
      topic: "Systemverifiering",
      sourceIds: [],
    },
    slides: [
      {
        id: "repeat_sv_1",
        order: 0,
        title: "Varför systemverifiering behövs",
        learningGoal: "Se varför systemverifiering minskar risk i praktiken.",
        keyPoints: repeated,
        beginnerExplanation: repeated.slice(0, 2).join(" "),
        advancedExplanation: repeated[2] ?? "",
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
        id: "repeat_sv_2",
        order: 1,
        title: "Hur verifieringen fungerar i vardagen",
        learningGoal: "Förstå hur verifiering skapar tryggare förändringar.",
        keyPoints: repeated,
        beginnerExplanation: repeated.slice(0, 2).join(" "),
        advancedExplanation: repeated[2] ?? "",
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
        id: "repeat_sv_3",
        order: 2,
        title: "Ett konkret exempel",
        learningGoal: "Se ett separat exempel där verifiering stoppar felaktig data.",
        keyPoints: [
          "En integrationskedja kan avvisa felaktiga order innan de påverkar fakturering.",
          "Spårbar loggning visar exakt var avvikelsen uppstod.",
          "Teamet kan rätta felet utan att sprida det vidare till andra system.",
        ],
        beginnerExplanation:
          "Det här exemplet visar hur verifiering stoppar fel innan de påverkar fler delar av verksamheten.",
        advancedExplanation:
          "Loggning och valideringsregler gör det möjligt att isolera avvikelsen tidigt.",
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
    createdAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "sv",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) =>
        check.code === "cross_slide_distinctness" && check.status !== "pass",
    ),
  );
});

test("deck evaluation accepts a concise intro when the opening still has strong slide intent", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_intro_concise",
    title: "Making the perfect salsa dip",
    topic: "Making the perfect salsa dip",
    summary: "A short procedural deck.",
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
      topic: "Making the perfect salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "salsa_intro",
        order: 0,
        title: "Making the perfect salsa dip",
        learningGoal:
          "Understand the ingredients, steps, and final adjustments involved in making the perfect salsa dip.",
        keyPoints: [
          "The starting ingredients shape the balance before any mixing begins.",
          "Preparation steps determine texture and consistency.",
          "Final tasting and adjustment decide when the dip is ready to serve.",
        ],
        beginnerExplanation: "A short intro can still work when the opening has a clear purpose.",
        advancedExplanation:
          "The opening names the subject directly and frames the rest of the explanation.",
        examples: [],
        likelyQuestions: ["What usually makes salsa go wrong?"],
        visualNotes: [],
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
    createdAt: "2026-04-16T20:00:00.000Z",
    updatedAt: "2026-04-16T20:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) =>
        check.code === "intro_slide_substance" && check.status === "pass",
    ),
  );
});

test("deck evaluation flags promotional source noise and awkward contract language", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_3",
    title: "World of Warcraft: A Living Social Laboratory",
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
      type: "mixed",
      topic: "World of Warcraft",
      sourceIds: ["https://worldofwarcraft.blizzard.com/"],
    },
    slides: [
      {
        id: "wow_noise_1",
        order: 0,
        title: "World of Warcraft at a glance",
        learningGoal: "Understand the role of World of Warcraft at a glance in World of Warcraft.",
        keyPoints: [
          "Subscribe Now 6-Month Subscription Offer Blaze Through New Adventures Blaze through your World of Warcraft adventures.",
          "World of Warcraft is a large shared online world.",
          "driven medical diagnostic tool, system verification ensures the algorithm produces accurate results across diverse datasets",
        ],
        beginnerExplanation:
          "Subscribe now and learn more about World of Warcraft.",
        advancedExplanation:
          "The slide still contains promotional source noise and one broken key point.",
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
    createdAt: "2026-04-14T18:00:00.000Z",
    updatedAt: "2026-04-14T18:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) =>
        check.code === "source_noise_contamination" && check.status !== "pass",
    ),
  );
  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
});

test("deck evaluation flags imperative example-anchor language", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_4",
    title: "World of Warcraft: Corrupted Blood",
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
      type: "mixed",
      topic: "World of Warcraft",
      sourceIds: ["https://en.wikipedia.org/wiki/Corrupted_Blood_incident"],
    },
    slides: [
      {
        id: "wow_use_1",
        order: 0,
        title: "The Corrupted Blood incident",
        learningGoal: "Understand why the outbreak mattered beyond the game.",
        keyPoints: [
          "The outbreak spread quickly through player movement and in-game travel.",
          "Researchers noticed that player reactions looked similar to real epidemic behavior.",
          "Use the outbreak as a concrete example anchor for explaining virtual disease spread.",
        ],
        beginnerExplanation:
          "The event became famous because it behaved like a surprising virtual epidemic.",
        advancedExplanation:
          "Its mix of code, behavior, and scale made it useful as an informal disease-spread case study.",
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
    createdAt: "2026-04-15T10:00:00.000Z",
    updatedAt: "2026-04-15T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
});

test("deck evaluation flags truncated dangling slide language", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_5",
    title: "World of Warcraft: Corrupted Blood",
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
        id: "wow_tail_1",
        order: 0,
        title: "How the Corrupted Blood plague spread beyond its intended zone due to a",
        learningGoal: "Understand why researchers were interested in the Corrupted Blood plague event as",
        keyPoints: [
          "The incident began as a gameplay effect.",
          "Players and pets carried it beyond the intended area.",
          "Researchers later studied the spread pattern.",
        ],
        beginnerExplanation:
          "Players carried the plague beyond the intended zone.",
        advancedExplanation:
          "Researchers treated the event as a natural experiment in disease spread.",
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
    createdAt: "2026-04-15T18:00:00.000Z",
    updatedAt: "2026-04-15T18:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
});

test("deck evaluation accepts question-shaped how-it-works titles", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_how_works",
    title: "How an interactive AI tutor works",
    topic: "How an interactive AI tutor works",
    summary:
      "The deck explains the input, processing, feedback, and takeaway behind an interactive AI tutor.",
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
      topic: "How an interactive AI tutor works",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_how_works_1",
        order: 0,
        title: "How an interactive AI tutor works",
        learningGoal:
          "See how an interactive AI tutor turns learner input into adaptive feedback.",
        keyPoints: [
          "The tutor starts by capturing a learner question, answer, or hesitation as input.",
          "The model interprets that input against the current lesson context before choosing a response.",
          "The feedback loop updates the next explanation so the learner receives more targeted guidance.",
        ],
        beginnerExplanation:
          "An interactive AI tutor responds to each learner action instead of presenting the same static lesson to everyone.",
        advancedExplanation:
          "The tutoring loop combines input interpretation, response generation, and feedback signals to keep the next step relevant.",
        examples: [
          "A learner gives a wrong answer, and the tutor responds with a smaller hint instead of moving on.",
        ],
        likelyQuestions: ["How does the tutor know what to explain next?"],
        visualNotes: ["Show a learner input moving through a feedback loop."],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          imagePrompt: "learner and AI tutor feedback loop",
          imageSlots: [],
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
        },
      },
    ],
    createdAt: "2026-04-13T22:00:00.000Z",
    updatedAt: "2026-04-13T22:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck);
  assert.equal(
    evaluation.checks.find((check) => check.code === "language_quality")
      ?.status,
    "pass",
  );
});

test("deck evaluation flags fragmentary workshop bullets and same-slide duplication", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_vgr_fragment",
    title: "VGR AI workshop",
    topic: "Using AI tools in daily work",
    summary: "A workshop about safe AI use in daily work.",
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
      topic: "Using AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_vgr_fragment",
        order: 0,
        title: "Specific use cases for AI in project management",
        learningGoal:
          "Identify concrete AI applications for project managers, product owners, and test leads.",
        keyPoints: [
          "Focus on the intersection of AI capabilities and VGR's specific mandates: healthcare, culture, and transport.",
          "Generating draft user stories for a new digital health service feature based on existing patient journey maps.",
          "AI tools must not process personal health data or sensitive protocol information due to strict data security regulations.",
          "AI tools must not process personal health data or sensitive protocol information due to strict data security regulations before review.",
        ],
        beginnerExplanation:
          "The workshop connects AI usage to concrete daily work and safe review.",
        advancedExplanation:
          "The stronger examples separate role-specific use cases from governance constraints.",
        examples: [
          "project managers, product owners, and test leads can use AI tools in their daily",
        ],
        likelyQuestions: ["Which tasks are safe to try first?"],
        visualNotes: ["Show role-specific work outputs."],
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          imagePrompt: "public sector team reviewing AI generated work outputs",
          imageSlots: [
            {
              id: "image_vgr_fragment",
              prompt: "public sector team reviewing AI generated work outputs",
            },
          ],
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
        },
      },
    ],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);
  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status === "fail",
    ),
  );
});

test("deck evaluation accepts complete declarative key points even when they use varied verbs", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_6",
    title: "Making the Perfect Salsa Dip",
    topic: "Making the perfect salsa dip",
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
      topic: "Making the perfect salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "salsa_eval_1",
        order: 0,
        title: "Essential ingredients",
        learningGoal: "See which ingredients shape the flavor, balance, and texture of making the perfect salsa dip.",
        keyPoints: [
          "Ripe tomatoes provide the foundational moisture and bright acidity that establish the structural balance of the dip.",
          "Adjusting the ratio of acidic citrus juice to sweet tomato pulp allows precise control over the salsa's balance and freshness.",
          "Freshly chopped cilantro introduces a vibrant herbal note that rounds out the flavor profile and adds color.",
        ],
        beginnerExplanation:
          "The quality and ratio of the raw ingredients determine whether the salsa tastes balanced and feels cohesive.",
        advancedExplanation:
          "Ingredient choice shapes both chemistry and texture before any chopping or mixing decisions are made.",
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
    createdAt: "2026-04-18T20:00:00.000Z",
    updatedAt: "2026-04-18T20:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    !evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
});

test("deck evaluation accepts organization operations titles that end with how it works", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_operations_title",
    title: "System Verification",
    topic: "System Verification",
    summary: "System Verification is explained through identity, operating model, capabilities, and value.",
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
        id: "operations_title_1",
        order: 0,
        title: "Where it operates and how it works",
        learningGoal:
          "Understand the operating footprint and delivery model behind System Verification.",
        keyPoints: [
          "System Verification operates through QA specialists who support software teams during delivery.",
          "The organization connects operating footprint, project support, and delivery collaboration.",
          "Its operating model becomes clearer when location, team structure, and workflow are separated from service capabilities.",
        ],
        beginnerExplanation:
          "The operating model explains where the organization works and how support reaches project teams.",
        advancedExplanation:
          "Separating operations from capabilities keeps the organization overview from turning into a service catalogue.",
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
    createdAt: "2026-05-02T10:00:00.000Z",
    updatedAt: "2026-05-02T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const languageCheck = evaluateDeckQuality(deck, []).checks.find(
    (check) => check.code === "language_quality",
  );

  assert.equal(languageCheck?.status, "pass");
});

test("deck evaluation ignores visual prompt scaffolding when judging intro substance", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_7",
    title: "Making the Perfect Salsa Dip",
    topic: "Making the perfect salsa dip",
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
      topic: "Making the perfect salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "salsa_eval_intro",
        order: 0,
        title: "Making the perfect salsa dip",
        learningGoal: "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
        keyPoints: [
          "The starting ingredients shape the balance of the dip before any cutting or mixing begins.",
          "The order of preparation changes texture, consistency, and how the flavors come together.",
          "Final tasting and adjustment determine whether the salsa feels finished and balanced.",
        ],
        beginnerExplanation:
          "The first useful view of salsa comes from seeing how ingredients, preparation, and final adjustment each change the final result.",
        advancedExplanation:
          "A strong introduction keeps the topic concrete by naming the variables that shape flavor, texture, and readiness.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          imagePrompt: "Editorial presentation visual about Making the perfect salsa dip.",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [
            {
              id: "salsa_eval_intro_image",
              prompt: "Create an educational presentation visual for the opening slide.",
            },
          ],
        },
      },
    ],
    createdAt: "2026-04-18T20:05:00.000Z",
    updatedAt: "2026-04-18T20:05:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    !evaluation.checks.some(
      (check) => check.code === "intro_slide_substance" && check.status !== "pass",
    ),
  );
});

test("deck evaluation flags leaked generation scaffold phrases", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_scaffold",
    title: "SpongeBob SquarePants first episode",
    topic: "SpongeBob SquarePants first episode",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: [],
    },
    slides: [
      {
        id: "scaffold_slide",
        order: 0,
        title: "Concrete Example: The premiere",
        learningGoal:
          "See how the subject or organization is connected to the first episode.",
        keyPoints: [
          "The core mechanisms, characteristics, or defining ideas behind SpongeBob SquarePants first episode.",
          "The first episode aired in 1999 and introduced the main workplace setting.",
          "The premiere established a recognizable tone for later episodes.",
        ],
        beginnerExplanation:
          "The subject or organization is not a valid audience-facing explanation.",
        advancedExplanation:
          "Concrete Example: internal generation scaffolding should not pass as final content.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          imagePrompt: "SpongeBob premiere",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T20:10:00.000Z",
    updatedAt: "2026-04-18T20:10:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "templated_slide_language" && check.status === "fail",
    ),
  );
});

test("deck evaluation flags repair-template fragments in explanations and dangling titles", () => {
  const deck = DeckSchema.parse({
    id: "deck_eval_repair_fragments",
    title: "SpongeBob 1999 premiere",
    topic: "SpongeBob SquarePants first episode",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: ["https://example.com/source"],
    },
    slides: [
      {
        id: "frag_1",
        order: 0,
        title: "The significance of the show's evolution from a seven-minute pilot to",
        learningGoal: "See how the 1999 premiere anchors the topic.",
        keyPoints: [
          "The first broadcast happened in 1999.",
          "Nickelodeon used the premiere to introduce the show.",
          "The episode connected the characters to the show's launch.",
        ],
        beginnerExplanation: "The first broadcast happened in 1999.",
        advancedExplanation:
          "Real-world applications is one concrete way to understand the first episode.",
        examples: [],
        likelyQuestions: [],
        visualNotes: [],
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
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const evaluation = evaluateDeckQuality(deck, []);

  assert.ok(
    evaluation.checks.some(
      (check) => check.code === "language_quality" && check.status !== "pass",
    ),
  );
});
