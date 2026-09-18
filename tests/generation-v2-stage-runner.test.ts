import assert from "node:assert/strict";
import test from "node:test";

import { PromptClassificationSchema } from "@slidespeech/types";
import type { GenerationDiagnostic } from "@slidespeech/types";
import {
  executeGenerationStage,
  executeRetriableGenerationStage,
  InMemoryGenerationTraceRecorder,
} from "../packages/core/src/generation/v2";

const timestamp = "2026-07-10T12:00:00.000Z";
const artifact = {
  schemaVersion: "2.0" as const,
  artifactId: "classification_1",
  createdAt: timestamp,
  requestArtifactId: "presentation_request_1",
  originalPrompt: "Explain a general subject.",
  subject: "A general subject",
  language: "en",
  audience: "Newcomers",
  presentationGoal: "Build understanding.",
  deckMode: "teaching" as const,
  groundingMode: "model-knowledge" as const,
  requestedSources: [],
  presentationDirections: [],
  requestedCoverage: [],
  openQuestions: [],
  requiresUserClarification: false,
  clarificationReason: null,
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

test("stage runner aborts execution and records a deadline failure", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  let observedAbort = false;
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async (_input, executionContext) =>
        new Promise((resolve) => {
          executionContext.signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve({ status: "succeeded", artifact });
            },
            { once: true },
          );
        }),
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder,
    deadlineMs: 5,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errors[0]?.code, "stage_deadline_exceeded");
  assert.equal(result.errors[0]?.category, "transport");
  assert.equal(observedAbort, true);
  assert.equal(recorder.records[0]?.status, "failed");
});

test("stage runner emits typed lifecycle and structural work progress", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const events: Array<{
    status: string;
    completedUnits?: number | undefined;
    totalUnits?: number | undefined;
  }> = [];
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async (_input, executionContext) => {
        executionContext.reportProgress({ completedUnits: 1, totalUnits: 2 });
        return { status: "succeeded", artifact };
      },
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder,
    now: createClock(),
    onProgress: (event) => events.push(event),
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    events.map((event) => event.status),
    ["started", "working", "succeeded"],
  );
  assert.deepEqual(events[1], {
    runId: "run_1",
    stage: "prompt-classification",
    attempt: 1,
    status: "working",
    occurredAt: "2026-07-10T12:00:00.025Z",
    completedUnits: 1,
    totalUnits: 2,
  });
});

test("progress observer failures cannot alter a valid stage result", async () => {
  const result = await executeGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => ({ status: "succeeded", artifact }),
    },
    input: { prompt: artifact.originalPrompt },
    context,
    recorder: new InMemoryGenerationTraceRecorder(),
    onProgress: () => {
      throw new Error("disconnected progress client");
    },
  });

  assert.equal(result.status, "succeeded");
});

test("retriable stage runner returns diagnostics as bounded feedback", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  const receivedFeedback: GenerationDiagnostic[][] = [];
  const retryableDiagnostic: GenerationDiagnostic = {
    ...rejection,
    code: "retryable_contract_issue",
    retryable: true,
  };
  const result = await executeRetriableGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async (input: { feedback: GenerationDiagnostic[] }) =>
        input.feedback.length === 0
          ? { status: "rejected", errors: [retryableDiagnostic] }
          : { status: "succeeded", artifact },
    },
    createInput: (feedback) => {
      receivedFeedback.push(feedback);
      return { feedback };
    },
    context: {
      runId: context.runId,
      inputArtifactIds: [],
      sourceIds: [],
    },
    startingAttempt: 5,
    recorder,
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(receivedFeedback.map((feedback) => feedback.length), [0, 1]);
  assert.deepEqual(recorder.records.map((record) => record.attempt), [5, 6]);
});

test("retriable stage runner does not retry non-retryable diagnostics", async () => {
  const recorder = new InMemoryGenerationTraceRecorder();
  let calls = 0;
  const result = await executeRetriableGenerationStage({
    definition: {
      name: "prompt-classification",
      parseArtifact: (value) => PromptClassificationSchema.parse(value),
      execute: async () => {
        calls += 1;
        return { status: "rejected", errors: [rejection] };
      },
    },
    createInput: () => ({}),
    context: {
      runId: context.runId,
      inputArtifactIds: [],
      sourceIds: [],
    },
    startingAttempt: 1,
    recorder,
  });

  assert.equal(result.status, "rejected");
  assert.equal(calls, 1);
  assert.equal(recorder.records.length, 1);
});

for (const failure of ["transport", "deadline", "malformed-output"] as const) {
  test(`stage runner does not replay a ${failure} failure`, async () => {
    const recorder = new InMemoryGenerationTraceRecorder();
    let calls = 0;
    const result = await executeRetriableGenerationStage({
      definition: {
        name: "prompt-classification",
        parseArtifact: (value) => PromptClassificationSchema.parse(value),
        execute: async () => {
          calls += 1;
          if (failure === "transport") throw new Error("Connection unavailable.");
          if (failure === "deadline") return new Promise(() => {});
          return { status: "succeeded", artifact: {} };
        },
      },
      createInput: () => ({}),
      context,
      startingAttempt: 1,
      deadlineMs: 5,
      recorder,
    });
    assert.equal(result.status, "failed");
    assert.equal(calls, 1);
    assert.equal(recorder.records.length, 1);
    assert.equal(result.errors[0]?.retryable, false);
  });
}

for (const timing of ["before-execution", "during-execution", "unresponsive-execution"] as const) {
  test(`stage runner honors cancellation ${timing}`, async () => {
    const controller = new AbortController();
    const recorder = new InMemoryGenerationTraceRecorder();
    let calls = 0;
    if (timing === "before-execution") controller.abort(new Error("Cancelled."));
    const result = await executeRetriableGenerationStage({
      definition: {
        name: "prompt-classification",
        parseArtifact: (value) => PromptClassificationSchema.parse(value),
        execute: async () => {
          calls += 1;
          controller.abort(new Error("Cancelled."));
          if (timing === "unresponsive-execution") return new Promise(() => {});
          return { status: "succeeded", artifact };
        },
      },
      createInput: () => ({}),
      context,
      startingAttempt: 1,
      signal: controller.signal,
      deadlineMs: 50,
      recorder,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errors[0]?.message, "Cancelled.");
    assert.equal(calls, timing === "before-execution" ? 0 : 1);
    assert.equal(recorder.records.length, 1);
    assert.equal("artifact" in result, false);
  });
}
