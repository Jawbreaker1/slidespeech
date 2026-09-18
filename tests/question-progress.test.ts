import assert from "node:assert/strict";
import test from "node:test";
import { PresentationQuestionResponseSchema, type QuestionProgress } from "@slidespeech/types";
import { readQuestionStream } from "../apps/web/lib/question-progress";
import { askPresentationQuestion } from "../apps/web/lib/published-presentations";

const stamp = "2026-09-18T12:00:00.000Z";
const identity = { schemaVersion: "2.0", createdAt: stamp };
const result = PresentationQuestionResponseSchema.parse({
  presentationId: "presentation_test", kind: "answered",
  answer: { ...identity, artifactId: "answer_test", question: "Why?", answer: "A multilingual answer: åäö 日本語.", groundingKind: "model-knowledge", factIds: [], sourceIds: [], confidence: .9, limitations: [] },
  review: { ...identity, artifactId: "review_test", targetStage: "qa-review", targetArtifactIds: ["answer_test"], approved: true, score: .9, summary: "Supported.", issues: [], retryRecommended: false },
  resume: { slideIndex: 0, passageIndex: 1, playbackSeconds: 0, bridgeText: "Back to the explanation." }, sources: [],
});
const progress: QuestionProgress = { stage: "qa-answer", status: "started", occurredAt: stamp };
const frame = (value: unknown) => `${JSON.stringify(value)}\n`;
const response = (text: string, chunkSize = 7) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
};

test("question stream reports real progress before the result and preserves split UTF-8", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  const seen: QuestionProgress[] = [];
  const pending = readQuestionStream(new Response(body), new AbortController().signal, value => seen.push(value));
  stream.enqueue(new TextEncoder().encode(frame({ type: "progress", progress })));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, [progress]);
  const bytes = new TextEncoder().encode(frame({ type: "result", result }));
  for (const byte of bytes) stream.enqueue(new Uint8Array([byte]));
  assert.deepEqual(await pending, result);
});

test("missing, malformed, rejected and explicit error results fail closed", async () => {
  for (const text of [
    frame({ type: "progress", progress }),
    "{broken}\n",
    frame({ type: "result", result: { ...result, review: { ...result.review, approved: false } } }),
    frame({ type: "error", error: "Review could not complete." }),
  ]) await assert.rejects(readQuestionStream(response(text), new AbortController().signal));
  assert.deepEqual(await readQuestionStream(response(JSON.stringify({ type: "result", result })), new AbortController().signal), result);
});

test("cancel while waiting for server output closes the stream and rejects late results", async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = readQuestionStream(new Response(body), controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort(); await rejected;
  assert.equal(cancelled, true);
  await assert.rejects(readQuestionStream(response(frame({ type: "result", result })), AbortSignal.abort()), { name: "AbortError" });
});

test("HTTP question client requests progress but retains exact result identity checks and JSON compatibility", async () => {
  const original = globalThis.fetch;
  const input = { text: "Why?", slideIndex: 0, passageIndex: 1, playbackSeconds: 5 };
  const seen: QuestionProgress[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("Accept"), "application/x-ndjson");
      assert.deepEqual(JSON.parse(String(init?.body)), input);
      return response(frame({ type: "progress", progress }) + frame({ type: "result", result }));
    };
    assert.deepEqual(await askPresentationQuestion("presentation_test", input, new AbortController().signal, p => seen.push(p)), result);
    assert.deepEqual(seen, [progress]);
    globalThis.fetch = async () => response(frame({ type: "result", result: { ...result, presentationId: "wrong_presentation" } }));
    await assert.rejects(askPresentationQuestion("presentation_test", input, new AbortController().signal), /does not match/);
    globalThis.fetch = async () => new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    assert.deepEqual(await askPresentationQuestion("presentation_test", input, new AbortController().signal), result);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Queue is full." }), { status: 429 });
    await assert.rejects(askPresentationQuestion("presentation_test", input, new AbortController().signal), /Queue is full/);
  } finally { globalThis.fetch = original; }
});
