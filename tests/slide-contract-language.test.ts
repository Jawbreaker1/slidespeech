import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../packages/providers/src/llm/openai-compatible";

const {
  buildSlideFromPlainText,
  buildContractAnchoredKeyPoints,
  buildContractLearningGoal,
  buildOutlineDeckSummary,
  buildProceduralOrientationKeyPoints,
} = __testables;

test("procedural learning goals use direct observational language instead of awkward understand phrasing", () => {
  const introGoal = buildContractLearningGoal(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Essential ingredients for a balanced salsa",
    },
  );

  const qualityGoal = buildContractLearningGoal(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 3,
      label: "quality",
      kind: "procedural-quality",
      focus: "Taste, texture, and adjustment",
    },
  );

  assert.match(introGoal, /^See\b/);
  assert.doesNotMatch(introGoal, /^Understand\b/);
  assert.match(qualityGoal, /^See\b/);
  assert.doesNotMatch(qualityGoal, /\bhow to\b/i);
});

test("procedural orientation key points stay declarative and non-imperative", () => {
  const points = buildProceduralOrientationKeyPoints("Making the perfect salsa dip");

  assert.equal(points.length, 3);
  for (const point of points) {
    assert.match(point, /^[A-Z]/);
    assert.match(point, /[.!?]$/);
    assert.doesNotMatch(point, /^(Use|Start|Taste|Add|Mix)\b/i);
  }
});

test("contract anchored key points avoid old template language and fragmentary focus echoes", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
      },
    },
    {
      index: 2,
      label: "steps",
      kind: "procedural-steps",
      focus: "Key preparation steps",
      objective: "See what the main preparation steps change in making the perfect salsa dip.",
    },
    [
      "Key preparation steps",
      "The order of chopping, mixing, and resting changes texture and consistency in the final dip.",
      "Roasting chili and garlic first deepens flavor before the ingredients are combined.",
    ],
  );

  assert.equal(points.length, 3);
  for (const point of points) {
    assert.doesNotMatch(point, /\binfluences real outcomes connected to\b/i);
    assert.notEqual(point, "Key preparation steps.");
  }
});

test("outline deck summary avoids the old generic focus-on phrasing", () => {
  const summary = buildOutlineDeckSummary({
    topic: "Making the perfect salsa dip",
    intent: {
      subject: "Making the perfect salsa dip",
      contentMode: "procedural",
      presentationGoal: "Explain how ingredients, preparation, and adjustment shape a balanced salsa dip",
    },
    presentationBrief: "Create a short presentation about how to make the perfect salsa dip.",
    plan: {
      title: "Making the Perfect Salsa Dip",
      storyline: ["Ingredients", "Preparation", "Adjustment"],
      learningObjectives: [
        "Explain how ingredients shape flavor and texture",
        "Explain what the main preparation steps change",
        "Explain how tasting and adjustment affect balance",
      ],
      recommendedSlideCount: 4,
    },
  });

  assert.doesNotMatch(summary, /\bbecomes easier to understand when you focus on\b/i);
  assert.match(summary, /\bideas, examples, or consequences\b/i);
});

test("plain-text slide parsing accepts synonym section headers", () => {
  const slide = buildSlideFromPlainText(
    [
      "SLIDE TITLE: Essential ingredients",
      "LEARNING GOAL: See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
      "KEY POINTS:",
      "- Ripe tomatoes provide the bright acidic base of the dip.",
      "- Onion adds bite and crunch that changes the texture profile.",
      "- Chili heat changes how sharply the salsa lands on the palate.",
      "BEGINNER EXPLANATION: These ingredients shape the dip before any preparation choices matter.",
      "ADVANCED EXPLANATION: Their ratios determine whether the final mix stays bright, crisp, and balanced.",
      "EXAMPLES: Roma tomatoes, white onion, jalapeno, lime juice, and cilantro form a common fresh salsa base.",
      "LIKELY QUESTION: Why do ripe tomatoes matter so much?",
    ].join("\n"),
    {
      id: "slide-ingredients",
      order: 1,
      title: "Essential ingredients",
      learningGoal: "See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
      keyPoints: [],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      narrationPointCount: 3,
      visuals: {
        layoutTemplate: "cards",
        heroStatement: "",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    },
  );

  assert.ok(slide);
  assert.equal(slide?.title, "Essential ingredients");
  assert.equal(
    slide?.learningGoal,
    "See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
  );
  assert.equal(slide?.keyPoints.length, 3);
});
