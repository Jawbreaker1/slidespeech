import assert from "node:assert/strict";
import test from "node:test";

import { PromptClassificationSchema } from "@slidespeech/types";
import type { GenerationDiagnostic } from "@slidespeech/types";
import {
  executeGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";

const timestamp = "2026-07-10T12:00:00.000Z";
const artifact = {
  schemaVersion: "2.0" as const,
  artifactId: "classification_1",
  createdAt: timestamp,
  originalPrompt: "Explain a general subject.",
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build understanding.",
  deckMode: "teaching" as const,
  groundingMode: "model-knowledge" as const,
  requestedSources: [],
  requestedCoverage: [],
  confidence: 0.9,
  openQuestions: [],
};

const context = {
  runId: "run_1",
  attempt: 1,
  inputArtifactIds: [],
  sourceIds: [],
};

const createClock = () => {
  const values = [
    new Date("2026-07-10T12:00:00.000Z"),
    new Date("2026-07-10T12:00:00.025Z"),
  ];
  return () => values.shift() ?? values.at(-1) ?? new Date(timestamp);
};

const rejection: GenerationDiagnostic = {
  code: "classification_ambiguous",
  message: "The request is ambiguous and needs clarification.",
  category: "semantic",
  retryable: false,
  artifactPath: [],
  sourceIds: [],
};

test("stage runner validates, records, and returns a successful artifact", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => ({ status: "succeeded", artifact }),
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder,
    now: createClock(),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.durationMs, 25);
  assert.equal(recorder.records.length, 1);
  assert.equal(recorder.records[0]?.status, "succeeded");
});

test("stage runner preserves explicit agent rejection without inventing an artifact", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => ({ status: "rejected", errors: [rejection] }),
    },
    input: { prompt: "Ambiguous" },
    context,
    recorder,
    now: createClock(),
  });

  assert.equal(result.status, "rejected");
  assert.equal("artifact" in result, false);
  assert.equal(result.errors[0]?.code, "classification_ambiguous");
});

test("stage runner fails closed on malformed output", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => ({ status: "succeeded", artifact: {} }),
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder,
    now: createClock(),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "stage_output_contract_failed");
  assert.equal(recorder.records[0]?.status, "failed");
});

test("stage runner records transport or implementation errors as failed stages", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => {
        throw new Error("model transport unavailable");
      },
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder,
    now: createClock(),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "stage_execution_failed");
  assert.match(result.errors[0]?.message ?? "", /model transport unavailable/);
});
