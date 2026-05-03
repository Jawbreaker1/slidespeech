import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicDeck,
  buildDeterministicPresentationPlan,
} from "../packages/core/src/deterministic-generation";

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

test("deterministic fallback decks use audience-facing visual card titles", () => {
  const deck = buildDeterministicDeck({
    topic: "System Verification",
    targetSlideCount: 4,
  });

  const cardTitles = deck.slides.flatMap((slide) =>
    slide.visuals.cards.map((card) => card.title),
  );

  assert.ok(cardTitles.length > 0);
  assert.equal(
    cardTitles.some((title) => /key\s*point\s*\d+/i.test(title)),
    false,
  );
});

test("deterministic fallback prefers clean grounding highlights over research scaffold labels", () => {
  const deck = buildDeterministicDeck({
    topic: "System Verification",
    targetSlideCount: 7,
    plan: {
      title: "System Verification onboarding",
      learningObjectives: ["Understand the organization."],
      storyline: [
        "Who System Verification is",
        "Where System Verification operates",
        "How System Verification works",
        "What System Verification offers",
        "How capabilities fit delivery",
        "One practical outcome",
        "Questions and next steps",
      ],
      recommendedSlideCount: 7,
      audienceLevel: "beginner",
    },
    groundingSummary:
      "Research coverage goals: What System Verification does; where it operates.\nCurated grounding highlights: System Verification is a QA network.",
    groundingHighlights: [
      "System Verification was founded in 2002 as a quality-assurance company.",
      "System Verification has 12 offices across four countries.",
      "System Verification supports software teams with QA services and project-specific quality work.",
    ],
  });

  const visibleText = JSON.stringify(deck.slides);

  assert.equal(deck.slides.length, 7);
  assert.doesNotMatch(
    visibleText,
    /Research coverage goals|Curated grounding highlights|Add one more concrete angle|Use the extra time/i,
  );
  assert.match(visibleText, /founded in 2002|12 offices|QA services/i);
});
