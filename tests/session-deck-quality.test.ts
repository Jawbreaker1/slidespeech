import test from "node:test";
import assert from "node:assert/strict";

import { DeckSchema } from "@slidespeech/types";

import { evaluateDeckQuality } from "../packages/core/src/evaluation";
import {
  buildDeckSemanticReviewAssessment,
  evaluateDeckCandidateForRetry,
} from "../packages/core/src/session-deck-quality";
import { validateDeck } from "../packages/core/src/validation";

test("deck evaluation fails when persisted validation contains blocking review errors", () => {
  const deck = DeckSchema.parse({
    id: "deck_validation_error_eval",
    title: "SpongeBob premiere",
    topic: "SpongeBob SquarePants first episode",
    summary: "A concise deck about the first episode.",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "Help Wanted premiere",
        learningGoal:
          "The first SpongeBob SquarePants episode aired as Help Wanted in 1999.",
        keyPoints: [
          "Help Wanted introduces SpongeBob trying to earn a job at the Krusty Krab.",
          "The episode establishes the fast-food workplace as a core comedy setting.",
          "The May 1999 sneak peek gave audiences their first look at the character.",
        ],
        beginnerExplanation:
          "Help Wanted gives the series its starting situation and first character dynamic.",
        advancedExplanation:
          "The premiere works because one simple job interview creates character, setting, and comic stakes at once.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
      validation: {
        passed: false,
        repaired: false,
        validatedAt: "2026-05-03T12:00:00.000Z",
        issues: [
          {
            code: "unsupported_claim",
            message: "The deck contains an unsupported claim.",
            severity: "error",
          },
        ],
      },
    },
  });

  const evaluation = evaluateDeckQuality(deck);

  assert.equal(
    evaluation.checks.find((check) => check.code === "persisted_validation_errors")
      ?.status,
    "fail",
  );
  assert.ok(evaluation.overallScore < 0.9);
});

test("workshop deck candidates stay retryable when exercise and audience coverage disappear", () => {
  const deck = DeckSchema.parse({
    id: "deck_workshop_missing_activity",
    title: "VGR workshop: Using AI tools in daily work",
    topic: "Using AI tools in daily work",
    summary: "A generic deck about AI tools.",
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
      topic: "Using AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "Welcome to Using AI tools in daily work",
        learningGoal: "Understand why AI tools matter in daily work.",
        keyPoints: [
          "AI can help organize information before a person reviews it.",
          "Human review remains important before any result is shared.",
          "Safe use depends on checking facts and sensitive information.",
        ],
        beginnerExplanation:
          "AI tools are useful when they help organize information before review.",
        advancedExplanation:
          "The main risk is treating generated text as final without checking it.",
      },
      {
        id: "slide_structure",
        order: 1,
        title: "Core structure",
        learningGoal: "Understand the main structure of safe AI use.",
        keyPoints: [
          "Inputs should be checked before they are sent to an AI tool.",
          "Outputs should be checked before they become work material.",
          "Teams need a clear boundary between drafts and decisions.",
        ],
        beginnerExplanation:
          "Safe AI use separates input checks, draft generation, and output review.",
        advancedExplanation:
          "The structure matters because each handoff can introduce factual or data-handling risk.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const assessment = evaluateDeckCandidateForRetry(deck, {
    deliveryFormat: "workshop",
    activityRequirement:
      "Include one practical exercise for participants to complete during the workshop.",
    audienceCues: ["project managers", "product owners", "test leads"],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, true);
  assert.match(
    assessment.reasons.join(" "),
    /participant exercise and role-specific audience coverage/i,
  );
});

test("deck candidates stay retryable when slide count misses the requested plan", () => {
  const deck = DeckSchema.parse({
    id: "deck_missing_outline_slides",
    title: "SpongeBob premiere",
    topic: "SpongeBob SquarePants first episode",
    summary: "A grounded overview of the first televised episode.",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "Help Wanted introduces SpongeBob",
        learningGoal:
          "See how Help Wanted establishes SpongeBob, the Krusty Krab, and the first job-story setup.",
        keyPoints: [
          "Help Wanted introduces SpongeBob trying to earn a job at the Krusty Krab.",
          "The episode establishes the workplace and character dynamic that shape the early series.",
          "The 1999 broadcast gives the deck a concrete starting point instead of a broad franchise summary.",
        ],
        beginnerExplanation:
          "The first episode is easiest to explain through SpongeBob's job attempt at the Krusty Krab.",
        advancedExplanation:
          "The premiere works because the job-story setup creates character motivation, setting, and comic tension at the same time.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const assessment = evaluateDeckCandidateForRetry(deck, {
    plan: {
      title: "SpongeBob premiere",
      recommendedSlideCount: 4,
      learningObjectives: [],
      storyline: [],
      audienceLevel: "beginner",
    },
  });

  assert.equal(assessment.retryable, true);
  assert.ok(assessment.failingCoreChecks.includes("slide_count"));
  assert.match(assessment.reasons.join(" "), /returned 1 slides.*requested 4/i);
});

test("source-backed sparse evidence accepts a compact deck with a closing slide", () => {
  const deck = DeckSchema.parse({
    id: "deck_sparse_grounded_shorter",
    title: "SpongeBob premiere",
    topic: "SpongeBob SquarePants first episode",
    summary:
      "A grounded overview of the first aired SpongeBob episode, its plot setup, and its production context.",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: ["https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)"],
    },
    slides: [
      {
        id: "slide_airing",
        order: 0,
        title: "Welcome to the 1999 premiere",
        learningGoal:
          "Understand that Help Wanted was the first SpongeBob episode broadcast in 1999.",
        keyPoints: [
          "Help Wanted was the first episode that introduced television viewers to SpongeBob SquarePants.",
          "The episode first aired on Nickelodeon in the United States on May 1, 1999.",
          "The broadcast followed the 1999 Kids' Choice Awards, giving the pilot a specific launch context.",
        ],
        beginnerExplanation:
          "The first useful anchor is simple: Help Wanted is the episode, Nickelodeon is the network, and May 1, 1999 is the first broadcast date.",
        advancedExplanation:
          "The airing context matters because it turns a broad franchise history into one concrete launch moment with source-backed timing.",
      },
      {
        id: "slide_plot",
        order: 1,
        title: "The job-story setup",
        learningGoal:
          "See how the episode gives SpongeBob a clear goal at the Krusty Krab.",
        keyPoints: [
          "The episode follows SpongeBob trying to get a job at the Krusty Krab.",
          "That setup gives the premiere a concrete action instead of only introducing a setting.",
          "The Krusty Krab goal makes the character and workplace relationship easy to explain.",
        ],
        beginnerExplanation:
          "The episode is easy to follow because SpongeBob wants a specific job at a specific place.",
        advancedExplanation:
          "The job attempt works as a compact narrative engine: it introduces motivation, location, and character behavior in one sourced premise.",
      },
      {
        id: "slide_context",
        order: 2,
        title: "What to remember",
        learningGoal:
          "Connect the first broadcast, the job plot, and the creator context into one grounded takeaway.",
        keyPoints: [
          "Stephen Hillenburg's marine science and animation background shaped the underwater premise.",
          "The episode combines a documented broadcast date with a simple job-seeking story.",
          "Questions can focus on the source-backed facts: the title, air date, network, and plot setup.",
        ],
        beginnerExplanation:
          "The strongest takeaway is that the premiere can be explained with a small number of grounded facts.",
        advancedExplanation:
          "A sparse source-backed deck should stop at the facts it can support, rather than stretching the same claims into extra slides.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const assessment = evaluateDeckCandidateForRetry(deck, {
    plan: {
      title: "SpongeBob premiere",
      recommendedSlideCount: 4,
      learningObjectives: [],
      storyline: [],
      audienceLevel: "beginner",
    },
    groundingSourceType: "mixed",
    groundingSourceIds: [
      "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
    ],
    groundingFacts: [
      {
        id: "fact_air_date",
        role: "timeline",
        claim:
          "Help Wanted first aired on Nickelodeon in the United States on May 1, 1999.",
        evidence:
          "It first aired on Nickelodeon in the United States on May 1, 1999.",
        sourceIds: [
          "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
        ],
        confidence: "high",
      },
      {
        id: "fact_plot",
        role: "operations",
        claim:
          "The episode follows SpongeBob attempting to get a job at the Krusty Krab.",
        evidence:
          "The episode follows SpongeBob attempting to get a job at a local fast food restaurant called the Krusty Krab.",
        sourceIds: [
          "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
        ],
        confidence: "high",
      },
      {
        id: "fact_creator",
        role: "background",
        claim:
          "Stephen Hillenburg created SpongeBob SquarePants for Nickelodeon.",
        evidence:
          "SpongeBob SquarePants was created by Stephen Hillenburg for Nickelodeon.",
        sourceIds: ["https://en.wikipedia.org/wiki/Spongebob_Squarepants"],
        confidence: "high",
      },
    ],
  });

  assert.equal(assessment.failingCoreChecks.includes("slide_count"), false);
});

test("source-backed sparse evidence treats explicit target slide count as an upper bound", () => {
  const deck = DeckSchema.parse({
    id: "deck_sparse_grounded_target_mismatch",
    title: "SpongeBob premiere",
    topic: "SpongeBob SquarePants first episode",
    summary: "A short grounded deck.",
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
      topic: "SpongeBob SquarePants first episode",
      sourceIds: ["https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)"],
    },
    slides: [
      {
        id: "slide_airing",
        order: 0,
        title: "The first broadcast",
        learningGoal: "Help Wanted first aired on Nickelodeon in 1999.",
        keyPoints: [
          "Help Wanted first aired on Nickelodeon in the United States on May 1, 1999.",
          "The broadcast followed the 1999 Kids' Choice Awards.",
          "The date anchors the first aired episode.",
        ],
        beginnerExplanation: "The first broadcast gives the topic a concrete date.",
        advancedExplanation: "The source-backed date anchors the deck's timeline.",
      },
      {
        id: "slide_plot",
        order: 1,
        title: "The job plot",
        learningGoal: "The episode follows SpongeBob trying to get a job.",
        keyPoints: [
          "SpongeBob tries to get a job at the Krusty Krab.",
          "The job attempt gives the episode a simple action.",
          "The Krusty Krab connects the character to the central workplace.",
        ],
        beginnerExplanation: "The plot is built around a clear job goal.",
        advancedExplanation: "The job attempt gives the first episode a concrete premise.",
      },
      {
        id: "slide_context",
        order: 2,
        title: "What to remember",
        learningGoal: "The facts connect the date and plot.",
        keyPoints: [
          "The deck should close by connecting the date and plot.",
          "The first aired episode has a sourced timing anchor.",
          "The job premise is the main plot anchor.",
        ],
        beginnerExplanation: "The takeaway connects the timeline and story.",
        advancedExplanation: "The deck can synthesize date and plot without adding unsupported claims.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const assessment = evaluateDeckCandidateForRetry(deck, {
    targetSlideCount: 4,
    groundingSourceType: "mixed",
    groundingSourceIds: [
      "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
    ],
    groundingFacts: [
      {
        id: "fact_air_date",
        role: "timeline",
        claim:
          "Help Wanted first aired on Nickelodeon in the United States on May 1, 1999.",
        evidence:
          "It first aired on Nickelodeon in the United States on May 1, 1999.",
        sourceIds: [
          "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
        ],
        confidence: "high",
      },
      {
        id: "fact_plot",
        role: "operations",
        claim:
          "The episode follows SpongeBob attempting to get a job at the Krusty Krab.",
        evidence:
          "The episode follows SpongeBob attempting to get a job at the Krusty Krab.",
        sourceIds: [
          "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
        ],
        confidence: "high",
      },
    ],
  });

  assert.equal(assessment.failingCoreChecks.includes("slide_count"), false);
});

test("soft semantic review warnings remain actionable without blocking publication", () => {
  const assessment = buildDeckSemanticReviewAssessment({
    approved: true,
    score: 0.9,
    summary:
      "The deck is mostly usable, but one slide still has repeated template language.",
    issues: [
      {
        code: "template_language",
        severity: "warning",
        message: "Slide 2 still repeats template language.",
        revisionInstruction:
          "Rewrite Slide 2 with subject-specific claims instead of template language.",
      },
    ],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, false);
  assert.equal(assessment.failingCoreChecks.includes("semantic_template_language"), false);
  assert.match(assessment.revisionNotes.join(" "), /Rewrite Slide 2/);
});

test("hard semantic review warnings still block publication", () => {
  const assessment = buildDeckSemanticReviewAssessment({
    approved: true,
    score: 0.9,
    summary:
      "The deck is mostly usable, but one slide exposes generator instructions.",
    issues: [
      {
        code: "prompt_leakage",
        severity: "warning",
        message: "Slide 2 exposes prompt text.",
        revisionInstruction:
          "Remove prompt text before publishing.",
      },
    ],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, false);
  assert.ok(assessment.failingCoreChecks.includes("semantic_prompt_leakage"));
});

test("semantic review rejection without hard issues blocks publication", () => {
  const assessment = buildDeckSemanticReviewAssessment({
    approved: false,
    score: 0.81,
    summary: "The reviewer rejected the draft but returned no structured issues.",
    issues: [],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, true);
  assert.ok(assessment.failingCoreChecks.includes("semantic_rejected"));
  assert.match(assessment.revisionNotes.join(" "), /publication-blocking/i);
});

test("moderately low semantic review score remains a publishable warning", () => {
  const assessment = buildDeckSemanticReviewAssessment({
    approved: true,
    score: 0.72,
    summary: "The reviewer gave the draft a low score but returned no structured issues.",
    issues: [],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, false);
  assert.deepEqual(assessment.failingCoreChecks, []);
});

test("unpublishable semantic review score blocks publication even without issue objects", () => {
  const assessment = buildDeckSemanticReviewAssessment({
    approved: true,
    score: 0.58,
    summary:
      "The reviewer gave the draft an unpublishable score but returned no structured issues.",
    issues: [],
  });

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.fatal, true);
  assert.ok(assessment.failingCoreChecks.includes("semantic_low_score"));
});

test("weak opening slides are actionable warnings rather than hard blockers", () => {
  const deck = DeckSchema.parse({
    id: "deck_weak_intro",
    title: "Ferrari brand strategy",
    topic: "The Ferrari brand",
    summary: "A short deck about Ferrari brand strategy.",
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
      topic: "The Ferrari brand",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro",
        order: 0,
        title: "Why this matters",
        learningGoal: "See why the topic matters.",
        keyPoints: [
          "Ferrari's racing heritage gives the brand a clear performance anchor.",
          "Scarcity and design make ownership feel selective rather than purely functional.",
          "The brand turns product detail into status, emotion, and long-term loyalty.",
        ],
        beginnerExplanation:
          "Ferrari is a useful brand example because it links racing, design, and scarcity.",
        advancedExplanation:
          "The brand's strength comes from connecting performance cues with cultural status and controlled availability.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const assessment = evaluateDeckCandidateForRetry(deck);

  assert.equal(assessment.retryable, true);
  assert.equal(assessment.failingCoreChecks.includes("intro_slide_substance"), false);
  assert.match(assessment.revisionNotes.join(" "), /opening material/i);
});

test("validation rejects near-duplicate visible points instead of repairing copy", () => {
  const deck = DeckSchema.parse({
    id: "deck_duplicate_visible_points",
    title: "VGR workshop",
    topic: "Using AI tools in daily work",
    summary: "A workshop about checked AI drafts.",
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
      topic: "Using AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_exercise",
        order: 0,
        title: "Practical exercise",
        learningGoal:
          "Apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
        keyPoints: [
          "Participants apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
          "Apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
          "The exercise has three steps: select one note, ask for a reviewable draft, and review it before sharing.",
        ],
        beginnerExplanation:
          "Participants apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
        advancedExplanation:
          "The exercise has three steps: select one note, ask for a reviewable draft, and review it before sharing.",
        visuals: {
          cards: [
            {
              id: "stale-card-1",
              title: "Participants apply AI tools",
              body: "Participants apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
              tone: "accent",
            },
            {
              id: "stale-card-2",
              title: "Apply AI tools",
              body: "Apply AI tools to draft or refine work artifacts while adhering to VGR constraints.",
              tone: "neutral",
            },
          ],
        },
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 1,
      tags: ["workshop"],
      language: "en",
    },
  });

  const result = validateDeck(deck);
  const flaggedSlide = result.value.slides[0]!;
  const visibleText = flaggedSlide.keyPoints.join(" ");

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "duplicate_visible_points" && issue.severity === "error",
    ),
  );
  assert.equal(result.repaired, false);
  assert.equal(
    flaggedSlide.keyPoints.filter((point) => /^Apply AI tools/i.test(point)).length,
    1,
  );
  assert.match(visibleText, /reviewable draft/i);

  const assessment = evaluateDeckCandidateForRetry(deck);
  assert.equal(assessment.retryable, true);
  assert.ok(assessment.failingCoreChecks.includes("duplicate_visible_points"));
});

test("validation rejects near-duplicate capability wording with different subjects", () => {
  const deck = DeckSchema.parse({
    id: "deck_duplicate_capability_subjects",
    title: "System Verification overview",
    topic: "System Verification",
    summary: "A short overview of System Verification.",
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
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_capabilities",
        order: 0,
        title: "Core capabilities and focus areas",
        learningGoal:
          "System Verification's capabilities combine automation frameworks, advisory workshops, and quality operations.",
        keyPoints: [
          "They utilize test automation frameworks including Playwright, Selenium, Cypress, and Ranorex.",
          "System Verification utilizes test automation frameworks including Playwright, Selenium, Cypress, and Ranorex.",
          "Advisory workshops help teams identify risks and validate data flows before release decisions.",
        ],
        beginnerExplanation:
          "System Verification combines automation, advisory support, and quality operations.",
        advancedExplanation:
          "Advisory workshops connect risk discovery to delivery evidence.",
      },
    ],
    createdAt: "2026-05-03T12:00:00.000Z",
    updatedAt: "2026-05-03T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 1,
      tags: [],
      language: "en",
    },
  });

  const result = validateDeck(deck);
  const flaggedText = result.value.slides[0]?.keyPoints.join(" ") ?? "";

  assert.ok(
    result.issues.some((issue) => issue.code === "duplicate_visible_points"),
  );
  assert.equal(
    (flaggedText.match(/Playwright, Selenium, Cypress, and Ranorex/g) ?? []).length,
    2,
  );
});
