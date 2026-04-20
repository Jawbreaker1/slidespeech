import test from "node:test";
import assert from "node:assert/strict";

import { SlideSchema, getPrimarySlideIllustration } from "@slidespeech/types";

test("slide schema provides a default visuals object", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Why this topic matters",
    learningGoal: "Build a first mental model.",
    keyPoints: ["Start with value", "Keep the model simple"],
    beginnerExplanation: "Explain the topic in everyday language.",
    advancedExplanation: "Explain the deeper structure behind the topic.",
  });

  assert.equal(slide.visuals.layoutTemplate, "hero-focus");
  assert.equal(slide.visuals.accentColor, "1C7C7D");
  assert.deepEqual(slide.visuals.cards, []);
  assert.deepEqual(slide.visuals.imageSlots, []);
});

test("slide schema accepts structured visuals", () => {
  const slide = SlideSchema.parse({
    id: "slide_2",
    order: 1,
    title: "Three core steps",
    learningGoal: "Show the process clearly.",
    keyPoints: ["Input", "Processing", "Output"],
    beginnerExplanation: "Break the process into visible stages.",
    advancedExplanation: "Discuss interfaces and tradeoffs between stages.",
    visuals: {
      layoutTemplate: "three-step-flow",
      accentColor: "2563EB",
      cards: [
        {
          id: "card_1",
          title: "Input",
          body: "What enters the system.",
          tone: "info",
        },
      ],
      diagramNodes: [
        {
          id: "input",
          label: "Input",
          tone: "info",
        },
      ],
      diagramEdges: [],
      callouts: [],
    },
  });

  assert.equal(slide.visuals.layoutTemplate, "three-step-flow");
  assert.equal(slide.visuals.cards[0]?.title, "Input");
});

test("illustration helper returns a data uri for image slots", () => {
  const slide = SlideSchema.parse({
    id: "slide_3",
    order: 2,
    title: "Visual example",
    learningGoal: "Attach a memorable visual to the slide.",
    keyPoints: ["Prompt", "Shape", "Memory"],
    beginnerExplanation: "Use a strong visual anchor.",
    advancedExplanation: "Use visual hierarchy and repetition deliberately.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "B45309",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "image_1",
          prompt: "Create an editorial illustration for a visual learning slide.",
          caption: "A memorable visual anchor.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const illustration = getPrimarySlideIllustration(slide);

  assert.ok(illustration);
  assert.match(illustration.dataUri, /^data:image\/svg\+xml/);
  assert.equal(illustration.kind, "curated");
  const decoded = decodeURIComponent(illustration.dataUri.split(",")[1] ?? "");
  assert.doesNotMatch(decoded, /ILLUSTRATION/);
  assert.doesNotMatch(decoded, /Create an editorial illustration for a visual learning slide\./);
  assert.doesNotMatch(decoded, /Visual example/);
});
