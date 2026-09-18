import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay, setImmediate as flush } from "node:timers/promises";
import type { GenerationV2SlideAgentProvider } from "@slidespeech/types";
import { createSlidePreviewRenderer } from "@slidespeech/providers";
import { executeGenerationStage, InMemoryGenerationTraceRecorder } from "@slidespeech/core";
import { createSlideStages } from "../packages/core/src/generation/v2/slide-stages";
import { GenerationDeadlineError, sequentialStageDeadlineMs, MAX_SEQUENTIAL_STAGE_DEADLINE_MS, withExecutionDeadline } from "../packages/core/src/generation/v2/execution-deadline";
import { fidelityCases, fidelityInput } from "./fixtures/slide-fidelity";

test("sequential stage budget scales with planned work but retains an absolute cap", () => {
  assert.equal(sequentialStageDeadlineMs(2, 180_000), 360_000);
  assert.equal(sequentialStageDeadlineMs(8, 180_000), MAX_SEQUENTIAL_STAGE_DEADLINE_MS);
  assert.equal(sequentialStageDeadlineMs(200, 180_000), MAX_SEQUENTIAL_STAGE_DEADLINE_MS);
  for (const count of [0, -1, Infinity, 1.5, NaN]) assert.throws(() => sequentialStageDeadlineMs(count, 100));
  for (const budget of [0, -1, Infinity, NaN]) assert.throws(() => sequentialStageDeadlineMs(2, budget));
});

test("unit timeout stops a provider that ignores cancellation and parent cancellation is preserved", async () => {
  let signal!: AbortSignal;
  await assert.rejects(withExecutionDeadline(5, undefined, async (value) => { signal = value; return new Promise(() => {}); }, "work-unit"),
    (error: unknown) => error instanceof GenerationDeadlineError && error.scope === "work-unit");
  assert.equal(signal.aborted, true);
  const parent = new AbortController(); const reason = new Error("User cancelled");
  const pending = withExecutionDeadline(1000, parent.signal, async () => new Promise(() => {}));
  parent.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  let called = false;
  await assert.rejects(withExecutionDeadline(1000, parent.signal, async () => { called = true; }));
  assert.equal(called, false);
});

async function fixture(wait: number) {
  const input = { ...fidelityInput(fidelityCases[0]), sources: [] };
  const calls: number[] = [];
  const agent: GenerationV2SlideAgentProvider = {
    selectSlideDesigns: async () => { throw new Error("Unexpected design call"); },
    reviewSlides: async () => { throw new Error("Unexpected review call"); },
    writeSlide: async (value, options) => {
      calls.push(value.slideIndex);
      await delay(wait, undefined, { signal: options?.signal });
      const { slideId, ...decision } = input.slides.slides[value.slideIndex]!;
      return { value: decision, telemetry: { provider: "test", model: "fixture" } };
    },
  };
  return { input, agent, calls, render: await createSlidePreviewRenderer(), recorder: new InMemoryGenerationTraceRecorder(),
    context: { runId: "budget_test", attempt: 1, inputArtifactIds: [], sourceIds: [] } };
}

test("two sequential slides can exceed one unit's time without losing full material or order", async (t) => {
  const f = await fixture(65);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pending = executeGenerationStage({ ...f, definition: createSlideStages(f.agent, f.render, undefined, undefined, 120).writing,
    deadlineMs: sequentialStageDeadlineMs(2, 120) });
  await flush();
  t.mock.timers.tick(65);
  await flush();
  assert.deepEqual(f.calls, [0, 1]);
  t.mock.timers.tick(65);
  const result = await pending;
  assert.equal(result.status, "succeeded");
  assert.ok(result.durationMs >= 120);
  assert.deepEqual(f.calls, [0, 1]);
  if (result.status === "succeeded") assert.deepEqual(result.artifact.slides.slides, f.input.slides.slides);
});

test("slow unit fails once with no next slide or partial artifact", async () => {
  const f = await fixture(100);
  const result = await executeGenerationStage({ ...f, definition: createSlideStages(f.agent, f.render, undefined, undefined, 10).writing, deadlineMs: 200 });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.errors[0]?.code, "work_unit_deadline_exceeded");
  assert.equal("artifact" in result, false);
  assert.deepEqual(f.calls, [0]);
});

test("a fit revision shares its slide's deadline instead of receiving a new budget", async (t) => {
  const f = await fixture(40);
  const render = Object.assign(() => ({ feedback: ["Text exceeds the measured frame."] }), { describe: f.render.describe });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pending = executeGenerationStage({ ...f, definition: createSlideStages(f.agent, render, undefined, undefined, 65).writing, deadlineMs: 250 });
  await flush(); t.mock.timers.tick(40); await flush();
  assert.deepEqual(f.calls, [0, 0]);
  t.mock.timers.tick(25);
  const result = await pending;
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.errors[0]?.code, "work_unit_deadline_exceeded");
  assert.deepEqual(f.calls, [0, 0]);
  assert.equal("artifact" in result, false);
});

test("stage cap and cancellation between slides still stop the sequential writer", async () => {
  const f = await fixture(30);
  const result = await executeGenerationStage({ ...f, definition: createSlideStages(f.agent, f.render, undefined, undefined, 100).writing, deadlineMs: 10 });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.errors[0]?.code, "stage_deadline_exceeded");
  const g = await fixture(0); const controller = new AbortController();
  const cancelled = await executeGenerationStage({ ...g, definition: createSlideStages(g.agent, g.render).writing, signal: controller.signal,
    onProgress: (event) => { if (event.completedUnits === 1) controller.abort(new Error("User cancelled")); } });
  assert.equal(cancelled.status, "failed");
  assert.deepEqual(g.calls, [0]);
});
