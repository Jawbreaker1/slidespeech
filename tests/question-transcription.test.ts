import assert from "node:assert/strict";
import test from "node:test";
import { QuestionTranscription } from "../apps/api/src/services/generation-v2/question-transcription";
import { FasterWhisperSTTProvider } from "../packages/providers/src/stt/faster-whisper-stt-provider";
import type { SpeechToTextProvider } from "@slidespeech/types";
import { resolve } from "node:path";

const wav = Buffer.alloc(3244); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(3200, 40);
const audio = { mimeType: "audio/wav", dataBase64: wav.toString("base64") };
test("recording transport preserves text and unknown confidence without invoking Q&A", async () => {
  let calls = 0;
  const service = new QuestionTranscription({ transcribe: async (_audio, options) => { calls++; assert.ok(options?.signal); return { text: "A short question?", confidence: null, isFinal: true }; } } as SpeechToTextProvider);
  const result = await service.transcribe(audio, new AbortController().signal);
  assert.deepEqual(result, { text: "A short question?", confidence: null, isFinal: true }); assert.equal(calls, 1);
  for (const invalid of [{ ...audio, dataBase64: "not base64" }, { ...audio, mimeType: "text/html" }, { ...audio, dataBase64: "" }]) await assert.rejects(service.transcribe(invalid, new AbortController().signal));
  assert.equal(calls, 1);
});
test("STT serializes work, rejects malformed output and drops late cancelled transcripts", async () => {
  let resolveResult!: (value: unknown) => void;
  let calls = 0;
  const service = new QuestionTranscription({ transcribe: () => { calls++; return calls === 1 ? new Promise((resolve) => { resolveResult = resolve; }) : Promise.resolve({ text: "Second person's question", confidence: null, isFinal: true }); } } as SpeechToTextProvider);
  const controller = new AbortController(); const pending = service.transcribe(audio, controller.signal);
  const rejected = assert.rejects(pending);
  const second = service.transcribe(audio, new AbortController().signal);
  assert.equal(calls, 1);
  controller.abort(); resolveResult({ text: "Late text", confidence: null, isFinal: true }); await rejected;
  assert.equal((await second).text, "Second person's question");
  assert.equal(calls, 2);
  const malformed = new QuestionTranscription({ transcribe: async () => ({}) } as SpeechToTextProvider);
  await assert.rejects(malformed.transcribe(audio, new AbortController().signal));
});

const provider = (model: string, timeout = 2000) => new FasterWhisperSTTProvider({ pythonBin: process.execPath, workerPath: resolve("tests/fixtures/stt-worker.cjs"), model, requestTimeoutMs: timeout });
test("STT worker spawn failure, malformed output and timeout fail explicitly", async () => {
  const missing = new FasterWhisperSTTProvider({ pythonBin: "/missing/python", model: "test", requestTimeoutMs: 100 });
  assert.equal((await missing.healthCheck()).ok, false);
  for (const mode of ["malformed", "hang"]) {
    const stt = provider(mode, 500);
    try { assert.equal((await stt.healthCheck()).ok, false); } finally { stt.dispose(); }
  }
});
test("cancelled STT kills its worker and a later request can start cleanly", async () => {
  const stt = provider("slow"); const controller = new AbortController();
  try {
    const pending = stt.transcribe({ ...audio, chunkId: "test" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50); await assert.rejects(pending);
    assert.equal((await stt.healthCheck()).ok, true);
  } finally { stt.dispose(); }
});
