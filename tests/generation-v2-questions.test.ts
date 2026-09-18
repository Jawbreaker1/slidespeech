import assert from "node:assert/strict";
import test from "node:test";
import { PresentationQuestionPipeline, PresentationSessionService, InMemoryGenerationTraceRecorder } from "@slidespeech/core";
import { QuestionAgent, StructuredGenerationClient } from "@slidespeech/providers";
import { PresentationQuestionResponseSchema } from "@slidespeech/types";
import type { GenerationV2QuestionAgentProvider, PublishablePresentation, QuestionAnswerDecision, QuestionClassificationV2, QuestionReviewDecision } from "@slidespeech/types";

const material = {
  artifactId: "publication_test", request: { request: { topic: "A fictional system" } }, classification: { subject: "A fictional system", language: "English" },
  factBank: { modelKnowledgeAllowed: false, facts: [{ id: "fact_1", claim: "The system stores input until a worker is available." }] },
  evidenceSet: { sources: [{ id: "source_1", title: "System handbook", url: "https://example.org/handbook" }], excerpts: [{ text: "Source qualifications remain here." }] },
  slides: { slides: [{ slideId: "slide_1", title: "Overview" }, { slideId: "slide_2", title: "Processing" }] },
  narrations: { scripts: [{ slideId: "slide_1", openingBridge: "Welcome.", segments: ["Welcome to the system."], transitionOut: "Next." }, { slideId: "slide_2", openingBridge: "Processing.", segments: ["Here is the full explanation."], transitionOut: "Finished." }] },
} as unknown as PublishablePresentation;
const question = { text: "Why does it retain input?", slideIndex: 1, passageIndex: 1, playbackSeconds: 12.75 };
test("legacy session interaction cannot re-enter heuristic question answering", () => {
  assert.equal("interact" in PresentationSessionService.prototype, false);
});
const classification: QuestionClassificationV2 = { relevance: "relevant", evidence: "sufficient", rationale: "Explains the documented behavior.", missingInformation: [] };
const candidate: QuestionAnswerDecision = { kind: "answered", answer: "It retains input so a busy worker can process it later.", groundingKind: "fact-bank", factIndexes: [0], sourceIndexes: [0], confidence: .9, limitations: [], bridgeText: "Returning to how processing works." };
const review: QuestionReviewDecision = { approved: true, score: .9, summary: "Addresses the question with the supplied evidence.", issues: [] };
const call = <T>(value: T) => ({ value, telemetry: { provider: "test", model: "test" } });
const harness = (overrides: Partial<GenerationV2QuestionAgentProvider> = {}) => {
  const seen: string[] = [], recorder = new InMemoryGenerationTraceRecorder();
  const agent: GenerationV2QuestionAgentProvider = {
    classifyQuestion: async (input) => { seen.push("classification"); assert.deepEqual(input.material.factBank, material.factBank); assert.equal(input.material.narrations.scripts.length, 2); assert.equal(input.followUpResearchAvailable, false); return call(classification); },
    answerQuestion: async (input) => { seen.push("answer"); assert.deepEqual(input.material.evidenceSet, material.evidenceSet); return call(candidate); },
    reviewAnswer: async (input) => { seen.push("review"); assert.deepEqual(input.candidate, candidate); return call(review); }, ...overrides,
  };
  return { pipeline: new PresentationQuestionPipeline(agent, recorder), seen, recorder };
};

test("question stages preserve all material and return to the interrupted passage boundary, never a mid-word cursor", async () => {
  const { pipeline, seen, recorder } = harness(), before = structuredClone(material);
  const progress: string[] = [];
  const result = await pipeline.answer(material, question, { onProgress: event => progress.push(`${event.stage}:${event.status}`) });
  assert.deepEqual(progress, ["qa-classification:started", "qa-classification:succeeded", "qa-answer:started", "qa-answer:succeeded", "qa-review:started", "qa-review:succeeded"]);
  assert.deepEqual(seen, ["classification", "answer", "review"]);
  assert.deepEqual(recorder.records.map((record) => record.stage), ["qa-classification", "qa-answer", "qa-review"]);
  assert.deepEqual(result.answer.factIds, ["fact_1"]); assert.deepEqual(result.answer.sourceIds, ["source_1"]);
  assert.equal(result.resume.playbackSeconds, 0); assert.equal(result.resume.slideIndex, 1); assert.equal(result.resume.passageIndex, 1);
  assert.equal(result.resume.bridgeText, candidate.bridgeText); assert.deepEqual(material, before);
  assert.equal(PresentationQuestionResponseSchema.safeParse({ ...result, review: { ...result.review, approved: false } }).success, false);
  assert.equal(PresentationQuestionResponseSchema.safeParse({ ...result, review: { ...result.review, targetArtifactIds: ["other_answer"] } }).success, false);
  assert.equal(PresentationQuestionResponseSchema.safeParse({ ...result, resume: { ...result.resume, playbackSeconds: 12.75 } }).success, false);
});

for (const badReview of [{ ...review, approved: false, issues: [] }, {}, { ...review, issues: [{ severity: "error", message: "Not supported." }] }]) {
  test(`question review fails closed: ${JSON.stringify(badReview)}`, async () => {
    const { pipeline } = harness({ reviewAnswer: async () => call(badReview as QuestionReviewDecision) });
    await assert.rejects(pipeline.answer(material, question));
  });
}

for (const stage of ["classifyQuestion", "answerQuestion", "reviewAnswer"] as const) {
  test(`no static answer when ${stage} is unavailable`, async () => {
    const { pipeline } = harness({ [stage]: async () => { throw new Error("Provider unavailable"); } });
    await assert.rejects(pipeline.answer(material, question), /Provider unavailable/);
  });
}

for (const changes of [{ sourceIndexes: [20] }, { factIndexes: [5] }, { groundingKind: "follow-up-research" }, { groundingKind: "model-knowledge" }]) {
  test(`invalid evidence/capability fails before review: ${JSON.stringify(changes)}`, async () => {
    const { pipeline, seen } = harness({ answerQuestion: async () => call({ ...candidate, ...changes } as QuestionAnswerDecision) });
    await assert.rejects(pipeline.answer(material, question)); assert.ok(!seen.includes("review"));
  });
}

test("research-needed and off-topic decisions are model-written and reviewed, not keyword routing", async () => {
  for (const scope of ["off-topic", "needs-clarification", "relevant"] as const) {
    const answer = { ...candidate, kind: scope === "relevant" ? "insufficient-evidence" as const : scope, groundingKind: "unsupported" as const, factIndexes: [], sourceIndexes: [], answer: "A response authored by the test agent, not runtime fallback." };
    const { pipeline } = harness({
      classifyQuestion: async () => call({ ...classification, relevance: scope, evidence: "needs-research" }),
      answerQuestion: async () => call(answer), reviewAnswer: async () => call(review),
    });
    const result = await pipeline.answer(material, question); assert.equal(result.kind, answer.kind); assert.equal(result.answer.answer, answer.answer);
  }
  const { pipeline } = harness({ classifyQuestion: async () => call({ ...classification, evidence: "needs-research" }) });
  await assert.rejects(pipeline.answer(material, question), /disposition/);
});

test("invalid positions fail before LLM calls and late cancelled work cannot become an answer", async () => {
  const { pipeline, seen } = harness();
  for (const input of [{ ...question, slideIndex: 2 }, { ...question, passageIndex: 3 }, { ...question, passageIndex: -1 }, { ...question, passageIndex: 0.5 }, { ...question, playbackSeconds: -1 }, { ...question, text: "  " }]) await assert.rejects(pipeline.answer(material, input));
  assert.equal(seen.length, 0);
  const controller = new AbortController();
  const cancelled = harness({ classifyQuestion: async () => { controller.abort(new Error("Cancelled")); return call(classification); } });
  await assert.rejects(cancelled.pipeline.answer(material, question, { signal: controller.signal }), /Cancelled/);
  assert.ok(!cancelled.seen.includes("answer"));
});

test("question agent keeps full factual context, structured contracts and low reasoning", async () => {
  const original = globalThis.fetch; const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(classification) } }] }), { status: 200 }); };
  try {
    const agent = new QuestionAgent(new StructuredGenerationClient({ providerName: "test", baseUrl: "http://localhost:1234/v1", model: "test" }));
    const { artifactId, ...inputMaterial } = material;
    await agent.classifyQuestion({ question, material: inputMaterial, followUpResearchAvailable: false });
    assert.equal(requests[0]!.max_tokens, 1500);
    assert.equal(requests[0]!.reasoning_effort, "low");
    const messages = requests[0]!.messages as { content: string }[];
    assert.deepEqual(JSON.parse(messages[1]!.content).material.factBank, material.factBank);
    assert.equal((requests[0]!.response_format as { type: string }).type, "json_schema");
  } finally { globalThis.fetch = original; }
});

test("answer writer and reviewer receive the identical exact return passage alongside all source material", async () => {
  const original = globalThis.fetch; const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(requests.length === 1 ? candidate : review) } }] }), { status: 200 });
  };
  try {
    const agent = new QuestionAgent(new StructuredGenerationClient({ providerName: "test", baseUrl: "http://localhost:1234/v1", model: "test" }));
    const input = { question, material, classification, followUpResearchAvailable: false as const };
    await agent.answerQuestion(input); await agent.reviewAnswer({ ...input, candidate });
    assert.deepEqual(requests.map(request => request.max_tokens), [2500, 5000]);
    for (const request of requests) {
      const messages = request.messages as { content: string }[];
      const data = JSON.parse(messages[1]!.content);
      assert.deepEqual(data.returnToNarration, { interruptedPassage: "Here is the full explanation.", followingPassage: "Finished." });
      assert.deepEqual(data.material, material);
      assert.equal(request.reasoning_effort, "low");
    }
  } finally { globalThis.fetch = original; }
});

test("a truncated review is not accepted or retried even when its JSON claims approval", async () => {
  const original = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const index = requests.length - 1;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: index === 2 ? "length" : "stop", message: { content: JSON.stringify([classification, candidate, review][index]) } }],
      usage: { completion_tokens: 5000, completion_tokens_details: { reasoning_tokens: 4800 } },
    }), { status: 200 });
  };
  try {
    const agent = new QuestionAgent(new StructuredGenerationClient({ providerName: "test", baseUrl: "http://localhost:1234/v1", model: "test" }));
    const recorder = new InMemoryGenerationTraceRecorder();
    await assert.rejects(new PresentationQuestionPipeline(agent, recorder).answer(material, question), /max_tokens=5000/);
    assert.equal(requests.length, 3);
    assert.equal(recorder.records.at(-1)?.status, "failed");
    assert.equal(recorder.records.at(-1)?.artifact, undefined);
  } finally { globalThis.fetch = original; }
});
