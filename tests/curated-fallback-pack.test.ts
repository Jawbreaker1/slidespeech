import test from "node:test";
import assert from "node:assert/strict";

import { DeckSchema, SlideSchema } from "@slidespeech/types";

import {
  buildCuratedFallbackIllustration,
  categorizeCuratedFallback,
} from "../packages/providers/src/illustration/curated-fallback-pack";

const buildInput = (overrides?: {
  intent?: {
    presentationFrame: "subject" | "organization" | "mixed";
    deliveryFormat: "presentation" | "workshop";
    organization?: string;
  };
  layoutTemplate?: "hero-focus" | "three-step-flow" | "two-column-callouts" | "summary-board";
  style?: "diagram" | "editorial" | "abstract" | "screenshot-like";
}) => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Fallback image test",
    learningGoal: "Show the correct fallback illustration.",
    keyPoints: ["One", "Two", "Three"],
    beginnerExplanation: "Beginner explanation.",
    advancedExplanation: "Advanced explanation.",
    visuals: {
      layoutTemplate: overrides?.layoutTemplate ?? "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Fallback image prompt",
          altText: "Fallback alt text",
          style: overrides?.style ?? "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "Fallback deck",
    topic: "Fallback topic",
    summary: "Fallback summary",
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
      topic: "Fallback topic",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-19T18:00:00.000Z",
    updatedAt: "2026-04-19T18:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "sv",
    },
  });

  return {
    deck: overrides?.intent
      ? ({
          ...deck,
          intent: {
            subject: "Fallback topic",
            framing: "Fallback framing",
            explicitSourceUrls: [],
            coverageRequirements: [],
            audienceCues: [],
            ...overrides.intent,
          },
        } as typeof deck & {
          intent: {
            subject: string;
            framing: string;
            explicitSourceUrls: string[];
            coverageRequirements: string[];
            audienceCues: string[];
            presentationFrame: "subject" | "organization" | "mixed";
            deliveryFormat: "presentation" | "workshop";
            organization?: string;
          };
        })
      : deck,
    slide,
  };
};

test("categorizes workshop slides into workshop classroom fallback", () => {
  const input = buildInput({
    intent: {
      presentationFrame: "subject",
      deliveryFormat: "workshop",
    },
  });

  assert.equal(categorizeCuratedFallback(input), "workshop_classroom");
});

test("categorizes organization slides into organization fallback", () => {
  const input = buildInput({
    intent: {
      presentationFrame: "organization",
      deliveryFormat: "presentation",
      organization: "System Verification",
    },
  });

  assert.equal(categorizeCuratedFallback(input), "organization_team");
});

test("keeps process/diagram slides on structural fallback path", () => {
  const input = buildInput({
    layoutTemplate: "three-step-flow",
    style: "diagram",
  });

  assert.equal(categorizeCuratedFallback(input), null);
});

test("builds a local curated fallback illustration for editorial slides", async () => {
  const input = buildInput({
    intent: {
      presentationFrame: "organization",
      deliveryFormat: "presentation",
      organization: "System Verification",
    },
  });

  const illustration = await buildCuratedFallbackIllustration(input);

  assert.ok(illustration);
  assert.equal(illustration?.kind, "curated");
  assert.match(illustration?.dataUri ?? "", /^data:image\/svg\+xml/);
  assert.equal(illustration?.altText, "Fallback alt text");
});
