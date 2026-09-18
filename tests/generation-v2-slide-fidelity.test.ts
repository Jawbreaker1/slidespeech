import assert from "node:assert/strict";
import test from "node:test";
import { FactBankSchema, SlidePlanSetSchema, SlideDraftSetSchema, SlideDesignSpecSetSchema, PresentationRequestArtifactSchema, PromptClassificationSchema, DeckStrategySchema } from "@slidespeech/types";
import { OpenAICompatibleGenerationAgent, createSlidePreviewRenderer } from "@slidespeech/providers";
import { createSlideStages } from "../packages/core/src/generation/v2/slide-stages";
import { executeGenerationStage, InMemoryGenerationTraceRecorder } from "@slidespeech/core";
import { fidelityCases, fidelityInput } from "./fixtures/slide-fidelity";
import { GROUNDED_AUTHORING_POLICY } from "../packages/providers/src/generation-v2/grounded-authoring-policy";
import { slideFactualReviewView } from "../packages/providers/src/generation-v2/slide-generation-agent";

test("fidelity controls are valid artifacts, including structurally valid semantic negatives", () => {
  for (const item of fidelityCases) for (const defect of [undefined, "visible", "notes", "plan"] as const) {
    const input = fidelityInput(item, defect);
    PresentationRequestArtifactSchema.parse(input.request);
    PromptClassificationSchema.parse(input.classification);
    FactBankSchema.parse(input.factBank);
    DeckStrategySchema.parse(input.strategy);
    SlidePlanSetSchema.parse(input.slidePlans);
    SlideDesignSpecSetSchema.parse(input.designs);
    SlideDraftSetSchema.parse(input.slides);
  }
});

test("factual review retains claims and notes in exact index order without author plan or design context", () => {
  const input = fidelityInput(fidelityCases[2], "notes");
  input.slides.slides[0]!.subtitle = fidelityCases[2].misleading;
  const view = slideFactualReviewView(input);
  assert.deepEqual(view.facts.map((fact) => fact.claim), input.factBank.facts.map((fact) => fact.claim));
  assert.deepEqual(view.slides.map((slide) => slide.speakerNotes), input.slides.slides.map((slide) => slide.speakerNotes));
  assert.deepEqual(view.slides.map((slide) => slide.content), input.slides.slides.map((slide) => slide.content));
  assert.equal(view.slides[0]!.subtitle, input.slides.slides[0]!.subtitle);
  assert.deepEqual(Object.keys(view), ["brief", "facts", "uncertainties", "slides"]);
});

test("author receives unmodified facts despite a misleading strategy question, including fit revision", async (t) => {
  const input = fidelityInput(fidelityCases[1], "plan");
  const render = await createSlidePreviewRenderer();
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://model.invalid/v1", model: "test-model", reasoningEffort: "low" });
  const draft = input.slides.slides[0]!;
  const { slideId, ...decision } = draft;
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(decision) } }] });
  });
  const writingInput = { ...input, sources: [], slideIndex: 0, previousSlides: [], layoutContract: render.describe(input.designs.designs[0]!) };
  await agent.slides.writeSlide(writingInput);
  const revision = { previous: draft, feedback: ["title height-overflow"] };
  await agent.slides.writeSlide({ ...writingInput, revision });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.ok(request.messages[0].content.includes(GROUNDED_AUTHORING_POLICY));
    const sent = JSON.parse(request.messages[1].content);
    assert.deepEqual(sent.factBank, input.factBank);
    assert.deepEqual(sent.strategy, input.strategy);
    assert.deepEqual(sent.slidePlans, input.slidePlans);
    assert.deepEqual(sent.layoutContract, writingInput.layoutContract);
    assert.equal(request.reasoning_effort, "low");
    assert.equal(request.max_tokens, 7000);
  }
  assert.deepEqual(JSON.parse(requests[1].messages[1].content).revision, revision);
});

for (const defect of ["visible", "notes"] as const) test(`semantic ${defect} rejection stops slides even when IDs and outline are valid`, async (t) => {
  const input = fidelityInput(fidelityCases[0], defect);
  const original = structuredClone(input);
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://model.invalid/v1", model: "test-model" });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.deepEqual(JSON.parse(request.messages[1].content), slideFactualReviewView(input));
    assert.equal(request.reasoning_effort, "low");
    assert.equal(request.max_tokens, 5000);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      approved: false, score: 0.9, summary: "A qualified fact was made unconditional.", retryRecommended: false,
      issues: [{ code: "scope-change", severity: "error", dimension: "grounding", message: "The claim no longer preserves its conditions.",
        targetArtifactIndex: 1, slideIndex: 0, factIndexes: [0], retryInstruction: "Write the claim with its supported scope." }],
    }) } }] });
  });
  const review = createSlideStages(agent.slides, await createSlidePreviewRenderer()).review;
  const result = await executeGenerationStage({ definition: review, input, recorder: new InMemoryGenerationTraceRecorder(),
    context: { runId: "review-control", attempt: 1, inputArtifactIds: [input.designs.artifactId, input.slides.artifactId], sourceIds: [] } });
  assert.equal(result.status, "rejected");
  assert.equal(result.artifact?.issues[0]?.artifactId, input.slides.artifactId);
  assert.equal(result.artifact?.issues[0]?.slideId, "slide_0");
  assert.deepEqual(result.artifact?.issues[0]?.factIds, [input.factBank.facts[0]!.id]);
  assert.deepEqual(input, original);
});
