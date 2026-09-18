import assert from "node:assert/strict";
import test from "node:test";
import { SerialWorkQueue, WorkQueueBusyError } from "../apps/api/src/services/generation-v2/work-queue";

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { resolve, promise };
};

test("interactive work queues isolate results and start deadlines only when dispatched", async () => {
  const queue = new SerialWorkQueue("Questions"); const first = deferred(); const calls: string[] = [];
  const a = queue.run(async () => { calls.push("a"); return first.promise; });
  const b = queue.run(async () => { calls.push("b"); const deadline = AbortSignal.timeout(100); deadline.throwIfAborted(); return "B"; });
  const c = queue.run(async () => { calls.push("c"); return "C"; });
  assert.deepEqual(calls, ["a"]);
  await new Promise((resolve) => setTimeout(resolve, 120));
  first.resolve("A");
  assert.deepEqual(await Promise.all([a, b, c]), ["A", "B", "C"]);
  assert.deepEqual(calls, ["a", "b", "c"]);
});

test("queue limits and queued cancellation do not affect the active caller", async () => {
  const queue = new SerialWorkQueue("Questions", 1); const first = deferred();
  const active = queue.run(() => first.promise);
  const controller = new AbortController(); let cancelledRan = false;
  const cancelled = queue.run(async () => { cancelledRan = true; return "wrong"; }, controller.signal);
  const rejection = assert.rejects(cancelled, { name: "AbortError" });
  await assert.rejects(queue.run(async () => "overflow"), WorkQueueBusyError);
  controller.abort(); await rejection;
  const next = queue.run(async () => "next");
  first.resolve("active");
  assert.deepEqual(await Promise.all([active, next]), ["active", "next"]);
  assert.equal(cancelledRan, false);
});

test("active cancellation holds the lane until worker unwind and drops late output", async () => {
  const queue = new SerialWorkQueue("Questions"); const first = deferred(); const controller = new AbortController();
  const active = queue.run(() => first.promise, controller.signal); const rejected = assert.rejects(active, { name: "AbortError" });
  controller.abort(); let nextStarted = false;
  const next = queue.run(async () => { nextStarted = true; return "next"; });
  assert.equal(nextStarted, false);
  first.resolve("late"); await rejected;
  assert.equal(await next, "next");
});

test("queued wait timeout and expired signals never invoke their work", async () => {
  const queue = new SerialWorkQueue("Questions", 2, 20); const first = deferred(); let called = false;
  const active = queue.run(() => first.promise);
  await assert.rejects(queue.run(async () => { called = true; return "late"; }), WorkQueueBusyError);
  await assert.rejects(queue.run(async () => { called = true; return "aborted"; }, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(called, false);
  first.resolve("first"); await active;
  assert.equal(await queue.run(async () => "recovered"), "recovered");
});

test("sync and async worker failures release the lane without changing the next answer", async () => {
  const queue = new SerialWorkQueue("Questions"); const first = deferred();
  const failed = queue.run(async () => { await first.promise; throw new Error("Worker failure"); });
  const rejected = assert.rejects(failed, /Worker failure/);
  const next = queue.run(async () => "another caller");
  first.resolve("fail"); await rejected; assert.equal(await next, "another caller");
  await assert.rejects(queue.run(() => { throw new Error("Sync failure"); }), /Sync failure/);
  assert.equal(await queue.run(async () => "still available"), "still available");
});
