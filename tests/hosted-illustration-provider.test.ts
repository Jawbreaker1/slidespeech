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

test("extracts lazy-loaded and srcset image candidates", () => {
  const html = `
    <html>
      <body>
        <img data-src="/images/company-team.webp" alt="Company team at work" />
        <img srcset="/images/hero-small.jpg 640w, /images/hero-large.jpg 1280w" alt="Hero image" />
      </body>
    </html>
  `;

  const candidates = extractImageCandidates(html, "https://example.com/about");
  const urls = candidates.map((candidate) => candidate.url);

  assert.ok(urls.includes("https://example.com/images/company-team.webp"));
  assert.ok(urls.includes("https://example.com/images/hero-small.jpg"));
  assert.ok(urls.includes("https://example.com/images/hero-large.jpg"));
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

  assert.match(query, /state/i);
  assert.match(query, /machines/i);
  assert.match(query, /interactive/i);
  assert.match(query, /\bimage\b/i);
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

test("illustration search query compacts noisy teaching prompts into topical terms", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "Spongebob Squarepants first episode that was aired in 1999",
    learningGoal: "See the cultural impact and legacy of the 1999 debut and why it matters.",
    keyPoints: ["Pilot", "Premiere", "Bikini Bottom"],
    beginnerExplanation: "Start with the first episode.",
    advancedExplanation: "Then connect it to the broader media moment.",
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
          prompt:
            "Create an educational visual for Spongebob Squarepants first episode that was aired in 1999 that reinforces See the cultural impact and legacy of the 1999 debut and why it matters..",
          altText: "Spongebob Squarepants first episode that was aired in 1999 illustration",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "The Birth of Bikini Bottom: SpongeBob's 1999 Premiere",
      topic: "Spongebob Squarepants first episode that was aired in 1999",
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
        topic: "Spongebob Squarepants first episode that was aired in 1999",
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

  assert.match(query, /spongebob/i);
  assert.match(query, /1999/i);
  assert.match(query, /\bimage\b/i);
  assert.doesNotMatch(query, /create an educational visual/i);
  assert.doesNotMatch(query, /that reinforces/i);
});

test("illustration search query keeps title anchors when deck topic is overly generic", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 1,
    title: "How the premiere introduced the main characters",
    learningGoal: "Understand how the first episode establishes SpongeBob's world.",
    keyPoints: ["SpongeBob", "Squidward", "Bikini Bottom"],
    beginnerExplanation: "The premiere introduces the show's core cast and tone.",
    advancedExplanation: "The debut episode sets the pattern for the comedic world.",
    visuals: {
      layoutTemplate: "three-step-flow",
      accentColor: "1C7C7D",
      cards: [],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [
        {
          id: "slot_1",
          prompt: "Editorial image about the SpongeBob premiere.",
          altText: "SpongeBob premiere illustration",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const query = buildIllustrationSearchQuery({
    deck: {
      id: "deck_1",
      title: "SpongeBob SquarePants: The 1999 Premiere",
      topic: "The first episode that aired in 1999",
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
        topic: "The first episode that aired in 1999",
        sourceIds: [],
      },
      slides: [slide],
      createdAt: "2026-04-19T22:00:00.000Z",
      updatedAt: "2026-04-19T22:00:00.000Z",
      metadata: {
        estimatedDurationMinutes: 6,
        tags: [],
        language: "en",
      },
    },
    slide,
  });

  assert.match(query, /spongebob/i);
  assert.match(query, /squarepants/i);
  assert.match(query, /1999/i);
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

test("illustration ranking strongly penalizes forum and classifieds results", () => {
  const slide = SlideSchema.parse({
    id: "slide_1",
    order: 0,
    title: "SpongeBob's 1999 premiere",
    learningGoal: "Ground the topic in the actual debut.",
    keyPoints: ["Help Wanted", "1999", "Nickelodeon"],
    beginnerExplanation: "This slide introduces the debut.",
    advancedExplanation: "This slide uses the original release context.",
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
          prompt: "SpongeBob 1999 premiere image",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "The Birth of Bikini Bottom: SpongeBob's 1999 Premiere",
    topic: "Spongebob Squarepants first episode that was aired in 1999",
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
      topic: "Spongebob Squarepants first episode that was aired in 1999",
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

  const forumScore = scoreSearchResultForIllustration(
    { deck, slide },
    {
      title: "FOR SALE - SpongeBob Bounce Round Moonbounce",
      url: "http://www.jlaforums.com/viewtopic.php?t=9513397",
      snippet: "Used and enjoyed SpongeBob squarepants moonbounce.",
    },
  );
  const referenceScore = scoreSearchResultForIllustration(
    { deck, slide },
    {
      title: "Help Wanted (SpongeBob SquarePants) - Wikipedia",
      url: "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
      snippet: "The first episode of SpongeBob SquarePants premiered in 1999.",
    },
  );

  assert.ok(referenceScore > forumScore);
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

    assert.equal(asset.kind, "curated");
    assert.equal(asset.sourceImageUrl, undefined);
    assert.equal(asset.sourcePageUrl, undefined);
    assert.match(asset.mimeType, /svg\+xml/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted illustration provider accepts a trusted source-page image with weak metadata when vision approves it", async () => {
  const slide = SlideSchema.parse({
    id: "slide_company_1",
    order: 0,
    title: "Who the company is",
    learningGoal: "Orient a newcomer to the company itself.",
    keyPoints: [
      "System Verification is a quality assurance company.",
      "The company supports software delivery with testing and QA services.",
      "The company works with customers in regulated and complex environments.",
    ],
    beginnerExplanation: "This slide introduces the company and its role.",
    advancedExplanation: "The slide frames the organization as a QA partner rather than an abstract concept.",
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
          prompt: "Editorial image for a software quality company onboarding slide",
          altText: "System Verification company introduction",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_company_1",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Company onboarding summary.",
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
      sourceIds: ["https://example.com/"],
    },
    slides: [slide],
    createdAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async search() {
      return [];
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async analyzeSlideImage() {
      return {
        summary: "This is a relevant company/team image for an onboarding slide.",
        isRelevant: true,
        relevanceScore: 0.48,
        visualIssues: [],
        pedagogicalHints: [],
      };
    },
    async analyzeDeckImages(input) {
      return Promise.all(input.slides.map((slideInput) => this.analyzeSlideImage(slideInput)));
    },
    async describeVisualIssues() {
      return [];
    },
    async extractPedagogicalVisualHints() {
      return [];
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url === "https://example.com/") {
      return new Response(
        '<html><body><img src="/uploads/12345.webp" /></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        },
      );
    }

    if (url === "https://example.com/uploads/12345.webp") {
      return new Response(Uint8Array.from([82, 73, 70, 70]), {
        status: 200,
        headers: {
          "content-type": "image/webp",
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

    assert.equal(asset.kind, "source");
    assert.equal(asset.sourcePageUrl, "https://example.com/");
    assert.equal(asset.sourceImageUrl, "https://example.com/uploads/12345.webp");
    assert.match(asset.mimeType, /^image\/webp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted illustration provider soft-accepts a trusted source-page image when vision transport fails", async () => {
  const slide = SlideSchema.parse({
    id: "slide_company_2",
    order: 0,
    title: "System Verification",
    learningGoal: "Show the company visually.",
    keyPoints: [
      "System Verification supports software quality assurance teams.",
      "The company works with delivery and verification workflows.",
      "Customers use the service to reduce release risk.",
    ],
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
          id: "slot_company_2",
          prompt: "Editorial image for a software quality company.",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });

  const deck = DeckSchema.parse({
    id: "deck_company_2",
    title: "System Verification",
    topic: "System Verification",
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
      sourceIds: ["https://example.com/"],
    },
    slides: [slide],
    createdAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async search() {
      return [];
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async analyzeSlideImage() {
      throw new Error("lmstudio-vision returned an empty response.");
    },
    async analyzeDeckImages(input) {
      return Promise.all(input.slides.map((slideInput) => this.analyzeSlideImage(slideInput)));
    },
    async describeVisualIssues() {
      return [];
    },
    async extractPedagogicalVisualHints() {
      return [];
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url === "https://example.com/") {
      return new Response(
        '<html><body><img src="/uploads/12345.webp" alt="Delivery team at work" /></body></html>',
        {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        },
      );
    }

    if (url === "https://example.com/uploads/12345.webp") {
      return new Response(Uint8Array.from([82, 73, 70, 70]), {
        status: 200,
        headers: {
          "content-type": "image/webp",
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

    assert.equal(asset.kind, "source");
    assert.equal(asset.sourcePageUrl, "https://example.com/");
    assert.equal(asset.sourceImageUrl, "https://example.com/uploads/12345.webp");
    assert.match(asset.mimeType, /^image\/webp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted illustration provider can recover a topical image via wikipedia fallback when search results are junk", async () => {
  const slide = SlideSchema.parse({
    id: "slide_sponge_1",
    order: 0,
    title: "Spongebob Squarepants first episode that was aired in 1999",
    learningGoal: "Ground the topic in the original debut.",
    keyPoints: ["Help Wanted", "1999", "Nickelodeon"],
    beginnerExplanation: "Start with the original episode.",
    advancedExplanation: "Then connect it to the first release context.",
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
          prompt: "SpongeBob 1999 premiere image",
          altText: "SpongeBob 1999 premiere",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_sponge_1",
    title: "The Birth of Bikini Bottom: SpongeBob's 1999 Premiere",
    topic: "Spongebob Squarepants first episode that was aired in 1999",
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
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async search() {
      return [
        {
          title: "FOR SALE - SpongeBob Bounce Round Moonbounce",
          url: "http://www.jlaforums.com/viewtopic.php?t=9513397",
          snippet: "Used and enjoyed SpongeBob squarepants moonbounce.",
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async analyzeSlideImage() {
      return {
        summary: "This is a relevant reference still for the episode topic.",
        isRelevant: true,
        relevanceScore: 0.68,
        visualIssues: [],
        pedagogicalHints: [],
      };
    },
    async analyzeDeckImages(input) {
      return Promise.all(input.slides.map((slideInput) => this.analyzeSlideImage(slideInput)));
    },
    async describeVisualIssues() {
      return [];
    },
    async extractPedagogicalVisualHints() {
      return [];
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url.startsWith("http://www.jlaforums.com/")) {
      return new Response("<html><body>No usable images here.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url.startsWith("https://en.wikipedia.org/w/index.php?search=")) {
      return new Response(
        '<html><body><a href="/wiki/Help_Wanted_(SpongeBob_SquarePants)">Help Wanted</a></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }

    if (url === "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)") {
      return new Response(
        '<html><head><meta property="og:image" content="https://upload.wikimedia.org/help-wanted.jpg" /></head><body></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }

    if (url === "https://upload.wikimedia.org/help-wanted.jpg") {
      return new Response(Uint8Array.from([255, 216, 255]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
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

    assert.equal(asset.kind, "source");
    assert.equal(
      asset.sourcePageUrl,
      "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
    );
    assert.equal(asset.sourceImageUrl, "https://upload.wikimedia.org/help-wanted.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted illustration provider soft-accepts wikipedia fallback when vision transport fails", async () => {
  const slide = SlideSchema.parse({
    id: "slide_sponge_2",
    order: 0,
    title: "Spongebob Squarepants first episode that was aired in 1999",
    learningGoal: "Ground the topic in the original debut.",
    keyPoints: ["Help Wanted", "1999", "Nickelodeon"],
    beginnerExplanation: "Start with the original episode.",
    advancedExplanation: "Then connect it to the first release context.",
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
          prompt: "SpongeBob 1999 premiere image",
          altText: "SpongeBob 1999 premiere",
          style: "editorial",
          tone: "accent",
        },
      ],
    },
  });
  const deck = DeckSchema.parse({
    id: "deck_sponge_2",
    title: "The Birth of Bikini Bottom: SpongeBob's 1999 Premiere",
    topic: "Spongebob Squarepants first episode that was aired in 1999",
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
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      sourceIds: [],
    },
    slides: [slide],
    createdAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async search() {
      return [];
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
        checkedAt: "2026-04-19T12:00:00.000Z",
      };
    },
    async analyzeSlideImage() {
      throw new Error("lmstudio-vision returned an empty response.");
    },
    async analyzeDeckImages(input) {
      return Promise.all(input.slides.map((slideInput) => this.analyzeSlideImage(slideInput)));
    },
    async describeVisualIssues() {
      return [];
    },
    async extractPedagogicalVisualHints() {
      return [];
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url.startsWith("https://en.wikipedia.org/w/index.php?search=")) {
      return new Response(
        '<html><body><a href="/wiki/Help_Wanted_(SpongeBob_SquarePants)">Help Wanted</a></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }

    if (url === "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)") {
      return new Response(
        '<html><head><meta property="og:image" content="https://upload.wikimedia.org/help-wanted.jpg" /></head><body></body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }

    if (url === "https://upload.wikimedia.org/help-wanted.jpg") {
      return new Response(Uint8Array.from([255, 216, 255]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
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

    assert.equal(asset.kind, "source");
    assert.equal(
      asset.sourcePageUrl,
      "https://en.wikipedia.org/wiki/Help_Wanted_(SpongeBob_SquarePants)",
    );
    assert.equal(asset.sourceImageUrl, "https://upload.wikimedia.org/help-wanted.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
