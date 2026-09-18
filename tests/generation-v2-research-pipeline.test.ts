import assert from "node:assert/strict";
import test from "node:test";

import type {
  FactBankDecision,
  FactCurationAgentInput,
  GenerationAgentCall,
  GenerationResearchDocument,
  GenerationResearchSearchResult,
  GenerationV2AgentProvider,
  GenerationV2ResearchProvider,
  PromptClassificationDecision,
  ResearchPlanDecision,
  ResearchReviewAgentInput,
  ResearchReviewDecision,
  DeckStrategyAgentInput,
  SlideAllocationAgentInput,
  OutlineReviewAgentInput,
  DeckStrategyDecision,
  SlideAllocationDecision,
  ReviewDecision,
  GenerationV2OutlineAgentProvider,
} from "@slidespeech/types";
import {
  GenerationV2ResearchPipeline,
  GenerationV2Pipeline,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";
import { GenerationV2Jobs } from "../apps/api/src/services/generation-v2/jobs";
import { GenerationV2JobSchema, ReviewResultSchema } from "@slidespeech/types";

const createdAt = "2026-08-24T12:00:00.000Z";
const telemetry = { provider: "pipeline-agent", model: "test-model" };

const classificationDecision: PromptClassificationDecision = {
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build understanding.",
  deckMode: "teaching",
  groundingMode: "model-knowledge",
  presentationDirections: [],
  requestedCoverage: [],
  requestedSlideCount: null,
  requestedDurationMinutes: null,
  visualPreference: null,
  voicePreference: null,
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
};

const researchPlanDecision: ResearchPlanDecision = {
  canExecute: true,
  blockingReason: null,
  requiresExternalResearch: false,
  researchQuestions: [
    {
      question: "What defines the subject?",
      coverageRequirementIndexes: [],
      evidenceRequirements: [
        {
          description: "A supported definition of the subject.",
          required: true,
        },
      ],
    },
  ],
  sourceTargets: [
    {
      kind: "model-knowledge",
      scope: "Stable foundational knowledge about the subject.",
      purpose: "Support a concise definition.",
      priority: 0,
    },
  ],
  knownRiskAreas: [],
};

const factDecision: FactBankDecision = {
  facts: [
    {
      claim: "The subject has a stable defining characteristic.",
      origin: "model-knowledge",
      knowledgeBasis: "Stable foundational knowledge permitted by the plan.",
      evidenceRequirementIds: [],
      role: "identity",
      language: "en",
    },
  ],
  uncertainties: [],
};

class PipelineAgent implements GenerationV2AgentProvider {
  readonly name = "pipeline-agent";
  reviewCalls = 0;
  planCalls = 0;
  factCalls = 0;
  factFeedback: boolean[] = [];
  factStageFeedback: boolean[] = [];
  retryTargetIndex: 0 | 1 | 2 | 3 = 3;
  alwaysRejectReview = false;
  approveFirstReview = false;
  rejectFirstFactStage = false;

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "ready",
      checkedAt: createdAt,
    };
  }

  async classifyPrompt(): Promise<
    GenerationAgentCall<PromptClassificationDecision>
  > {
    return { value: classificationDecision, telemetry };
  }

  async planResearch(): Promise<GenerationAgentCall<ResearchPlanDecision>> {
    this.planCalls += 1;
    return { value: researchPlanDecision, telemetry };
  }

  async selectResearchSources(): Promise<never> {
    throw new Error("Source selection is not used by model-knowledge research.");
  }

  async selectEvidence(): Promise<never> {
    throw new Error("Evidence selection is not used without fetched pages.");
  }

  async curateFacts(
    input: FactCurationAgentInput,
  ): Promise<GenerationAgentCall<FactBankDecision>> {
    this.factCalls += 1;
    this.factFeedback.push(input.reviewFeedback !== undefined);
    this.factStageFeedback.push(input.stageFeedback !== undefined);
    const requirementIds = this.rejectFirstFactStage && this.factCalls === 1
      ? ["unknown_requirement"]
      : input.researchPlan.evidenceRequirements.map((requirement) => requirement.id);
    const decision = {
      ...factDecision,
      facts: factDecision.facts.map((fact) => ({
        ...fact,
        evidenceRequirementIds: requirementIds,
      })),
    };
    return { value: decision, telemetry };
  }

  async reviewResearch(
    input: ResearchReviewAgentInput,
  ): Promise<GenerationAgentCall<ResearchReviewDecision>> {
    this.reviewCalls += 1;
    const requirementAssessments = Object.fromEntries(
      input.targetArtifacts[0].evidenceRequirements.map((requirement) => [
        requirement.id,
        (this.approveFirstReview || this.reviewCalls > 1) &&
        !this.alwaysRejectReview
          ? {
              status: "supported" as const,
              rationale: "The research chain supports this requirement.",
            }
          : {
              status: "unsupported" as const,
              rationale: "The owning research artifact needs revision.",
              targetArtifactIndex: this.retryTargetIndex,
              factIndexes: this.retryTargetIndex === 3 ? [0] : [],
              retryInstruction:
                "Address this issue while preserving the request.",
            },
      ]),
    );
    if (
      (this.approveFirstReview || this.reviewCalls > 1) &&
      !this.alwaysRejectReview
    ) {
      return {
        value: {
          approved: true,
          score: 0.9,
          summary: "The revised research chain supports the request.",
          issues: [],
          retryRecommended: false,
          requirementAssessments,
        },
        telemetry,
      };
    }
    return {
      value: {
        approved: false,
        score: 0.5,
        summary: "One owning research artifact needs revision.",
        issues: [],
        retryRecommended: true,
        requirementAssessments,
      },
      telemetry,
    };
  }
}

class NoNetworkResearchProvider implements GenerationV2ResearchProvider {
  readonly name = "no-network";

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "ready",
      checkedAt: createdAt,
    };
  }

  async search(): Promise<GenerationResearchSearchResult[]> {
    throw new Error("Network research must not run for this plan.");
  }

  async fetch(): Promise<GenerationResearchDocument> {
    throw new Error("Network research must not run for this plan.");
  }
}

const executePipeline = (agent: PipelineAgent) => {
  let sequence = 0;
  const recorder = new InMemoryGenerationTraceRecorder();
  const pipeline = new GenerationV2ResearchPipeline({
    agent,
    researchProvider: new NoNetworkResearchProvider(),
    recorder,
    artifactFactory: {
      createId: (prefix) => `${prefix}_${++sequence}`,
      now: () => createdAt,
    },
  });
  return {
    recorder,
    result: pipeline.execute({ topic: "Explain a general subject." }),
  };
};

test("research review retries only fact curation when the fact bank owns the issue", async () => {
  const agent = new PipelineAgent();
  const execution = executePipeline(agent);
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(agent.planCalls, 1);
  assert.equal(agent.factCalls, 2);
  assert.deepEqual(agent.factFeedback, [false, true]);
  assert.deepEqual(
    execution.recorder.records
      .filter((record) => record.stage === "fact-curation")
      .map((record) => record.attempt),
    [1, 3],
  );
});

test("research pipeline retries a retryable agent stage with diagnostics", async () => {
  const agent = new PipelineAgent();
  agent.rejectFirstFactStage = true;
  agent.approveFirstReview = true;
  const execution = executePipeline(agent);
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(agent.factCalls, 2);
  assert.deepEqual(agent.factStageFeedback, [false, true]);
  assert.deepEqual(
    execution.recorder.records
      .filter((record) => record.stage === "fact-curation")
      .map((record) => record.attempt),
    [1, 2],
  );
});

test("research review rebuilds downstream artifacts when the plan owns the issue", async () => {
  const agent = new PipelineAgent();
  agent.retryTargetIndex = 0;
  const execution = executePipeline(agent);
  const result = await execution.result;

  assert.equal(result.status, "succeeded");
  assert.equal(agent.planCalls, 2);
  assert.equal(agent.factCalls, 2);
  assert.deepEqual(
    execution.recorder.records
      .filter((record) => record.stage === "research-execution")
      .map((record) => record.attempt),
    [1, 2],
  );
});

test("acquisition-owned review retry preserves the plan and rebuilds its downstream artifacts", async () => {
  const agent = new PipelineAgent();
  agent.retryTargetIndex = 1;
  const execution = executePipeline(agent);
  const result = await execution.result;
  assert.equal(result.status, "succeeded");
  assert.equal(agent.planCalls, 1);
  for (const stage of ["research-execution", "evidence-selection", "fact-curation"]) {
    assert.equal(execution.recorder.records.filter((record) => record.stage === stage).length, 2, stage);
  }
});

test("evidence-owned retry preserves both plan and acquisition", async () => {
  const agent = new PipelineAgent();
  agent.retryTargetIndex = 2;
  const execution = executePipeline(agent);
  assert.equal((await execution.result).status, "succeeded");
  assert.equal(agent.planCalls, 1);
  assert.equal(execution.recorder.records.filter((record) => record.stage === "research-execution").length, 1);
  assert.equal(execution.recorder.records.filter((record) => record.stage === "evidence-selection").length, 2);
  assert.equal(agent.factCalls, 2);
});

test("acquisition-owned rejection exhausts the existing single research retry", async () => {
  const agent = new PipelineAgent();
  agent.retryTargetIndex = 1;
  agent.alwaysRejectReview = true;
  const execution = executePipeline(agent);
  const result = await execution.result;
  assert.equal(result.status, "rejected");
  assert.equal(agent.planCalls, 1);
  assert.equal(agent.reviewCalls, 2);
  assert.equal(execution.recorder.records.filter((record) => record.stage === "research-execution").length, 2);
});

test("research review fails closed after one unsuccessful retry", async () => {
  const agent = new PipelineAgent();
  agent.alwaysRejectReview = true;
  const execution = executePipeline(agent);
  const result = await execution.result;

  assert.equal(result.status, "rejected");
  assert.equal(result.stage, "research-review");
  assert.equal(agent.reviewCalls, 2);
  assert.equal(agent.factCalls, 2);
});

test("research pipeline propagates external cancellation and never proceeds to planning", async () => {
  const controller = new AbortController();
  const agent = new PipelineAgent();
  const pipeline = new GenerationV2ResearchPipeline({
    agent,
    researchProvider: new NoNetworkResearchProvider(),
    recorder: new InMemoryGenerationTraceRecorder(),
    onProgress: (event) => {
      if (event.stage === "prompt-classification" && event.status === "started") {
        controller.abort(new Error("Cancelled by user."));
      }
    },
  });
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { signal: controller.signal });
  assert.equal(result.status, "failed");
  assert.equal(agent.planCalls, 0);
  assert.equal(agent.factCalls, 0);
});

class OutlinePipelineAgent extends PipelineAgent implements GenerationV2OutlineAgentProvider {
  strategyCalls = 0;
  allocationCalls = 0;
  outlineReviewCalls = 0;
  strategyDecision: DeckStrategyDecision = {
    canPlan: true, blockingReason: null,
    strategy: { storyArc: [{ role: "intro", audienceQuestion: "What are we here to understand?" }, { role: "conclusion", audienceQuestion: "What should we take away, and what questions remain?" }], durationMinutes: 3, tone: "Clear and welcoming", layoutVarietyPolicy: { minimumUniqueLayouts: 2, maximumConsecutiveSameFamily: 1, allowIntentionalRepetition: false }, narrationStyle: "Develop connected explanations." },
  };
  outlineDecision: ReviewDecision = { approved: true, score: 0.9, summary: "Useful and grounded outline.", issues: [], retryRecommended: false };
  changeAllocation?: (decision: SlideAllocationDecision) => void;
  lastInput?: DeckStrategyAgentInput;

  async planDeckStrategy(input: DeckStrategyAgentInput) {
    this.strategyCalls++;
    this.lastInput = input;
    return { value: this.strategyDecision, telemetry };
  }
  async allocateSlides(input: SlideAllocationAgentInput) {
    this.allocationCalls++;
    const ids = input.factBank.facts.map((fact) => fact.id);
    const decision: SlideAllocationDecision = { slides: input.strategy.storyArc.map((beat, index) => ({
      role: beat.role,
      allowedFactIds: ids, requiredFactIds: ids,
      modelKnowledgeScope: { allowed: false, scope: null },
      overlapPolicy: { mode: index === 0 ? "preview" : "recap", factIds: ids, rationale: "Preview and synthesize the main idea." },
    })) };
    this.changeAllocation?.(decision);
    return { value: decision, telemetry };
  }
  async reviewOutline(_input: OutlineReviewAgentInput) {
    this.outlineReviewCalls++;
    return { value: this.outlineDecision, telemetry };
  }
}

function outlinePipeline(agent = new OutlinePipelineAgent(), controller?: AbortController, cancelStage?: string) {
  agent.approveFirstReview = true;
  const recorder = new InMemoryGenerationTraceRecorder();
  const pipeline = new GenerationV2Pipeline({
    agent, recorder, researchProvider: new NoNetworkResearchProvider(),
    onProgress: (event) => { if (event.stage === cancelStage && event.status === "started") controller?.abort(); },
  });
  return { pipeline, agent, recorder };
}

test("connected V2 pipeline carries one immutable request and run through research, strategy, allocation and review", async () => {
  const { pipeline, agent, recorder } = outlinePipeline();
  const result = await pipeline.plan({ topic: "Explain a general subject.", targetSlideCount: 2, targetDurationMinutes: 3 });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.equal(agent.planCalls, 1);
  assert.equal(agent.factCalls, 1);
  assert.equal(agent.strategyCalls, 1);
  assert.equal(agent.lastInput?.request.request.targetSlideCount, 2);
  assert.equal(agent.lastInput?.request.request.targetDurationMinutes, 3);
  assert.equal(new Set(recorder.records.map((record) => record.runId)).size, 1);
  assert.deepEqual(recorder.records.slice(-3).map((record) => record.stage), ["deck-strategy", "slide-allocation", "outline-review"]);
  assert.deepEqual(result.slidePlans.slides.map((slide) => slide.role), ["intro", "conclusion"]);
  assert.equal(result.strategy.factBankArtifactId, result.factBank.artifactId);
  assert.equal(result.slidePlans.deckStrategyArtifactId, result.strategy.artifactId);
  assert.deepEqual(result.outlineReview.targetArtifactIds, [result.strategy.artifactId, result.slidePlans.artifactId]);
  assert.equal("slides" in result, false);
});

test("strategy can reject thin material without allocation or fallback", async () => {
  const { pipeline, agent } = outlinePipeline();
  agent.strategyDecision = { canPlan: false, blockingReason: "Not enough distinct material.", strategy: null };
  const result = await pipeline.plan({ topic: "Explain a general subject." });
  assert.equal(result.status, "rejected");
  assert.equal(agent.allocationCalls, 0);
  assert.equal(agent.outlineReviewCalls, 0);
});

for (const defect of ["unknown-fact", "missing-intro", "missing-conclusion", "missing-slide", "duplicate-fact", "required-not-allowed", "overlap-not-allowed"] as const) {
  test(`allocation rejects ${defect} without semantic repairs or review`, async () => {
    const { pipeline, agent } = outlinePipeline();
    agent.changeAllocation = (decision) => {
      const slide = decision.slides[0]!;
      if (defect === "unknown-fact") slide.allowedFactIds = ["unknown_fact"];
      if (defect === "missing-intro") slide.role = "context";
      if (defect === "missing-conclusion") decision.slides.at(-1)!.role = "summary";
      if (defect === "missing-slide") decision.slides.pop();
      if (defect === "duplicate-fact") slide.allowedFactIds.push(slide.allowedFactIds[0]!);
      if (defect === "required-not-allowed") slide.allowedFactIds = [];
      if (defect === "overlap-not-allowed") { slide.requiredFactIds = []; slide.allowedFactIds = []; }
    };
    const result = await pipeline.plan({ topic: "Explain a general subject." });
    assert.equal(result.status, "failed");
    assert.equal(agent.allocationCalls, 1);
    assert.equal(agent.outlineReviewCalls, 0);
  });
}

test("outline reviewer explicit rejection blocks readiness even with no issues and a high score", async () => {
  const { pipeline, agent } = outlinePipeline();
  agent.outlineDecision = { ...agent.outlineDecision, approved: false, score: 0.99, issues: [] };
  const result = await pipeline.plan({ topic: "Explain a general subject." });
  assert.equal(result.status, "rejected");
  assert.equal("outlineReview" in result, false);
});

test("malformed and contradictory outline approvals fail closed", async () => {
  for (const decision of [{}, { approved: true }, { approved: true, score: 0.9, summary: "Retry this outline.", issues: [], retryRecommended: true }]) {
    const { pipeline, agent } = outlinePipeline();
    agent.outlineDecision = decision as ReviewDecision;
    const result = await pipeline.plan({ topic: "Explain a general subject." });
    assert.equal(result.status, "failed");
    assert.equal(agent.outlineReviewCalls, 1);
  }
});

for (const stage of ["deck-strategy", "slide-allocation", "outline-review"]) {
  test(`cancelling ${stage} ends the same connected run without readiness`, async () => {
    const controller = new AbortController();
    const { pipeline, agent } = outlinePipeline(undefined, controller, stage);
    const result = await pipeline.plan({ topic: "Explain a general subject." }, { signal: controller.signal });
    assert.equal(result.status, "failed");
    assert.equal(agent.outlineReviewCalls, 0);
  });
}

test("job transport cannot mistake a reviewed outline for actual generated slides", async () => {
  const { pipeline } = outlinePipeline();
  // Deliberately violate the executor contract to test the runtime boundary.
  const jobs = new GenerationV2Jobs(async (request, options) => await pipeline.plan(request, options) as unknown as import("@slidespeech/core").GenerationV2PublishedSuccess);
  const started = jobs.start({ topic: "Explain a general subject." });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const result = jobs.get(started.id)!;
  assert.equal(result.status, "failed");
  assert.equal(GenerationV2JobSchema.safeParse(result).success, true);
  assert.equal("result" in result, false);
});

import { createSlidePreviewRenderer } from "@slidespeech/providers";
import type { GenerationV2SlideAgentProvider, SlideWritingAgentInput, SlideWritingDecision } from "@slidespeech/types";

function slideAgent() {
  const inputs: SlideWritingAgentInput[] = [];
  const state = { reject: false, malformed: false, change: undefined as ((draft: SlideWritingDecision) => void) | undefined };
  const agent: GenerationV2SlideAgentProvider = {
    async selectSlideDesigns(input) { return { telemetry, value: { themeId: input.request.request.theme ?? "editorial", designs: input.slidePlans.slides.map((_, index) => ({
      layoutId: index === 0 ? "editorial-opening" : "closing-question", contentDensity: "sparse", visualRole: index === 0 ? "hero" : "question",
    })) } }; },
    async writeSlide(input) {
      inputs.push(structuredClone(input));
      const draft: SlideWritingDecision = {
        title: input.slideIndex === 0 ? "A clear introduction" : "What will you try next?",
        content: input.slideIndex === 0 ? { kind: "statement", statement: "Understand the defining characteristic." } : { kind: "question", question: "How would you apply this idea?", guidance: "Questions are welcome." },
        usedFactIds: input.slidePlans.slides[input.slideIndex]!.requiredFactIds,
        speakerNotes: input.factBank.facts.map((fact) => fact.claim), sourceAttributions: [], likelyQuestions: [],
      };
      state.change?.(draft);
      return { telemetry, value: draft };
    },
    async reviewSlides() { return { telemetry, value: state.malformed ? {} as ReviewDecision : { approved: !state.reject, score: 0.99, summary: "Reviewed the actual content.", issues: [], retryRecommended: false } }; },
  };
  return { agent, inputs, state };
}

test("full slide pipeline generates measured scenes and an exact review, retaining deck context", async () => {
  const { pipeline, recorder } = outlinePipeline();
  const slides = slideAgent();
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(recorder.records.slice(-3).map((record) => record.stage), ["design-selection", "slide-generation", "slide-review"]);
  assert.equal(new Set(recorder.records.map((record) => record.runId)).size, 1);
  assert.equal(result.scenes.length, 2);
  assert.equal(slides.inputs[1]!.previousSlides.length, 1);
  assert.equal(slides.inputs[1]!.request.request.topic, "Explain a general subject.");
  assert.equal(slides.inputs[0]!.layoutContract.layoutId, result.designs.designs[0]!.layoutId);
  assert.ok(slides.inputs[0]!.layoutContract.fields.every((field) => field.maximumLines >= 1));
  assert.deepEqual(result.slideReview.targetArtifactIds, [result.designs.artifactId, result.slides.artifactId]);
  assert.equal(result.slides.slideDesignSpecSetArtifactId, result.designs.artifactId);
  assert.equal("publishedAt" in result, false);
});

for (const defect of ["reject", "malformed", "unknown-fact", "missing-required", "unknown-source"] as const) {
  test(`actual slide readiness rejects ${defect}, without static fallback`, async () => {
    const { pipeline } = outlinePipeline();
    const slides = slideAgent();
    slides.state.reject = defect === "reject";
    slides.state.malformed = defect === "malformed";
    slides.state.change = (draft) => {
      if (defect === "unknown-fact") draft.usedFactIds = ["invented_fact"];
      if (defect === "missing-required") draft.usedFactIds = [];
      if (defect === "unknown-source") draft.sourceAttributions = [{ sourceId: "invented_source", label: "A source" }];
    };
    const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() });
    assert.equal(result.status, defect === "reject" ? "rejected" : "failed");
    assert.equal("slides" in result, false);
  });
}

test("measured overflow is revised once by the author with previous draft and feedback", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  const render = await createSlidePreviewRenderer();
  let calls = 0;
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: Object.assign((draft: import("@slidespeech/types").SlideDraft, design: import("@slidespeech/types").SlideDesignSpec) => ++calls === 1 ? { feedback: ["Element 3 needs 280px but has 246px."] } : render(draft, design), { describe: render.describe }) });
  assert.equal(result.status, "succeeded");
  assert.equal(slides.inputs.length, 3);
  assert.equal(slides.inputs[1]!.revision!.previous.title, slides.inputs[0]!.slideIndex === 0 ? "A clear introduction" : "unexpected");
  assert.deepEqual(slides.inputs[1]!.revision!.feedback, ["Element 3 needs 280px but has 246px."]);
});

function correctableSlideReview(): ReviewDecision {
  return { approved: false, score: 0.7, summary: "One claim needs correction.", retryRecommended: true,
    issues: [{ code: "claim_scope", severity: "error", dimension: "grounding", message: "The claim adds an unsupported guarantee.",
      targetArtifactIndex: 1, slideIndex: 0, factIndexes: [0], retryInstruction: "Remove the guarantee; explain only the supported characteristic." }] };
}

test("semantic slide revision preserves research, designs and unaffected slides, then reviews the exact new set", async () => {
  const { pipeline, recorder } = outlinePipeline();
  const slides = slideAgent();
  const reviewed: import("@slidespeech/types").SlideReviewAgentInput[] = [];
  slides.agent.reviewSlides = async (input) => {
    reviewed.push(structuredClone(input));
    return { telemetry, value: reviewed.length === 1 ? correctableSlideReview()
      : { approved: true, score: 0.7, summary: "Useful and factually sound.", retryRecommended: false, issues: [] } };
  };
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(slides.inputs.map((input) => input.slideIndex), [0, 1, 0]);
  assert.deepEqual(slides.inputs[2]!.revision!.previous, reviewed[0]!.slides.slides[0]);
  assert.match(slides.inputs[2]!.revision!.feedback[0]!, /unsupported guarantee/);
  assert.deepEqual(reviewed[1]!.slides.slides[1], reviewed[0]!.slides.slides[1]);
  assert.deepEqual(reviewed[1]!.designs, reviewed[0]!.designs);
  assert.deepEqual(reviewed[1]!.factBank, reviewed[0]!.factBank);
  assert.notEqual(reviewed[1]!.slides.artifactId, reviewed[0]!.slides.artifactId);
  assert.deepEqual(result.slideReview.targetArtifactIds, [result.designs.artifactId, result.slides.artifactId]);
  assert.equal(recorder.records.filter((record) => record.stage === "design-selection").length, 1);
  const attempts = recorder.records.filter((record) => record.stage === "slide-generation");
  assert.deepEqual(attempts.map((record) => record.attempt), [1, 2]);
  assert.ok(attempts[1]!.inputArtifactIds.includes(reviewed[0]!.slides.artifactId));
  const prior = recorder.records.filter((record) => record.stage === "slide-review")[0]!;
  assert.ok(attempts[1]!.inputArtifactIds.includes(ReviewResultSchema.parse(prior.artifact).artifactId));
});

test("advisory review and a modest score do not trigger revision", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  slides.agent.reviewSlides = async () => ({ telemetry, value: { approved: true, score: 0.6, summary: "Useful with minor wording issues.", retryRecommended: false,
    issues: [{ ...correctableSlideReview().issues[0]!, severity: "warning", dimension: "language", message: "The prose could be smoother.", retryInstruction: null }] } });
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() });
  assert.equal(result.status, "succeeded");
  assert.equal(slides.inputs.length, 2);
});

for (const defect of ["still-rejected", "global", "no-instruction", "design-owned", "warnings-only", "review-unavailable", "writer-unavailable", "cancelled"] as const) {
  test(`bounded semantic revision stops safely for ${defect}`, async () => {
    const { pipeline } = outlinePipeline();
    const slides = slideAgent();
    const controller = new AbortController();
    let reviews = 0;
    slides.agent.reviewSlides = async () => {
      reviews++;
      if (defect === "review-unavailable") throw new Error("Review offline.");
      const review = correctableSlideReview();
      if (defect === "global") review.issues[0]!.slideIndex = null;
      if (defect === "no-instruction") review.issues[0]!.retryInstruction = null;
      if (defect === "design-owned") review.issues[0]!.targetArtifactIndex = 0;
      if (defect === "warnings-only") review.issues[0]!.severity = "warning";
      return { telemetry, value: review };
    };
    const write = slides.agent.writeSlide;
    slides.agent.writeSlide = async (input, options) => {
      if (input.revision && defect === "writer-unavailable") throw new Error("Writer offline.");
      if (input.revision && defect === "cancelled") controller.abort();
      return write(input, options);
    };
    const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() }, { signal: controller.signal });
    assert.equal(result.status, ["review-unavailable", "writer-unavailable", "cancelled"].includes(defect) ? "failed" : "rejected");
    assert.equal("slides" in result, false);
    assert.equal(reviews, defect === "still-rejected" ? 2 : 1);
    assert.equal(slides.inputs.length, ["still-rejected", "cancelled"].includes(defect) ? 3 : 2);
  });
}

test("physical-fit revision retains semantic feedback and preserves the untouched scene", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  const renderer = await createSlidePreviewRenderer();
  const scenes: import("@slidespeech/types").LaidOutSlideScene[] = [];
  let calls = 0;
  const render = Object.assign((...args: Parameters<typeof renderer>) => {
    if (++calls === 3) return { feedback: ["Measured title overflow."] };
    const result = renderer(...args);
    if (result.scene) scenes.push(result.scene);
    return result;
  }, { describe: renderer.describe });
  let reviews = 0;
  slides.agent.reviewSlides = async () => ({ telemetry, value: ++reviews === 1 ? correctableSlideReview()
    : { approved: true, score: 0.9, summary: "Corrected.", retryRecommended: false, issues: [] } });
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.equal(calls, 4);
  assert.equal(slides.inputs.length, 4);
  assert.equal(slides.inputs[3]!.revision!.feedback.length, 2);
  assert.match(slides.inputs[3]!.revision!.feedback[0]!, /unsupported guarantee/);
  assert.equal(slides.inputs[3]!.revision!.feedback[1], "Measured title overflow.");
  assert.deepEqual(result.scenes[1], scenes[1]);
});

test("exhausted text fit does not shrink, truncate or substitute slide copy", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  const renderer = await createSlidePreviewRenderer();
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: Object.assign(() => ({ feedback: ["Measured overflow."] }), { describe: renderer.describe }) });
  assert.equal(result.status, "rejected");
  assert.equal(slides.inputs.length, 2);
  assert.equal("scenes" in result, false);
});

test("transport failure in the slide writer stops without semantic retries", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  let calls = 0;
  slides.agent.writeSlide = async () => { calls++; throw new Error("Model unavailable."); };
  const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() });
  assert.equal(result.status, "failed");
  assert.equal(calls, 1);
});

test("job serves only reviewed measured slides and does not imply publication", async () => {
  const { pipeline } = outlinePipeline();
  const slides = slideAgent();
  const render = await createSlidePreviewRenderer();
  const jobs = new GenerationV2Jobs(async (request, options) => {
    const preview = await pipeline.execute(request, { agent: slides.agent, render }, options);
    if (preview.status !== "succeeded") return preview;
    const narrated = await pipeline.narrateSlides(preview, {
      writeNarration: async (input) => ({ telemetry, value: { scripts: input.slides.slides.map((slide, index) => ({
        openingBridge: index === 0 ? "Welcome to this introduction." : "Let us draw this together.",
        segments: slide.speakerNotes, transitionOut: index === 0 ? "Now let us connect the ideas." : "Thank you for joining.",
        sourceIndexes: [], questionInvitation: index === input.slides.slides.length - 1 ? "What questions do you have?" : null,
      })) } }),
      reviewNarration: async () => ({ telemetry, value: { approved: true, score: 0.9, summary: "Coherent whole speech.", issues: [], retryRecommended: false } }),
    }, options);
    if (narrated.status !== "succeeded") return narrated;
    return pipeline.publishNarratedSlides(narrated, {
      reviewPublication: async () => ({ telemetry, value: { approved: true, score: 0.9, summary: "Complete and useful.", issues: [], retryRecommended: false } }),
    }, options);
  });
  const job = jobs.start({ topic: "Explain a general subject." });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const result = jobs.get(job.id)!;
  assert.equal(result.status, "slides-ready");
  if (result.status !== "slides-ready") return;
  assert.equal(GenerationV2JobSchema.safeParse(result).success, true);
  assert.equal(result.result.spokenPresentation?.narrations.scripts.length, result.result.slides.slides.length);
  const stale = structuredClone(result);
  stale.result.spokenPresentation!.narrations.slideDraftSetArtifactId = "unreviewed-slides";
  assert.equal(GenerationV2JobSchema.safeParse(stale).success, false);
  result.result.slideReview.approved = false;
  assert.equal(GenerationV2JobSchema.safeParse(result).success, false);
});

for (const stage of ["design-selection", "slide-generation", "slide-review"]) {
  test(`cancellation during ${stage} never exposes partial slides`, async () => {
    const controller = new AbortController();
    const { pipeline } = outlinePipeline(undefined, controller, stage);
    const slides = slideAgent();
    const result = await pipeline.execute({ topic: "Explain a general subject." }, { agent: slides.agent, render: await createSlidePreviewRenderer() }, { signal: controller.signal });
    assert.equal(result.status, "failed");
    assert.equal("slides" in result, false);
  });
}

test("real font overflow feedback identifies the affected copy, not just an unstable element number", async () => {
  const render = await createSlidePreviewRenderer();
  const text = "Temperature controls the speed of fermentation in your dough";
  const result = render({ slideId: "slide_fit", title: "Fermentation", content: { kind: "process", steps: Array.from({ length: 4 }, () => ({ label: text, description: "A brief explanation." })) }, usedFactIds: [], sourceAttributions: [], speakerNotes: [], likelyQuestions: [] },
    { slideId: "slide_fit", layoutId: "numbered-process", layoutFamily: "process", visualRole: "process", contentDensity: "balanced", imageStrategy: "none", variationSeed: 0 });
  assert.ok(result.feedback);
  assert.ok(result.feedback.some((message) => message.includes(text) && message.includes("height-overflow")));
  assert.equal(result.scene, undefined);
});

test("recorded-outline continuation cannot bypass approval or exact lineage", async () => {
  const { pipeline } = outlinePipeline();
  const outline = await pipeline.plan({ topic: "Explain a general subject." });
  assert.equal(outline.status, "succeeded");
  if (outline.status !== "succeeded") return;
  for (const defect of ["rejected", "other-target", "other-bank"]) {
    const input = structuredClone(outline);
    if (defect === "rejected") input.outlineReview.approved = false;
    if (defect === "other-target") input.outlineReview.targetArtifactIds[0] = "unreviewed_strategy";
    if (defect === "other-bank") input.slidePlans.factBankArtifactId = "unreviewed_bank";
    const slides = slideAgent();
    const result = await pipeline.draftOutline(input, { agent: slides.agent, render: await createSlidePreviewRenderer() });
    assert.equal(result.status, "rejected");
    assert.equal(slides.inputs.length, 0);
  }
});
