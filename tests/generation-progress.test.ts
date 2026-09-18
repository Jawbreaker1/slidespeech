import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationV2Job } from "@slidespeech/types";
import { estimateGeneration, GenerationTimingHistory } from "../apps/api/src/services/generation-v2/timing-history";
import { elapsedLabel, estimateLabel, generationUnits } from "../apps/web/lib/generation-progress";

const start = "2026-09-18T10:00:00.000Z";
const job: GenerationV2Job = {
  id: "00000000-0000-4000-8000-000000000000", status: "running",
  request: { topic: "An arbitrary subject", targetSlideCount: 4 },
  createdAt: start, updatedAt: start, startedAt: start, stageStartedAt: start,
  progress: [{ runId: "test", stage: "slide-generation", attempt: 1, status: "working", occurredAt: start, completedUnits: 1, totalUnits: 4 }],
};
const samples = [
  { slides: 4, durationMs: 600_000, remainingByStage: { "slide-generation": 300_000 } },
  { slides: 4, durationMs: 720_000, remainingByStage: { "slide-generation": 420_000 } },
  { slides: 8, durationMs: 1_200_000, remainingByStage: { "slide-generation": 600_000 } },
];

test("remaining time uses observed matching-length runs and actual stage elapsed time", () => {
  assert.deepEqual(estimateGeneration(job, samples, Date.parse(start) + 60_000), {
    lowerMs: 240_000, upperMs: 360_000, sampleCount: 2, lengthAdjusted: false,
  });
  assert.equal(generationUnits(job), "1 of 4 slides written and fitted");
  assert.equal(elapsedLabel(start, Date.parse(start) + 65_000), "1:05");
});

test("queued estimates exclude waiting and explicitly project unmatched slide counts", () => {
  const queued: GenerationV2Job = { ...job, status: "queued", queuePosition: 1, progress: [], request: { topic: "Another subject", targetSlideCount: 6 } };
  assert.deepEqual(estimateGeneration(queued, samples, Date.parse(start) + 3_600_000), {
    lowerMs: 900_000, upperMs: 1_080_000, sampleCount: 3, lengthAdjusted: true,
  });
});

test("missing measurements and overrun never promise a fake completion time", () => {
  assert.equal(estimateGeneration(job, []), undefined);
  assert.equal(estimateGeneration(job, [{ slides: 4, durationMs: 600_000, remainingByStage: {} }]), undefined);
  assert.equal(estimateLabel(undefined), "Not enough timing data yet");
  assert.equal(estimateLabel(estimateGeneration(job, samples, Date.parse(start) + 900_000)), "Longer than previous runs");
  assert.equal(estimateLabel({ lowerMs: 240_000, upperMs: 360_000, sampleCount: 2, lengthAdjusted: false }), "About 4-6 min");
  assert.equal(estimateGeneration({ ...job, status: "cancelled", error: "Cancelled" }, samples), undefined);
});

test("absent optional timing storage cannot prevent execution", async () => {
  const history = new GenerationTimingHistory("/nonexistent/slidespeech-timing-history", "a-model");
  await history.refresh();
  assert.equal(history.estimate(job), undefined);
});
