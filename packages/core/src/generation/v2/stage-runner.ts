import {
  GenerationDiagnosticSchema,
  GenerationStageProgressEventSchema,
  GenerationStageResultRecordSchema,
} from "@slidespeech/types";
import type {
  GenerationDiagnostic,
  GenerationStageTelemetry,
  GenerationStageName,
  GenerationStageProgressListener,
  GenerationStageResult,
  GenerationStageResultRecord,
  GenerationTraceRecorder,
} from "@slidespeech/types";
import { GenerationDeadlineError, withExecutionDeadline } from "./execution-deadline";

export type GenerationStageContext = {
  runId: string;
  attempt: number;
  inputArtifactIds: string[];
  sourceIds: string[];
};

export type GenerationStageExecutionContext = GenerationStageContext & {
  signal: AbortSignal;
  reportProgress: (update: {
    completedUnits?: number | undefined;
    totalUnits?: number | undefined;
  }) => void;
};

export type GenerationStageExecution<TCandidate> =
  | {
      status: "succeeded";
      artifact: TCandidate;
      warnings?: GenerationDiagnostic[];
      telemetry?: GenerationStageTelemetry;
    }
  | {
      status: "rejected";
      artifact?: TCandidate;
      warnings?: GenerationDiagnostic[];
      errors: [GenerationDiagnostic, ...GenerationDiagnostic[]];
      telemetry?: GenerationStageTelemetry;
    };

export type GenerationStageDefinition<TInput, TArtifact> = {
  name: GenerationStageName;
  parseArtifact: (value: unknown) => TArtifact;
  execute: (
    input: TInput,
    context: GenerationStageExecutionContext,
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
  deadlineMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: GenerationStageProgressListener | undefined;
  now?: () => Date;
};

type ExecuteRetriableGenerationStageInput<TInput, TArtifact> = Omit<
  ExecuteGenerationStageInput<TInput, TArtifact>,
  "input" | "context"
> & {
  createInput: (feedback: GenerationDiagnostic[]) => TInput;
  context: Omit<GenerationStageContext, "attempt">;
  startingAttempt: number;
  maximumAttempts?: number | undefined;
};

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 1_800;

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_DIAGNOSTIC_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH - 3)}...`;
};

const contractFailure = (message: string): GenerationDiagnostic => ({
  code: "stage_output_contract_failed",
  message,
  category: "contract",
  retryable: false,
  artifactPath: [],
  sourceIds: [],
});

const executionFailure = (error: unknown): GenerationDiagnostic => ({
  code: "stage_execution_failed",
  message: errorMessage(error),
  category: "internal",
  retryable: false,
  artifactPath: [],
  sourceIds: [],
});

const deadlineFailure = (error: GenerationDeadlineError): GenerationDiagnostic => ({
  code: error.scope === "stage" ? "stage_deadline_exceeded" : "work_unit_deadline_exceeded",
  message: error.message,
  category: "transport",
  retryable: false,
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
  const deadlineMs = input.deadlineMs;
  if (
    deadlineMs !== undefined &&
    (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
  ) {
    throw new Error("Generation stage deadline must be a positive finite number.");
  }
  let executing = true;
  const emitProgress = (
    status: "started" | "working" | "succeeded" | "rejected" | "failed",
    occurredAt: Date,
    update: {
      completedUnits?: number | undefined;
      totalUnits?: number | undefined;
    } = {},
  ): void => {
    if (!input.onProgress) {
      return;
    }
    const event = GenerationStageProgressEventSchema.parse({
      runId: input.context.runId,
      stage: input.definition.name,
      attempt: input.context.attempt,
      status,
      occurredAt: occurredAt.toISOString(),
      ...update,
    });
    try {
      input.onProgress(event);
    } catch {
      // Progress observers cannot change generation semantics.
    }
  };
  const finish = async (
    result: GenerationStageResult<TArtifact>,
    completed: Date,
  ): Promise<GenerationStageResult<TArtifact>> => {
    const record = GenerationStageResultRecordSchema.parse(result);
    await input.recorder.record(record);
    emitProgress(result.status, completed);
    return result;
  };
  emitProgress("started", started);

  try {
    execution = await withExecutionDeadline(deadlineMs, input.signal, (signal) =>
      input.definition.execute(input.input, {
        ...input.context,
        signal,
        reportProgress: (update) => {
          if (executing && !signal.aborted) emitProgress("working", now(), update);
        },
      }),
    );
  } catch (error) {
    const completed = now();
    const diagnostic =
      error instanceof GenerationDeadlineError
        ? deadlineFailure(error)
        : executionFailure(error);
    const failed: GenerationStageResult<TArtifact> = {
      ...input.context,
      stage: input.definition.name,
      status: "failed",
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      warnings: [],
      errors: [diagnostic],
    };
    return finish(failed, completed);
  } finally {
    executing = false;
  }

  const completed = now();
  const base = {
    ...input.context,
    stage: input.definition.name,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    ...(execution.telemetry ? { telemetry: execution.telemetry } : {}),
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
          errors: [contractFailure(errorMessage(error))],
        };
        return finish(failed, completed);
      }
    }

    const rejected: GenerationStageResult<TArtifact> = {
      ...base,
      status: "rejected",
      warnings: validateDiagnostics(execution.warnings ?? []),
      errors: validateDiagnostics(execution.errors),
      ...(artifact !== undefined ? { artifact } : {}),
    };
    return finish(rejected, completed);
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
    return finish(succeeded, completed);
  } catch (error) {
    const failed: GenerationStageResult<TArtifact> = {
      ...base,
      status: "failed",
      warnings: validateDiagnostics(execution.warnings ?? []),
      errors: [contractFailure(errorMessage(error))],
    };
    return finish(failed, completed);
  }
};

export const executeRetriableGenerationStage = async <TInput, TArtifact>(
  input: ExecuteRetriableGenerationStageInput<TInput, TArtifact>,
): Promise<GenerationStageResult<TArtifact>> => {
  const maximumAttempts = input.maximumAttempts ?? 2;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Maximum stage attempts must be a positive integer.");
  }
  if (!Number.isInteger(input.startingAttempt) || input.startingAttempt < 1) {
    throw new Error("Starting stage attempt must be a positive integer.");
  }

  let feedback: GenerationDiagnostic[] = [];
  for (let retryOffset = 0; retryOffset < maximumAttempts; retryOffset += 1) {
    const result = await executeGenerationStage({
      definition: input.definition,
      input: input.createInput(feedback),
      context: {
        ...input.context,
        attempt: input.startingAttempt + retryOffset,
      },
      recorder: input.recorder,
      ...(input.deadlineMs !== undefined
        ? { deadlineMs: input.deadlineMs }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.now ? { now: input.now } : {}),
    });
    if (
      result.status !== "rejected" ||
      retryOffset === maximumAttempts - 1 ||
      result.errors.some((diagnostic) => !diagnostic.retryable)
    ) {
      return result;
    }
    feedback = result.errors;
  }

  throw new Error("Retriable stage loop exited without a result.");
};
