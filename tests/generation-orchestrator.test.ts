import test from "node:test";
import assert from "node:assert/strict";

import {
  generatePresentationDeck,
  PresentationDeckGenerationQualityError,
} from "../packages/core/src/generation/generation-orchestrator";
import { DeckSchema } from "@slidespeech/types";
import type {
  Deck,
  DeckSemanticReviewResult,
  GenerateDeckInput,
  ReviewDeckSemanticsInput,
} from "@slidespeech/types";

const pedagogicalProfile = {
  audienceLevel: "beginner" as const,
  tone: "supportive and concrete",
  pace: "balanced",
  preferredExampleStyle: "real_world" as const,
  wantsFrequentChecks: true,
  detailLevel: "standard" as const,
};

const plan = {
  title: "Making the perfect salsa dip",
  learningObjectives: [
    "Understand ingredients, preparation, and final adjustment.",
  ],
  storyline: [
    "Bright, scoopable salsa dip",
    "Essential ingredients",
    "Key preparation steps",
    "Final adjustments and serving",
  ],
  recommendedSlideCount: 4,
  audienceLevel: "beginner" as const,
};

const buildWeakProceduralDeck = (input: GenerateDeckInput): Deck =>
  DeckSchema.parse({
    id: "deck_weak_salsa",
    title: "Making the Perfect Salsa Dip",
    topic: input.topic,
    summary: "A procedural salsa deck with awkward generated language.",
    pedagogicalProfile,
    source: {
      type: "topic",
      topic: input.topic,
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_weak_intro",
        order: 0,
        title: "Bright, scoopable salsa dip",
        learningGoal:
          "Visualize the ideal balance of fresh flavor, controlled heat, and a texture that holds together for dipping.",
        keyPoints: [
          "Think about the last time you had a great salsa. Did the tomatoes taste like actual tomatoes, or did they taste watery.",
          "The salsa should taste bright and fresh, with the natural sweetness of ripe tomatoes and the sharp kick of onions clearly defined.",
          "The texture is crucial. If it's too watery, it makes the chips soggy. If it's too thick, it's hard to get a good bite.",
        ],
        beginnerExplanation:
          "A useful salsa target is bright tomato flavor, controlled heat, and enough body to stay on the chip.",
        advancedExplanation:
          "Texture matters because excess juice dilutes seasoning, while too little moisture makes the dip feel heavy.",
        examples: [],
      },
      {
        id: "slide_weak_ingredients",
        order: 1,
        title: "Essential ingredients",
        learningGoal:
          "Choose the tomato base, crunch, heat, acid, and seasoning roles before mixing.",
        keyPoints: [
          "Ripe tomatoes provide the necessary body and fresh flavor for the dip.",
          "Onions and peppers add essential crunch and controlled heat to the texture.",
          "Fresh cilantro, lime juice, and salt balance the flavors and enhance the overall taste.",
        ],
        beginnerExplanation:
          "Think of each ingredient as playing a specific job in your salsa.",
        advancedExplanation:
          "A small squeeze of lime adds acidity, and a small pinch of salt should be added gradually.",
        examples: [],
      },
      {
        id: "slide_weak_steps",
        order: 2,
        title: "Key preparation steps",
        learningGoal:
          "The simple method: chopping, mixing, and resting for flavor development.",
        keyPoints: [
          "Dice tomatoes and onion into small, similar pieces so the dip stays scoopable.",
          "Fold in chili, lime, salt, and herbs gradually so heat and acidity can be adjusted before serving.",
          "Let very juicy tomatoes drain briefly before the final seasoning so the dip does not loosen in the bowl.",
        ],
        beginnerExplanation:
          "Even chopping gives every bite a similar mix of tomato, onion, chili, herbs, and lime.",
        advancedExplanation:
          "Draining very juicy tomatoes before seasoning keeps the final bowl from turning watery.",
        examples: [],
      },
      {
        id: "slide_weak_final",
        order: 3,
        title: "Final adjustments and serving",
        learningGoal:
          "Use final taste and texture checks to decide what to adjust before serving.",
        keyPoints: [
          "Taste the salsa with the chip or food it will be served with because salt, acid, and heat read differently there.",
          "Identify the essential ingredients and their roles to make precise adjustments for flavor balance.",
          "Questions are welcome about the strongest takeaway from perfect salsa dip and how it applies next.",
        ],
        beginnerExplanation:
          "Taste your salsa using the chip or food you plan to eat it with.",
        advancedExplanation:
          "Adjust only one lever at a time: salt for flatness, lime for dullness, chili for heat, or drained juice for loose texture.",
        examples: [],
      },
    ],
    createdAt: "2026-05-04T12:00:00.000Z",
    updatedAt: "2026-05-04T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: ["procedural"],
      language: "en",
    },
  });

test("generation orchestration keeps decks with only non-blocking semantic warnings", async () => {
  const result = await generatePresentationDeck({
    planner: {
      generateDeck: async (input: GenerateDeckInput) => buildWeakProceduralDeck(input),
      planPresentation: async () => plan,
    } as any,
    qualityReviewer: {
      reviewDeckSemantics: async (
        _input: ReviewDeckSemanticsInput,
      ): Promise<DeckSemanticReviewResult> => ({
        approved: true,
        score: 0.7,
        summary:
          "The semantic reviewer found non-fatal template language issues.",
        issues: [
          {
            code: "template_language",
            severity: "warning",
            message:
              "The deck has awkward procedural language but no fatal prompt leakage.",
            revisionInstruction:
              "Improve the procedural wording when possible.",
          },
        ],
      }),
    } as any,
    request: {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
        presentationFrame: "subject",
      },
      targetSlideCount: 4,
    },
    pedagogicalProfile,
    plan,
  });

  assert.equal(result.deck.id, "deck_weak_salsa");
});

test("generation orchestration fails when semantic deck review is unavailable", async () => {
  await assert.rejects(
    () =>
      generatePresentationDeck({
        planner: {
          generateDeck: async (input: GenerateDeckInput) => buildWeakProceduralDeck(input),
          planPresentation: async () => plan,
        } as any,
        qualityReviewer: {
          reviewDeckSemantics: async () => {
            throw new Error("review model timed out");
          },
        } as any,
        request: {
          topic: "Making the perfect salsa dip",
          intent: {
            subject: "Making the perfect salsa dip",
            contentMode: "procedural",
            presentationFrame: "subject",
          },
          targetSlideCount: 4,
        },
        pedagogicalProfile,
        plan,
      }),
    (error) =>
      error instanceof PresentationDeckGenerationQualityError &&
      error.failingCoreChecks.includes("semantic_review_unavailable") &&
      error.message.includes("review model timed out"),
  );
});
