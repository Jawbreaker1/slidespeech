import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationV2PublishedResult as GenerationV2PipelineResult } from "@slidespeech/core";
import { GenerationV2JobSchema } from "@slidespeech/types";
import { GenerationV2JobBusyError, GenerationV2Jobs } from "../apps/api/src/services/generation-v2/jobs";
import type { GenerationV2JobExecutor } from "../apps/api/src/services/generation-v2/jobs";

const now = "2026-09-14T12:00:00.000Z";
const stop: GenerationV2PipelineResult = {
  status: "rejected", runId: "generation_test", stage: "research-review",
  diagnostics: [{ code: "test_rejection", message: "Source support is missing.", category: "semantic", retryable: false, artifactPath: [], sourceIds: [] }],
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve!: (result: GenerationV2PipelineResult) => void;
  const promise = new Promise<GenerationV2PipelineResult>((done) => { resolve = done; });
  return { promise, resolve };
};

test("research jobs reject malformed input before execution", () => {
  let called = false;
  const jobs = new GenerationV2Jobs(async () => { called = true; return stop; });
  assert.throws(() => jobs.start({ topic: "x" }));
  assert.equal(called, false);
});

test("stage clocks survive working updates and reset only on a new attempt", async () => {
  const pending = deferred();
  let progress!: Parameters<GenerationV2JobExecutor>[1]["onProgress"];
  const jobs = new GenerationV2Jobs(async (_request, options) => { progress = options.onProgress; return pending.promise; });
  const first = jobs.start({ topic: "Clock measurements" });
  const waiting = jobs.start({ topic: "Waiting clock" });
  assert.ok(first.startedAt);
  assert.equal(waiting.startedAt, undefined);
  progress({ runId: "run", stage: "slide-generation", attempt: 1, status: "started", occurredAt: now });
  progress({ runId: "run", stage: "slide-generation", attempt: 1, status: "working", occurredAt: "2026-09-14T12:00:10.000Z" });
  assert.equal(jobs.get(first.id)?.stageStartedAt, now);
  progress({ runId: "run", stage: "slide-generation", attempt: 2, status: "started", occurredAt: "2026-09-14T12:00:20.000Z" });
  assert.equal(jobs.get(first.id)?.stageStartedAt, "2026-09-14T12:00:20.000Z");
  jobs.cancel(waiting.id);
  pending.resolve(stop); await settle();
});

test("research jobs preserve request choices and isolate callers from mutable state", async () => {
  const pending = deferred();
  let captured: Parameters<GenerationV2JobExecutor>[0] | undefined;
  const jobs = new GenerationV2Jobs(async (request) => { captured = request; return pending.promise; });
  const input = { topic: "Explain a general subject.", targetSlideCount: 5, targetDurationMinutes: 8, useWebResearch: true };
  const job = jobs.start(input);
  input.topic = "Changed after submission.";
  job.request.topic = "Changed by caller.";
  assert.equal(captured?.topic, "Explain a general subject.");
  assert.equal(jobs.get(job.id)?.request.targetSlideCount, 5);
  assert.equal(jobs.get(job.id)?.request.targetDurationMinutes, 8);
  assert.equal(jobs.get(job.id)?.request.useWebResearch, true);
  assert.equal(jobs.get(job.id)?.request.topic, "Explain a general subject.");
  pending.resolve(stop);
  await settle();
  assert.equal(jobs.get(job.id)?.status, "rejected");
});

test("research jobs retain actual progress and queue the second caller without overlapping execution", async () => {
  const pending = deferred();
  const jobs = new GenerationV2Jobs(async (_request, { onProgress }) => {
    onProgress({ runId: "run_test", stage: "research-execution", attempt: 1, status: "started", occurredAt: now });
    onProgress({ runId: "run_test", stage: "research-execution", attempt: 1, status: "working", occurredAt: now, completedUnits: 1, totalUnits: 4 });
    onProgress({ runId: "run_test", stage: "research-execution", attempt: 2, status: "started", occurredAt: now });
    return pending.promise;
  });
  const job = jobs.start({ topic: "Explain a general subject." });
  assert.equal(job.progress.length, 2);
  assert.equal(job.progress[0]?.completedUnits, 1);
  assert.equal(job.progress[1]?.attempt, 2);
  const second = jobs.start({ topic: "A second subject." });
  assert.equal(second.status, "queued");
  assert.equal(second.status === "queued" && second.queuePosition, 1);
  assert.equal(second.progress.length, 0);
  assert.doesNotThrow(() => GenerationV2JobSchema.parse(second));
  pending.resolve(stop);
  await settle();
  assert.equal(jobs.get(second.id)?.status, "rejected");
});

test("research job cancellation aborts execution and cannot be overwritten by late output", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  const jobs = new GenerationV2Jobs(async (_request, options) => { signal = options.signal; return pending.promise; });
  const job = jobs.start({ topic: "Explain a general subject." });
  assert.equal(jobs.cancel(job.id)?.status, "cancelled");
  assert.equal(signal?.aborted, true);
  const waiting = jobs.start({ topic: "Do not overlap an unwinding request." });
  assert.equal(waiting.status, "queued");
  pending.resolve(stop);
  await settle();
  assert.equal(jobs.get(job.id)?.status, "cancelled");
  assert.equal(jobs.cancel(job.id)?.status, "cancelled");
  assert.equal(jobs.get(waiting.id)?.status, "rejected");
});

test("generation queue is FIFO, bounded, and updates positions after queued cancellation", async () => {
  const pending = deferred(); const called: string[] = [];
  const jobs = new GenerationV2Jobs(async (request) => { called.push(request.topic); return called.length === 1 ? pending.promise : stop; }, 2);
  const first = jobs.start({ topic: "First topic" });
  const second = jobs.start({ topic: "Second topic" });
  const third = jobs.start({ topic: "Third topic" });
  assert.deepEqual(called, ["First topic"]);
  assert.equal(third.status === "queued" && third.queuePosition, 2);
  assert.throws(() => jobs.start({ topic: "Queue overflow" }), GenerationV2JobBusyError);
  assert.equal(jobs.cancel(second.id)?.status, "cancelled");
  const moved = jobs.get(third.id)!;
  assert.equal(moved.status === "queued" && moved.queuePosition, 1);
  assert.doesNotThrow(() => GenerationV2JobSchema.parse(jobs.get(second.id)));
  const fourth = jobs.start({ topic: "Fourth topic" });
  pending.resolve(stop); await settle();
  assert.deepEqual(called, ["First topic", "Third topic", "Fourth topic"]);
  for (const job of [first, third, fourth]) assert.equal(jobs.get(job.id)?.status, "rejected");
  assert.equal(jobs.get(second.id)?.status, "cancelled");
});

test("generation failure frees the lane for a different caller and queued requests remain immutable", async () => {
  const pending = deferred(); const called: string[] = [];
  const jobs = new GenerationV2Jobs(async (request) => {
    called.push(request.topic);
    if (called.length === 1) { await pending.promise; throw new Error("First caller failed."); }
    return stop;
  });
  const first = jobs.start({ topic: "First topic" });
  const request = { topic: "Second topic", targetSlideCount: 7 };
  const second = jobs.start(request);
  request.topic = "Caller mutated input"; second.request.topic = "Caller mutated snapshot";
  pending.resolve(stop); await settle();
  assert.deepEqual(called, ["First topic", "Second topic"]);
  assert.equal(jobs.get(first.id)?.status, "failed");
  assert.equal(jobs.get(second.id)?.request.targetSlideCount, 7);
  assert.equal(jobs.get(second.id)?.status, "rejected");
});

test("repeated cancellations cannot evict active work or surviving queued work from history", async () => {
  const pending = deferred(); let calls = 0;
  const jobs = new GenerationV2Jobs(async () => { calls++; return pending.promise; });
  const first = jobs.start({ topic: "Active presentation" });
  const waiting = jobs.start({ topic: "Waiting presentation" });
  for (let i = 0; i < 30; i++) { const temporary = jobs.start({ topic: "Withdrawn presentation" }); jobs.cancel(temporary.id); }
  assert.equal(jobs.get(first.id)?.status, "running");
  assert.equal(jobs.get(waiting.id)?.status, "queued");
  pending.resolve(stop); await settle();
  assert.equal(calls, 2);
  assert.equal(jobs.get(waiting.id)?.status, "rejected");
});

test("research execution failure remains failed, with no result or fallback", async () => {
  const jobs = new GenerationV2Jobs(async () => { throw new Error("Model unavailable."); });
  const job = jobs.start({ topic: "Explain a general subject." });
  await settle();
  const failed = jobs.get(job.id)!;
  assert.equal(failed.status, "failed");
  assert.equal("result" in failed, false);
  assert.equal("error" in failed && failed.error, "Model unavailable.");
  assert.doesNotThrow(() => GenerationV2JobSchema.parse(failed));
});

test("preview history is bounded and absent jobs do not rerun automatically", async () => {
  let calls = 0;
  const jobs = new GenerationV2Jobs(async () => { calls++; return stop; });
  const first = jobs.start({ topic: "Explain a general subject." });
  await settle();
  for (let index = 0; index < 20; index++) {
    jobs.start({ topic: "Explain a general subject." });
    await settle();
  }
  assert.equal(jobs.get(first.id), undefined);
  assert.equal(jobs.cancel(first.id), undefined);
  assert.equal(calls, 21);
});

test("research transport cannot represent a published deck or readiness without output", () => {
  const base = { id: "00000000-0000-4000-8000-000000000000", request: { topic: "A subject" }, createdAt: now, updatedAt: now, progress: [] };
  assert.equal(GenerationV2JobSchema.safeParse({ ...base, status: "published" }).success, false);
  assert.equal(GenerationV2JobSchema.safeParse({ ...base, status: "outline-ready" }).success, false);
  assert.equal(GenerationV2JobSchema.safeParse({ ...base, status: "failed", error: "Failed", result: {} }).success, false);
});
