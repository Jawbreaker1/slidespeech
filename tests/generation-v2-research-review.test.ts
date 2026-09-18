import assert from "node:assert/strict";
import test from "node:test";

import {
  EvidenceSetSchema,
  FactBankSchema,
  PresentationRequestArtifactSchema,
  PromptClassificationSchema,
  ResearchPlanSchema,
  ResearchReviewDecisionSchema,
} from "@slidespeech/types";
import type {
  GenerationAgentCall,
  GenerationV2AgentProvider,
  ResearchReviewDecision,
  ResearchReviewAgentInput,
} from "@slidespeech/types";
import {
  createResearchReviewStage,
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";
import { OpenAICompatibleGenerationAgent } from "../packages/providers/src/generation-v2";

const createdAt = "2026-08-24T12:00:00.000Z";
const identity = (artifactId: string) => ({
  schemaVersion: "2.0" as const,
  artifactId,
  createdAt,
});

const request = PresentationRequestArtifactSchema.parse({
  ...identity("request_1"),
  request: { topic: "Explain a general subject." },
  explicitUrls: [],
});
const classification = PromptClassificationSchema.parse({
  ...identity("classification_1"),
  requestArtifactId: request.artifactId,
  originalPrompt: request.request.topic,
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build understanding.",
  deckMode: "teaching",
  groundingMode: "model-knowledge",
  requestedSources: [],
  presentationDirections: [],
  requestedCoverage: [],
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
});
const researchPlan = ResearchPlanSchema.parse({
  ...identity("research_plan_1"),
  requestArtifactId: request.artifactId,
  classificationArtifactId: classification.artifactId,
  canExecute: true,
  blockingReason: null,
  requiresExternalResearch: false,
  researchQuestions: [
    {
      id: "question_1",
      question: "What defines the subject?",
      coverageRequirementIds: [],
    },
  ],
  evidenceRequirements: [
    {
      id: "requirement_1",
      description: "A supported definition of the subject.",
      required: true,
      coverageRequirementIds: [],
    },
  ],
  sourceTargets: [
    {
      id: "target_1",
      kind: "model-knowledge",
      scope: "Stable foundational knowledge about the subject.",
      purpose: "Support a concise definition.",
      priority: 0,
    },
  ],
  stopCriteria: { maximumSources: 4, maximumPagesPerDomain: 2 },
  knownRiskAreas: [],
});
const evidenceSet = EvidenceSetSchema.parse({
  ...identity("evidence_set_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  researchBundleArtifactId: "research_bundle_1",
  sources: [],
  snippets: [],
  selectionCoverage: [
    { evidenceRequirementId: "requirement_1", snippetIds: [] },
  ],
});
const researchBundle = {
  ...identity("research_bundle_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  sources: [], pages: [], fetchErrors: [],
  targetOutcomes: [{ targetId: "target_1", attemptedUrls: [], stopReason: "not-required" as const }],
};
const factBank = FactBankSchema.parse({
  ...identity("fact_bank_1"),
  classificationArtifactId: classification.artifactId,
  evidenceSetArtifactId: evidenceSet.artifactId,
  facts: [
    {
      id: "fact_1",
      claim: "The subject has a stable defining characteristic.",
      origin: "model-knowledge",
      knowledgeBasis: "Stable foundational knowledge permitted by the plan.",
      evidenceRequirementIds: ["requirement_1"],
      role: "identity",
      language: "en",
      allowedUse: "visible-slide",
    },
  ],
  uncertainties: [],
  modelKnowledgeAllowed: true,
});

const approvedDecision = ResearchReviewDecisionSchema.parse({
  approved: true,
  score: 0.9,
  summary: "The research chain supports the requested deck.",
  issues: [],
  retryRecommended: false,
  requirementAssessments: {
    requirement_1: {
      status: "supported",
      rationale: "The declared knowledge basis supports the definition.",
    },
  },
});

class ReviewAgent implements GenerationV2AgentProvider {
  readonly name = "review-agent";
  decision: ResearchReviewDecision = approvedDecision;
  received: ResearchReviewAgentInput | undefined;

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "ready",
      checkedAt: createdAt,
    };
  }

  async classifyPrompt(): Promise<never> {
    throw new Error("not used");
  }

  async planResearch(): Promise<never> {
    throw new Error("not used");
  }

  async selectResearchSources(): Promise<never> {
    throw new Error("not used");
  }

  async selectEvidence(): Promise<never> {
    throw new Error("not used");
  }

  async curateFacts(): Promise<never> {
    throw new Error("not used");
  }

  async reviewResearch(input: ResearchReviewAgentInput): Promise<
    GenerationAgentCall<ResearchReviewDecision>
  > {
    this.received = input;
    return {
      value: this.decision,
      telemetry: { provider: this.name, model: "test-model" },
    };
  }
}

const run = (agent: ReviewAgent, stageFactBank = factBank) => {
  let sequence = 0;
  return executeGenerationStage({
    definition: createResearchReviewStage({
      agent,
      artifactFactory: {
        createId: (prefix) => `${prefix}_${++sequence}`,
        now: () => createdAt,
      },
    }),
    input: { request, classification, researchPlan, researchBundle, evidenceSet, factBank: stageFactBank },
    context: {
      runId: "run_review_1",
      attempt: 1,
      inputArtifactIds: [
        researchPlan.artifactId,
        researchBundle.artifactId,
        evidenceSet.artifactId,
        factBank.artifactId,
      ],
      sourceIds: [],
    },
    recorder: new InMemoryGenerationTraceRecorder(),
  });
};

test("research review receives acquisition identity and outcomes", async () => {
  const agent = new ReviewAgent();
  await run(agent);
  const acquisition = agent.received?.targetArtifacts[1];
  assert.equal(acquisition?.artifactId, researchBundle.artifactId);
  assert.deepEqual(acquisition?.targetOutcomes, researchBundle.targetOutcomes);
});

test("review rejects an acquisition bundle detached from the evidence before calling the agent", async () => {
  const agent = new ReviewAgent();
  const stage = createResearchReviewStage({ agent });
  const result = await stage.execute({
    request, classification, researchPlan, evidenceSet, factBank,
    researchBundle: { ...researchBundle, artifactId: "different_bundle" },
  }, { runId: "detached", attempt: 1, inputArtifactIds: [], sourceIds: [],
    signal: new AbortController().signal, reportProgress: () => {} });
  assert.equal(result.status, "rejected");
  assert.equal(agent.received, undefined);
});

test("research review approves an unchanged, sufficiently grounded chain", async () => {
  const result = await run(new ReviewAgent());

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.equal(result.artifact.targetStage, "research-review");
  assert.deepEqual(result.artifact.targetArtifactIds, [
    researchPlan.artifactId,
    researchBundle.artifactId,
    evidenceSet.artifactId,
    factBank.artifactId,
  ]);
});

test("research review cannot approve an unchanged fact bank marked insufficient", async () => {
  const { facts, classificationArtifactId, evidenceSetArtifactId, modelKnowledgeAllowed } = factBank;
  const result = await run(new ReviewAgent(), {
    ...identity(factBank.artifactId), facts, classificationArtifactId, evidenceSetArtifactId, modelKnowledgeAllowed,
    sourceSummaries: [], sourceQuality: [], missingFacts: [], contradictions: [],
    sufficientForDeck: false,
    blockingReasons: ["A required part of the evidence remains unavailable."],
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "approved_review_has_insufficient_fact_bank");
});

test("research review cannot approve an empty current fact bank", async () => {
  const result = await run(new ReviewAgent(), { ...factBank, facts: [] });
  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "approved_review_has_empty_fact_bank");
});

test("research review receives source-linked uncertainty without inventing a readiness verdict", async () => {
  const agent = new ReviewAgent();
  const bank = FactBankSchema.parse({ ...factBank, uncertainties: [{
    description: "This claim has a qualification worth checking.",
    evidenceSnippetIds: [], evidenceRequirementIds: ["requirement_1"],
  }] });
  const result = await run(agent, bank);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(agent.received?.targetArtifacts[3], bank);
  assert.equal("sufficientForDeck" in bank, false);
});

test("unavailable or malformed research review never produces approval", async () => {
  for (const malformed of [undefined, {}, { ...approvedDecision, approved: false }]) {
    const agent = new ReviewAgent();
    agent.reviewResearch = async () => {
      if (malformed === undefined) throw new Error("Model unavailable");
      return { value: malformed as ResearchReviewDecision, telemetry: { provider: "test", model: "test-model" } };
    };
    const result = await run(agent);
    assert.notEqual(result.status, "succeeded");
  }
});

test("research review preserves rejection feedback with core-owned lineage", async () => {
  const agent = new ReviewAgent();
  agent.decision = ResearchReviewDecisionSchema.parse({
    approved: false,
    score: 0.5,
    summary: "The fact bank does not fully support the required definition.",
    issues: [
      {
        code: "insufficient_definition_support",
        severity: "error",
        dimension: "grounding",
        message: "The definition needs stronger support.",
        targetArtifactIndex: 3,
        slideIndex: null,
        factIndexes: [0],
        retryInstruction: "Recurate the fact bank from the available evidence.",
      },
    ],
    retryRecommended: true,
    requirementAssessments: {
      requirement_1: {
        status: "unsupported",
        rationale: "The definition is not adequately supported.",
        targetArtifactIndex: 3,
        factIndexes: [0],
        retryInstruction: "Recurate the definition from adequate evidence.",
      },
    },
  });

  const result = await run(agent);
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") {
    return;
  }
  assert.equal(result.artifact?.issues[0]?.artifactId, factBank.artifactId);
  assert.deepEqual(result.artifact?.issues[0]?.factIds, ["fact_1"]);
  assert.equal(result.errors[0]?.code, "research_review_rejected");
});

test("research review rejects invalid positional references", async () => {
  const agent = new ReviewAgent();
  agent.decision = ResearchReviewDecisionSchema.parse({
    approved: false,
    score: 0.4,
    summary: "Invalid references should not cross the stage boundary.",
    issues: [
      {
        code: "invalid_reference",
        severity: "error",
        dimension: "contract",
        message: "Invalid positional references.",
        targetArtifactIndex: 4,
        slideIndex: null,
        factIndexes: [3],
        retryInstruction: null,
      },
    ],
    retryRecommended: false,
    requirementAssessments: {
      requirement_1: {
        status: "supported",
        rationale: "The requirement itself is supported.",
      },
    },
  });

  const result = await run(agent);
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") {
    return;
  }
  assert.equal("artifact" in result, false);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    [
      "research_review_unknown_artifact_position",
      "research_review_unknown_fact_position",
    ],
  );
});

test("research review rejects approval with an unsupported required requirement", async () => {
  const agent = new ReviewAgent();
  agent.decision = ResearchReviewDecisionSchema.parse({
    ...approvedDecision,
    requirementAssessments: {
      requirement_1: {
        status: "unsupported",
        rationale: "The supplied material does not establish the definition.",
        targetArtifactIndex: 2,
        factIndexes: [],
        retryInstruction: "Select evidence that establishes the full definition.",
      },
    },
    retryRecommended: true,
  });

  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "approved_research_review_has_unsupported_requirement",
  );
});

test("research review rejects a requirement assessment key mismatch", async () => {
  const agent = new ReviewAgent();
  agent.decision = ResearchReviewDecisionSchema.parse({
    ...approvedDecision,
    requirementAssessments: {},
  });

  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "research_review_requirement_keys_mismatch",
  );
});

test("real review adapter preserves full input and accepts targeted assessment feedback without duplicate issues", async (t) => {
  const decision = {
    ...approvedDecision, approved: false, retryRecommended: true,
    requirementAssessments: { requirement_1: {
      status: "unsupported", rationale: "The material only partly explains the requirement.",
      targetArtifactIndex: 3, factIndexes: [0], retryInstruction: "Clarify the unsupported part without discarding the supported material.",
    } },
  };
  const requests: Record<string, any>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(decision) } }] }));
  });
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", model: "test-model", baseUrl: "http://localhost/v1", reasoningEffort: "low" });
  const result = await executeGenerationStage({
    definition: createResearchReviewStage({ agent }),
    input: { request, classification, researchPlan, researchBundle, evidenceSet, factBank },
    context: { runId: "adapter-review", attempt: 1, inputArtifactIds: [], sourceIds: [] },
    recorder: new InMemoryGenerationTraceRecorder(),
  });
  assert.equal(requests.length, 1);
  const sent = requests[0]!;
  const data = JSON.parse(sent.messages[1].content);
  assert.deepEqual(data.request, request);
  assert.deepEqual(data.classification, classification);
  assert.deepEqual(data.targetArtifacts, [researchPlan, researchBundle, evidenceSet, factBank]);
  assert.equal(sent.reasoning_effort, "low");
  assert.equal(sent.max_tokens, 8000);
  assert.equal(result.status, "rejected");
  assert.equal(result.artifact?.approved, false);
  assert.equal(result.artifact?.issues.length, 1);
  assert.equal(result.artifact?.issues[0]?.artifactId, factBank.artifactId);
  assert.deepEqual(result.artifact?.issues[0]?.factIds, [factBank.facts[0]!.id]);
});
