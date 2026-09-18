import assert from "node:assert/strict";
import test from "node:test";
import { generationCompletionBudget, OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import type { FactCurationAgentInput } from "@slidespeech/types";

test("fact completion capacity scales with structural workload, with a stable floor and hard ceiling", () => {
  for (const [requirements, slides, expected] of [[0, 0, 10000], [6, 3, 10000], [6, 4, 11000], [11, 0, 12500], [16, 8, 14000], [50, 100, 14000]]) {
    assert.equal(generationCompletionBudget("fact-curation", { requirementCount: requirements!, slideCount: slides }), expected);
  }
  assert.equal(generationCompletionBudget("fact-curation", { requirementCount: 8 }), 11000);
});

test("increased fact capacity preserves full evidence, structured output and low reasoning", async () => {
  // Provider transport fixture: only fields used in schema construction are needed.
  const input = { classification: { subject: "An unrelated topic", requestedSlideCount: 8 },
    researchPlan: { evidenceRequirements: Array.from({ length: 16 }, (_, i) => ({ id: `requirement_${i}`, description: `Required material ${i}` })) },
    evidence: { sources: [{ id: "source_one", title: "Unabridged source context" }], snippets: [{ id: "snippet_one", text: "Full multilingual source context: åäö 日本語." }] },
  } as unknown as FactCurationAgentInput;
  const original = globalThis.fetch;
  let request: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ facts: [], uncertainties: [] }) } }] }), { status: 200 });
  };
  try {
    await new OpenAICompatibleGenerationAgent({ providerName: "test", model: "test", baseUrl: "http://localhost:1234/v1", reasoningEffort: "low" }).curateFacts(input);
    assert.equal(request?.max_tokens, 14000);
    assert.equal(request?.reasoning_effort, "low");
    assert.equal((request?.response_format as { type: string }).type, "json_schema");
    assert.deepEqual(JSON.parse((request?.messages as { content: string }[])[1]!.content), input);
  } finally { globalThis.fetch = original; }
});
