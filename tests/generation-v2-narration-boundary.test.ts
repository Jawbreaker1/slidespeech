import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import { createNarrationDecisionSchema, NarrationScriptSchema, narrationPassages, narrationPlaybackView } from "@slidespeech/types";
import type { NarrationReviewAgentInput, PublicationAgentInput } from "@slidespeech/types";
import { fidelityInput, fidelityCases } from "./fixtures/slide-fidelity";

function fixture(): NarrationReviewAgentInput {
  const { designs: _designs, ...material } = fidelityInput(fidelityCases[2]);
  return { ...material, sources: [], narrations: {
    schemaVersion: "2.0", artifactId: "scripts", createdAt: "2026-09-17T00:00:00.000Z",
    deckStrategyArtifactId: material.strategy.artifactId, slideDraftSetArtifactId: material.slides.artifactId,
    scripts: material.slides.slides.map((slide, index) => ({ slideId: slide.slideId,
      openingBridge: "Välkomna. Vi undersöker ett försök.",
      segments: ["I försöket grodde 80 procent av den provade frösatsen vid 22 grader.", "pausePrompts", "[Regie: warten]"],
      transitionOut: "Resultatet gäller just den provade satsen och förhållandena.",
      ...(index ? { questionInvitation: "Vilka frågor har ni?" } : {}),
      pausePrompts: ["A legacy cue that is NOT spoken."], sourceMentions: [],
    })),
  } };
}

test("new narration decisions contain speech and provenance, not unused delivery cues", () => {
  const input = fixture();
  const decision = { scripts: input.narrations.scripts.map(({ slideId: _id, sourceMentions: _sources, pausePrompts: _cues, ...script }) => ({
    ...script, sourceIndexes: [], questionInvitation: script.questionInvitation ?? null,
  })) };
  const schema = createNarrationDecisionSchema(input);
  assert.deepEqual(schema.parse(decision), decision);
  assert.equal(schema.safeParse({ scripts: decision.scripts.map(script => ({ ...script, pausePrompts: [] })) }).success, false);
  // Old immutable publications remain readable; their metadata never becomes speech.
  for (const script of input.narrations.scripts) assert.deepEqual(NarrationScriptSchema.parse(script), script);
});

test("review projection preserves every actual spoken character and passage, including defects", () => {
  const { narrations } = fixture();
  const original = structuredClone(narrations);
  const projected = narrationPlaybackView(narrations);
  assert.equal(projected.artifactId, narrations.artifactId);
  projected.scripts.forEach((script, index) => {
    assert.deepEqual(script.passages, narrationPassages(narrations.scripts[index]!));
    assert.deepEqual(Object.keys(script), ["slideId", "passages", "sourceMentions"]);
  });
  assert.deepEqual(narrations, original);
  // A legitimate discussion of delivery concepts must not be string-filtered either.
  const discussion = { ...narrations.scripts[0]!, segments: ["In this API, pausePrompts describes delivery cues; the term is relevant to this lesson."] };
  assert.equal(narrationPassages(discussion)[1], discussion.segments[0]);
});

for (const stage of ["narration", "publication"] as const) test(`${stage} reviewer receives the exact playback projection and complete factual context`, async t => {
  const input = fixture();
  const designs = fidelityInput(fidelityCases[2]).designs;
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://model.invalid/v1", model: "test" });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const sent = JSON.parse(body.messages[1].content);
    assert.equal(body.reasoning_effort, "low");
    assert.deepEqual(sent.narrations, narrationPlaybackView(input.narrations));
    for (const key of ["request", "classification", "factBank", "strategy", "slidePlans", "slides"] as const) {
      assert.deepEqual(sent[key], input[key]);
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      approved: false, score: 0.3, summary: "Spoken authoring instructions require revision.", issues: [], retryRecommended: true,
    }) } }] });
  });
  const result = stage === "narration" ? await agent.narration.reviewNarration(input)
    : await agent.publication.reviewPublication({ ...input, designs, reviews: [] } as unknown as PublicationAgentInput);
  assert.equal(result.value.approved, false);
});
