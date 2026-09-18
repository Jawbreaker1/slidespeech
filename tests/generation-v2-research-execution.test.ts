import assert from "node:assert/strict";
import test from "node:test";

import {
  ResearchPlanSchema,
  ResearchSourceSelectionDecisionSchema,
  ReviewResultSchema,
} from "@slidespeech/types";
import type {
  GenerationAgentCall,
  GenerationResearchDocument,
  GenerationResearchSearchResult,
  GenerationV2ResearchProvider,
  ResearchSourceSelectionAgentInput,
  ResearchSourceSelectionDecision,
  ResearchPlan,
  ReviewResult,
} from "@slidespeech/types";
import {
  createResearchExecutionStage,
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";
import type { GenerationArtifactFactory } from "../packages/core/src/generation/v2";
import type { ResearchBundleLimits } from "../packages/core/src/generation/v2";

const artifactFactory = (): GenerationArtifactFactory => {
  let sequence = 0;
  return {
    createId: (prefix) => `${prefix}_${++sequence}`,
    now: () => "2026-08-24T12:00:00.000Z",
  };
};

const plan = (overrides: Partial<ResearchPlan> = {}): ResearchPlan =>
  ResearchPlanSchema.parse({
    schemaVersion: "2.0",
    artifactId: "research_plan_1",
    createdAt: "2026-08-24T12:00:00.000Z",
    requestArtifactId: "presentation_request_1",
    classificationArtifactId: "classification_1",
    canExecute: true,
    blockingReason: null,
    requiresExternalResearch: true,
    researchQuestions: [
      {
        id: "question_1",
        question: "What evidence answers the request?",
        coverageRequirementIds: [],
      },
    ],
    evidenceRequirements: [
      {
        id: "evidence_1",
        description: "Evidence answering the research question.",
        required: true,
        coverageRequirementIds: [],
      },
    ],
    sourceTargets: [
      {
        id: "search_target",
        kind: "web-search",
        query: "exact web query",
        purpose: "Find supporting material.",
        priority: 0,
      },
      {
        id: "explicit_target",
        kind: "explicit-url",
        requestedSourceId: "requested_source_1",
        url: "https://primary.example.com/source",
        purpose: "Use the requested primary source.",
        priority: 99,
      },
      {
        id: "domain_target",
        kind: "same-domain-search",
        domain: "docs.example.com",
        query: "exact domain query",
        purpose: "Find a supporting page on the same domain.",
        priority: 1,
      },
    ],
    stopCriteria: {
      maximumSources: 4,
      maximumPagesPerDomain: 2,
    },
    knownRiskAreas: [],
    ...overrides,
  });

class TestResearchProvider implements GenerationV2ResearchProvider {
  readonly name = "test-research";
  readonly searchQueries: string[] = [];
  readonly fetchUrls: string[] = [];
  failUrls = new Set<string>();
  linksByUrl = new Map<string, Array<{ url: string; text: string }>>();
  domainResults: GenerationResearchSearchResult[] = [
    {
      title: "Relevant domain result",
      url: "https://docs.example.com/guide",
      snippet: "Relevant snippet",
    },
    {
      title: "Wrong domain",
      url: "https://unrelated.example.net/page",
      snippet: "Should be filtered structurally by domain.",
    },
  ];

  async healthCheck() {
    return {
      provider: this.name,
      ok: true,
      detail: "ready",
      checkedAt: "2026-08-24T12:00:00.000Z",
    };
  }

  async search(query: string): Promise<GenerationResearchSearchResult[]> {
    this.searchQueries.push(query);
    if (query.startsWith("site:")) {
      return this.domainResults;
    }
    return [
      {
        title: "Search result",
        url: "https://search.example.org/result",
        snippet: "Search snippet",
      },
    ];
  }

  async fetch(url: string): Promise<GenerationResearchDocument> {
    this.fetchUrls.push(url);
    if (this.failUrls.has(url)) {
      throw new Error(`Fetch failed for ${url}`);
    }
    return {
      url,
      title: new URL(url).hostname,
      content: "abcdefghijklmnop",
      links: this.linksByUrl.get(url) ?? [],
      contentType: "text/html",
      truncated: false,
    };
  }
}

class TestSelectionAgent {
  readonly calls: ResearchSourceSelectionAgentInput[] = [];
  transform: (
    input: ResearchSourceSelectionAgentInput,
    decision: ResearchSourceSelectionDecision,
  ) => ResearchSourceSelectionDecision = (_input, decision) => decision;

  async selectResearchSources(
    input: ResearchSourceSelectionAgentInput,
  ): Promise<GenerationAgentCall<ResearchSourceSelectionDecision>> {
    this.calls.push(input);
    const decision = ResearchSourceSelectionDecisionSchema.parse({
        canUseCandidates: true,
        blockingReason: null,
        selectedCandidates: input.candidates
          .slice(0, input.maximumSelections)
          .map((_candidate, priority) => ({
            candidateIndex: priority,
            rationale: "The candidate directly supports the research target.",
            priority,
          })),
      });
    return {
      value: this.transform(input, decision),
      telemetry: { provider: "test-agent", model: "test-model" },
    };
  }
}

const run = (
  researchPlan: ResearchPlan,
  provider: GenerationV2ResearchProvider,
  agent = new TestSelectionAgent(),
  limits?: Partial<ResearchBundleLimits>,
  reviewFeedback?: ReviewResult,
) =>
  executeGenerationStage({
    definition: createResearchExecutionStage({
      provider,
      agent,
      artifactFactory: artifactFactory(),
      ...(limits ? { limits } : {}),
    }),
    input: { researchPlan, ...(reviewFeedback ? { reviewFeedback } : {}) },
    context: {
      runId: "run_research_execution",
      attempt: 1,
      inputArtifactIds: [researchPlan.artifactId],
      sourceIds: [],
    },
    recorder: new InMemoryGenerationTraceRecorder(),
  });

test("research execution follows exact plan targets with explicit sources first", async () => {
  const provider = new TestResearchProvider();
  const result = await run(plan(), provider);

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.deepEqual(provider.searchQueries, [
    "exact web query",
    "site:docs.example.com exact domain query",
  ]);
  assert.equal(
    provider.fetchUrls[0],
    "https://primary.example.com/source",
  );
  assert.equal(
    provider.fetchUrls.includes("https://unrelated.example.net/page"),
    false,
  );
  assert.equal(result.artifact.sources.length, 3);
  assert.equal(result.artifact.pages.every((page) => page.content.length === 16), true);
});

test("research acquisition retains unapproved image candidates under their exact source page", async (t) => {
  const provider = new TestResearchProvider();
  const fetch = provider.fetch.bind(provider);
  t.mock.method(provider, "fetch", async (url: string) => ({
    ...await fetch(url), imageDiscovery: {
      candidates: [{ url: "https://cdn.example.test/subject.jpg", discoveredVia: "img" as const, caption: "Source caption", declaredWidth: 1200 }],
      totalCandidates: 1, truncated: false,
    },
  }));
  const result = await run(plan(), provider);
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  const ids = new Set<string>();
  for (const page of result.artifact.pages) {
    assert.equal(page.url, result.artifact.sources.find((source) => source.id === page.sourceId)?.url);
    const candidate = page.imageDiscovery!.candidates[0]!;
    assert.equal(candidate.url, "https://cdn.example.test/subject.jpg");
    assert.equal(candidate.caption, "Source caption");
    assert.equal(candidate.declaredWidth, 1200);
    assert.equal("approved" in candidate, false);
    assert.equal("assetId" in candidate, false);
    ids.add(candidate.id);
  }
  assert.equal(ids.size, result.artifact.pages.length);
});

test("research execution enforces the planned per-domain page limit", async () => {
  const provider = new TestResearchProvider();
  provider.domainResults = [
    {
      title: "Guide one",
      url: "https://docs.example.com/one",
      snippet: "One",
    },
    {
      title: "Guide two",
      url: "https://docs.example.com/two",
      snippet: "Two",
    },
    {
      title: "Guide three",
      url: "https://docs.example.com/three",
      snippet: "Three",
    },
  ];
  const domainPlan = plan({
    sourceTargets: [
      {
        id: "domain_target",
        kind: "same-domain-search",
        domain: "docs.example.com",
        query: "exact domain query",
        purpose: "Find supporting pages on the same domain.",
        priority: 0,
      },
    ],
    stopCriteria: {
      maximumSources: 5,
      maximumPagesPerDomain: 2,
    },
  });

  const result = await run(domainPlan, provider);

  assert.equal(result.status, "succeeded");
  assert.equal(provider.fetchUrls.length, 2);
  assert.deepEqual(provider.fetchUrls, [
    "https://docs.example.com/one",
    "https://docs.example.com/two",
  ]);
});

for (const kind of ["same-domain-search", "web-search"] as const) {
  test(`research execution shares the source budget across ${kind} targets before deepening one`, async () => {
    const provider = new TestResearchProvider();
    provider.search = async (query) => {
      provider.searchQueries.push(query);
      const target = query.split(" ").at(-1)!;
      return ["first", "second", "third"].map((page) => ({
        url: `https://docs.example.com/${target}/${page}`,
        title: `${target} ${page}`,
        snippet: "A candidate for this research target.",
      }));
    };
    const agent = new TestSelectionAgent();
    const result = await run(plan({
      sourceTargets: ["one", "two", "three"].map((id, priority) => ({
        id,
        kind,
        ...(kind === "same-domain-search" ? { domain: "docs.example.com" } : {}),
        query: id,
        purpose: `Research question ${id}.`,
        priority,
      })),
      stopCriteria: { maximumSources: 4, maximumPagesPerDomain: 4 },
    }), provider, agent);

    assert.equal(result.status, "succeeded");
    assert.deepEqual(provider.fetchUrls, [
      "https://docs.example.com/one/first",
      "https://docs.example.com/two/first",
      "https://docs.example.com/three/first",
      "https://docs.example.com/one/second",
    ]);
    assert.equal(provider.searchQueries.length, 3, "Each query runs only once.");
    assert.equal(agent.calls.every((call) => call.maximumSelections === 1), true);
  });
}

test("failed fetches consume their attempt budget without starving the next target", async () => {
  const provider = new TestResearchProvider();
  provider.failUrls.add("https://docs.example.com/guide");
  provider.domainResults.push({
    title: "Another first-target page",
    url: "https://docs.example.com/second",
    snippet: "Additional material.",
  });
  const result = await run(plan({
    sourceTargets: [
      { id: "one", kind: "same-domain-search", domain: "docs.example.com", query: "first", purpose: "First question.", priority: 0 },
      { id: "two", kind: "web-search", query: "second", purpose: "Second question.", priority: 1 },
    ],
    stopCriteria: { maximumSources: 2, maximumPagesPerDomain: 2 },
  }), provider);

  assert.equal(result.status, "succeeded");
  assert.deepEqual(provider.fetchUrls, [
    "https://docs.example.com/guide",
    "https://search.example.org/result",
  ]);
  if (result.status === "succeeded") {
    assert.equal(result.artifact.fetchErrors.length, 1);
    assert.equal(result.artifact.sources[0]?.targetId, "two");
  }
});

test("source selection limits bound total per-target work across rounds", async () => {
  const provider = new TestResearchProvider();
  provider.domainResults = ["one", "two", "three"].map((name) => ({
    title: name,
    url: `https://docs.example.com/${name}`,
    snippet: "Candidate evidence.",
  }));
  const result = await run(plan({
    sourceTargets: [{ id: "one", kind: "same-domain-search", domain: "docs.example.com", query: "first", purpose: "Question.", priority: 0 }],
    stopCriteria: { maximumSources: 5, maximumPagesPerDomain: 5 },
  }), provider, new TestSelectionAgent(), { maximumSelectionsPerTarget: 2 });

  assert.equal(result.status, "succeeded");
  assert.equal(provider.fetchUrls.length, 2);
});

for (const initiallyRejected of [false, true]) {
test(`an initially ${initiallyRejected ? "rejected" : "empty"} candidate set can use a link discovered by a later target`, async () => {
  const provider = new TestResearchProvider();
  provider.search = async (query) => {
    provider.searchQueries.push(query);
    return query.endsWith("first") ? (initiallyRejected ? [{
      title: "Unhelpful page", url: "https://docs.example.com/unhelpful", snippet: "No useful information.",
    }] : []) : [{
      title: "Entry page",
      url: "https://docs.example.com/index",
      snippet: "Entry point with links.",
    }];
  };
  provider.linksByUrl.set("https://docs.example.com/index", [{
    url: "https://docs.example.com/detail",
    text: "Detailed material",
  }]);
  const agent = new TestSelectionAgent();
  agent.transform = (input, decision) => input.target.id === "first" &&
    input.candidates.every((candidate) => candidate.url.endsWith("/unhelpful"))
    ? { canUseCandidates: false, blockingReason: "These candidates are not useful.", selectedCandidates: [] }
    : decision;
  const result = await run(plan({
    sourceTargets: ["first", "second"].map((id, priority) => ({
      id, kind: "same-domain-search", domain: "docs.example.com", query: id,
      purpose: `Research ${id}.`, priority,
    })),
    stopCriteria: { maximumSources: 2, maximumPagesPerDomain: 2 },
  }), provider, agent);

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.artifact.sources.map((source) => source.targetId), ["second", "first"]);
    assert.deepEqual(result.artifact.fetchErrors, []);
  }
  assert.equal(provider.fetchUrls.includes("https://docs.example.com/unhelpful"), false);
});
}

test("candidate batching rejects a size that cannot reduce its winners", () => {
  assert.throws(() => createResearchExecutionStage({
    provider: new TestResearchProvider(),
    agent: new TestSelectionAgent(),
    limits: { maximumCandidatesPerSelectionCall: 1 },
  }), /at least two/);
});

test("research execution lets the agent select real links discovered in an explicit source", async () => {
  const provider = new TestResearchProvider();
  provider.domainResults = [];
  provider.linksByUrl.set("https://docs.example.com/index", [
    {
      url: "https://docs.example.com/borrowing",
      text: "Borrowing and references",
    },
    {
      url: "https://unrelated.example.net/page",
      text: "Unrelated page",
    },
  ]);
  provider.linksByUrl.set("https://docs.example.com/borrowing", [
    {
      url: "https://docs.example.com/reference-rules",
      text: "Detailed reference rules",
    },
  ]);
  const linkedPlan = plan({
    sourceTargets: [
      {
        id: "explicit_target",
        kind: "explicit-url",
        requestedSourceId: "requested_source_1",
        url: "https://docs.example.com/index",
        purpose: "Use the requested documentation entry point.",
        priority: 0,
      },
      {
        id: "domain_target",
        kind: "same-domain-search",
        domain: "docs.example.com",
        query: "borrowing references",
        purpose: "Find detailed documentation about borrowing and references.",
        priority: 1,
      },
    ],
    stopCriteria: {
      maximumSources: 3,
      maximumPagesPerDomain: 3,
    },
  });
  const agent = new TestSelectionAgent();

  const result = await run(linkedPlan, provider, agent);

  assert.equal(result.status, "succeeded");
  assert.deepEqual(provider.fetchUrls, [
    "https://docs.example.com/index",
    "https://docs.example.com/borrowing",
    "https://docs.example.com/reference-rules",
  ]);
  assert.equal(agent.calls[0]?.candidates.length, 1);
  assert.equal(agent.calls[0]?.candidates[0]?.origin, "discovered-link");
  assert.equal(agent.calls[1]?.candidates[0]?.origin, "discovered-link");
});

test("research execution lets the agent rank candidates beyond one context batch", async () => {
  const provider = new TestResearchProvider();
  provider.domainResults = [];
  provider.linksByUrl.set(
    "https://docs.example.com/index",
    ["one", "two", "three", "four"].map((name) => ({
      url: `https://docs.example.com/${name}`,
      text: `Generic page ${name}`,
    })).concat({
      url: "https://docs.example.com/relevant-detail",
      text: "Relevant late detail",
    }),
  );
  const linkedPlan = plan({
    sourceTargets: [
      {
        id: "explicit_target",
        kind: "explicit-url",
        requestedSourceId: "requested_source_1",
        url: "https://docs.example.com/index",
        purpose: "Use the requested documentation entry point.",
        priority: 0,
      },
      {
        id: "domain_target",
        kind: "same-domain-search",
        domain: "docs.example.com",
        query: "relevant detail",
        purpose: "Find the relevant detailed documentation.",
        priority: 1,
      },
    ],
    stopCriteria: {
      maximumSources: 2,
      maximumPagesPerDomain: 2,
    },
  });
  const agent = new TestSelectionAgent();
  agent.transform = (input, decision) => {
    const relevantIndex = input.candidates.findIndex(
      (candidate) => candidate.title === "Relevant late detail",
    );
    return relevantIndex < 0
      ? decision
      : ResearchSourceSelectionDecisionSchema.parse({
          canUseCandidates: true,
          blockingReason: null,
          selectedCandidates: [
            {
              candidateIndex: relevantIndex,
              rationale: "This page directly supports the target purpose.",
              priority: 0,
            },
          ],
        });
  };

  const result = await run(linkedPlan, provider, agent, {
    maximumCandidatesPerSelectionCall: 2,
    maximumSelectionsPerTarget: 1,
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(provider.fetchUrls, [
    "https://docs.example.com/index",
    "https://docs.example.com/relevant-detail",
  ]);
  assert.equal(agent.calls.every((call) => call.candidates.length <= 2), true);
});

test("research execution rejects a source-selection decision with an unavailable candidate position", async () => {
  const provider = new TestResearchProvider();
  const agent = new TestSelectionAgent();
  agent.transform = () =>
    ResearchSourceSelectionDecisionSchema.parse({
      canUseCandidates: true,
      blockingReason: null,
      selectedCandidates: [
        {
          candidateIndex: 99,
          rationale: "This position was not supplied by the execution stage.",
          priority: 0,
        },
      ],
    });
  const searchPlan = plan({
    sourceTargets: [
      {
        id: "search_target",
        kind: "web-search",
        query: "exact web query",
        purpose: "Find supporting material.",
        priority: 0,
      },
    ],
  });

  const result = await run(searchPlan, provider, agent);

  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "research_selection_unknown_candidate");
  assert.deepEqual(provider.fetchUrls, []);
});

test("research execution preserves partial fetch failures without inventing content", async () => {
  const provider = new TestResearchProvider();
  provider.failUrls.add("https://search.example.org/result");
  const result = await run(plan(), provider);

  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") {
    return;
  }
  assert.equal(result.artifact.fetchErrors.length, 1);
  assert.equal(result.warnings[0]?.code, "research_fetch_failed");
  assert.equal(
    result.artifact.pages.some((page) => page.url.includes("search.example.org")),
    false,
  );
});

test("research execution rejects when required external research yields no source", async () => {
  const provider = new TestResearchProvider();
  provider.failUrls = new Set([
    "https://primary.example.com/source",
    "https://search.example.org/result",
    "https://docs.example.com/guide",
  ]);
  const result = await run(plan(), provider);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "external_research_returned_no_sources",
  );
  assert.ok(result.errors.some((error) => error.message.includes("Fetch failed for https://primary.example.com/source")));
});

test("multiple long acquisition failures retain separate bounded diagnostics", async () => {
  const provider = new TestResearchProvider();
  const message = "Source unavailable. ".repeat(90);
  provider.fetch = async () => { throw new Error(message); };
  const result = await run(plan(), provider);
  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "external_research_returned_no_sources");
  const causes = result.errors.filter((error) => error.code === "research_fetch_failed");
  assert.ok(causes.length > 1);
  assert.ok(causes.every((cause) => cause.message === message && cause.artifactPath[0] === "fetchErrors"));
});

test("model-knowledge plans complete without invoking network research", async () => {
  const provider = new TestResearchProvider();
  const modelKnowledgePlan = plan({
    requiresExternalResearch: false,
    sourceTargets: [
      {
        id: "knowledge_target",
        kind: "model-knowledge",
        scope: "General domain concepts only.",
        purpose: "Provide bounded model context.",
        priority: 0,
      },
    ],
  });
  const result = await run(modelKnowledgePlan, provider);

  assert.equal(result.status, "succeeded");
  assert.deepEqual(provider.searchQueries, []);
  assert.deepEqual(provider.fetchUrls, []);
  if (result.status === "succeeded") {
    assert.equal(result.artifact.sources.length, 0);
  }
});

test("acquisition records targets skipped by a global budget instead of hiding them", async () => {
  const provider = new TestResearchProvider();
  const result = await run(plan({ stopCriteria: { maximumSources: 1, maximumPagesPerDomain: 1 } }), provider);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.artifact.targetOutcomes?.map((outcome) => ({
      id: outcome.targetId, reason: outcome.stopReason, attempts: outcome.attemptedUrls.length,
    })), [
      { id: "search_target", reason: "global-budget", attempts: 0 },
      { id: "explicit_target", reason: "explicit-attempted", attempts: 1 },
      { id: "domain_target", reason: "global-budget", attempts: 0 },
    ]);
  }
});

test("acquisition distinguishes a domain budget from an empty candidate set", async () => {
  const provider = new TestResearchProvider();
  provider.domainResults = [{ title: "Detail", url: "https://docs.example.com/detail", snippet: "More source material." }];
  const result = await run(plan({
    sourceTargets: [
      { id: "explicit", kind: "explicit-url", requestedSourceId: "requested", url: "https://docs.example.com/source", purpose: "Requested page.", priority: 0 },
      { id: "support", kind: "same-domain-search", domain: "example.com", query: "details", purpose: "Additional material.", priority: 1 },
    ],
    stopCriteria: { maximumSources: 4, maximumPagesPerDomain: 1 },
  }), provider);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.equal(result.artifact.targetOutcomes[1]?.stopReason, "domain-budget");
  }
});

test("acquisition feedback reaches candidate selection without rewriting the plan", async () => {
  const researchPlan = plan();
  const before = structuredClone(researchPlan);
  const feedback = ReviewResultSchema.parse({
    schemaVersion: "2.0", artifactId: "review", createdAt: "2026-09-14T12:00:00.000Z",
    targetStage: "research-review", targetArtifactIds: [researchPlan.artifactId, "previous_bundle"],
    approved: false, score: 0.4, summary: "Acquire the planned supporting evidence.",
    retryRecommended: true, issues: [{ code: "missing_evidence", severity: "error", dimension: "grounding",
      message: "The supporting page was not acquired.", artifactId: "previous_bundle", factIds: [],
      retryInstruction: "Select the available supporting document for the existing research target." }],
  });
  const agent = new TestSelectionAgent();
  const result = await run(researchPlan, new TestResearchProvider(), agent, undefined, feedback);
  assert.equal(result.status, "succeeded");
  assert.ok(agent.calls.length > 0);
  assert.equal(agent.calls.every((call) => call.reviewFeedback === feedback), true);
  assert.deepEqual(researchPlan, before);
});

test("agent candidate rejection is an acquisition outcome, not a fabricated fetch failure", async () => {
  const agent = new TestSelectionAgent();
  agent.transform = () => ({ canUseCandidates: false, blockingReason: "Available candidates do not answer the research question.", selectedCandidates: [] });
  const result = await run(plan(), new TestResearchProvider(), agent);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.artifact.fetchErrors, []);
    const rejected = result.artifact.targetOutcomes.filter((outcome) => outcome.stopReason === "agent-rejected");
    assert.equal(rejected.length, 2);
    assert.equal(rejected.every((outcome) => outcome.detail === "Available candidates do not answer the research question."), true);
  }
});
