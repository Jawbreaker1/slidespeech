import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileGenerationTraceRecorder } from "../packages/providers/src/generation-v2";

test("file generation trace recorder persists one inspectable record per stage attempt", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "slidespeech-generation-trace-"));

  try {
    const recorder = new FileGenerationTraceRecorder({ rootDir });
    await recorder.record({
      runId: "run_1",
      stage: "prompt-classification",
      attempt: 1,
      status: "failed",
      startedAt: "2026-07-10T12:00:00.000Z",
      completedAt: "2026-07-10T12:00:00.025Z",
      durationMs: 25,
      inputArtifactIds: [],
      sourceIds: [],
      warnings: [],
      errors: [
        {
          code: "stage_execution_failed",
          message: "model transport unavailable",
          category: "transport",
          retryable: true,
          artifactPath: [],
          sourceIds: [],
        },
      ],
    });

    const filePath = join(
      rootDir,
      "generation-runs",
      "run_1",
      "prompt-classification-01.json",
    );
    const record = JSON.parse(await readFile(filePath, "utf8")) as {
      status: string;
      errors: Array<{ code: string }>;
    };

    assert.equal(record.status, "failed");
    assert.equal(record.errors[0]?.code, "stage_execution_failed");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
