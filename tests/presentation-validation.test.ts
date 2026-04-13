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

