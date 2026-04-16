import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicPresentationPlan } from "../packages/core/src/deterministic-generation";

test("deterministic presentation plan uses intent coverage and activity instead of generic storyline beats", () => {
  const plan = buildDeterministicPresentationPlan({
    topic: "Create a workshop presentation for project managers, product owners, and test leads at VGR",
    presentationBrief:
      "workshop presentation for project managers, product owners, and test leads at VGR",
    intent: {
      subject: "using AI tools in daily work",
      framing:
        "workshop presentation for project managers, product owners, and test leads at VGR",
      explicitSourceUrls: ["https://www.vgregion.se/"],
      coverageRequirements: [
        "Using AI tools for planning and follow-up",
        "Using AI tools for backlog and requirement work",
      ],
      audienceCues: ["project managers", "product owners", "test leads"],
      deliveryFormat: "workshop",
      activityRequirement:
        "a practical exercise for the audience to complete during the workshop",
    },
    audienceLevel: "beginner",
    targetSlideCount: 4,
  });

  assert.ok(plan.storyline.some((beat) => /planning and follow-up/i.test(beat)));
  assert.ok(plan.storyline.some((beat) => /backlog and requirement work/i.test(beat)));
  assert.ok(plan.storyline.some((beat) => /hands-on exercise/i.test(beat)));
  assert.ok(
    plan.storyline.every(
      (beat) => !/\b(main structure|concrete example|recap and next step)\b/i.test(beat),
    ),
  );
});
