import { join } from "node:path";

import { GenerationStageResultRecordSchema } from "@slidespeech/types";
import type {
  GenerationStageResultRecord,
  GenerationTraceRecorder,
} from "@slidespeech/types";

import { writeJsonFile } from "../shared";

export interface FileGenerationTraceRecorderConfig {
  rootDir: string;
}

export class FileGenerationTraceRecorder implements GenerationTraceRecorder {
  constructor(private readonly config: FileGenerationTraceRecorderConfig) {}

  async record(result: GenerationStageResultRecord): Promise<void> {
    const validated = GenerationStageResultRecordSchema.parse(result);
    const attempt = String(validated.attempt).padStart(2, "0");
    const filePath = join(
      this.config.rootDir,
      "generation-runs",
      validated.runId,
      `${validated.stage}-${attempt}.json`,
    );

    await writeJsonFile(filePath, validated);
  }
}
