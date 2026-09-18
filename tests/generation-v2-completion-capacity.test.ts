import assert from "node:assert/strict";
import test from "node:test";
import { generationCompletionBudget, OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import type { GenerationCapacityStage } from "@slidespeech/providers";
import { fidelityInput, fidelityCases } from "./fixtures/slide-fidelity";

test("single-slide writing reserves reasoning and answer space without scaling with deck length", () => {
  assert.equal(generationCompletionBudget("slide-writing", {}), 7000);
  for (const slideCount of [1, 7, 100]) {
    assert.equal(generationCompletionBudget("slide-writing", { slideCount }), 7000);
  }
});

test("question capacities reserve review headroom without scaling with deck length", () => {
  for (const [stage, expected] of [["question-classification", 1500], ["question-answer", 2500], ["question-review", 5000]] as const) {
    for (const work of [{}, { slideCount: 1 }, { slideCount: 100, requirementCount: 100, durationMinutes: 480 }]) {
      assert.equal(generationCompletionBudget(stage, work), expected);
    }
  }
});

test("whole-deck stages retain small-deck allowances and scale together within a finite ceiling", () => {
  const floors: Partial<Record<GenerationCapacityStage, number>> = {
    "research-planning": 5000, strategy: 4000, allocation: 7000, "outline-review": 4000,
    "image-selection": 3000, design: 4000, "slide-review": 5000, narration: 8000,
    "narration-review": 5000, publication: 5000,
  };
  for (const [key, floor] of Object.entries(floors)) {
    const stage = key as GenerationCapacityStage;
    assert.equal(generationCompletionBudget(stage, { slideCount: 3 }), floor);
    assert.equal(generationCompletionBudget(stage, { slideCount: 8 }), floor + 5000);
    assert.equal(generationCompletionBudget(stage, { slideCount: 100 }), 14000);
  }
  assert.equal(generationCompletionBudget("research-review", { requirementCount: 6 }), 8000);
  assert.equal(generationCompletionBudget("research-review", { requirementCount: 14 }), 11000);
  assert.equal(generationCompletionBudget("research-review", { requirementCount: 22 }), 14000);
  assert.equal(generationCompletionBudget("narration", { slideCount: 3, durationMinutes: 16 }), 13000);
  assert.equal(generationCompletionBudget("narration-review", { slideCount: 3, durationMinutes: 16 }), 10000);
  for (const invalid of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => generationCompletionBudget("allocation", { slideCount: invalid }));
    assert.throws(() => generationCompletionBudget("research-review", { requirementCount: invalid }));
  }
});

test("allocation, narration and image layout calls receive proportional capacity without losing full context", async () => {
  const input = fidelityInput(fidelityCases[2]);
  input.classification.requestedSlideCount = 8;
  input.strategy.slideCount = 8;
  input.strategy.durationMinutes = 10;
  input.strategy.storyArc = Array.from({ length: 8 }, (_, i) => ({ ...input.strategy.storyArc[i % 2]!, order: i }));
  input.slidePlans.slides = Array.from({ length: 8 }, (_, i) => ({ ...input.slidePlans.slides[i % 2]!, slideId: `slide_${i}`, order: i }));
  input.slides.slides = Array.from({ length: 8 }, (_, i) => ({ ...input.slides.slides[i % 2]!, slideId: `slide_${i}` }));
  const originalFetch = globalThis.fetch;
  let captured: { max_tokens: number; reasoning_effort: string; messages: {content: string}[] } | undefined;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(String(init?.body));
    throw new Error("Transport capture only");
  };
  try {
    const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", model: "test", baseUrl: "http://localhost:1234/v1", reasoningEffort: "low" });
    for (const [call, expected] of [
      [() => agent.allocateSlides(input), 12000],
      [() => agent.narration.writeNarration({ ...input, sources: [] }), 13000],
      [() => agent.slides.selectSlideDesigns({ ...input, availableImages: [] }), 9000],
    ] as const) {
      await assert.rejects(call, /Transport capture only/);
      assert.equal(captured?.max_tokens, expected);
      assert.equal(captured?.reasoning_effort, "low");
      const payload = JSON.parse(captured!.messages[1]!.content);
      assert.deepEqual(payload.factBank, input.factBank);
      assert.deepEqual(payload.slidePlans, input.slidePlans);
      assert.deepEqual(payload.strategy, input.strategy);
    }
  } finally { globalThis.fetch = originalFetch; }
});
