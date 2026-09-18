import assert from "node:assert/strict";
import test from "node:test";

import {
  FactBankDecisionSchema,
  EvidenceSetSchema,
  PromptClassificationSchema,
  ResearchBundleSchema,
  ResearchPlanSchema,
} from "@slidespeech/types";
import type {
  FactBankDecision,
  FactCurationAgentInput,
  GenerationAgentCall,
  GenerationV2AgentProvider,
  PromptClassification,
  PromptClassificationDecision,
  ResearchPlanDecision,
  ResearchReviewDecision,
} from "@slidespeech/types";
import {
  createFactCurationStage,
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";

const createdAt = "2026-08-24T12:00:00.000Z";
const identity = (artifactId: string) => ({
  schemaVersion: "2.0" as const,
  artifactId,
  createdAt,
});

const classification = (groundingMode: "explicit-sources" | "model-knowledge") =>
  PromptClassificationSchema.parse({
    ...identity(`classification_${groundingMode}`),
    requestArtifactId: "presentation_request_1",
    originalPrompt: "Create a presentation about a subject.",
    subject: "A subject",
    language: "en",
    audience: "General audience",
    presentationGoal: "Explain the subject.",
    deckMode: "teaching",
    groundingMode,
    requestedSources:
      groundingMode === "explicit-sources"
        ? [{ id: "requested_source_1", url: "https://example.com/source" }]
        : [],
    presentationDirections: [],
    requestedCoverage: [
      {
        id: "coverage_1",
        description: "Explain the defining evidence.",
        required: true,
      },
    ],
    openQuestions: [],
    requiresUserClarification: false,
    clarificationReason: null,
  });

const researchPlan = ResearchPlanSchema.parse({
  ...identity("research_plan_1"),
  requestArtifactId: "presentation_request_1",
  classificationArtifactId: "classification_explicit-sources",
  canExecute: true,
  blockingReason: null,
  requiresExternalResearch: true,
  researchQuestions: [
    {
      id: "question_1",
      question: "What evidence defines the subject?",
      coverageRequirementIds: ["coverage_1"],
    },
  ],
  evidenceRequirements: [
    {
      id: "evidence_1",
      description: "Evidence defining the subject.",
      required: true,
      coverageRequirementIds: ["coverage_1"],
    },
  ],
  sourceTargets: [
    {
      id: "target_1",
      kind: "explicit-url",
      requestedSourceId: "requested_source_1",
      url: "https://example.com/source",
      purpose: "Find defining evidence.",
      priority: 0,
    },
  ],
  stopCriteria: {
    maximumSources: 3,
    maximumPagesPerDomain: 2,
  },
  knownRiskAreas: [],
});

const researchBundle = ResearchBundleSchema.parse({
  ...identity("research_bundle_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  sources: [
    {
      id: "source_1",
      targetId: "target_1",
      origin: "explicit-url",
      url: "https://example.com/source",
      title: "Primary source",
      fetchedAt: createdAt,
      status: "fetched",
      retrievedBy: "test-research",
    },
  ],
  pages: [
    {
      id: "page_1",
      sourceId: "source_1",
      url: "https://example.com/source",
      title: "Primary source",
      content: "The source contains defining evidence.",
    },
  ],
  fetchErrors: [],
  targetOutcomes: [{ targetId: "target_1", attemptedUrls: ["https://example.com/source"], stopReason: "explicit-attempted" }],
});

const evidenceSet = EvidenceSetSchema.parse({
  ...identity("evidence_set_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  researchBundleArtifactId: researchBundle.artifactId,
  sources: researchBundle.sources.map(({ targetId: _targetId, origin: _origin, status: _status, ...source }) => source),
  snippets: [
    {
      id: "snippet_1",
      sourceId: "source_1",
      pageId: "page_1",
      pageUrl: "https://example.com/source",
      pageTitle: "Primary source",
      text: "The source contains defining evidence.",
    },
  ],
  selectionCoverage: [
    { evidenceRequirementId: "evidence_1", snippetIds: ["snippet_1"] },
  ],
});

const validDecision = FactBankDecisionSchema.parse({
  facts: [
    {
      claim: "The source supports the subject's defining characteristic.",
      origin: "source",
      evidenceSnippetIds: ["snippet_1"],
      evidenceRequirementIds: ["evidence_1"],
      role: "identity",
      language: "en",
    },
  ],
  uncertainties: [],
});

class FactAgent implements GenerationV2AgentProvider {
  readonly name = "fact-agent";
  decision: FactBankDecision = validDecision;

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
    throw new Error("not used");
  }

  async planResearch(): Promise<GenerationAgentCall<ResearchPlanDecision>> {
    throw new Error("not used");
  }

  async selectResearchSources(): Promise<never> {
    throw new Error("not used");
  }

  async selectEvidence(): Promise<never> {
    throw new Error("not used");
  }

  async curateFacts(
    _input: FactCurationAgentInput,
  ): Promise<GenerationAgentCall<FactBankDecision>> {
    return {
      value: this.decision,
      telemetry: { provider: this.name, model: "test-model" },
    };
  }

  async reviewResearch(): Promise<
    GenerationAgentCall<ResearchReviewDecision>
  > {
    throw new Error("not used");
  }
}

const run = (
  agent: FactAgent,
  groundingMode: "explicit-sources" | "model-knowledge" = "explicit-sources",
  stageResearchPlan = researchPlan,
  stageEvidenceSet = evidenceSet,
) => {
  let sequence = 0;
  return executeGenerationStage({
    definition: createFactCurationStage({
      agent,
      artifactFactory: {
        createId: (prefix) => `${prefix}_${++sequence}`,
        now: () => createdAt,
      },
    }),
    input: {
      classification: classification(groundingMode),
      researchPlan: stageResearchPlan,
      evidenceSet: stageEvidenceSet,
    },
    context: {
      runId: "run_fact_curation",
      attempt: 1,
      inputArtifactIds: [
        stageResearchPlan.artifactId,
        stageEvidenceSet.artifactId,
      ],
      sourceIds: stageEvidenceSet.sources.map((source) => source.id),
    },
    recorder: new InMemoryGenerationTraceRecorder(),
  });
};

test("fact curation accepts fully traceable source facts", async () => {
  const result = await run(new FactAgent());

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    const fact = result.artifact.facts[0]!;
    assert.equal(fact.origin, "source");
    assert.equal(fact.evidenceSnippetIds[0], "snippet_1");
    assert.match(fact.id, /^fact_/);
    assert.equal(result.artifact.modelKnowledgeAllowed, false);
  }
});

test("fact curation rejects an unknown evidence reference", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: validDecision.facts.map((fact) =>
      fact.origin === "source"
        ? {
            ...fact,
            evidenceSnippetIds: ["snippet_extra"],
          }
        : fact,
    ),
  });
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "invalid_fact_decision",
  );
  assert.deepEqual(result.errors[0]?.artifactPath, ["facts", 0, "evidenceSnippetIds", 0]);
});

test("fact curation rejects a source fact without selected evidence", async () => {
  const agent = new FactAgent();
  agent.decision = {
    ...validDecision,
    facts: validDecision.facts.map((fact) =>
      fact.origin === "source"
        ? { ...fact, evidenceSnippetIds: [] }
        : fact,
    ),
  };
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "invalid_fact_decision");
  assert.deepEqual(result.errors[0]?.artifactPath, ["facts", 0, "evidenceSnippetIds"]);
});

test("fact curation rejects an unknown requirement reference", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: validDecision.facts.map((fact) => ({
      ...fact,
      evidenceRequirementIds: ["evidence_1", "evidence_extra"],
    })),
  });
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "invalid_fact_decision",
  );
});

test("fact curation does not infer coverage from requirement links", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: validDecision.facts.map((fact) => ({
      ...fact,
      evidenceRequirementIds: [],
    })),
  });
  const result = await run(agent);

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") assert.equal("sufficientForDeck" in result.artifact, false);
});

test("fact curation rejects legacy judgments instead of accepting self approval", () => {
  for (const obsolete of [
    { sufficientForDeck: true }, { requirementAssessments: [] },
    { sourceSummaries: [] }, { sourceQuality: [] }, { contradictions: [] },
    { blockingReasons: [] },
  ]) assert.equal(FactBankDecisionSchema.safeParse({ ...validDecision, ...obsolete }).success, false);
  assert.equal(FactBankDecisionSchema.safeParse({ facts: validDecision.facts }).success, false);
});

test("fact curation preserves grounded enrichment beyond required evidence", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: [
      ...validDecision.facts,
      {
        claim: "The source also provides useful supporting context.",
        origin: "source",
        evidenceSnippetIds: ["snippet_1"],
        evidenceRequirementIds: [],
        role: "background",
        language: "en",
      },
    ],
  });

  const result = await run(agent);

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.artifact.facts[1]?.evidenceRequirementIds, []);
  }
});

test("fact curation rejects unknown uncertainty references", async () => {
  for (const references of [
    { evidenceSnippetIds: ["unknown_snippet"], evidenceRequirementIds: [] },
    { evidenceSnippetIds: [], evidenceRequirementIds: ["unknown_requirement"] },
  ]) {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    uncertainties: [{ description: "Evidence conflicts.", ...references }],
  });
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "invalid_fact_decision",
  );
  }
});

test("fact curation preserves empty findings for review without manufacturing facts", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: [],
    uncertainties: [{
        description: "The source did not support the required evidence.",
        evidenceSnippetIds: [], evidenceRequirementIds: ["evidence_1"],
    }],
  });
  const result = await run(agent);

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.deepEqual(result.artifact.facts, []);
  assert.ok("uncertainties" in result.artifact);
  assert.deepEqual(result.artifact.uncertainties, agent.decision.uncertainties);
  assert.equal("sufficientForDeck" in result.artifact, false);
});

test("fact curation preserves contributing facts alongside a remaining evidence gap", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    uncertainties: [{
      description: "The defining characteristic is supported, but the requested limitation is not documented.",
      evidenceSnippetIds: ["snippet_1"], evidenceRequirementIds: ["evidence_1"],
    }],
  });
  const result = await run(agent);

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(result.artifact.facts[0]?.evidenceRequirementIds, ["evidence_1"]);
  assert.deepEqual(result.artifact.facts[0]?.claim, validDecision.facts[0]?.claim);
  assert.ok("uncertainties" in result.artifact);
  assert.deepEqual(result.artifact.uncertainties, agent.decision.uncertainties);
});

test("uncertainties reject duplicate references without interpreting their language", async () => {
  const agent = new FactAgent();
  agent.decision = {
    ...validDecision,
    uncertainties: [{
      description: "Only part of the required evidence is documented.",
      evidenceSnippetIds: ["snippet_1", "snippet_1"], evidenceRequirementIds: [],
    }],
  };
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "invalid_fact_decision");
});

test("uncertainties preserve exact requirement ids independently of array order", async () => {
  const planWithSecondRequirement = ResearchPlanSchema.parse({
    ...researchPlan,
    evidenceRequirements: [
      ...researchPlan.evidenceRequirements,
      {
        id: "evidence_2",
        description: "Evidence about a limitation.",
        required: true,
        coverageRequirementIds: [],
      },
    ],
  });
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: validDecision.facts.map((fact) => ({
      ...fact,
      evidenceRequirementIds: ["evidence_1"],
    })),
    uncertainties: [{
        description: "The source does not document the limitation.",
        evidenceSnippetIds: [], evidenceRequirementIds: ["evidence_2"],
    }],
  });
  const result = await run(
    agent,
    "explicit-sources",
    planWithSecondRequirement,
  );

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.ok("uncertainties" in result.artifact);
    assert.deepEqual(result.artifact.uncertainties[0]?.evidenceRequirementIds, ["evidence_2"]);
  }
});

test("fact curation rejects model knowledge outside the grounding policy", async () => {
  const agent = new FactAgent();
  agent.decision = FactBankDecisionSchema.parse({
    ...validDecision,
    facts: [
      {
        claim: "A model-knowledge claim.",
        origin: "model-knowledge",
        knowledgeBasis: "General model knowledge.",
        evidenceRequirementIds: ["evidence_1"],
        role: "identity",
        language: "en",
      },
    ],
  });
  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "model_knowledge_not_allowed");
});

test("fact curation rejects duplicate references even from a provider bypassing parsing", async () => {
  for (const references of [
    { evidenceSnippetIds: ["snippet_1", "snippet_1"] },
    { evidenceRequirementIds: ["evidence_1", "evidence_1"] },
  ]) {
    const agent = new FactAgent();
    agent.decision = {
      ...validDecision,
      facts: validDecision.facts.map((fact) => ({ ...fact, ...references })),
    };
    const result = await run(agent);
    assert.equal(result.status, "rejected");
    assert.equal(result.errors.some((error) => error.message === "Fact references must be unique."), true);
  }
});

test("fact references preserve provenance when evidence order changes", async () => {
  const reorderedEvidence = EvidenceSetSchema.parse({
    ...evidenceSet,
    snippets: [
      { ...evidenceSet.snippets[0], id: "snippet_2", text: "Unselected background." },
      evidenceSet.snippets[0],
    ],
  });
  const result = await run(new FactAgent(), "explicit-sources", researchPlan, reorderedEvidence);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    const fact = result.artifact.facts[0]!;
    assert.equal(fact.origin, "source");
    if (fact.origin === "source") {
      assert.deepEqual(fact.evidenceSnippetIds, ["snippet_1"]);
      assert.deepEqual(fact.sourceIds, ["source_1"]);
    }
    assert.deepEqual(fact.evidenceRequirementIds, ["evidence_1"]);
  }
});
