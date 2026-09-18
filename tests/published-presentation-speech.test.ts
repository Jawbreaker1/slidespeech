import assert from "node:assert/strict";
import test from "node:test";
import { PublishedPresentationSpeech } from "../apps/api/src/services/generation-v2/presentation-speech";
import { narrationPassages } from "@slidespeech/types";
import type { PublishedPresentationRecord, TextToSpeechProvider } from "@slidespeech/types";
import type { PresentationQuestionResponse } from "@slidespeech/types";

const script = { slideId: "slide_1", openingBridge: "Welcome.", segments: ["An explanation.", "A connected idea."], transitionOut: "That concludes our story.", questionInvitation: "What questions do you have?", pausePrompts: ["Do not speak this cue."], sourceMentions: ["source_id"] };
const record = { presentation: { artifactId: "publication_1", narrations: { scripts: [script] } } } as PublishedPresentationRecord;
const bytes = Buffer.alloc(48); bytes.write("RIFF"); bytes.write("WAVE", 8);
const wav = { audioBase64: bytes.toString("base64"), mimeType: "audio/wav", durationMs: 100 };
const provider = (synthesize: TextToSpeechProvider["synthesize"]): TextToSpeechProvider => ({
  name: "test", synthesize,
  healthCheck: async () => ({ provider: "test", ok: true, detail: "Test fixture", checkedAt: "2026-09-16T00:00:00.000Z" }),
});
const approvedAnswer = (): PresentationQuestionResponse => ({
  presentationId: "publication_1", kind: "answered",
  answer: { schemaVersion: "2.0", artifactId: "answer_1", createdAt: "2026-09-15T00:00:00.000Z", question: "Why?", answer: "A reviewed answer.", groundingKind: "fact-bank", factIds: [], sourceIds: [], confidence: .9, limitations: ["Do not speak metadata."] },
  review: { schemaVersion: "2.0", artifactId: "review_1", createdAt: "2026-09-15T00:00:00.000Z", targetStage: "qa-review", targetArtifactIds: ["answer_1"], approved: true, score: .9, summary: "Reviewed", issues: [], retryRecommended: false },
  resume: { slideIndex: 0, passageIndex: 1, playbackSeconds: 0, bridgeText: "Back to our explanation." }, sources: [],
});

test("Piper adapter receives only exact approved passages, never delivery cues, IDs or arbitrary client text", async () => {
  let calls = 0;
  const speech = new PublishedPresentationSpeech(provider(async (text, options) => {
    calls++; assert.equal(text, "Welcome.\n\nAn explanation.\n\nA connected idea.\n\nThat concludes our story.\n\nWhat questions do you have?");
    assert.equal(options?.style, "narration"); return wav;
  }));
  assert.deepEqual(narrationPassages(script), [script.openingBridge, ...script.segments, script.transitionOut, script.questionInvitation]);
  const first = speech.synthesize(record, 0), second = speech.synthesize(record, 0);
  assert.strictEqual(first, second);
  await first; assert.equal(calls, 1);
  for (const index of [-1, 1, 0.5, NaN]) assert.throws(() => speech.synthesize(record, index), RangeError);
});

test("speech failure is not cached as silence and changed script cannot reuse old audio", async () => {
  let calls = 0;
  const speech = new PublishedPresentationSpeech(provider(async () => { calls++; if (calls === 1) return { ...wav, audioBase64: "" }; return wav; }));
  await assert.rejects(speech.synthesize(record, 0));
  await speech.synthesize(record, 0);
  const changed = structuredClone(record); changed.presentation.narrations.scripts[0]!.segments = ["Different text"];
  await speech.synthesize(changed, 0);
  assert.equal(calls, 3);
});

test("passage audio uses the exact reviewed boundary and cannot collide with full-slide or neighboring audio", async () => {
  const received: string[] = [];
  const speech = new PublishedPresentationSpeech(provider(async (text) => { received.push(text); return wav; }));
  await speech.synthesize(record, 0, 1);
  await speech.synthesize(record, 0, 1);
  await speech.synthesize(record, 0, 2);
  await speech.synthesize(record, 0);
  assert.deepEqual(received, [script.segments[0], script.segments[1], narrationPassages(script).join("\n\n")]);
  for (const index of [-1, 5, 0.5, NaN]) assert.throws(() => speech.synthesize(record, 0, index), RangeError);
});

test("staying paused or replaying can speak only the approved answer without announcing a return", async () => {
  const received: string[] = [];
  const speech = new PublishedPresentationSpeech(provider(async (text) => { received.push(text); return wav; }));
  speech.registerAnswer(approvedAnswer());
  await speech.answerAudio("publication_1", "answer_1", false);
  await speech.answerAudio("publication_1", "answer_1", true);
  assert.deepEqual(received, ["A reviewed answer.", "A reviewed answer.\n\nBack to our explanation."]);
});

test("only a server-registered approved answer and bridge can be spoken; no cross-presentation lookup", async () => {
  let calls = 0;
  const speech = new PublishedPresentationSpeech(provider(async (text, options) => {
    calls++; assert.equal(text, "A reviewed answer.\n\nBack to our explanation."); assert.equal(options?.style, "answer"); return wav;
  }));
  assert.equal(speech.answerAudio("publication_1", "answer_1"), undefined);
  const result = approvedAnswer(); speech.registerAnswer(result); result.answer.answer = "Mutated outside the store";
  assert.equal(speech.answerAudio("different_publication", "answer_1"), undefined);
  await speech.answerAudio("publication_1", "answer_1"); await speech.answerAudio("publication_1", "answer_1"); assert.equal(calls, 1);
  assert.throws(() => speech.registerAnswer({ ...approvedAnswer(), review: { ...approvedAnswer().review, approved: false } }));
  assert.throws(() => speech.registerAnswer({ ...approvedAnswer(), review: { ...approvedAnswer().review, targetArtifactIds: ["unreviewed_answer"] } }));
});

test("expired approved answer audio is not silently regenerated", () => {
  const now = Date.now;
  try {
    let time = 0; Date.now = () => time;
    const speech = new PublishedPresentationSpeech(provider(async () => wav));
    speech.registerAnswer(approvedAnswer()); time = 31 * 60_000;
    assert.equal(speech.answerAudio("publication_1", "answer_1"), undefined);
  } finally { Date.now = now; }
});
