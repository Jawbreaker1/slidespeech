import assert from "node:assert/strict";
import test from "node:test";

import { normalizePresentationPlan } from "../packages/providers/src/llm/presentation-plan-normalization";

test("presentation plan normalization fails closed instead of building static fallback storyline", () => {
  assert.throws(
    () =>
      normalizePresentationPlan(
        {
          title: "Research coverage goals",
          learningObjectives: ["Return one clean audience-facing storyline beat."],
          storyline: [],
          recommendedSlideCount: 4,
          audienceLevel: "beginner",
        },
        {
          topic: "Molted Email",
          subject: "Molted Email",
          targetSlideCount: 4,
        },
      ),
    /no usable storyline/i,
  );
});

test("presentation plan normalization keeps model-written beats without expanding them", () => {
  const normalized = normalizePresentationPlan(
    {
      title: "Molted Email overview",
      learningObjectives: [
        "Explain what Molted Email is for.",
        "Show why AI agents need mailbox infrastructure.",
      ],
      storyline: [
        "Start with the mailbox problem for AI agents.",
        "Explain how Molted Email gives each agent an address.",
        "Connect the workflow to product teams building agentic software.",
      ],
      recommendedSlideCount: 5,
      audienceLevel: "beginner",
    },
    {
      topic: "Molted Email",
      subject: "Molted Email",
      targetSlideCount: 5,
    },
  ) as {
    title: string;
    learningObjectives: string[];
    storyline: string[];
    recommendedSlideCount: number;
  };

  assert.equal(normalized.title, "Molted Email overview");
  assert.equal(normalized.recommendedSlideCount, 3);
  assert.deepEqual(normalized.storyline, [
    "Start with the mailbox problem for AI agents",
    "Explain how Molted Email gives each agent an address",
    "Connect the workflow to product teams building agentic software",
  ]);
});
