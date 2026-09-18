export class WorkQueueBusyError extends Error {}

type WaitingWork = { start: () => void; cleanup: () => void };

/** One active worker. Cancellation never releases its slot before the work settles. */
export class SerialWorkQueue {
  private active = false;
  private readonly waiting: WaitingWork[] = [];

  constructor(private readonly name: string, private readonly maximumQueued = 4, private readonly maximumWaitMs = 180_000) {
    if (!Number.isInteger(maximumQueued) || maximumQueued < 0 || !Number.isFinite(maximumWaitMs) || maximumWaitMs <= 0) throw new RangeError("Invalid work queue limits.");
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      if (this.active && this.waiting.length >= this.maximumQueued) { reject(new WorkQueueBusyError(`${this.name} queue is full. Please try again shortly.`)); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remove = (reason: unknown) => {
        const index = this.waiting.indexOf(entry);
        if (index < 0) return;
        this.waiting.splice(index, 1); entry.cleanup(); reject(reason);
      };
      const onAbort = () => remove(signal!.reason);
      const entry: WaitingWork = {
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
        start: () => {
          entry.cleanup(); this.active = true;
          void (async () => {
            try { signal?.throwIfAborted(); const value = await work(); signal?.throwIfAborted(); resolve(value); }
            catch (error) { reject(error); }
            finally { this.active = false; this.waiting.shift()?.start(); }
          })();
        },
      };
      if (!this.active) { entry.start(); return; }
      this.waiting.push(entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => remove(new WorkQueueBusyError(`${this.name} is still busy. Please try again shortly.`)), this.maximumWaitMs);
    });
  }
}
