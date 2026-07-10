import {
  GenerationDiagnosticSchema,
  GenerationStageResultRecordSchema,
} from "@slidespeech/types";
import type {
  GenerationDiagnostic,
  GenerationStageName,
  GenerationStageResult,
  GenerationStageResultRecord,
  GenerationTraceRecorder,
} from "@slidespeech/types";

export type GenerationStageContext = {
  runId: string;
  attempt: number;
  inputArtifactIds: string[];
  sourceIds: string[];
};

export type GenerationStageExecution<TCandidate> =
  | {
      status: "succeeded";
      artifact: TCandidate;
      warnings?: GenerationDiagnostic[];
    }
  | {
      status: "rejected";
      artifact?: TCandidate;
      warnings?: GenerationDiagnostic[];
      errors: [GenerationDiagnostic, ...GenerationDiagnostic[]];
    };

export type GenerationStageDefinition<TInput, TArtifact> = {
  name: GenerationStageName;
  parseArtifact: (value: unknown) => TArtifact;
  execute: (
    input: TInput,
    context: GenerationStageContext,
  ) => Promise<GenerationStageExecution<unknown>>;
};

export class InMemoryGenerationTraceRecorder implements GenerationTraceRecorder {
  readonly records: GenerationStageResultRecord[] = [];

  async record(result: GenerationStageResultRecord): Promise<void> {
    this.records.push(result);
  }
}

type ExecuteGenerationStageInput<TInput, TArtifact> = {
  definition: GenerationStageDefinition<TInput, TArtifact>;
  input: TInput;
  context: GenerationStageContext;
  recorder: GenerationTraceRecorder;
  now?: () => Date;
};

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 1_800;

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_DIAGNOSTIC_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH - 3)}...`;
};

const contractFailure = (
  message: string,
  retryable: boolean,
): GenerationDiagnostic => ({
  code: "stage_output_contract_failed",
  message,
  category: "contract",
  retryable,
  artifactPath: [],
  sourceIds: [],
});

const executionFailure = (error: unknown): GenerationDiagnostic => ({
  code: "stage_execution_failed",
  message: errorMessage(error),
  category: "internal",
  retryable: true,
  artifactPath: [],
  sourceIds: [],
});

const validateDiagnostics = (values: GenerationDiagnostic[]): GenerationDiagnostic[] =>
  values.map((value) => GenerationDiagnosticSchema.parse(value));

export const executeGenerationStage = async <TInput, TArtifact>(
  input: ExecuteGenerationStageInput<TInput, TArtifact>,
): Promise<GenerationStageResult<TArtifact>> => {
  const now = input.now ?? (() => new Date());
  const started = now();
  let execution: GenerationStageExecution<unknown>;

  try {
    execution = await input.definition.execute(input.input, input.context);
  } catch (error) {
    const completed = now();
    const failed: GenerationStageResult<TArtifact> = {
      ...input.context,
      stage: input.definition.name,
      status: "failed",
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      warnings: [],
      errors: [executionFailure(error)],
    };
    const record = GenerationStageResultRecordSchema.parse(failed);
    await input.recorder.record(record);
    return failed;
  }

  const completed = now();
  const base = {
    ...input.context,
    stage: input.definition.name,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
  };

  if (execution.status === "rejected") {
    let artifact: TArtifact | undefined;
    if (execution.artifact !== undefined) {
      try {
        artifact = input.definition.parseArtifact(execution.artifact);
      } catch (error) {
        const failed: GenerationStageResult<TArtifact> = {
          ...base,
          status: "failed",
          warnings: validateDiagnostics(execution.warnings ?? []),
          errors: [contractFailure(errorMessage(error), true)],
        };
        const record = GenerationStageResultRecordSchema.parse(failed);
        await input.recorder.record(record);
        return failed;
      }
    }

    const rejected: GenerationStageResult<TArtifact> = {
      ...base,
      status: "rejected",
      warnings: validateDiagnostics(execution.warnings ?? []),
      errors: validateDiagnostics(execution.errors),
      ...(artifact !== undefined ? { artifact } : {}),
    };
    const record = GenerationStageResultRecordSchema.parse(rejected);
    await input.recorder.record(record);
    return rejected;
  }

  try {
    const artifact = input.definition.parseArtifact(execution.artifact);
    const succeeded: GenerationStageResult<TArtifact> = {
      ...base,
      status: "succeeded",
      warnings: validateDiagnostics(execution.warnings ?? []),
      errors: [],
      artifact,
    };
    const record = GenerationStageResultRecordSchema.parse(succeeded);
    await input.recorder.record(record);
    return succeeded;
  } catch (error) {
    const failed: GenerationStageResult<TArtifact> = {
      ...base,
      status: "failed",
      warnings: validateDiagnostics(execution.warnings ?? []),
      errors: [contractFailure(errorMessage(error), true)],
    };
    const record = GenerationStageResultRecordSchema.parse(failed);
    await input.recorder.record(record);
    return failed;
  }
};
