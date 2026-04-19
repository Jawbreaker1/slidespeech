import test from "node:test";
import assert from "node:assert/strict";

import { LMStudioVisionProvider } from "../packages/providers/src/vision/lmstudio-vision-provider";

const createVisionResponse = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              '{"summary":"ok","isRelevant":true,"relevanceScore":0.8,"visualIssues":[],"pedagogicalHints":[]}',
          },
        },
      ],
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

test("lmstudio vision provider preserves inline data-url payloads for lm studio", async () => {
  const provider = new LMStudioVisionProvider({
    baseUrl: "http://lmstudio.test/v1",
    model: "vision-model",
    timeoutMs: 5000,
  });

  const originalFetch = globalThis.fetch;
  let capturedPayload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/chat/completions")) {
      capturedPayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return createVisionResponse();
    }

    throw new Error(`Unexpected fetch target: ${String(input)}`);
  }) as typeof fetch;

  try {
    await provider.analyzeSlideImage({
      slideId: "slide-1",
      topic: "World of Warcraft",
      slideTitle: "Corrupted Blood",
      learningGoal: "Explain how the incident spread.",
      keyPoints: ["Players carried the debuff into cities."],
      imageDataUrl: "data:image/png;base64,QUJDRA==",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const userMessage = (capturedPayload?.messages as Array<Record<string, unknown>>)[1];
  const imagePart = (userMessage?.content as Array<Record<string, unknown>>)[1];
  assert.equal(
    (imagePart?.image_url as Record<string, unknown>)?.url,
    "data:image/png;base64,QUJDRA==",
  );
});

test("lmstudio vision provider fetches remote images and sends data-url payloads", async () => {
  const provider = new LMStudioVisionProvider({
    baseUrl: "http://lmstudio.test/v1",
    model: "vision-model",
    timeoutMs: 5000,
  });

  const originalFetch = globalThis.fetch;
  let capturedPayload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://example.com/image.png") {
      return new Response(Buffer.from("image-bytes"), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
        },
      });
    }

    if (url.endsWith("/chat/completions")) {
      capturedPayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return createVisionResponse();
    }

    throw new Error(`Unexpected fetch target: ${url}`);
  }) as typeof fetch;

  try {
    await provider.analyzeSlideImage({
      slideId: "slide-2",
      topic: "System Verification",
      slideTitle: "Who the company is",
      learningGoal: "Explain what the company does.",
      keyPoints: ["The company provides QA services."],
      imageUrl: "https://example.com/image.png",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const userMessage = (capturedPayload?.messages as Array<Record<string, unknown>>)[1];
  const imagePart = (userMessage?.content as Array<Record<string, unknown>>)[1];
  assert.equal(
    (imagePart?.image_url as Record<string, unknown>)?.url,
    `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`,
  );
});
