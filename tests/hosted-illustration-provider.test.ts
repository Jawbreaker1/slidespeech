import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIllustrationSearchQuery,
  extractImageCandidateUrls,
  scoreSearchResultForIllustration,
} from "../packages/providers/src/illustration/hosted-illustration-provider";
import { DeckSchema, SlideSchema } from "@slidespeech/types";

test("extracts og image and relative image urls", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/images/hero.png" />
      </head>
      <body>
        <img src="https://cdn.example.com/diagram.webp" />
        <img src="/assets/logo.svg" />
      </body>
    </html>
  `;

  const urls = extractImageCandidateUrls(html, "https://example.com/post");

  assert.ok(urls.includes("https://example.com/images/hero.png"));
  assert.ok(urls.includes("https://cdn.example.com/diagram.webp"));
  assert.ok(!urls.some((url) => /logo\.svg/i.test(url)));
});

test("builds illustration search query from deck and slide context", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Why state machines help",
    learningGoal: "Give the learner a strong first mental model.",
    keyPoints: ["State", "Transition", "Control flow"],
    beginnerExplanation: "Start with simple ideas.",
    advancedExplanation: "Add architecture details later.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "A modern editorial illustration of an AI presenter resuming after interruption.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "State machines",
      topic: "State machines for interactive AI teaching",
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
        topic: "State machines for interactive AI teaching",
        sourceIds: [],
      },
      slides: [slide],
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 6,
        tags: [],
        language: "en",
      },
    },
    slide,
  });

  assert.match(query, /State machines for interactive AI teaching/i);
  assert.match(query, /Why state machines help/i);
  assert.match(query, /illustration/i);
});

test("illustration search query includes source host hints when source urls exist", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Company overview",
    learningGoal: "Show the company visually.",
    keyPoints: ["Quality", "Operations", "Insights"],
    beginnerExplanation: "Company intro.",
    advancedExplanation: "Company detail.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Editorial image for a software quality company.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "System Verification",
      topic: "Company presentation - System Verification",
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
      slides: [slide],
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 6,
        tags: [],
        language: "en",
      },
    },
    slide,
  });

  assert.match(query, /systemverification/i);
});

test("illustration ranking penalizes irrelevant low-quality domains", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Welcome to Volvo Cars",
    learningGoal: "Introduce Volvo visually.",
    keyPoints: ["Cars", "Safety", "Design"],
    beginnerExplanation: "Volvo is a car brand.",
    advancedExplanation: "Volvo builds passenger vehicles.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imagePrompt: "Editorial photo of a Volvo car",
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Photo of a Volvo car on a road",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "Volvo Cars",
    topic: "Make a presentation about Volvo for children",
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
      topic: "Make a presentation about Volvo for children",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-11T10:00:00.000Z",
    updatedAt: "2026-04-11T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 6,
      tags: [],
      language: "en",
    },
  });

  const officialResult = {
    title: "Volvo Cars - Official site",
    url: "https://www.volvocars.com/intl/",
    snippet: "Official Volvo cars homepage and model overview.",
  };
  const lowQualityResult = {
    title: "What does Volvo mean in Chinese?",
    url: "https://www.zhihu.com/en/answer/903952600",
    snippet: "An answer about the Chinese characters for a word.",
  };

  assert.ok(
    scoreSearchResultForIllustration(
      {
        deck,
        slide,
      },
      officialResult,
    ) >
      scoreSearchResultForIllustration(
        {
          deck,
          slide,
        },
        lowQualityResult,
      ),
  );
});
