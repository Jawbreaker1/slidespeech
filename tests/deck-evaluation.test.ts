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
