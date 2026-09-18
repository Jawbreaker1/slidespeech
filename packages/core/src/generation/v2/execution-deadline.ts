export const DEFAULT_GENERATION_STAGE_DEADLINE_MS = 180_000;
export const MAX_SEQUENTIAL_STAGE_DEADLINE_MS = 15 * 60_000;

export class GenerationDeadlineError extends Error {
  constructor(readonly deadlineMs: number, readonly scope: "stage" | "work-unit") {
    super(`${scope === "stage" ? "Stage" : "Work unit"} exceeded its ${deadlineMs}ms execution deadline.`);
  }
}

export function sequentialStageDeadlineMs(unitCount: number, unitDeadlineMs: number): number {
  if (!Number.isSafeInteger(unitCount) || unitCount < 1) throw new Error("Sequential work requires a positive integer unit count.");
  if (!Number.isFinite(unitDeadlineMs) || unitDeadlineMs <= 0) throw new Error("Unit deadline must be positive and finite.");
  return Math.min(unitCount * unitDeadlineMs, MAX_SEQUENTIAL_STAGE_DEADLINE_MS);
}

// One cancellation boundary for both whole stages and sequential work units.
// A provider that ignores abort cannot return a late successful result.
export async function withExecutionDeadline<T>(
  deadlineMs: number | undefined,
  parentSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
  scope: "stage" | "work-unit" = "stage",
): Promise<T> {
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) throw new Error("Execution deadline must be positive and finite.");
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    if (deadlineMs !== undefined) timer = setTimeout(() => controller.abort(new GenerationDeadlineError(deadlineMs, scope)), deadlineMs);
    const result = await Promise.race([execute(signal), aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (timer !== undefined) clearTimeout(timer);
  }
}
