import assert from "node:assert/strict";
import test from "node:test";

import {
  GeneratePresentationRequestSchema,
  PromptClassificationDecisionSchema,
  createPromptClassificationDecisionSchema,
  ResearchPlanDecisionSchema,
} from "@slidespeech/types";
import type {
  FactBankDecision,
  FactCurationAgentInput,
  GenerationAgentCall,
  GenerationStageTelemetry,
  GenerationV2AgentProvider,
  PromptClassification,
  PromptClassificationDecision,
  ResearchPlanDecision,
  ResearchReviewDecision,
} from "@slidespeech/types";
import {
  createPresentationRequestArtifact,
  createPromptClassificationStage,
  createResearchPlanStage,
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";
import type { GenerationArtifactFactory } from "../packages/core/src/generation/v2";

const telemetry: GenerationStageTelemetry = {
  provider: "test-agent",
  model: "test-model",
  promptTokens: 100,
  completionTokens: 50,
  reasoningTokens: 20,
  totalTokens: 150,
};

const createArtifactFactory = (): GenerationArtifactFactory => {
  let sequence = 0;
  return {
    createId: (prefix) => `${prefix}_${++sequence}`,
    now: () => "2026-08-24T12:00:00.000Z",
  };
};

const context = (stage: "classification" | "research") => ({
  runId: `run_${stage}`,
  attempt: 1,
  inputArtifactIds: [],
  sourceIds: [],
});

const classificationDecision = PromptClassificationDecisionSchema.parse({
  subject: "A product",
  language: "en",
  audience: "New team members",
  presentationGoal: "Explain the product and its creator.",
  deckMode: "onboarding",
  groundingMode: "explicit-sources",
  presentationDirections: [],
  requestedCoverage: [
    { description: "Explain who created the product.", required: true },
  ],
  requestedSlideCount: 3,
  requestedDurationMinutes: null,
  visualPreference: null,
  voicePreference: null,
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
});

test("live classification contract routes contradictory source policy through the existing model correction", () => {
  const schema = createPromptClassificationDecisionSchema(1, { explicitSourceCount: 0 });
  const selected = { ...classificationDecision, sourceCandidateIndexes: [0] };
  assert.equal(schema.safeParse({ ...selected, groundingMode: "web-research" }).success, false);
  assert.equal(schema.safeParse({ ...selected, groundingMode: "model-knowledge" }).success, false);
  assert.equal(schema.safeParse({ ...selected, groundingMode: "mixed" }).success, true);
  assert.equal(schema.safeParse(selected).success, true);
  assert.equal(schema.safeParse({ ...selected, sourceCandidateIndexes: [] }).success, false);
  const noSearch = createPromptClassificationDecisionSchema(1, { explicitSourceCount: 0, useWebResearch: false });
  assert.equal(noSearch.safeParse({ ...selected, groundingMode: "mixed" }).success, false);
  assert.equal(noSearch.safeParse(selected).success, true);
  const requireSearch = createPromptClassificationDecisionSchema(1, { explicitSourceCount: 0, useWebResearch: true });
  assert.equal(requireSearch.safeParse(selected).success, false);
  assert.equal(requireSearch.safeParse({ ...selected, groundingMode: "mixed" }).success, true);
});

const buildPlan = (
  classification: PromptClassification,
): ResearchPlanDecision =>
  ResearchPlanDecisionSchema.parse({
    canExecute: true,
    blockingReason: null,
    requiresExternalResearch: true,
    researchQuestions: [
      {
        question: "What is the product and who created it?",
        coverageRequirementIndexes: classification.requestedCoverage.map(
          (_coverage, index) => index,
        ),
        evidenceRequirements: [
          {
            description: "Evidence identifying the product and its creator.",
            required: true,
          },
        ],
      },
    ],
    sourceTargets: classification.requestedSources.map((_source, index) => ({
      kind: "explicit-url" as const,
      requestedSourceIndex: index,
      purpose: "Answer the required research question.",
      priority: index,
    })),
    knownRiskAreas: ["The creator detail may require a supporting page."],
  });

class TestAgent implements GenerationV2AgentProvider {
  readonly name = "test-agent";
  classification = classificationDecision;
  planTransform: (plan: ResearchPlanDecision) => ResearchPlanDecision =
    (plan) => plan;

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "ready",
      checkedAt: "2026-08-24T12:00:00.000Z",
    };
  }

  async classifyPrompt(): Promise<
    GenerationAgentCall<PromptClassificationDecision>
  > {
    return { value: this.classification, telemetry };
  }

  async planResearch(
    input: { classification: PromptClassification },
  ): Promise<GenerationAgentCall<ResearchPlanDecision>> {
    return {
      value: this.planTransform(buildPlan(input.classification)),
      telemetry,
    };
  }

  async selectResearchSources(): Promise<never> {
    throw new Error("not used in these tests");
  }

  async selectEvidence(): Promise<never> {
    throw new Error("not used in these tests");
  }

  async curateFacts(
    _input: FactCurationAgentInput,
  ): Promise<GenerationAgentCall<FactBankDecision>> {
    throw new Error("not used in these tests");
  }

  async reviewResearch(): Promise<
    GenerationAgentCall<ResearchReviewDecision>
  > {
    throw new Error("not used in these tests");
  }
}

const classify = async (agent: TestAgent) => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const request = GeneratePresentationRequestSchema.parse({
    topic:
      "Create an onboarding presentation from https://example.com/product and include its creator.",
    targetSlideCount: 7,
    targetDurationMinutes: 12,
  });
  const requestArtifact = createPresentationRequestArtifact(
    request,
    createArtifactFactory(),
  );
  return executeGenerationStage({
    definition: createPromptClassificationStage({
      agent,
      artifactFactory: createArtifactFactory(),
    }),
    input: requestArtifact,
    context: {
      ...context("classification"),
      inputArtifactIds: [requestArtifact.artifactId],
    },
    recorder,
  });
};

const requestForClassification = (classification: PromptClassification) =>
  createPresentationRequestArtifact(
    GeneratePresentationRequestSchema.parse({
      topic:
        "Create an onboarding presentation from https://example.com/product and include its creator.",
      targetSlideCount: 7,
      targetDurationMinutes: 12,
    }),
    {
      createId: () => classification.requestArtifactId,
      now: () => "2026-08-24T12:00:00.000Z",
    },
  );

test("classification preserves agent semantics while structured controls remain authoritative", async () => {
  const result = await classify(new TestAgent());

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.equal(result.artifact.requestedSlideCount, 7);
  assert.equal(result.artifact.requestedDurationMinutes, 12);
  assert.equal(
    result.artifact.requestedSources[0]?.url,
    "https://example.com/product",
  );
  assert.match(result.artifact.requestedSources[0]?.id ?? "", /^requested_source_/);
  assert.equal(result.telemetry?.reasoningTokens, 20);
});

test("classification selects domain candidates semantically without dropping explicit URLs", async () => {
  const agent = new TestAgent();
  agent.classification = { ...classificationDecision, sourceCandidateIndexes: [0] };
  const request = createPresentationRequestArtifact({ topic: "Use example.org/about and https://example.com/source to explain this organization." });
  const result = await executeGenerationStage({ definition: createPromptClassificationStage({ agent }), input: request,
    context: context("classification"), recorder: new InMemoryGenerationTraceRecorder() });
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(result.artifact.requestedSources.map(source => source.url), ["https://example.com/source", "https://example.org/about"]);
  const plan = await executeGenerationStage({ definition: createResearchPlanStage({ agent }), input: { request, classification: result.artifact },
    context: context("research"), recorder: new InMemoryGenerationTraceRecorder() });
  assert.equal(plan.status, "succeeded");
  if (plan.status === "succeeded") assert.deepEqual(plan.artifact.sourceTargets.map(target => target.kind === "explicit-url" && target.url), ["https://example.com/source", "https://example.org/about"]);
});

test("classification can decline a domain-shaped product name without forcing research", async () => {
  const agent = new TestAgent();
  agent.classification = { ...classificationDecision, groundingMode: "model-knowledge", sourceCandidateIndexes: [] };
  const request = createPresentationRequestArtifact({ topic: "Teach ASP.NET concepts without web research.", useWebResearch: false });
  const result = await executeGenerationStage({ definition: createPromptClassificationStage({ agent }), input: request,
    context: context("classification"), recorder: new InMemoryGenerationTraceRecorder() });
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") assert.deepEqual(result.artifact.requestedSources, []);
});

test("classification rejects missing, duplicate and invented candidate selections", async () => {
  const request = createPresentationRequestArtifact({ topic: "Describe example.org and https://example.com." });
  for (const indexes of [undefined, [1], [-1], [0.5], [0, 0]]) {
    const agent = new TestAgent();
    agent.classification = { ...classificationDecision, ...(indexes === undefined ? {} : { sourceCandidateIndexes: indexes }) };
    const result = await executeGenerationStage({ definition: createPromptClassificationStage({ agent }), input: request,
      context: context("classification"), recorder: new InMemoryGenerationTraceRecorder() });
    assert.equal(result.status, "rejected");
    assert.equal(result.errors[0]?.code, "invalid_source_candidate_selection");
  }
});

test("live classification schema requires bounded candidate positions even when empty", () => {
  assert.ok(!createPromptClassificationDecisionSchema(0).safeParse(classificationDecision).success);
  assert.ok(createPromptClassificationDecisionSchema(0).safeParse({ ...classificationDecision, sourceCandidateIndexes: [] }).success);
  assert.ok(!createPromptClassificationDecisionSchema(0).safeParse({ ...classificationDecision, sourceCandidateIndexes: [0] }).success);
  assert.ok(createPromptClassificationDecisionSchema(1).safeParse({ ...classificationDecision, sourceCandidateIndexes: [0] }).success);
  assert.ok(!createPromptClassificationDecisionSchema(1).safeParse({ ...classificationDecision, sourceCandidateIndexes: [1] }).success);
});

test("classification preserves presentation directions without requiring them as research coverage", async () => {
  const agent = new TestAgent();
  agent.classification = { ...classificationDecision, presentationDirections: ["Use a conversational welcome and invite questions at the end."] };
  const result = await classify(agent);
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(result.artifact.presentationDirections, agent.classification.presentationDirections);
  assert.equal(result.artifact.requestedCoverage.length, 1);
  const planned = await executeGenerationStage({
    definition: createResearchPlanStage({ agent, artifactFactory: createArtifactFactory() }),
    input: { request: requestForClassification(result.artifact), classification: result.artifact },
    context: context("research"), recorder: new InMemoryGenerationTraceRecorder(),
  });
  assert.equal(planned.status, "succeeded");
  if (planned.status !== "succeeded") return;
  assert.deepEqual(planned.artifact.researchQuestions[0]?.coverageRequirementIds, result.artifact.requestedCoverage.map((coverage) => coverage.id));
});

test("classification preserves an agent clarification decision as rejection", async () => {
  const agent = new TestAgent();
  agent.classification = PromptClassificationDecisionSchema.parse({
    ...classificationDecision,
    requiresUserClarification: true,
    clarificationReason: "The intended product is not identifiable.",
  });

  const result = await classify(agent);

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "prompt_requires_clarification");
});

test("research planning preserves explicit source and coverage provenance", async () => {
  const classificationResult = await classify(new TestAgent());
  assert.equal(classificationResult.status, "succeeded");
  if (classificationResult.status !== "succeeded") {
    return;
  }

  const agent = new TestAgent();
  const recorder = new InMemoryGenerationTraceRecorder();
  const result = await executeGenerationStage({
    definition: createResearchPlanStage({
      agent,
      artifactFactory: createArtifactFactory(),
    }),
    input: {
      request: requestForClassification(classificationResult.artifact),
      classification: classificationResult.artifact,
    },
    context: {
      ...context("research"),
      inputArtifactIds: [classificationResult.artifact.artifactId],
    },
    recorder,
  });

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.equal(result.artifact.sourceTargets[0]?.kind, "explicit-url");
  assert.deepEqual(
    result.artifact.researchQuestions[0]?.coverageRequirementIds,
    classificationResult.artifact.requestedCoverage.map(
      (coverage) => coverage.id,
    ),
  );
  assert.deepEqual(
    result.artifact.evidenceRequirements[0]?.coverageRequirementIds,
    classificationResult.artifact.requestedCoverage.map(
      (coverage) => coverage.id,
    ),
  );
});

test("research planning rejects invalid source and coverage positions", async () => {
  const classificationResult = await classify(new TestAgent());
  assert.equal(classificationResult.status, "succeeded");
  if (classificationResult.status !== "succeeded") {
    return;
  }

  const agent = new TestAgent();
  agent.planTransform = (plan) => ({
    ...plan,
    researchQuestions: plan.researchQuestions.map((question) => ({
      ...question,
      coverageRequirementIndexes: [99],
    })),
    sourceTargets: plan.sourceTargets.map((target) =>
      target.kind === "explicit-url"
        ? { ...target, requestedSourceIndex: 99 }
        : target,
    ),
  });
  const result = await executeGenerationStage({
    definition: createResearchPlanStage({
      agent,
      artifactFactory: createArtifactFactory(),
    }),
    input: {
      request: requestForClassification(classificationResult.artifact),
      classification: classificationResult.artifact,
    },
    context: context("research"),
    recorder: new InMemoryGenerationTraceRecorder(),
  });

  assert.equal(result.status, "rejected");
  assert.deepEqual(
    new Set(result.errors.map((error) => error.code)),
    new Set([
      "research_plan_unknown_coverage_index",
      "research_plan_unknown_source_index",
      "explicit_source_not_planned",
    ]),
  );
});

test("research planning assigns protocol ids and runtime limits in core", async () => {
  const classificationResult = await classify(new TestAgent());
  assert.equal(classificationResult.status, "succeeded");
  if (classificationResult.status !== "succeeded") {
    return;
  }

  const agent = new TestAgent();
  const result = await executeGenerationStage({
    definition: createResearchPlanStage({
      agent,
      artifactFactory: createArtifactFactory(),
    }),
    input: {
      request: requestForClassification(classificationResult.artifact),
      classification: classificationResult.artifact,
    },
    context: context("research"),
    recorder: new InMemoryGenerationTraceRecorder(),
  });

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  const upstreamIds = new Set([
    classificationResult.artifact.artifactId,
    ...classificationResult.artifact.requestedSources.map((source) => source.id),
    ...classificationResult.artifact.requestedCoverage.map(
      (coverage) => coverage.id,
    ),
  ]);
  const planIds = [
    ...result.artifact.researchQuestions.map((question) => question.id),
    ...result.artifact.evidenceRequirements.map((requirement) => requirement.id),
    ...result.artifact.sourceTargets.map((target) => target.id),
  ];
  assert.equal(planIds.some((id) => upstreamIds.has(id)), false);
  assert.deepEqual(result.artifact.stopCriteria, {
    maximumSources: 12,
    maximumPagesPerDomain: 4,
  });
});
