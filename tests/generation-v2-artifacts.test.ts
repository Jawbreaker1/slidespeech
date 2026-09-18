import assert from "node:assert/strict";
import test from "node:test";

import { createPresentationRequestArtifact, createResearchBundleManifest } from "@slidespeech/core";
import { createResearchReviewStage } from "../packages/core/src/generation/v2";
import {
  DeckStrategySchema,
  EvidenceSetSchema,
  FactBankSchema,
  NarrationScriptSetSchema,
  PresentationRequestArtifactSchema,
  PromptClassificationSchema,
  PublishablePresentationSchema,
  PublicationReviewSchema,
  ResearchPlanSchema,
  ResearchBundleSchema,
  ResearchReviewResultSchema,
  ReviewResultSchema,
  SlideDesignSpecSetSchema,
  SlideDraftSchema,
  SlideDraftSetSchema,
  SlidePlanSetSchema,
  createSlideAllocationDecisionSchema,
  createDesignDecisionSchema,
} from "@slidespeech/types";

const createdAt = "2026-07-10T12:00:00.000Z";
const identity = (artifactId: string) => ({
  schemaVersion: "2.0" as const,
  artifactId,
  createdAt,
});

test("request capture preserves structured controls and exact explicit URLs", () => {
  const artifact = createPresentationRequestArtifact(
    {
      topic:
        "Build an overview from https://example.test/about and https://example.test/docs.",
      useWebResearch: true,
      targetDurationMinutes: 12,
      targetSlideCount: 6,
      theme: "editorial",
      pedagogicalProfile: {
        audienceLevel: "advanced",
      },
    },
    {
      createId: (prefix) => `${prefix}_1`,
      now: () => createdAt,
    },
  );

  assert.equal(artifact.request.targetSlideCount, 6);
  assert.equal(artifact.request.targetDurationMinutes, 12);
  assert.equal(artifact.request.theme, "editorial");
  assert.equal(artifact.request.pedagogicalProfile?.audienceLevel, "advanced");
  assert.deepEqual(artifact.explicitUrls, [
    "https://example.test/about",
    "https://example.test/docs",
  ]);
});

test("source URLs preserve balanced delimiters rather than trimming meaningful path characters", () => {
  const url = "https://example.test/Subject_(background)";
  for (const topic of [url, `Read (${url}).`, `[Source](${url})`, `<${url}>`, `${url}, then discuss it.`]) {
    assert.deepEqual(createPresentationRequestArtifact({ topic }).explicitUrls, [url]);
  }
});

test("source extraction preserves encoded paths and query values without inventing fuzzy links", () => {
  const url = "https://example.test/a%28b%29?q=%22x%22#part";
  const topic = `${url} and ${url}. Also https://example.test/åäö, www.example.test, name@example.test and ftp://example.test/file`;
  assert.deepEqual(createPresentationRequestArtifact({ topic }).explicitUrls, [url, new URL("https://example.test/åäö").href]);
});

test("scheme-less websites become candidates, not automatically selected sources", () => {
  for (const topic of ["Present aiai3d.io and its founders.", "Beskriv example.se/om och grundarna.", "Explique example.org/about et ses fondateurs."]) {
    const request = createPresentationRequestArtifact({ topic });
    assert.deepEqual(request.explicitUrls, []);
    assert.equal(request.sourceCandidates?.length, 1);
    assert.equal(request.sourceCandidates[0]!.url, new URL(`https://${request.sourceCandidates[0]!.text}`).href);
    assert.ok(topic.includes(request.sourceCandidates[0]!.text));
  }
  const request = createPresentationRequestArtifact({ topic: "ASP.NET versus Node.js. Do not research the web." });
  assert.deepEqual(request.explicitUrls, []);
  assert.deepEqual(request.sourceCandidates, [{ text: "ASP.NET", url: "https://asp.net/" }]);
});

test("source candidates preserve URL structure and exclude email, IP and other protocols", () => {
  const request = createPresentationRequestArtifact({ topic: "Read (example.org/Subject_(background)?x=%22a%22#part), example.org/Subject_(background)?x=%22a%22#part and www.example.com/åäö. Ignore name@example.net, 192.168.1.2, ftp://example.net/file. Also https://example.com/ and example.com." });
  assert.deepEqual(request.explicitUrls, ["https://example.com/"]);
  assert.deepEqual(request.sourceCandidates?.map(candidate => candidate.url), [
    "https://example.org/Subject_(background)?x=%22a%22#part", new URL("https://www.example.com/åäö").href,
  ]);
});

test("evidence sets preserve resolvable source and requirement lineage", () => {
  const evidence = EvidenceSetSchema.parse({
    ...identity("evidence_set_1"),
    researchPlanArtifactId: "research_plan_1",
    researchBundleArtifactId: "research_bundle_1",
    sources: [
      {
        id: "source_1",
        url: "https://example.test/about",
        title: "About the subject",
        fetchedAt: createdAt,
        retrievedBy: "test-provider",
      },
    ],
    snippets: [
      {
        id: "snippet_1",
        sourceId: "source_1",
        pageId: "page_1",
        pageUrl: "https://example.test/about",
        pageTitle: "About the subject",
        text: "A directly supported statement about the subject.",
      },
    ],
    selectionCoverage: [
      {
        evidenceRequirementId: "evidence_requirement_1",
        snippetIds: ["snippet_1"],
      },
    ],
  });

  assert.equal(evidence.snippets[0]?.sourceId, evidence.sources[0]?.id);
  assert.equal(
    EvidenceSetSchema.safeParse({
      ...evidence,
      selectionCoverage: [
        {
          evidenceRequirementId: "evidence_requirement_1",
          snippetIds: ["missing_snippet"],
        },
      ],
    }).success,
    false,
  );
});

const classification = PromptClassificationSchema.parse({
  ...identity("classification_1"),
  requestArtifactId: "presentation_request_1",
  originalPrompt: "Explain a general subject to a new audience.",
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build a useful shared understanding.",
  deckMode: "teaching",
  groundingMode: "model-knowledge",
  requestedSources: [],
  presentationDirections: [],
  requestedCoverage: [],
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
});

const requestArtifact = PresentationRequestArtifactSchema.parse({
  ...identity("presentation_request_1"),
  request: {
    topic: "Explain a general subject to a new audience.",
  },
  explicitUrls: [],
});

const researchPlan = ResearchPlanSchema.parse({
  ...identity("research_plan_1"),
  requestArtifactId: requestArtifact.artifactId,
  classificationArtifactId: classification.artifactId,
  canExecute: true,
  blockingReason: null,
  requiresExternalResearch: true,
  researchQuestions: [
    {
      id: "research_question_1",
      question: "What directly supported characteristic defines the subject?",
      coverageRequirementIds: [],
    },
  ],
  evidenceRequirements: [
    {
      id: "evidence_1",
      description: "Direct support for the subject's defining characteristic.",
      required: true,
      coverageRequirementIds: [],
    },
  ],
  sourceTargets: [
    {
      id: "source_target_1",
      kind: "web-search",
      query: "general subject defining characteristic",
      purpose: "Find direct support for the defining characteristic.",
      priority: 0,
    },
  ],
  stopCriteria: {
    maximumSources: 5,
    maximumPagesPerDomain: 3,
  },
  knownRiskAreas: [],
});

const evidenceSet = EvidenceSetSchema.parse({
  ...identity("evidence_set_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  researchBundleArtifactId: "research_bundle_1",
  sources: [
    {
      id: "source_1",
      url: "https://example.test/about",
      title: "About the subject",
      fetchedAt: createdAt,
      retrievedBy: "test-provider",
    },
  ],
  snippets: [
    {
      id: "snippet_1",
      sourceId: "source_1",
      pageId: "page_1",
      pageUrl: "https://example.test/about",
      pageTitle: "About the subject",
      text: "The subject has a concrete defining characteristic.",
    },
  ],
  selectionCoverage: [
    {
      evidenceRequirementId: "evidence_1",
      snippetIds: ["snippet_1"],
    },
  ],
});

const rawResearchBundle = ResearchBundleSchema.parse({
  ...identity("research_bundle_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  sources: evidenceSet.sources.map((source) => ({
    ...source, targetId: "source_target_1", origin: "web-search", status: "fetched",
  })),
  pages: evidenceSet.snippets.map((snippet) => ({
    id: snippet.pageId, sourceId: snippet.sourceId, url: snippet.pageUrl,
    title: snippet.pageTitle, content: snippet.text,
  })),
  fetchErrors: [],
  targetOutcomes: [{ targetId: "source_target_1", attemptedUrls: ["https://example.test/about"], stopReason: "no-candidates" }],
});
const researchBundle = createResearchBundleManifest(rawResearchBundle);

test("candidate discovery is preserved in research but cannot masquerade as image approval or fact-review evidence", () => {
  const bundle = structuredClone(rawResearchBundle);
  bundle.pages[0]!.imageDiscovery = {
    candidates: [{ id: "image_1", url: "https://example.test/photo.jpg", discoveredVia: "img", alt: "Untrusted image description" }],
    totalCandidates: 1, truncated: false,
  };
  ResearchBundleSchema.parse(bundle);
  const manifest = createResearchBundleManifest(bundle);
  assert.equal("imageDiscovery" in manifest.pages[0]!, false);
  assert.equal(manifest.pages[0]!.contentCharacters, bundle.pages[0]!.content.length);
  assert.equal(bundle.pages[0]!.imageDiscovery.candidates[0]!.alt, "Untrusted image description");
  const wrongCount = structuredClone(bundle);
  wrongCount.pages[0]!.imageDiscovery!.totalCandidates = 2;
  assert.equal(ResearchBundleSchema.safeParse(wrongCount).success, false);
  const invalidUrl = structuredClone(bundle);
  invalidUrl.pages[0]!.imageDiscovery!.candidates[0]!.url = "not a URL";
  assert.equal(ResearchBundleSchema.safeParse(invalidUrl).success, false);
  const falseApproval = structuredClone(bundle);
  Object.assign(falseApproval.pages[0]!.imageDiscovery!.candidates[0]!, { approved: true });
  assert.equal(ResearchBundleSchema.safeParse(falseApproval).success, false);
  const duplicates = structuredClone(bundle);
  duplicates.pages[0]!.imageDiscovery!.candidates.push(duplicates.pages[0]!.imageDiscovery!.candidates[0]!);
  duplicates.pages[0]!.imageDiscovery!.totalCandidates = 2;
  assert.equal(ResearchBundleSchema.safeParse(duplicates).success, false);
  assert.equal(rawResearchBundle.pages[0]!.imageDiscovery, undefined);
});

const factBank = FactBankSchema.parse({
  ...identity("fact_bank_1"),
  classificationArtifactId: classification.artifactId,
  evidenceSetArtifactId: "evidence_set_1",
  facts: [
    {
      id: "fact_1",
      claim: "The subject has a concrete defining characteristic.",
      origin: "source",
      sourceIds: ["source_1"],
      evidenceSnippetIds: ["snippet_1"],
      evidenceRequirementIds: ["evidence_1"],
      role: "identity",
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
  sufficientForDeck: true,
  blockingReasons: [],
});

const strategy = DeckStrategySchema.parse({
  ...identity("strategy_1"),
  classificationArtifactId: classification.artifactId,
  factBankArtifactId: factBank.artifactId,
  deckMode: "teaching",
  storyArc: [
    { order: 0, role: "intro", audienceQuestion: "What is this subject and why are we here?" },
    { order: 1, role: "conclusion", audienceQuestion: "What should the audience remember?" },
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
      allowedFactIds: ["fact_1"],
      requiredFactIds: ["fact_1"],
      modelKnowledgeScope: { allowed: false },
      overlapPolicy: { mode: "preview", factIds: ["fact_1"] },
    },
    {
      slideId: "slide_conclusion",
      order: 1,
      role: "conclusion",
      allowedFactIds: ["fact_1"],
      requiredFactIds: [],
      modelKnowledgeScope: { allowed: false },
      overlapPolicy: { mode: "recap", factIds: ["fact_1"] },
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
    },
    {
      slideId: "slide_conclusion",
      layoutId: "qa_closing",
      layoutFamily: "closing",
      contentDensity: "sparse",
      visualRole: "question",
      imageStrategy: "none",
      variationSeed: 2,
    },
  ],
});

test("planning contracts have one question owner and reject obsolete parallel prose", () => {
  assert.equal(strategy.storyArc[0]?.audienceQuestion, "What is this subject and why are we here?");
  const oldStrategy = structuredClone(strategy);
  Object.assign(oldStrategy.storyArc[0]!, { purpose: "A prewritten factual account." });
  assert.equal(DeckStrategySchema.safeParse(oldStrategy).success, false);

  const allocation = { slides: slidePlans.slides.map(({ slideId, order, ...slide }) => ({
    ...slide, modelKnowledgeScope: { ...slide.modelKnowledgeScope, scope: null },
    overlapPolicy: { ...slide.overlapPolicy, rationale: null },
  })) };
  const allocationSchema = createSlideAllocationDecisionSchema(strategy, factBank);
  allocationSchema.parse(allocation);
  for (const key of ["audienceQuestion", "learningPurpose", "narrationIntent"]) {
    const legacyPlan = structuredClone(slidePlans);
    Object.assign(legacyPlan.slides[0]!, { [key]: "A competing account." });
    assert.equal(SlidePlanSetSchema.safeParse(legacyPlan).success, false, key);
    const legacyDecision = structuredClone(allocation);
    Object.assign(legacyDecision.slides[0]!, { [key]: "A competing account." });
    assert.equal(allocationSchema.safeParse(legacyDecision).success, false, key);
  }
  for (const key of ["emphasis", "speakerSupport"]) {
    const legacyDesigns = structuredClone(designs);
    Object.assign(legacyDesigns.designs[0]!, { [key]: ["A competing account."] });
    assert.equal(SlideDesignSpecSetSchema.safeParse(legacyDesigns).success, false, key);
  }
  const designSchema = createDesignDecisionSchema(2);
  const decisions = { themeId: "editorial", designs: [
    { layoutId: "editorial-opening", contentDensity: "sparse", visualRole: "hero" },
    { layoutId: "closing-question", contentDensity: "sparse", visualRole: "question" },
  ] };
  designSchema.parse(decisions);
  for (const key of ["emphasis", "speakerSupport"]) {
    const legacyDecision = structuredClone(decisions);
    Object.assign(legacyDecision.designs[0]!, { [key]: ["A competing account."] });
    assert.equal(designSchema.safeParse(legacyDecision).success, false, key);
  }
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

const createApprovedReview = (
  artifactId: string,
  targetStage:
    | "research-review"
    | "outline-review"
    | "slide-review"
    | "narration-review"
    | "publication-review",
  targetArtifactIds: string[],
) => {
  const review = ReviewResultSchema.parse({
  ...identity(artifactId),
  targetStage,
  targetArtifactIds,
  approved: true,
  score: 0.92,
  summary: `${targetStage} approved its exact artifact set.`,
  issues: [],
  retryRecommended: false,
  });
  return targetStage === "research-review"
    ? ResearchReviewResultSchema.parse({
        ...review,
        requirementAssessments: researchPlan.evidenceRequirements.map((requirement) => ({
          evidenceRequirementId: requirement.id,
          status: "supported",
          rationale: "The reviewed evidence directly supports this requirement.",
        })),
      })
    : PublicationReviewSchema.parse(review);
};

const contentArtifactIds = [
  requestArtifact.artifactId,
  classification.artifactId,
  researchPlan.artifactId,
  researchBundle.artifactId,
  evidenceSet.artifactId,
  factBank.artifactId,
  strategy.artifactId,
  slidePlans.artifactId,
  designs.artifactId,
  slides.artifactId,
  narrations.artifactId,
];

const reviews = [
  createApprovedReview("review_research", "research-review", [
    researchPlan.artifactId,
    researchBundle.artifactId,
    evidenceSet.artifactId,
    factBank.artifactId,
  ]),
  createApprovedReview("review_outline", "outline-review", [
    strategy.artifactId,
    slidePlans.artifactId,
  ]),
  createApprovedReview("review_slides", "slide-review", [
    designs.artifactId,
    slides.artifactId,
  ]),
  createApprovedReview("review_narration", "narration-review", [
    slides.artifactId,
    narrations.artifactId,
  ]),
  createApprovedReview(
    "review_publication",
    "publication-review",
    contentArtifactIds,
  ),
];

test("publication stages require explicit final approval and retain every exact upstream artifact", async () => {
  const { createPublicationStages } = await import("../packages/core/src/generation/v2/publication-stages");
  const { executeGenerationStage, InMemoryGenerationTraceRecorder } = await import("@slidespeech/core");
  const candidate = { request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet, factBank, strategy, slidePlans, designs, slides, narrations, reviews: reviews.slice(0, 4) };
  const context = { runId: "publication-test", attempt: 1, inputArtifactIds: contentArtifactIds, sourceIds: evidenceSet.sources.map((source) => source.id) };
  const approved = { approved: true, score: 0.9, summary: "Useful complete presentation.", issues: [], retryRecommended: false };
  for (const value of [approved, { ...approved, approved: false }, {}, { ...approved, retryRecommended: true }]) {
    const recorder = new InMemoryGenerationTraceRecorder();
    const stages = createPublicationStages({ reviewPublication: async (input) => {
      assert.deepEqual(input, candidate);
      return { value: value as import("@slidespeech/types").ReviewDecision, telemetry: { provider: "test", model: "test" } };
    } });
    const review = await executeGenerationStage({ definition: stages.review, input: candidate, context, recorder });
    if (value === approved) {
      assert.equal(review.status, "succeeded");
      if (review.status !== "succeeded") return;
      const publication = await executeGenerationStage({ definition: stages.publication, input: { candidate, review: review.artifact }, context, recorder });
      assert.equal(publication.status, "succeeded");
      if (publication.status === "succeeded") {
        assert.deepEqual(publication.artifact.slides, slides);
        assert.deepEqual(publication.artifact.narrations, narrations);
        assert.equal(publication.artifact.reviews.length, 5);
      }
    } else assert.notEqual(review.status, "succeeded");
  }
});

test("publication cannot silently replace a missing, stale or rejected prerequisite", async () => {
  const { createPublicationStages } = await import("../packages/core/src/generation/v2/publication-stages");
  const { executeGenerationStage, InMemoryGenerationTraceRecorder } = await import("@slidespeech/core");
  const stages = createPublicationStages({ reviewPublication: async () => { throw new Error("Should not be invoked"); } });
  const base = { request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet, factBank, strategy, slidePlans, designs, slides, narrations, reviews: reviews.slice(0, 4) };
  for (const change of [
    { ...base, reviews: base.reviews.slice(1) },
    { ...base, narrations: { ...narrations, slideDraftSetArtifactId: "wrong-slides" } },
    { ...base, reviews: base.reviews.map((review, index) => index === 0 ? { ...review, approved: false } : review) },
  ]) {
    const result = await executeGenerationStage({ definition: stages.publication, input: { candidate: change, review: reviews[4]! },
      context: { runId: "publication-test", attempt: 1, inputArtifactIds: contentArtifactIds, sourceIds: [] }, recorder: new InMemoryGenerationTraceRecorder() });
    assert.equal(result.status, "failed");
  }
});

test("published storage is write-once, survives restart, rejects path traversal and never repairs corruption", async (t) => {
  const { PublishedPresentationStore, createSlidePreviewRenderer } = await import("@slidespeech/providers");
  const { slideDesignProof } = await import("./fixtures/slide-design-proof");
  const { mkdtemp, rm, writeFile, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "publication-store-"));
  try {
    const render = await createSlidePreviewRenderer();
    const scenes = slides.slides.map((slide, index) => {
      const proof = slideDesignProof[index === 0 ? 0 : 5]!;
      const result = render({ ...proof.draft, slideId: slide.slideId }, { ...proof.design, slideId: slide.slideId });
      assert.ok(result.scene); return result.scene;
    });
    const record = { presentation: PublishablePresentationSchema.parse({ ...identity("published_test"), request: requestArtifact, classification, researchPlan, researchBundle,
      evidenceSet, factBank, strategy, slidePlans, designs, slides, narrations, reviews, publishedAt: createdAt }), scenes };

    await t.test("V2 library lists only valid publications, paginates and searches without legacy fallback", async () => {
      const libraryRoot = join(root, "library");
      const library = new PublishedPresentationStore(libraryRoot);
      assert.deepEqual(await library.list(), { items: [], total: 0, unavailableCount: 0, nextOffset: null });
      const newer = structuredClone(record);
      newer.presentation.artifactId = "published_newer";
      newer.presentation.publishedAt = "2026-09-16T12:00:00.000Z";
      newer.scenes[0]!.title = "Ängar och årstider";
      await library.save(record); await library.save(newer);
      const page = await library.list({ limit: 1 });
      assert.equal(page.total, 2); assert.equal(page.nextOffset, 1);
      assert.equal(page.items[0]!.id, "published_newer");
      assert.deepEqual(page.items[0]!.cover, JSON.parse(JSON.stringify(newer.scenes[0])));
      assert.equal(page.items[0]!.slideCount, newer.scenes.length);
      assert.equal((await library.list({ offset: 1, limit: 1 })).items[0]!.id, "published_test");
      assert.equal((await library.list({ order: "oldest" })).items[0]!.id, "published_test");
      assert.equal((await library.list({ query: "ÄNGAR" })).items[0]!.id, "published_newer");
      assert.equal((await library.list({ query: "absent subject" })).total, 0);
      for (const invalid of [{ limit: 0 }, { limit: 25 }, { offset: -1 }, { offset: 0.5 }]) await assert.rejects(library.list(invalid));
      await writeFile(join(libraryRoot, "broken_record.json"), "{}");
      await writeFile(join(libraryRoot, "legacy_record.json"), JSON.stringify({ deck: { title: "Old deck" } }));
      const afterCorruption = await library.list();
      assert.equal(afterCorruption.total, 2); assert.equal(afterCorruption.unavailableCount, 2);
      await assert.rejects(library.get("broken_record"));
    });

    await t.test("archiving preserves exact content, removes playback access and refuses overwrite or traversal", async () => {
      const archiveRoot = join(root, "archive-test");
      const library = new PublishedPresentationStore(archiveRoot);
      await library.save(record);
      const before = await readFile(join(archiveRoot, "published_test.json"), "utf8");
      assert.equal(await library.archive("published_test"), true);
      assert.equal(await library.get("published_test"), undefined);
      assert.equal((await library.list()).total, 0);
      assert.equal(await readFile(join(archiveRoot, "archived", "published_test.json"), "utf8"), before);
      assert.equal(await library.archive("published_test"), false);
      await assert.rejects(library.archive("../outside"));
      await writeFile(join(archiveRoot, "published_test.json"), "do not overwrite the archive");
      await assert.rejects(library.archive("published_test"));
      assert.equal(await readFile(join(archiveRoot, "archived", "published_test.json"), "utf8"), before);
    });

    const store = new PublishedPresentationStore(root);
    await store.save(record);
    await assert.rejects(store.save(record));
    const restored = await new PublishedPresentationStore(root).get("published_test");
    assert.deepEqual(restored, JSON.parse(JSON.stringify(record)));
    restored!.presentation.narrations.scripts[0]!.segments[0] = "Changed by caller";
    assert.deepEqual(await store.get("published_test"), JSON.parse(JSON.stringify(record)));
    await assert.rejects(store.get("../../outside"));
    assert.equal(await store.get("missing_record"), undefined);
    await writeFile(join(root, "published_test.json"), "{}");
    await assert.rejects(store.get("published_test"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("publication rejects missing acquisition coverage and detached evidence pages", () => {
  const candidate = {
    ...identity("presentation_acquisition"), request: requestArtifact, classification,
    researchPlan, researchBundle, evidenceSet, factBank, strategy, slidePlans,
    designs, slides, narrations, reviews, publishedAt: createdAt,
  };
  assert.equal(PublishablePresentationSchema.safeParse(candidate).success, true);
  for (const invalid of [
    { ...candidate, researchBundle: { ...researchBundle, targetOutcomes: [] } },
    { ...candidate, evidenceSet: { ...evidenceSet, researchBundleArtifactId: "unreviewed_bundle" } },
    { ...candidate, evidenceSet: { ...evidenceSet, snippets: evidenceSet.snippets.map((snippet) => ({ ...snippet, pageId: "unacquired_page" })) } },
    { ...candidate, evidenceSet: { ...evidenceSet, sources: evidenceSet.sources.map((source) => ({ ...source, url: "https://unrelated.test/" })) } },
  ]) {
    assert.equal(PublishablePresentationSchema.safeParse(invalid).success, false);
  }
});

test("publication preserves explicit sources while allowing only captured candidate URLs", () => {
  const base = { ...identity("presentation_sources"), request: requestArtifact, classification,
    researchPlan, researchBundle, evidenceSet, factBank, strategy, slidePlans, designs, slides, narrations, reviews, publishedAt: createdAt };
  const url = "https://example.org/";
  const request = { ...requestArtifact, sourceCandidates: [{ text: "example.org", url }] };
  assert.ok(PublishablePresentationSchema.safeParse({ ...base, request }).success, "An unselected candidate is not a required source");
  const selected = { ...classification, requestedSources: [{ id: "requested_candidate", url }] };
  assert.ok(PublishablePresentationSchema.safeParse({ ...base, request, classification: selected }).success);
  assert.ok(!PublishablePresentationSchema.safeParse({ ...base, classification: selected }).success, "No URL invention");
  assert.ok(!PublishablePresentationSchema.safeParse({ ...base, request: { ...request, explicitUrls: [url] } }).success, "An explicit URL cannot disappear");
  assert.ok(!PublishablePresentationSchema.safeParse({ ...base, request, classification: { ...selected, requestedSources: [{ id: "requested_candidate", url: `${url}invented-path` }] } }).success);
});

test("acquisition manifests retain lineage and size without duplicating raw page content", () => {
  assert.equal(researchBundle.artifactId, rawResearchBundle.artifactId);
  assert.equal(researchBundle.pages[0]?.contentCharacters, rawResearchBundle.pages[0]?.content.length);
  assert.equal(Object.hasOwn(researchBundle.pages[0]!, "content"), false);
  assert.deepEqual(researchBundle.targetOutcomes, rawResearchBundle.targetOutcomes);
});

test("Pipeline 2.0 artifact chain parses as one publishable presentation", () => {
  const presentation = PublishablePresentationSchema.parse({
    ...identity("presentation_1"),
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews,
    publishedAt: createdAt,
  });

  assert.equal(presentation.slides.slides.length, 2);
  assert.equal(presentation.slidePlans.slides[0]?.role, "intro");
  assert.equal(presentation.slidePlans.slides.at(-1)?.role, "conclusion");
  const { selectionCoverage, ...selectedEvidence } = presentation.evidenceSet;
  assert.ok(selectionCoverage, "Historical coverage remains readable without rewriting the publication.");
  const current = PublishablePresentationSchema.parse({ ...presentation, evidenceSet: selectedEvidence });
  assert.equal(Object.hasOwn(current.evidenceSet, "selectionCoverage"), false);
  assert.deepEqual(current.factBank, presentation.factBank, "Coverage responsibility stays with the unchanged fact bank.");
});

test("publication preserves the actual research-review stage artifact", async () => {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected agent call.");
  };
  const stage = createResearchReviewStage({
    agent: {
      name: "contract-test",
      healthCheck: unused,
      classifyPrompt: unused,
      planResearch: unused,
      selectResearchSources: unused,
      selectEvidence: unused,
      curateFacts: unused,
      reviewResearch: async () => ({
        value: {
          approved: true,
          score: 0.9,
          summary: "Evidence supports the required defining characteristic.",
          issues: [],
          retryRecommended: false,
          requirementAssessments: {
            evidence_1: { status: "supported", rationale: "fact_1 is supported by snippet_1." },
          },
        },
        telemetry: { provider: "test", model: "test" },
      }),
    },
    artifactFactory: { createId: () => "actual_research_review", now: () => createdAt },
  });
  const result = await stage.execute(
    { request: requestArtifact, classification, researchPlan, researchBundle: rawResearchBundle, evidenceSet, factBank },
    { runId: "run_1", attempt: 1, inputArtifactIds: [], sourceIds: [],
      signal: new AbortController().signal, reportProgress: () => {} },
  );
  assert.equal(result.status, "succeeded");
  const actualReview = stage.parseArtifact(result.artifact);
  const presentation = PublishablePresentationSchema.parse({
    ...identity("presentation_actual_review"),
    request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet, factBank,
    strategy, slidePlans, designs, slides, narrations,
    reviews: [actualReview, ...reviews.filter((review) => review.targetStage !== "research-review")],
    publishedAt: createdAt,
  });
  assert.deepEqual(presentation.reviews[0], actualReview);
});

test("publication requires intact research assessments and consistent approvals", () => {
  const candidate = {
    ...identity("presentation_review_contracts"),
    request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet, factBank,
    strategy, slidePlans, designs, slides, narrations, reviews, publishedAt: createdAt,
  };
  assert.equal(PublishablePresentationSchema.safeParse(candidate).success, true);
  const researchReview = ResearchReviewResultSchema.parse(reviews[0]);
  const { requirementAssessments: _assessments, ...missingAudit } = researchReview;
  const unsupported = {
    evidenceRequirementId: "evidence_1", status: "unsupported",
    rationale: "The requirement lacks direct support.", artifactId: factBank.artifactId,
    factIds: ["fact_1"], retryInstruction: "Obtain direct support for the requirement.",
  };
  for (const invalid of [
    missingAudit,
    { ...researchReview, requirementAssessments: [] },
    { ...researchReview, requirementAssessments: [...researchReview.requirementAssessments, ...researchReview.requirementAssessments] },
    { ...researchReview, requirementAssessments: [{ ...researchReview.requirementAssessments[0], evidenceRequirementId: "unknown" }] },
    { ...researchReview, requirementAssessments: [unsupported] },
    { ...researchReview, retryRecommended: true },
  ]) {
    assert.equal(PublishablePresentationSchema.safeParse({
      ...candidate, reviews: [invalid, ...reviews.slice(1)],
    }).success, false);
  }
  for (const severity of ["warning", "error"] as const) {
    const result = PublishablePresentationSchema.safeParse({
      ...candidate,
      reviews: reviews.map((review) => review.targetStage === "publication-review" ? {
        ...review, issues: [{
          code: "content_observation", dimension: "coherence", severity,
          message: "An observation from the reviewer.", factIds: [],
        }],
      } : review),
    });
    assert.equal(result.success, severity === "warning");
  }
  const optionalCandidate = {
    ...candidate,
    researchPlan: {
      ...researchPlan,
      evidenceRequirements: researchPlan.evidenceRequirements.map((requirement) => ({
        ...requirement, required: false,
      })),
    },
  };
  for (const assessment of [
    unsupported,
    { ...unsupported, artifactId: "unknown" },
    { ...unsupported, factIds: ["unknown"] },
  ]) {
    assert.equal(PublishablePresentationSchema.safeParse({
      ...optionalCandidate,
      reviews: [{ ...researchReview, requirementAssessments: [assessment] }, ...reviews.slice(1)],
    }).success, assessment === unsupported);
  }
  assert.equal(ResearchReviewResultSchema.safeParse({
    ...researchReview, targetStage: "slide-review",
  }).success, false);
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
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews: reviews.map((review) =>
      review.targetStage === "publication-review"
        ? { ...review, approved: false }
        : review,
    ),
    publishedAt: createdAt,
  });

  assert.equal(result.success, false);
});

test("publication cannot override an insufficient fact bank with approved reviews", () => {
  const result = PublishablePresentationSchema.safeParse({
    ...identity("presentation_insufficient"),
    request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet,
    factBank: {
      ...factBank,
      sufficientForDeck: false,
      blockingReasons: ["Required evidence remains incomplete."],
    },
    strategy, slidePlans, designs, slides, narrations, reviews,
    publishedAt: createdAt,
  });
  assert.equal(result.success, false);
});

test("current fact banks publish only with exact complete research approval, never self approval", () => {
  assert.ok("sufficientForDeck" in factBank, "Keep the historical publication fixture intact.");
  const { sourceSummaries, sourceQuality, missingFacts, contradictions, sufficientForDeck, blockingReasons, ...content } = factBank;
  const currentBank = { ...content, uncertainties: [] };
  const candidate = {
    ...identity("presentation_current_facts"),
    request: requestArtifact, classification, researchPlan, researchBundle, evidenceSet,
    factBank: currentBank, strategy, slidePlans, designs, slides, narrations, reviews,
    publishedAt: createdAt,
  };
  assert.equal(PublishablePresentationSchema.safeParse(candidate).success, true);
  assert.equal(FactBankSchema.safeParse({ ...currentBank, sufficientForDeck: true }).success, false);
  assert.equal(FactBankSchema.safeParse({ ...content }).success, false);
  for (const invalid of [
    { factBank: { ...currentBank, facts: [] } },
    { factBank: { ...currentBank, uncertainties: [{ description: "Unknown evidence.", evidenceSnippetIds: ["unknown"], evidenceRequirementIds: [] }] } },
    { factBank: { ...currentBank, uncertainties: [{ description: "Unknown requirement.", evidenceSnippetIds: [], evidenceRequirementIds: ["unknown"] }] } },
    { reviews: reviews.filter(review => review.targetStage !== "research-review") },
    { reviews: reviews.map(review => review.targetStage === "research-review" ? { ...review, approved: false } : review) },
    { reviews: reviews.map(review => review.targetStage === "research-review" ? { ...review, targetArtifactIds: ["other_bank"] } : review) },
    { reviews: reviews.map(review => review.targetStage === "research-review" ? { ...review, requirementAssessments: [] } : review) },
  ]) assert.equal(PublishablePresentationSchema.safeParse({ ...candidate, ...invalid }).success, false);
});

test("publishable presentations reject unresolved fact and source lineage", () => {
  const unknownFactResult = PublishablePresentationSchema.safeParse({
    ...identity("presentation_unknown_fact"),
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans: {
      ...slidePlans,
      slides: [
        { ...slidePlans.slides[0], allowedFactIds: ["unknown_fact"] },
        slidePlans.slides[1],
      ],
    },
    designs,
    slides,
    narrations,
    reviews,
    publishedAt: createdAt,
  });
  assert.equal(unknownFactResult.success, false);

  const unknownSourceResult = PublishablePresentationSchema.safeParse({
    ...identity("presentation_unknown_source"),
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides: {
      ...slides,
      slides: [
        {
          ...slides.slides[0],
          sourceAttributions: [
            { sourceId: "unknown_source", label: "Unknown" },
          ],
        },
        slides.slides[1],
      ],
    },
    narrations,
    reviews,
    publishedAt: createdAt,
  });
  assert.equal(unknownSourceResult.success, false);
});

test("publishable presentations require every exact stage review", () => {
  const missingReviewResult = PublishablePresentationSchema.safeParse({
    ...identity("presentation_missing_review"),
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews: reviews.filter(
      (review) => review.targetStage !== "narration-review",
    ),
    publishedAt: createdAt,
  });
  assert.equal(missingReviewResult.success, false);

  const wrongTargetsResult = PublishablePresentationSchema.safeParse({
    ...identity("presentation_wrong_review_targets"),
    request: requestArtifact,
    classification,
    researchPlan,
    researchBundle,
    evidenceSet,
    factBank,
    strategy,
    slidePlans,
    designs,
    slides,
    narrations,
    reviews: reviews.map((review) =>
      review.targetStage === "slide-review"
        ? { ...review, targetArtifactIds: [slides.artifactId] }
        : review,
    ),
    publishedAt: createdAt,
  });
  assert.equal(wrongTargetsResult.success, false);
});
