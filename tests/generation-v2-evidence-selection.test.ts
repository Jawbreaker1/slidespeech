import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay, setImmediate as flush } from "node:timers/promises";
import { sequentialStageDeadlineMs } from "../packages/core/src/generation/v2/execution-deadline";

import {
  EvidenceSelectionDecisionSchema,
  PromptClassificationSchema,
  ResearchBundleSchema,
  ResearchPlanSchema,
  type EvidenceSelectionAgentInput,
  type EvidenceSelectionDecision,
  type GenerationAgentCall,
} from "@slidespeech/types";
import {
  createEvidenceSelectionStage,
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
  segmentEvidenceText,
} from "../packages/core/src/generation/v2";

const createdAt = "2026-08-24T12:00:00.000Z";
test("rendered layout segmentation never separates coordinates from their text", () => {
  const text = Array.from({ length: 8 }, (_, index) => JSON.stringify({ text: "A whole sentence. Another sentence.", x: index * 10, y: 100 })).join("\n");
  const segments = segmentEvidenceText(text, 160, 40, "line");
  for (const segment of segments) {
    assert.equal(segment.text, text.slice(segment.startOffset, segment.endOffset));
    for (const line of segment.text.trim().split("\n")) assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.equal(segments.at(-1)?.endOffset, text.length);
});
const identity = (artifactId: string) => ({
  schemaVersion: "2.0" as const,
  artifactId,
  createdAt,
});

const classification = PromptClassificationSchema.parse({
  ...identity("classification_1"),
  requestArtifactId: "presentation_request_1",
  originalPrompt: "Explain a subject from one source.",
  subject: "A subject",
  language: "en",
  audience: "Practitioners",
  presentationGoal: "Explain the subject.",
  deckMode: "teaching",
  groundingMode: "explicit-sources",
  requestedSources: [
    { id: "requested_source_1", url: "https://example.test/source" },
  ],
  presentationDirections: [],
  requestedCoverage: [],
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
});

const researchPlan = ResearchPlanSchema.parse({
  ...identity("research_plan_1"),
  requestArtifactId: "presentation_request_1",
  classificationArtifactId: classification.artifactId,
  canExecute: true,
  blockingReason: null,
  requiresExternalResearch: true,
  researchQuestions: [
    { id: "question_1", question: "What matters?", coverageRequirementIds: [] },
  ],
  evidenceRequirements: [
    {
      id: "requirement_1",
      description: "Direct evidence about what matters.",
      required: true,
      coverageRequirementIds: [],
    },
  ],
  sourceTargets: [
    {
      id: "target_1",
      kind: "explicit-url",
      requestedSourceId: "requested_source_1",
      url: "https://example.test/source",
      purpose: "Use the requested source.",
      priority: 0,
    },
  ],
  stopCriteria: { maximumSources: 2, maximumPagesPerDomain: 2 },
  knownRiskAreas: [],
});

const lateEvidence = `${"Background context is preserved. ".repeat(175)}This is the decisive evidence at the end.`;
const researchBundle = ResearchBundleSchema.parse({
  ...identity("research_bundle_1"),
  researchPlanArtifactId: researchPlan.artifactId,
  sources: [
    {
      id: "source_1",
      targetId: "target_1",
      origin: "explicit-url",
      url: "https://example.test/source",
      title: "Complete source",
      fetchedAt: createdAt,
      status: "fetched",
      retrievedBy: "test-provider",
    },
  ],
  pages: [
    {
      id: "page_1",
      sourceId: "source_1",
      url: "https://example.test/source",
      title: "Complete source",
      content: lateEvidence,
    },
  ],
  fetchErrors: [],
  targetOutcomes: [{ targetId: "target_1", attemptedUrls: ["https://example.test/source"], stopReason: "explicit-attempted" }],
});

class TestEvidenceAgent {
  decision: (input: EvidenceSelectionAgentInput) => EvidenceSelectionDecision =
    (input) =>
      EvidenceSelectionDecisionSchema.parse({
        segmentAssessments: Object.fromEntries(
          input.segments.map((segment, segmentIndex) => [
            segment.key,
            segmentIndex === input.segments.length - 1
              ? {
                  status: "selected",
                  rationale: "The final segment contains the direct evidence.",
                }
              : {
                  status: "discarded",
                  rationale: "This segment does not contain the direct evidence.",
                },
          ]),
        ),
        observations: [],
      });

  async selectEvidence(
    input: EvidenceSelectionAgentInput,
  ): Promise<GenerationAgentCall<EvidenceSelectionDecision>> {
    return {
      value: this.decision(input),
      telemetry: { provider: "test-agent", model: "test-model" },
    };
  }
}

const run = (agent: TestEvidenceAgent, options: { bundle?: typeof researchBundle; unitDeadlineMs?: number; deadlineMs?: number; signal?: AbortSignal } = {}) => {
  let nextId = 0;
  return executeGenerationStage({
    definition: createEvidenceSelectionStage({
      agent,
      unitDeadlineMs: options.unitDeadlineMs,
      artifactFactory: {
        createId: (prefix) => `${prefix}_${++nextId}`,
        now: () => createdAt,
      },
      limits: {
        segmentCharacters: 1_000,
        segmentOverlapCharacters: 100,
        maximumEvidenceCharacters: 10_000,
        maximumSelectionsPerPage: 2,
      },
    }),
    input: { classification, researchPlan, researchBundle: options.bundle ?? researchBundle },
    deadlineMs: options.deadlineMs,
    signal: options.signal,
    context: {
      runId: "run_evidence_selection",
      attempt: 1,
      inputArtifactIds: [researchBundle.artifactId],
      sourceIds: ["source_1"],
    },
    recorder: new InMemoryGenerationTraceRecorder(),
  });
};

test("segmentation covers the complete page rather than only its prefix", () => {
  const segments = segmentEvidenceText(lateEvidence, 1_000, 100);
  assert.equal(segments[0]?.startOffset, 0);
  assert.equal(segments.at(-1)?.endOffset, lateEvidence.length);
  assert.match(segments.at(-1)?.text ?? "", /decisive evidence at the end/);
});

test("multilingual evidence candidates never detach a clause from its sentence and retain exact source offsets", () => {
  for (const sentence of [
    "The company expanded in September, while its product launched the following year. ",
    "Företaget bildades i april, medan tjänsten lanserades i september. ",
    "La société a été créée en avril, tandis que le produit a été lancé en septembre. ",
    "会社は四月に設立されました。製品は九月に発売されました。",
  ]) {
    const text = sentence.repeat(17);
    const valid = new Set([...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)].map(value => value.index));
    valid.add(text.length);
    const segments = segmentEvidenceText(text, 180, 30);
    assert.equal(segments[0]!.startOffset, 0); assert.equal(segments.at(-1)!.endOffset, text.length);
    for (const [index, segment] of segments.entries()) {
      assert.ok(valid.has(segment.startOffset)); assert.ok(valid.has(segment.endOffset));
      assert.equal(segment.text, text.slice(segment.startOffset, segment.endOffset));
      if (index) {
        assert.ok(segment.startOffset > segments[index - 1]!.startOffset);
        assert.ok(segment.startOffset <= segments[index - 1]!.endOffset);
      }
    }
  }
});

test("indivisible evidence is not silently truncated, invalid budgets cannot loop, and empty pages stay empty", () => {
  const text = "unpunctuated content ".repeat(300);
  assert.deepEqual(segmentEvidenceText(text, 1000, 100), [{ key: "segment_1", startOffset: 0, endOffset: text.length, text }]);
  assert.deepEqual(segmentEvidenceText("", 1000, 100), []);
  for (const [size, overlap] of [[NaN, 0], [Infinity, 0], [100, NaN], [100, 100], [10.5, 0], [100, -1]]) {
    assert.throws(() => segmentEvidenceText("text", size!, overlap!), /limits/);
  }
});

test("evidence selection preserves a relevant segment from the end of a page", async () => {
  const result = await run(new TestEvidenceAgent());

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.match(result.artifact.snippets[0]?.text ?? "", /decisive evidence/);
    assert.equal(result.artifact.selectionCoverage, undefined);
    const expected = segmentEvidenceText(lateEvidence, 1_000, 100).at(-1)!;
    assert.equal(result.artifact.snippets[0]?.text, expected.text);
    assert.equal(result.artifact.snippets[0]?.sourceId, "source_1");
    assert.equal(result.artifact.snippets[0]?.pageId, "page_1");
  }
});

test("evidence selection rejects a segment assessment count mismatch", async () => {
  const agent = new TestEvidenceAgent();
  agent.decision = () =>
    EvidenceSelectionDecisionSchema.parse({
      segmentAssessments: {},
      observations: [],
    });

  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "evidence_segment_assessment_count_mismatch",
  );
});

test("evidence selection rejects excess selections rather than silently dropping evidence", async () => {
  const agent = new TestEvidenceAgent();
  agent.decision = (input) =>
    EvidenceSelectionDecisionSchema.parse({
      segmentAssessments: Object.fromEntries(
        input.segments.map((segment) => [
          segment.key,
          { status: "selected", rationale: "Useful evidence." },
        ]),
      ),
      observations: [],
    });

  const result = await run(agent);

  assert.equal(result.status, "rejected");
  assert.equal(
    result.errors[0]?.code,
    "evidence_selection_limit_exceeded",
  );
});

test("relevance-only selection preserves full requirements and every acquired source segment", async () => {
  const agent = new TestEvidenceAgent();
  const original = agent.decision;
  agent.decision = (input) => {
    assert.deepEqual(input.evidenceRequirements, researchPlan.evidenceRequirements.map(({ id, description, required }) => ({ id, description, required })));
    assert.deepEqual(input.segments, segmentEvidenceText(lateEvidence, 1_000, 100));
    return original(input);
  };
  assert.equal((await run(agent)).status, "succeeded");
});

test("no relevant source is still a rejection, not manufactured evidence", async () => {
  const agent = new TestEvidenceAgent();
  agent.decision = (input) => ({ segmentAssessments: Object.fromEntries(input.segments.map((segment) => [segment.key, { status: "discarded", rationale: "Unrelated." }])), observations: [] });
  const result = await run(agent);
  assert.equal(result.status, "rejected");
  assert.equal(result.errors[0]?.code, "evidence_selection_found_no_relevant_material");
});

test("each source page has its own execution unit within a bounded stage", async (t) => {
  const agent = new TestEvidenceAgent();
  let calls = 0;
  agent.selectEvidence = async (input) => {
    calls++;
    await delay(65);
    return { value: agent.decision(input), telemetry: { provider: "test", model: "test" } };
  };
  const bundle = { ...researchBundle, pages: [researchBundle.pages[0]!, { ...researchBundle.pages[0]!, id: "page_2" }] };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pending = run(agent, { bundle, unitDeadlineMs: 120, deadlineMs: sequentialStageDeadlineMs(2, 120) });
  await flush(); t.mock.timers.tick(65); await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(65);
  const result = await pending;
  assert.equal(result.status, "succeeded");
  assert.equal(result.durationMs, 130);
  if (result.status === "succeeded") assert.deepEqual(result.artifact.snippets.map(s => s.pageId), ["page_1", "page_2"]);
});

test("an unresponsive evidence provider cannot publish late or advance to another page", async (t) => {
  const agent = new TestEvidenceAgent();
  let calls = 0;
  let complete!: (value: GenerationAgentCall<EvidenceSelectionDecision>) => void;
  let seen!: EvidenceSelectionAgentInput;
  agent.selectEvidence = async input => { calls++; seen = input; return new Promise(resolve => { complete = resolve; }); };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = run(agent, { unitDeadlineMs: 10, deadlineMs: 100 });
  await flush(); t.mock.timers.tick(10);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "work_unit_deadline_exceeded");
  assert.equal("artifact" in result, false);
  complete({ value: agent.decision(seen), telemetry: { provider: "test", model: "test" } });
  await flush();
  assert.equal(calls, 1);
});
