import test from "node:test";
import assert from "node:assert/strict";
import { startQuestionRecording } from "../apps/web/lib/question-recording";

function environment(getUserMedia: () => Promise<MediaStream>) {
  const keys = ["window", "navigator", "MediaRecorder"] as const;
  const prior = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  class Recorder {
    static last: Recorder;
    static isTypeSupported() { return true; }
    mimeType = "audio/webm"; state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { Recorder.last = this; }
    start() { this.state = "recording"; }
    data(value: string) { this.ondataavailable?.({ data: new Blob([value], { type: this.mimeType }) }); }
    stop() { this.state = "inactive"; this.data("final"); this.onstop?.(); }
  }
  Object.defineProperty(globalThis, "window", { value: { isSecureContext: true }, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: { getUserMedia } }, configurable: true });
  Object.defineProperty(globalThis, "MediaRecorder", { value: Recorder, configurable: true });
  return { Recorder, restore: () => keys.forEach((key, index) => { const descriptor = prior[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }) };
}

test("cancelling during a microphone permission prompt closes a late stream without recording", async () => {
  let grant!: (stream: MediaStream) => void, stops = 0;
  const env = environment(() => new Promise((resolve) => { grant = resolve; }));
  const controller = new AbortController();
  try {
    const pending = startQuestionRecording({ signal: controller.signal, onLevel() {}, onPreview() { assert.fail(); }, onComplete() { assert.fail(); }, onError() { assert.fail(); } });
    controller.abort(); grant({ getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream);
    await assert.rejects(pending); assert.equal(stops, 1);
  } finally { env.restore(); }
});

test("recording previews contain the whole container prefix and completion releases microphone tracks", async () => {
  let stops = 0; const previews: Blob[] = [], completed: Blob[] = [];
  const env = environment(async () => ({ getTracks: () => [{ stop: () => { stops++; } }] }) as unknown as MediaStream);
  const clock = Date.now; let now = 0; Date.now = () => now;
  try {
    const recording = await startQuestionRecording({ signal: new AbortController().signal, onLevel() {}, onPreview: (blob) => previews.push(blob), onComplete: (blob) => completed.push(blob), onError: (error) => { throw error; } });
    env.Recorder.last.data("header"); now = 4500; env.Recorder.last.data("chunk1"); now = 9000; env.Recorder.last.data("chunk2");
    recording.stop();
    assert.equal(await previews[0]!.text(), "headerchunk1"); assert.equal(await previews[1]!.text(), "headerchunk1chunk2");
    assert.equal(await completed[0]!.text(), "headerchunk1chunk2final"); assert.equal(stops, 1);
  } finally { Date.now = clock; env.restore(); }
});

test("cancel stops recording and never sends a completed or late question", async () => {
  let stops = 0, completed = 0;
  const env = environment(async () => ({ getTracks: () => [{ stop: () => { stops++; } }] }) as unknown as MediaStream);
  const controller = new AbortController();
  try {
    const recording = await startQuestionRecording({ signal: controller.signal, onLevel() {}, onPreview() {}, onComplete() { completed++; }, onError() { assert.fail(); } });
    controller.abort(); env.Recorder.last.data("late"); recording.stop();
    assert.equal(stops, 1); assert.equal(completed, 0); assert.equal(env.Recorder.last.state, "inactive");
  } finally { env.restore(); }
});
