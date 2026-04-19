import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIllustrationSearchQuery,
  extractImageCandidates,
  extractImageCandidateUrls,
  HostedIllustrationProvider,
  scoreExtractedImageCandidate,
  scoreSearchResultForIllustration,
} from "../packages/providers/src/illustration/hosted-illustration-provider";
import {
  DeckSchema,
  SlideSchema,
  type VisionProvider,
  type WebResearchProvider,
} from "@slidespeech/types";

test("extracts og image and relative image urls", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/images/hero.png" />
      </head>
      <body>
        <img src="https://cdn.example.com/diagram.webp" />
        <img src="/assets/logo.svg" />
      </body>
    </html>
  `;

  const urls = extractImageCandidateUrls(html, "https://example.com/post");

  assert.ok(urls.includes("https://example.com/images/hero.png"));
  assert.ok(urls.includes("https://cdn.example.com/diagram.webp"));
  assert.ok(!urls.some((url) => /logo\.svg/i.test(url)));
});

test("extracts image candidate metadata from img tags", () => {
  const html = `
    <html>
      <body>
        <img
          src="/images/corrupted-blood-players.jpg"
          alt="World of Warcraft players spreading the Corrupted Blood debuff"
          title="Corrupted Blood incident"
        />
      </body>
    </html>
  `;

  const candidates = extractImageCandidates(html, "https://example.com/post");

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0]?.url,
    "https://example.com/images/corrupted-blood-players.jpg",
  );
  assert.match(
    candidates[0]?.altText ?? "",
    /World of Warcraft players spreading the Corrupted Blood debuff/i,
  );
  assert.match(candidates[0]?.title ?? "", /Corrupted Blood incident/i);
});

test("builds illustration search query from deck and slide context", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Why state machines help",
    learningGoal: "Give the learner a strong first mental model.",
    keyPoints: ["State", "Transition", "Control flow"],
    beginnerExplanation: "Start with simple ideas.",
    advancedExplanation: "Add architecture details later.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "A modern editorial illustration of an AI presenter resuming after interruption.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "State machines",
      topic: "State machines for interactive AI teaching",
      summary: "Summary",
      pedagogicalProfile: {
        audienceLevel: "beginner",
        tone: "supportive and concrete",
        pace: "balanced",
        preferredExampleStyle: "real_world",
        wantsFrequentChecks: true,
        detailLevel: "standard",
      },
      source: {
        type: "topic",
        topic: "State machines for interactive AI teaching",
        sourceIds: [],
      },
      slides: [slide],
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 6,
        tags: [],
        language: "en",
      },
    },
    slide,
  });

  assert.match(query, /State machines for interactive AI teaching/i);
  assert.match(query, /Why state machines help/i);
  assert.match(query, /illustration/i);
});

test("illustration search query includes source host hints when source urls exist", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Company overview",
    learningGoal: "Show the company visually.",
    keyPoints: ["Quality", "Operations", "Insights"],
    beginnerExplanation: "Company intro.",
    advancedExplanation: "Company detail.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Editorial image for a software quality company.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "System Verification",
      topic: "Company presentation - System Verification",
      summary: "Summary",
      pedagogicalProfile: {
        audienceLevel: "beginner",
        tone: "supportive and concrete",
        pace: "balanced",
        preferredExampleStyle: "real_world",
        wantsFrequentChecks: true,
        detailLevel: "standard",
      },
      source: {
        type: "mixed",
        topic: "System Verification",
        sourceIds: ["https://www.systemverification.com/"],
      },
      slides: [slide],
      createdAt: "2026-04-11T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 6,
        tags: [],
        language: "en",
      },
    },
    slide,
  });

  assert.match(query, /systemverification/i);
});

test("illustration ranking penalizes irrelevant low-quality domains", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Welcome to Volvo Cars",
    learningGoal: "Introduce Volvo visually.",
    keyPoints: ["Cars", "Safety", "Design"],
    beginnerExplanation: "Volvo is a car brand.",
    advancedExplanation: "Volvo builds passenger vehicles.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imagePrompt: "Editorial photo of a Volvo car",
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Photo of a Volvo car on a road",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "Volvo Cars",
    topic: "Make a presentation about Volvo for children",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Make a presentation about Volvo for children",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-11T10:00:00.000Z",
    updatedAt: "2026-04-11T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 6,
      tags: [],
      language: "en",
    },
  });

  const officialResult = {
    title: "Volvo Cars - Official site",
    url: "https://www.volvocars.com/intl/",
    snippet: "Official Volvo cars homepage and model overview.",
  };
  const lowQualityResult = {
    title: "What does Volvo mean in Chinese?",
    url: "https://www.zhihu.com/en/answer/903952600",
    snippet: "An answer about the Chinese characters for a word.",
  };

  assert.ok(
    scoreSearchResultForIllustration(
      {
        deck,
        slide,
      },
      officialResult,
    ) >
      scoreSearchResultForIllustration(
        {
          deck,
          slide,
        },
        lowQualityResult,
      ),
  );
});

test("semantic image candidate scoring prefers topic-relevant metadata", () => {
  const desiredTokens = [
    "world",
    "warcraft",
    "corrupted",
    "blood",
    "incident",
    "players",
  ];
  const preferredHosts = ["wikipedia.org"];

  const relevantCandidate = {
    url: "https://upload.wikimedia.org/corrupted-blood-incident.jpg",
    altText: "World of Warcraft players during the Corrupted Blood incident",
    title: "Corrupted Blood",
  };
  const irrelevantCandidate = {
    url: "https://upload.wikimedia.org/wiki-icon.svg",
    altText: "Wikipedia wordmark",
    title: "Wikipedia",
  };

  assert.ok(
    scoreExtractedImageCandidate(
      relevantCandidate,
      preferredHosts,
      desiredTokens,
    ) >
      scoreExtractedImageCandidate(
        irrelevantCandidate,
        preferredHosts,
        desiredTokens,
      ),
  );
});

test("hosted illustration provider falls back when vision rejects a source image", async () => {
  const slide = SlideSchema.parse({
    id: "slide_wow_1",
    order: 0,
    title: "The Corrupted Blood plague event",
    learningGoal: "Understand why the Corrupted Blood incident mattered.",
    keyPoints: [
      "World of Warcraft players spread the debuff beyond the original raid.",
    ],
    beginnerExplanation: "A virtual disease escaped into the wider game world.",
    advancedExplanation: "Bugged pet behavior extended the disease vector.",
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "World of Warcraft Corrupted Blood incident",
          altText: "Corrupted Blood incident illustration",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_wow_1",
    title: "Virtual Pandemics: Lessons from World of Warcraft",
    topic: "World of Warcraft Corrupted Blood incident",
    summary: "World of Warcraft and the Corrupted Blood incident.",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "mixed",
      topic: "World of Warcraft Corrupted Blood incident",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-17T14:00:00.000Z",
    updatedAt: "2026-04-17T14:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: [],
      language: "en",
    },
  });

  const webResearchProvider: WebResearchProvider = {
    name: "test-web-research",
    async healthCheck() {
      return {
        provider: "test-web-research",
        ok: true,
        detail: "ok",
        checkedAt: "2026-04-17T14:00:00.000Z",
      };
    },
    async search() {
      return [
        {
          title: "Corrupted Blood incident",
          url: "https://example.com/corrupted-blood",
          snippet: "A World of Warcraft case study.",
        },
      ];
    },
    async fetch() {
      throw new Error("unused");
    },
    async summarizeFindings() {
      return "unused";
    },
  };

  const visionProvider: VisionProvider = {
    name: "test-vision",
    async healthCheck() {
      return {
        provider: "test-vision",
        ok: true,
        detail: "ok",
        checkedAt: "2026-04-17T14:00:00.000Z",
      };
    },
    async analyzeSlideImage() {
      return {
        summary: "This is just a cropped wordmark, not a Warcraft scene.",
        isRelevant: false,
        relevanceScore: 0.05,
        visualIssues: ["The image is a wordmark crop rather than a Warcraft scene."],
        pedagogicalHints: [],
      };
    },
    async analyzeDeckImages(input) {
      return Promise.all(input.slides.map((slideInput) => this.analyzeSlideImage(slideInput)));
    },
    async describeVisualIssues() {
      return ["The image is a wordmark crop rather than a Warcraft scene."];
    },
    async extractPedagogicalVisualHints() {
      return [];
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url === "https://example.com/corrupted-blood") {
      return new Response(
        '<html><body><img src="/images/bad-crop.png" alt="Wikipedia wordmark crop" /></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        },
      );
    }

    if (url === "https://example.com/images/bad-crop.png") {
      return new Response(Uint8Array.from([137, 80, 78, 71]), {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const provider = new HostedIllustrationProvider({
      webResearchProvider,
      visionProvider,
      timeoutMs: 1000,
    });

    const asset = await provider.renderSlideIllustration({
      deck,
      slide,
    });

    assert.equal(asset.sourceImageUrl, undefined);
    assert.equal(asset.sourcePageUrl, undefined);
    assert.match(asset.mimeType, /svg\+xml/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
