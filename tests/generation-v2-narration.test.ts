import assert from "node:assert/strict";
import test from "node:test";
import { GenerationV2Pipeline, InMemoryGenerationTraceRecorder } from "@slidespeech/core";
import type { GenerationV2PipelineConfig, GenerationV2PipelineSuccess } from "@slidespeech/core";
import { OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import { createNarrationDecisionSchema, ReviewedNarrationSchema } from "@slidespeech/types";
import type { GenerationV2NarrationAgentProvider, NarrationAgentInput, NarrationDecision, ReviewDecision, ReviewResult } from "@slidespeech/types";
import { fidelityInput, fidelityCases } from "./fixtures/slide-fidelity";
import { GenerationV2Jobs } from "../apps/api/src/services/generation-v2/jobs";
import { GROUNDED_AUTHORING_POLICY } from "../packages/providers/src/generation-v2/grounded-authoring-policy";

const identity = (artifactId: string) => ({ artifactId, schemaVersion: "2.0" as const, createdAt: "2026-09-15T19:00:00.000Z" });
const decision: ReviewDecision = { approved: true, score: 0.9, summary: "Coherent and grounded.", retryRecommended: false, issues: [] };
const review = (targetStage: ReviewResult["targetStage"], targetArtifactIds: string[]): ReviewResult => ({ ...identity(targetStage), ...decision, issues: [], targetStage, targetArtifactIds });

function fixture() {
  const input = fidelityInput(fidelityCases[0]);
  // Only the already-approved inputs read by narration are needed in this unit fixture.
  return { ...input, status: "succeeded", runId: "narration-test", scenes: [], evidenceSet: { sources: [] },
    researchReview: review("research-review", [input.factBank.artifactId]),
    outlineReview: review("outline-review", [input.strategy.artifactId, input.slidePlans.artifactId]),
    slideReview: review("slide-review", [input.designs.artifactId, input.slides.artifactId]),
  } as unknown as GenerationV2PipelineSuccess;
}
function scriptDecision(): NarrationDecision {
  return { scripts: [0, 1].map((index) => ({ openingBridge: index ? "Let us draw this together." : "Welcome. Today we will explore water and pressure.",
    segments: ["At standard atmospheric pressure, pure water boils at about 100 degrees Celsius. Change the pressure, and that temperature changes too."],
    transitionOut: index ? "The condition matters as much as the number." : "Keep that condition in mind as we recap.",
    questionInvitation: index ? "What would you like to explore further?" : null, sourceIndexes: [],
  })) };
}
function setup(overrides: Partial<GenerationV2NarrationAgentProvider> = {}) {
  const recorder = new InMemoryGenerationTraceRecorder();
  const pipeline = new GenerationV2Pipeline({ recorder } as GenerationV2PipelineConfig);
  const telemetry = { provider: "test", model: "test" };
  const agent: GenerationV2NarrationAgentProvider = {
    writeNarration: async () => ({ value: scriptDecision(), telemetry }),
    reviewNarration: async () => ({ value: decision, telemetry }), ...overrides,
  };
  return { pipeline, recorder, agent, telemetry };
}

test("narration preserves upstream material and records exact complete script approval", async () => {
  const slides = fixture(), original = structuredClone(slides);
  const { pipeline, recorder, agent } = setup();
  const result = await pipeline.narrateSlides(slides, agent);
  assert.equal(result.status, "succeeded");
  if (result.status !== "succeeded") return;
  assert.deepEqual(slides, original);
  assert.deepEqual(result.spokenPresentation.narrations.scripts.map((script) => script.slideId), ["slide_0", "slide_1"]);
  ReviewedNarrationSchema.parse(result.spokenPresentation);
  assert.deepEqual(recorder.records.map((item) => item.stage), ["narration-generation", "narration-review"]);
});

test("humanizer rejection revises once and re-reviews the new artifact, never carrying approval", async () => {
  const { pipeline, recorder, agent, telemetry } = setup();
  const inputs: NarrationAgentInput[] = [];
  agent.writeNarration = async (input) => { inputs.push(structuredClone(input)); return { value: scriptDecision(), telemetry }; };
  let reviews = 0;
  agent.reviewNarration = async () => ({ value: reviews++ === 0 ? { ...decision, approved: false, retryRecommended: true, summary: "Make the transitions coherent." } : decision, telemetry });
  const result = await pipeline.narrateSlides(fixture(), agent);
  assert.equal(result.status, "succeeded");
  assert.equal(inputs.length, 2);
  assert.ok(inputs[1]!.revision);
  assert.deepEqual(inputs[0]!.factBank, inputs[1]!.factBank);
  const first = recorder.records[0]!.artifact as { artifactId: string };
  const revised = recorder.records[2]!.artifact as { artifactId: string };
  assert.notEqual(first.artifactId, revised.artifactId);
  if (result.status === "succeeded") assert.deepEqual(result.spokenPresentation.review.targetArtifactIds, ["slides", revised.artifactId]);
  assert.deepEqual(recorder.records.map((item) => item.attempt), [1, 1, 2, 2]);
});

test("repeated rejection stops after two attempts, including rejected reviews with no issue objects", async () => {
  const { pipeline, recorder, agent, telemetry } = setup();
  agent.reviewNarration = async () => ({ value: { ...decision, approved: false, retryRecommended: true }, telemetry });
  const result = await pipeline.narrateSlides(fixture(), agent);
  assert.equal(result.status, "rejected");
  assert.equal("spokenPresentation" in result, false);
  assert.equal(recorder.records.length, 4);
});

for (const malformed of [null, {}, { ...decision, approved: true, retryRecommended: true }]) test(`malformed or contradictory humanizer review fails closed: ${JSON.stringify(malformed)}`, async () => {
  const { pipeline, agent, telemetry } = setup();
  agent.reviewNarration = async () => ({ value: malformed as ReviewDecision, telemetry });
  const result = await pipeline.narrateSlides(fixture(), agent);
  assert.equal(result.status, "failed");
});

test("missing script, source invention and missing closing invitation fail structural validation", () => {
  const slides = fixture();
  const schema = createNarrationDecisionSchema({ ...slides, sources: [] });
  for (const mutate of [
    (value: NarrationDecision) => value.scripts.pop(),
    (value: NarrationDecision) => { value.scripts[0]!.sourceIndexes = [0]; },
    (value: NarrationDecision) => { value.scripts[1]!.questionInvitation = null; },
  ]) { const value = scriptDecision(); mutate(value); assert.equal(schema.safeParse(value).success, false); }
});

test("unapproved or stale slide input cannot start narration", async () => {
  const { pipeline, recorder, agent } = setup();
  const slides = fixture();
  slides.slideReview.approved = false;
  assert.equal((await pipeline.narrateSlides(slides, agent)).status, "rejected");
  slides.slideReview.approved = true;
  slides.slides.artifactId = "unreviewed-edit";
  assert.equal((await pipeline.narrateSlides(slides, agent)).status, "rejected");
  assert.equal(recorder.records.length, 0);
});

test("validator outage and cancellation do not yield a ready narration", async () => {
  const { pipeline, agent, recorder } = setup({ reviewNarration: async () => { throw new Error("Model offline"); } });
  assert.equal((await pipeline.narrateSlides(fixture(), agent)).status, "failed");
  assert.equal(recorder.records.length, 2);
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  agent.writeNarration = async () => { calls++; throw new Error("Must not run"); };
  assert.equal((await pipeline.narrateSlides(fixture(), agent, { signal: controller.signal })).status, "failed");
  assert.equal(calls, 0);
});

test("real adapter sends full factual context and low reasoning without legacy notes generation", async (t) => {
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://model.invalid/v1", model: "test" });
  const slides = fixture();
  const input: NarrationAgentInput = { request: slides.request, classification: slides.classification, factBank: slides.factBank,
    strategy: slides.strategy, slidePlans: slides.slidePlans, slides: slides.slides, sources: [] };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.ok(request.messages[0].content.includes(GROUNDED_AUTHORING_POLICY));
    assert.equal(request.reasoning_effort, "low");
    assert.deepEqual(JSON.parse(request.messages[1].content), input);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(scriptDecision()) } }] });
  });
  await agent.narration.writeNarration(input);
});

test("application jobs never expose incomplete preview artifacts just because narration passed", async () => {
  const { pipeline, agent } = setup();
  const result = await pipeline.narrateSlides(fixture(), agent);
  if (result.status !== "succeeded") return assert.fail("Fixture must pass narration");
  // The minimal narration fixture has no scenes/research and must not pass the UI job contract.
  const jobs = new GenerationV2Jobs(async () => result);
  const job = jobs.start({ topic: "Water and pressure" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(jobs.get(job.id)!.status, "failed");
  assert.equal("result" in jobs.get(job.id)!, false);
});

test("application execution cannot report success without reviewed narration", async () => {
  const jobs = new GenerationV2Jobs(async () => fixture() as import("@slidespeech/core").GenerationV2NarrationSuccess);
  const job = jobs.start({ topic: "Water and pressure" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(jobs.get(job.id)!.status, "failed");
  assert.equal("result" in jobs.get(job.id)!, false);
});
