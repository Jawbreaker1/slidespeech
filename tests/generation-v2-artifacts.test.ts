import assert from "node:assert/strict";
import test from "node:test";

import {
  DeckStrategySchema,
  FactBankSchema,
  NarrationScriptSetSchema,
  PromptClassificationSchema,
  PublishablePresentationSchema,
  ReviewResultSchema,
  SlideDesignSpecSetSchema,
  SlideDraftSchema,
  SlideDraftSetSchema,
  SlidePlanSetSchema,
} from "@slidespeech/types";

const createdAt = "2026-07-10T12:00:00.000Z";
const identity = (artifactId: string) => ({
  schemaVersion: "2.0" as const,
  artifactId,
  createdAt,
});

const classification = PromptClassificationSchema.parse({
  ...identity("classification_1"),
  originalPrompt: "Explain a general subject to a new audience.",
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build a useful shared understanding.",
  deckMode: "teaching",
  groundingMode: "model-knowledge",
  requestedSources: [],
  requestedCoverage: [],
  confidence: 0.92,
  openQuestions: [],
});

const factBank = FactBankSchema.parse({
  ...identity("fact_bank_1"),
  classificationArtifactId: classification.artifactId,
  facts: [
    {
      id: "fact_1",
      claim: "The subject has a concrete defining characteristic.",
      origin: "source",
      sourceIds: ["source_1"],
      evidenceExcerpt: "Evidence supporting the defining characteristic.",
      role: "identity",
      confidence: 0.9,
      language: "en",
      allowedUse: "visible-slide",
    },
  ],
  sourceSummaries: [
    { sourceId: "source_1", summary: "A concise source summary." },
  ],
  sourceQuality: [
    {
      sourceId: "source_1",
      quality: "high",
      rationale: "The source directly supports the claim.",
    },
  ],
  missingFacts: [],
  contradictions: [],
  modelKnowledgeAllowed: true,
});

const strategy = DeckStrategySchema.parse({
  ...identity("strategy_1"),
  classificationArtifactId: classification.artifactId,
  factBankArtifactId: factBank.artifactId,
  deckMode: "teaching",
  storyArc: [
    { order: 0, purpose: "Orient the audience." },
    { order: 1, purpose: "Synthesize and invite questions." },
  ],
  requiredIntro: true,
  requiredConclusion: true,
  slideCount: 2,
  durationMinutes: 4,
  language: "en",
  audience: "Newcomers",
  tone: "Clear and direct",
  layoutVarietyPolicy: {
    minimumUniqueLayouts: 2,
    maximumConsecutiveSameFamily: 1,
    allowIntentionalRepetition: false,
  },
  narrationStyle: "Connected presenter speech",
});

const slidePlans = SlidePlanSetSchema.parse({
  ...identity("slide_plans_1"),
  deckStrategyArtifactId: strategy.artifactId,
  factBankArtifactId: factBank.artifactId,
  slides: [
    {
      slideId: "slide_intro",
      order: 0,
      role: "intro",
      audienceQuestion: "What is this subject and why are we here?",
      learningPurpose: "Orient the audience without exhausting the material.",
      allowedFactIds: ["fact_1"],
      requiredFactIds: ["fact_1"],
      forbiddenFactIds: [],
      modelKnowledgeScope: { allowed: false },
      overlapPolicy: { mode: "preview", factIds: ["fact_1"] },
      narrationIntent: "Welcome and orient the audience.",
    },
    {
      slideId: "slide_conclusion",
      order: 1,
      role: "conclusion",
      audienceQuestion: "What should the audience remember?",
      learningPurpose: "Synthesize the material and invite questions.",
      allowedFactIds: ["fact_1"],
      requiredFactIds: [],
      forbiddenFactIds: [],
      modelKnowledgeScope: { allowed: false },
      overlapPolicy: { mode: "recap", factIds: ["fact_1"] },
      narrationIntent: "Close the presentation naturally.",
    },
  ],
});

const designs = SlideDesignSpecSetSchema.parse({
  ...identity("designs_1"),
  deckStrategyArtifactId: strategy.artifactId,
  slidePlanSetArtifactId: slidePlans.artifactId,
  designs: [
    {
      slideId: "slide_intro",
      layoutId: "intro_hero",
      layoutFamily: "hero",
      contentDensity: "sparse",
      visualRole: "hero",
      imageStrategy: "none",
      variationSeed: 1,
      emphasis: ["subject"],
      speakerSupport: ["orientation"],
    },
    {
      slideId: "slide_conclusion",
      layoutId: "qa_closing",
      layoutFamily: "closing",
      contentDensity: "sparse",
      visualRole: "question",
      imageStrategy: "none",
      variationSeed: 2,
      emphasis: ["takeaway"],
      speakerSupport: ["question invitation"],
    },
  ],
});

const slides = SlideDraftSetSchema.parse({
  ...identity("slides_1"),
  deckStrategyArtifactId: strategy.artifactId,
  slidePlanSetArtifactId: slidePlans.artifactId,
  slideDesignSpecSetArtifactId: designs.artifactId,
  slides: [
    {
      slideId: "slide_intro",
      title: "A clear introduction",
      content: {
        kind: "statement",
        statement: "The subject starts with one defining characteristic.",
      },
      usedFactIds: ["fact_1"],
      speakerNotes: [],
      sourceAttributions: [{ sourceId: "source_1", label: "Primary source" }],
      likelyQuestions: [],
    },
    {
      slideId: "slide_conclusion",
      title: "What to remember",
      content: {
        kind: "question",
        question: "What would you like to explore next?",
      },
      usedFactIds: ["fact_1"],
      speakerNotes: [],
      sourceAttributions: [{ sourceId: "source_1", label: "Primary source" }],
      likelyQuestions: [],
    },
  ],
});

const narrations = NarrationScriptSetSchema.parse({
  ...identity("narrations_1"),
  deckStrategyArtifactId: strategy.artifactId,
  slideDraftSetArtifactId: slides.artifactId,
  scripts: [
    {
      slideId: "slide_intro",
      openingBridge: "Welcome. Let us start with the subject itself.",
      segments: ["This opening gives us a shared point of departure."],
      transitionOut: "With that orientation, we can move to the takeaway.",
      pausePrompts: [],
      sourceMentions: ["source_1"],
    },
    {
      slideId: "slide_conclusion",
      openingBridge: "Let us bring the presentation together.",
      segments: ["The defining characteristic is the main idea to retain."],
      transitionOut: "That concludes the prepared material.",
      pausePrompts: [],
      sourceMentions: ["source_1"],
      questionInvitation: "Questions are welcome.",
    },
  ],
});

const publicationReview = ReviewResultSchema.parse({
  ...identity("review_1"),
  targetStage: "publication-review",
  targetArtifactIds: [slides.artifactId, narrations.artifactId],
  approved: true,
  score: 0.92,
  summary: "The complete presentation is publishable.",
  issues: [],
  retryRecommended: false,
});

test("Pipeline 2.0 artifact chain parses as one publishable presentation", () => {
  const presentation = PublishablePresentationSchema.parse({
    ...identity("presentation_1"),
    classification,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews: [publicationReview],
    publishedAt: createdAt,
  });

  assert.equal(presentation.slides.slides.length, 2);
  assert.equal(presentation.slidePlans.slides[0]?.role, "intro");
  assert.equal(presentation.slidePlans.slides.at(-1)?.role, "conclusion");
});

test("slide drafts accept one layout-specific content shape and reject legacy surface fields", () => {
  assert.equal(
    SlideDraftSchema.safeParse({
      slideId: "slide_cards",
      title: "Distinct cards",
      content: {
        kind: "cards",
        cards: [
          { title: "First", body: "First distinct idea." },
          { title: "Second", body: "Second distinct idea." },
        ],
      },
      usedFactIds: [],
      speakerNotes: [],
      sourceAttributions: [],
      likelyQuestions: [],
    }).success,
    true,
  );

  assert.equal(
    SlideDraftSchema.safeParse({
      slideId: "slide_legacy",
      title: "Repeated legacy surface",
      content: { kind: "statement", statement: "One claim." },
      keyPoints: ["One claim."],
      beginnerExplanation: "One claim.",
      usedFactIds: [],
      speakerNotes: [],
      sourceAttributions: [],
      likelyQuestions: [],
    }).success,
    false,
  );
});

test("artifact contracts fail on missing provenance and invalid slide boundaries", () => {
  const factResult = FactBankSchema.safeParse({
    ...factBank,
    facts: [{ ...factBank.facts[0], sourceIds: [] }],
  });
  assert.equal(factResult.success, false);

  const planResult = SlidePlanSetSchema.safeParse({
    ...slidePlans,
    slides: [
      { ...slidePlans.slides[0], role: "context" },
      slidePlans.slides[1],
    ],
  });
  assert.equal(planResult.success, false);
});

test("publishable presentations fail closed when publication review rejects", () => {
  const result = PublishablePresentationSchema.safeParse({
    ...identity("presentation_rejected"),
    classification,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews: [{ ...publicationReview, approved: false }],
    publishedAt: createdAt,
  });

  assert.equal(result.success, false);
});
