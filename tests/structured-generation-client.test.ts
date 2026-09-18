import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  FactBankDecisionJsonSchema,
  PromptClassificationDecisionJsonSchema,
  ResearchPlanSchema,
} from "@slidespeech/types";
import { OpenAICompatibleGenerationAgent, StructuredGenerationClient } from "../packages/providers/src/generation-v2";
import { OpenAICompatibleLLMProvider } from "../packages/providers/src/llm/openai-compatible";

const withServer = async (
  handler: Parameters<typeof createServer>[0],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not expose a TCP port.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("classification corrects contradictory source intent once without rewriting the model decision", async (t) => {
  const requests: Array<Record<string, any>> = [];
  const decision = {
    subject: "A company", language: "sv", audience: "New colleagues", presentationGoal: "Explain the company",
    deckMode: "onboarding", sourceCandidateIndexes: [0], requestedCoverage: [], presentationDirections: [],
    requestedSlideCount: null, requestedDurationMinutes: null, visualPreference: null, voicePreference: null,
    openQuestions: [], requiresUserClarification: false, clarificationReason: null,
  };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      ...decision, groundingMode: requests.length === 1 ? "web-research" : "mixed",
    }) } }] }), { status: 200 });
  });
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://localhost/v1", model: "test", reasoningEffort: "low" });
  const result = await agent.classifyPrompt({ schemaVersion: "2.0", artifactId: "request", createdAt: "2026-09-17T12:00:00.000Z",
    request: { topic: "Beskriv example.com" }, explicitUrls: [], sourceCandidates: [{ text: "example.com", url: "https://example.com/" }],
  });
  assert.equal(requests.length, 2);
  assert.equal(result.value.groundingMode, "mixed");
  assert.deepEqual(result.value.sourceCandidateIndexes, [0]);
  assert.ok(requests[1]!.messages.at(-1).content.includes("Grounding mode must account for"));
  for (const request of requests) assert.equal(request.reasoning_effort, "low");
});

for (const invalidSelection of [
  [{ candidateIndex: 2, rationale: "Outside this batch.", priority: 0 }],
  [
    { candidateIndex: 0, rationale: "First candidate.", priority: 0 },
    { candidateIndex: 1, rationale: "Second candidate.", priority: 1 },
  ],
]) {
  test(`source selection supplies and enforces batch bounds (${invalidSelection.length} selections)`, async (t) => {
    const requests: Array<Record<string, any>> = [];
    const validSelection = [{ candidateIndex: 1, rationale: "Within the supplied bounds.", priority: 0 }];
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify({
          canUseCandidates: true,
          blockingReason: null,
          selectedCandidates: requests.length === 1 ? invalidSelection : validSelection,
        }) },
      }] }), { status: 200 });
    });
    const target = { id: "target", kind: "web-search" as const, query: "Evidence", purpose: "Answer the research question.", priority: 0 };
    const agent = new OpenAICompatibleGenerationAgent({ providerName: "test", baseUrl: "http://localhost/v1", model: "test", reasoningEffort: "low" });
    const result = await agent.selectResearchSources({
      researchPlan: ResearchPlanSchema.parse({
        schemaVersion: "2.0", artifactId: "plan", createdAt: "2026-09-14T12:00:00.000Z",
        requestArtifactId: "request", classificationArtifactId: "classification",
        canExecute: true, blockingReason: null, requiresExternalResearch: true,
        researchQuestions: [{ id: "question", question: "What supports the request?", coverageRequirementIds: [] }],
        evidenceRequirements: [{ id: "requirement", description: "Support for the request.", required: true, coverageRequirementIds: [] }],
        sourceTargets: [target], stopCriteria: { maximumSources: 2, maximumPagesPerDomain: 2 }, knownRiskAreas: [],
      }),
      target,
      candidates: ["one", "two"].map((name) => ({
        url: `https://example.com/${name}`, title: name, context: "Candidate source.",
        origin: "search-result" as const, discoveredFromUrl: null,
      })),
      maximumSelections: 1,
    });

    assert.deepEqual(result.value.selectedCandidates, validSelection);
    assert.equal(requests.length, 2, "Only the existing bounded format correction is used.");
    for (const request of requests) {
      const schema = request.response_format.json_schema.schema;
      assert.equal(schema.properties.selectedCandidates.maxItems, 1);
      assert.equal(schema.properties.selectedCandidates.items.properties.candidateIndex.maximum, 1);
      assert.equal(request.messages[0].content.includes(JSON.stringify(schema)), true);
      assert.equal(request.reasoning_effort, "low");
    }
  });
}

test("structured client sends JSON Schema and reports model token telemetry", async () => {
  let requestBody: Record<string, unknown> | undefined;
  await withServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ mode: "onboarding" }),
                reasoning_content: "Internal reasoning is not parsed as output.",
              },
            },
          ],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 30,
            total_tokens: 110,
            completion_tokens_details: { reasoning_tokens: 20 },
          },
        }),
      );
    });
  }, async (baseUrl) => {
    const client = new StructuredGenerationClient({
      providerName: "test-provider",
      baseUrl,
      model: "test-model",
      reasoningEffort: "none",
    });
    const result = await client.complete({
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        properties: {
          mode: { type: "string", description: "The classified presentation mode." },
          score: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["mode"],
        additionalProperties: false,
      },
      system: "Return the schema.",
      user: "Classify this.",
      maxTokens: 200,
      parse: (value) => value as { mode: string },
    });

    assert.deepEqual(result.value, { mode: "onboarding" });
    assert.equal(result.telemetry.reasoningTokens, 20);
  });

  const responseFormat = requestBody?.response_format as
    | Record<string, unknown>
    | undefined;
  assert.equal(responseFormat?.type, "json_schema");
  assert.equal(requestBody?.reasoning_effort, "none");
  assert.equal(requestBody?.chat_template_kwargs, undefined);
  const contract = (responseFormat?.json_schema as { schema: unknown }).schema;
  const messages = requestBody?.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content.includes(JSON.stringify(contract)), true);
  assert.equal(messages[1]?.content, "Classify this.");
});

test("structured client fails closed instead of treating reasoning as content", async () => {
  await withServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "",
              reasoning_content: JSON.stringify({ mode: "onboarding" }),
            },
          },
        ],
      }),
    );
  }, async (baseUrl) => {
    const client = new StructuredGenerationClient({
      providerName: "test-provider",
      baseUrl,
      model: "test-model",
    });

    await assert.rejects(
      client.complete({
        schemaName: "test_schema",
        jsonSchema: { type: "object" },
        system: "Return the schema.",
        user: "Classify this.",
        maxTokens: 20,
        parse: (value) => value,
      }),
      /returned no structured content/,
    );
  });
});

for (const [label, content] of [
  ["reasoning-only", ""],
  ["partial JSON", "{\n"],
  ["parseable JSON", '{"approved":true}'],
] as const) {
  test(`structured client rejects token exhaustion without parsing or retrying ${label}`, async (t) => {
    let requests = 0;
    let parses = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests += 1;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content, reasoning_content: "Unfinished review." },
        }],
        usage: {
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      }));
    });
    const client = new StructuredGenerationClient({
      providerName: "test-provider",
      baseUrl: "http://localhost:1234/v1",
      model: "test-model",
    });
    await assert.rejects(client.complete({
      schemaName: "review_schema",
      jsonSchema: { type: "object" },
      system: "Review the input.",
      user: "Input to review.",
      maxTokens: 20,
      parse: (value) => { parses += 1; return value; },
    }), /token limit.*review_schema.*completion_tokens=20.*reasoning_tokens=15/);
    assert.equal(requests, 1);
    assert.equal(parses, 0);
  });
}

test("structured client retries malformed schema output with parser feedback", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  await withServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >,
      );
      const corrected = requestBodies.length === 2;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  canUseCandidates: true,
                  selectedCandidates: corrected ? [0] : [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      );
    });
  }, async (baseUrl) => {
    const client = new StructuredGenerationClient({
      providerName: "test-provider",
      baseUrl,
      model: "test-model",
    });
    const result = await client.complete({
      schemaName: "selection_schema",
      jsonSchema: { type: "object" },
      system: "Return the schema.",
      user: "Select candidates.",
      maxTokens: 100,
      parse: (value) => {
        const decision = value as {
          canUseCandidates: boolean;
          selectedCandidates: number[];
        };
        if (
          decision.canUseCandidates &&
          decision.selectedCandidates.length === 0
        ) {
          throw new Error("A usable candidate set requires a selection.");
        }
        return decision;
      },
    });

    assert.deepEqual(result.value.selectedCandidates, [0]);
    assert.equal(result.telemetry.totalTokens, 30);
  });

  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies.map((body) => body.reasoning_effort), ["low", "low"]);
  for (const body of requestBodies) {
    const format = body.response_format as { json_schema: { schema: unknown } };
    const messages = body.messages as Array<{ content: string }>;
    assert.equal(messages[0]?.content.includes(JSON.stringify(format.json_schema.schema)), true);
  }
  const retryMessages = requestBodies[1]?.messages as
    | Array<Record<string, unknown>>
    | undefined;
  assert.equal(retryMessages?.length, 4);
  assert.match(
    String(retryMessages?.[3]?.content),
    /requires a selection/,
  );
});

test("generation sampler schemas retain constraints for prompting and runtime validation", () => {
  const classificationSchema = JSON.stringify(
    PromptClassificationDecisionJsonSchema,
  );
  const factBankSchema = JSON.stringify(FactBankDecisionJsonSchema);

  assert.match(classificationSchema, /"minLength":1/);
  assert.match(classificationSchema, /"maxItems":50/);
  assert.match(factBankSchema, /"evidenceSnippetIds":\{"type":"array"/);
  assert.doesNotMatch(factBankSchema, /"evidenceSnippetSelection"/);
  assert.doesNotMatch(classificationSchema, /"maxLength"/);
  assert.doesNotMatch(factBankSchema, /"maxLength"/);
});

test("LM Studio runtime text, JSON and tool requests explicitly use low reasoning", async (t) => {
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{
      finish_reason: "stop",
      message: {
        content: '{"ok":true}',
        tool_calls: [{ function: { name: "result", arguments: '{"ok":true}' } }],
      },
    }] }), { headers: { "Content-Type": "application/json" } });
  });
  class RuntimeProbe extends OpenAICompatibleLLMProvider {
    async probe() {
      await this.chatText([{ role: "user", content: "Test." }], { tokenAttempts: [32] });
      await this.chatJson({
        schemaName: "result", system: "Test.", user: "Test.",
        parse: (value) => value, tokenAttempts: [32],
      });
      await this.chatToolCall({
        functionName: "result", functionDescription: "Test.", parameters: {},
        messages: [{ role: "user", content: "Test." }],
        parse: (value) => value, tokenAttempts: [32],
      });
    }
  }
  await new RuntimeProbe({
    providerName: "lmstudio", baseUrl: "http://localhost:1234/v1", model: "test",
  }).probe();
  assert.deepEqual(bodies.map((body) => body.reasoning_effort), ["low", "low", "low"]);
  assert.ok(bodies.every((body) => body.chat_template_kwargs === undefined));
});
