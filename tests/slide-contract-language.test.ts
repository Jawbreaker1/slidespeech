import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../packages/providers/src/llm/openai-compatible";
import { buildNarrationFromPlainText } from "../packages/providers/src/llm/narration-review-normalization";

const {
  buildSlideFromPlainText,
  assessGeneratedSlideDraft,
  applyPlanDrivenDeckShape,
  buildSlideContracts,
  resolveSourceBackedCaseAnchor,
  buildContractAnchoredKeyPoints,
  buildContractLearningGoal,
  buildContractTitle,
  buildOutlineDeckSummary,
  buildOrientationSlideFromContext,
  buildProceduralOrientationKeyPoints,
  buildRoleSpecificSlideRecoveryFromContext,
  normalizeDeck,
  normalizePresentationPlan,
  shouldUseDeterministicHowWorksSlide,
  shouldUseDeterministicSubjectOverviewSlide,
  toStringArray,
} = __testables;

test("procedural learning goals use direct concrete guidance instead of awkward understand phrasing", () => {
  const introGoal = buildContractLearningGoal(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Essential ingredients for a balanced salsa",
    },
  );

  const qualityGoal = buildContractLearningGoal(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 3,
      label: "quality",
      kind: "procedural-quality",
      focus: "Taste, texture, and adjustment",
    },
  );

  assert.match(introGoal, /^A good salsa dip\b/);
  assert.match(qualityGoal, /^Taste\b/);
  assert.doesNotMatch(qualityGoal, /\bhow to\b/i);
  assert.doesNotMatch(qualityGoal, /\bmain ingredients or materials\b/i);
  assert.doesNotMatch(qualityGoal, /\bpractical cues that show\b/i);
});

test("procedural final slides close with questions only when marked final", () => {
  const finalGoal = buildContractLearningGoal(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 3,
      isFinal: true,
      label: "quality",
      kind: "procedural-quality",
      focus: "Taste, texture, and adjustment",
    },
  );
  const finalPoints = buildContractAnchoredKeyPoints(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
    },
    {
      index: 3,
      isFinal: true,
      label: "quality",
      kind: "procedural-quality",
      focus: "Taste, texture, and adjustment",
    },
    [
      "Final texture shows whether the salsa has enough balance.",
      "Small seasoning changes can correct an uneven result.",
      "Serving temperature affects how the finished salsa tastes.",
    ],
  );

  assert.match(finalGoal, /taste and texture checks/i);
  assert.match(finalPoints.join(" "), /strongest finish|balanced flavor|serving chip/i);
});

test("procedural four-slide decks start with an orientation contract before ingredients", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
        contentMode: "procedural",
      },
      targetSlideCount: 4,
    },
    4,
  );

  assert.equal(contracts[0]?.kind, "orientation");
  assert.equal(contracts[1]?.kind, "procedural-ingredients");
  assert.equal(contracts[2]?.kind, "procedural-steps");
  assert.equal(contracts[3]?.kind, "procedural-quality");
});

test("procedural orientation key points stay declarative and non-imperative", () => {
  const points = buildProceduralOrientationKeyPoints("Making the perfect salsa dip");

  assert.equal(points.length, 3);
  for (const point of points) {
    assert.match(point, /^[A-Z]/);
    assert.match(point, /[.!?]$/);
    assert.doesNotMatch(point, /^(Use|Start|Taste|Add|Mix)\b/i);
    assert.doesNotMatch(point, /\bneeds a clear target\b/i);
    assert.doesNotMatch(point, /\bprocess is easier to control\b/i);
    assert.doesNotMatch(point, /\bcore inputs establish\b/i);
    assert.doesNotMatch(point, /\bpreparation order changes\b/i);
  }
  assert.match(points.join(" "), /fresh tomato|chip or spoon|excess tomato juice/i);
});

test("contract anchored key points avoid old template language and fragmentary focus echoes", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "Making the perfect salsa dip",
      intent: {
        subject: "Making the perfect salsa dip",
      },
    },
    {
      index: 2,
      label: "steps",
      kind: "procedural-steps",
      focus: "Key preparation steps",
      objective: "See what the main preparation steps change in making the perfect salsa dip.",
    },
    [
      "Key preparation steps",
      "The order of chopping, mixing, and resting changes texture and consistency in the final dip.",
      "Roasting chili and garlic first deepens flavor before the ingredients are combined.",
    ],
  );

  assert.equal(points.length, 3);
  for (const point of points) {
    assert.doesNotMatch(point, /\binfluences real outcomes connected to\b/i);
    assert.notEqual(point, "Key preparation steps.");
  }
});

test("outline deck summary avoids the old generic focus-on phrasing", () => {
  const summary = buildOutlineDeckSummary({
    topic: "Making the perfect salsa dip",
    intent: {
      subject: "Making the perfect salsa dip",
      contentMode: "procedural",
      presentationGoal: "Explain how ingredients, preparation, and adjustment shape a balanced salsa dip",
    },
    presentationBrief: "Create a short presentation about how to make the perfect salsa dip.",
    plan: {
      title: "Making the Perfect Salsa Dip",
      storyline: ["Ingredients", "Preparation", "Adjustment"],
      learningObjectives: [
        "Explain how ingredients shape flavor and texture",
        "Explain what the main preparation steps change",
        "Explain how tasting and adjustment affect balance",
      ],
      recommendedSlideCount: 4,
    },
  });

  assert.doesNotMatch(summary, /\bbecomes easier to understand when you focus on\b/i);
  assert.match(summary, /\bideas, examples, or consequences\b/i);
});

test("organization outline summaries use a clean onboarding sentence", () => {
  const summary = buildOutlineDeckSummary({
    topic: "System Verification",
    presentationBrief:
      "Create an onboarding presentation about our company. Use https://www.systemverification.com/ for grounding.",
    intent: {
      subject: "System Verification",
      presentationFrame: "organization",
      organization: "System Verification",
      framing: "onboarding presentation about our company",
    },
    plan: {
      title: "System Verification onboarding",
      recommendedSlideCount: 4,
      learningObjectives: [],
      storyline: [],
      audienceLevel: "beginner",
    },
  });

  assert.match(summary, /identity, operating model, capabilities, and one practical consequence/i);
  assert.doesNotMatch(summary, /subject or organization|customer-facing outcomes/i);
});

test("plain-text slide parsing accepts synonym section headers", () => {
  const slide = buildSlideFromPlainText(
    [
      "SLIDE TITLE: Essential ingredients",
      "LEARNING GOAL: See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
      "KEY POINTS:",
      "- Ripe tomatoes provide the bright acidic base of the dip.",
      "- Onion adds bite and crunch that changes the texture profile.",
      "- Chili heat changes how sharply the salsa lands on the palate.",
      "BEGINNER EXPLANATION: These ingredients shape the dip before any preparation choices matter.",
      "ADVANCED EXPLANATION: Their ratios determine whether the final mix stays bright, crisp, and balanced.",
      "EXAMPLES: Roma tomatoes, white onion, jalapeno, lime juice, and cilantro form a common fresh salsa base.",
      "LIKELY QUESTION: Why do ripe tomatoes matter so much?",
    ].join("\n"),
    {
      id: "slide-ingredients",
      order: 1,
      title: "Essential ingredients",
      learningGoal: "See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
      keyPoints: [],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      narrationPointCount: 3,
      visuals: {
        layoutTemplate: "cards",
        heroStatement: "",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    },
  );

  assert.ok(slide);
  assert.equal(slide?.title, "Essential ingredients");
  assert.equal(
    slide?.learningGoal,
    "See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
  );
  assert.equal(slide?.keyPoints.length, 3);
});

test("string array parsing keeps JSON arrays and hyphenated words intact", () => {
  const parsedJsonArray = toStringArray(
    '["The premiere established a long-form storytelling base.", "The series earned award-winning recognition over time.", "The 1999 airing stayed tied to Nickelodeon."]',
  );
  const parsedNestedJsonArray = toStringArray([
    '["The premiere established a long-form storytelling base.", "The series earned award-winning recognition over time.", "The 1999 airing stayed tied to Nickelodeon."]',
  ]);
  const parsedTruncatedJsonArray = toStringArray([
    '["The premiere established a long-form storytelling base.", "The series earned award-winning recognition over time.", "The 1999 airing stayed tied to Nickelodeon."',
  ]);

  assert.deepEqual(parsedJsonArray, [
    "The premiere established a long-form storytelling base.",
    "The series earned award-winning recognition over time.",
    "The 1999 airing stayed tied to Nickelodeon.",
  ]);
  assert.deepEqual(parsedNestedJsonArray, parsedJsonArray);
  assert.deepEqual(parsedTruncatedJsonArray, parsedJsonArray);

  const parsedBullets = toStringArray(
    [
      "- The premiere established a long-form storytelling base.",
      "- The series earned award-winning recognition over time.",
      "- The 1999 airing stayed tied to Nickelodeon.",
    ].join("\n"),
  );

  assert.deepEqual(parsedBullets, parsedJsonArray);
});

test("plain-text narration rejects leaked reasoning JSON", () => {
  const slide = {
    id: "slide_reasoning",
    order: 0,
    title: "VGR AI workshop",
    learningGoal: "See how VGR teams can use AI tools safely in daily work.",
    keyPoints: [
      "Project managers can use AI to summarize meeting notes into reviewable action items.",
      "Product owners can use AI to turn user feedback into backlog candidates.",
      "Test leads can use AI to draft scenarios that still need human validation.",
    ],
    beginnerExplanation:
      "AI tools can support VGR teams when outputs are reviewed before use.",
    advancedExplanation:
      "The safest workflow keeps AI-generated drafts traceable, checked, and tied to approved context.",
    examples: [],
    speakerNotes: [],
    visuals: {
      cards: [],
      callouts: [],
      diagramNodes: [],
    },
  } as any;
  const deck = {
    topic: "Using AI tools in daily work",
    metadata: { language: "en" },
    pedagogicalProfile: { audienceLevel: "beginner" },
    slides: [slide],
  } as any;

  const narration = buildNarrationFromPlainText(
    '{"thought":"The user wants spoken narration for a presentation slide. Do not use JSON. Write exactly 4 short paragraphs."}',
    slide,
    deck,
  );

  assert.equal(narration, null);
});

test("presentation plan normalization restores a distinct source-backed subject arc when storyline steps collapse", () => {
  const normalized = normalizePresentationPlan(
    {
      title: "Virtual plagues and disease spread",
      learningObjectives: [
        "Explain what happened.",
        "Explain why it mattered.",
      ],
      storyline: [
        "What happened",
        "What happened",
        "Why it mattered",
        "Why it mattered",
      ],
      recommendedSlideCount: 4,
      audienceLevel: "beginner",
    },
    {
      topic: "World of Warcraft",
      subject: "World of Warcraft",
      intent: {
        presentationFrame: "subject",
        explicitSourceUrls: ["https://en.wikipedia.org/wiki/Corrupted_Blood_incident"],
        focusAnchor: "Corrupted Blood plague event",
      },
      groundingHighlights: [
        "A raid boss curse escaped into cities when players teleported away and pets retained the debuff.",
      ],
    },
  ) as any;

  assert.deepEqual(normalized.storyline, [
    "What happened",
    "Corrupted Blood plague event",
    "Why the detail matters",
    "What it teaches",
  ]);
});

test("presentation plan normalization turns research-scaffolded output into a clean slide outline", () => {
  const normalized = normalizePresentationPlan(
    {
      title: "Research coverage goals: System Verification onboarding",
      learningObjectives: [
        "Research coverage goals: who the company is and what it offers.",
        "Curated grounding highlights: QA services and offices.",
      ],
      storyline: [
        "Research coverage goals: what System Verification does",
        "Curated grounding highlights: founded in 2002 and QA network",
        "External grounding summary: use source excerpts",
        "Explanation of QA delivery: integrating quality assurance into daily",
      ],
      recommendedSlideCount: 7,
      audienceLevel: "beginner",
    },
    {
      topic: "System Verification",
      subject: "System Verification",
      targetSlideCount: 7,
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation for new employees",
        explicitSourceUrls: ["https://www.systemverification.com/"],
        coverageRequirements: [
          "Who System Verification is",
          "What System Verification offers",
          "How System Verification works",
        ],
        audienceCues: ["new employees"],
        deliveryFormat: "presentation",
      },
      groundingCoverageGoals: [
        "Who System Verification is",
        "What System Verification offers",
      ],
    },
  ) as any;

  assert.equal(normalized.storyline.length, 7);
  assert.doesNotMatch(normalized.title, /research coverage goals/i);
  assert.ok(
    normalized.storyline.every(
      (beat: string) =>
        !/research coverage goals|curated grounding highlights|external grounding summary/i.test(
          beat,
        ) && !/^explanation of\b/i.test(beat),
    ),
  );
  assert.deepEqual(normalized.storyline.slice(0, 4), [
    "Who System Verification is",
    "Where System Verification operates",
    "How System Verification works",
    "What System Verification offers",
  ]);
});

test("organization onboarding contracts allocate distinct later-slide anchors", () => {
  const contracts = buildSlideContracts(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Quality assurance consulting for complex software teams",
          "QA operations, verification, and quality management support",
        ],
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Understand what System Verification is and why it matters.",
          "Explain the capabilities and services the company offers.",
          "Explain how delivery, QA operations, and verification support work in practice.",
          "Explain one practical example or customer outcome that shows the company's value.",
        ],
        storyline: [
          "Company overview",
          "Capabilities and services",
          "Delivery and QA operations",
          "Customer value example",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "QA operations and verification support for complex engineering teams",
        "Quality management and software testing services",
      ],
      groundingHighlights: [
        "Expert support for requirements in AI projects",
        "Global QA operations across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark",
        "Flexible QA services cover software testing and quality management",
        "Founding details, corporate structure, and primary market focus",
      ],
    },
    4,
  );

  assert.deepEqual(
    contracts.map((contract: { kind: string }) => contract.kind),
    ["orientation", "entity-operations", "entity-capabilities", "entity-value"],
  );

  const laterFoci = contracts
    .slice(1)
    .map((contract: { focus: string }) => contract.focus.trim().toLowerCase());
  assert.equal(new Set(laterFoci).size, laterFoci.length);
  assert.match(contracts[0]?.focus ?? "", /\bwho system verification is\b/i);
  assert.match(
    contracts[0]?.objective ?? "",
    /\boperating footprint\b|\bdelivery model\b|\bservice portfolio\b/i,
  );
  assert.notEqual(contracts[1]?.evidence ?? "", "");
  assert.notEqual(contracts[2]?.evidence ?? "", "");
  assert.doesNotMatch(
    contracts[3]?.evidence ?? "",
    /\bfounding details\b|\bcorporate structure\b|\bprimary market focus\b/i,
  );
  assert.match(
    contracts.at(-1)?.evidence ?? "",
    /AI projects|Sweden|software testing|customer value example/i,
  );
});

test("long organization onboarding contracts do not repeat operations as filler", () => {
  const contracts = buildSlideContracts(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an English onboarding presentation about System Verification for product owners, project managers, and test leads. Use https://www.systemverification.com/ for grounding.",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about System Verification",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Who System Verification is",
          "What System Verification offers",
          "Where System Verification operates",
          "How its QA and AI quality services work",
          "A closing slide inviting questions",
        ],
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 7,
        learningObjectives: [
          "Understand who System Verification is.",
          "Explain where System Verification operates.",
          "Explain the company's QA capabilities.",
          "Explain how delivery works in practice.",
          "Explain how AI quality services fit into the offer.",
          "Summarize the most important takeaway.",
          "Invite relevant audience questions.",
        ],
        storyline: [
          "Company overview",
          "Operating footprint",
          "Capabilities and services",
          "Delivery model",
          "AI quality services",
          "Key takeaway",
          "Questions and practical value",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "System Verification offers quality assurance, quality management, and quality operations services.",
        "System Verification combines QA expertise with AI-driven insights.",
      ],
      groundingHighlights: [
        "System Verification is a QA specialist that supports the development lifecycle with quality assurance and AI-driven insights.",
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "System Verification offers quality management, quality insights, quality operations, delivery, and QA consulting.",
      ],
    },
    7,
  );

  assert.deepEqual(
    contracts.map((contract: { kind: string }) => contract.kind),
    [
      "orientation",
      "entity-operations",
      "entity-capabilities",
      "coverage",
      "development",
      "synthesis",
      "entity-value",
    ],
  );
  assert.equal(
    contracts.filter((contract: { kind: string }) => contract.kind === "entity-operations")
      .length,
    1,
  );
  assert.equal(contracts.at(-1)?.kind, "entity-value");
});

test("organization onboarding contracts prefer grounded operational anchors over generic plan language", () => {
  const contracts = buildSlideContracts(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. Use https://www.systemverification.com/ for grounding.",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Quality assurance consulting for complex software teams",
          "QA operations, verification, and quality management support",
        ],
      },
      plan: {
        title: "System Verification overview",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain the company's value proposition.",
          "Explain the core value proposition of predictive testing, strategic intelligence, and resilient systems.",
          "Explain the key services offered, including advisory, workshops, and QA integration.",
          "Explain one practical customer outcome.",
        ],
        storyline: [
          "Company overview",
          "Core value proposition",
          "Services and capabilities",
          "Customer outcome",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Global QA operations across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark",
        "Delivery, QA operations, and verification support for complex engineering teams",
      ],
      groundingHighlights: [
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "Delivery teams integrate QA operations, verification support, and quality management into daily engineering work.",
        "Flexible QA services cover software testing, quality management, and project-specific advisory support.",
      ],
    },
    4,
  );

  assert.equal(contracts[1]?.kind, "entity-operations");
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.objective ?? ""}`,
    /\boperates\b|\bdelivery\b|\bwork is delivered\b|\bQA operations\b/i,
  );
  assert.doesNotMatch(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.objective ?? ""}`,
    /\bvalue proposition\b|\bnewcomer\b|\bwhat it offers\b/i,
  );
});

test("organization onboarding contracts keep operations, capabilities, and value seeds separated", () => {
  const contracts = buildSlideContracts(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. Use https://www.systemverification.com/ for grounding.",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Delivery model and Nordic operating footprint",
          "Test automation frameworks and advisory services",
          "Practical consequence of early risk identification",
        ],
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Understand who System Verification is, where it operates, and how it fits into day-to-day work.",
          "Explain how delivery, QA operations, and verification support work in practice.",
          "Explain the technical frameworks and advisory services that define the company's capabilities.",
          "Explain one practical consequence that shows the company's value.",
        ],
        storyline: [
          "Company overview",
          "Delivery and QA operations",
          "Capabilities and services",
          "Practical consequence",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "System Verification operates as a dedicated QA network across the Nordics with cross-regional delivery teams.",
        "System Verification uses Playwright, Selenium, Cypress, and Ranorex for automated testing and CI/CD integration.",
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
      ],
      groundingHighlights: [
        "System Verification operates as a dedicated QA network across the Nordics, coordinating cross-regional delivery teams and collaboration practices.",
        "System Verification integrates quality assurance into CI/CD pipelines using automation frameworks like Playwright, Selenium, Cypress, and Ranorex.",
        "System Verification validates data flows and custom features beyond standard ERP or CRM systems.",
        "During a custom ERP and CRM transformation, System Verification validated end-to-end data flows through targeted workshops.",
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
      ],
    },
    4,
  );

  assert.equal(contracts[1]?.kind, "entity-operations");
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.objective ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /operates|nordics|cross-regional|delivery teams|collaboration/i,
  );
  assert.doesNotMatch(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.objective ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /playwright|selenium|cypress|ranorex|framework|during a custom|client ci\/cd/i,
  );

  assert.equal(contracts[2]?.kind, "entity-capabilities");
  assert.match(
    `${contracts[2]?.focus ?? ""} ${contracts[2]?.objective ?? ""} ${contracts[2]?.evidence ?? ""}`,
    /playwright|selenium|cypress|ranorex|automation frameworks|advisory services|automated testing/i,
  );

  assert.equal(contracts[3]?.kind, "entity-value");
  assert.match(
    `${contracts[3]?.focus ?? ""} ${contracts[3]?.objective ?? ""} ${contracts[3]?.evidence ?? ""}`,
    /early risk|data flow validation|critical defects|practical consequence/i,
  );
  assert.doesNotMatch(
    `${contracts[3]?.focus ?? ""} ${contracts[3]?.objective ?? ""} ${contracts[3]?.evidence ?? ""}`,
    /QA network|Nordics|Playwright|Selenium|Cypress|Ranorex|CI\/CD|pipeline|framework|during a custom/i,
  );
});

test("organization deck titles are repaired away from marketing guide phrasing", () => {
  const normalized = normalizeDeck(
    {
      title: "System Verification: Your Guide to Nordic QA Excellence",
      summary: "A short onboarding deck.",
      slides: [],
    },
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. Use https://www.systemverification.com/ for grounding.",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [],
        storyline: [],
        audienceLevel: "beginner",
      },
      groundingHighlights: [],
      groundingCoverageGoals: [],
    },
  ) as { title: string };

  assert.equal(normalized.title, "System Verification onboarding");
});

test("organization no-case value slides reject framework and CI pipeline value stories", () => {
  const input = {
    topic: "System Verification",
    presentationBrief:
      "Create an onboarding presentation about our company. Use https://www.systemverification.com/ for grounding.",
    intent: {
      subject: "System Verification",
      presentationFrame: "organization" as const,
      organization: "System Verification",
      framing: "onboarding presentation about our company",
      presentationGoal:
        "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
      coverageRequirements: [
        "Delivery model and Nordic operating footprint",
        "Test automation frameworks and advisory services",
        "Practical consequence of early risk identification",
      ],
    },
    plan: {
      title: "System Verification onboarding",
      recommendedSlideCount: 4,
      learningObjectives: [
        "Understand who System Verification is.",
        "Explain delivery and QA operations.",
        "Explain the automation frameworks and advisory capabilities.",
        "Explain one practical consequence.",
      ],
      storyline: [
        "Company overview",
        "Delivery and QA operations",
        "Capabilities and services",
        "Practical consequence",
      ],
      audienceLevel: "beginner" as const,
    },
    groundingCoverageGoals: [
      "System Verification operates as a dedicated QA network across the Nordics with cross-regional delivery teams.",
      "System Verification integrates Playwright, Selenium, Cypress, and Ranorex into CI/CD pipelines to reduce deployment risk.",
      "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
    ],
    groundingHighlights: [
      "System Verification integrates Playwright, Selenium, Cypress, and Ranorex into CI/CD pipelines to reduce deployment risk.",
      "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
    ],
  };

  const contracts = buildSlideContracts(input, 4);
  const valueContract = contracts[3];
  const valueContractText = `${valueContract?.focus ?? ""} ${valueContract?.objective ?? ""} ${valueContract?.evidence ?? ""}`;

  assert.equal(valueContract?.kind, "entity-value");
  assert.match(valueContractText, /early risk|data flow validation|critical defects|practical consequence/i);
  assert.doesNotMatch(
    valueContractText,
    /Playwright|Selenium|Cypress|Ranorex|CI\/CD|pipeline|framework/i,
  );

  const shaped = applyPlanDrivenDeckShape(
    [
      {
        title: "System Verification",
        learningGoal: "See who System Verification is.",
        keyPoints: [
          "System Verification is a quality assurance organization.",
          "System Verification works across several markets.",
          "System Verification supports complex engineering teams.",
        ],
      },
      {
        title: "Where it operates and how it works",
        learningGoal: "See how System Verification works in practice.",
        keyPoints: [
          "System Verification delivers AI-powered quality solutions by embedding automated validation directly into client development pipelines.",
          "Cross-functional engineering teams collaborate through shared CI/CD environments to maintain continuous test coverage.",
          "The organization maintains a Nordic operational footprint that coordinates regional testing teams.",
        ],
      },
      {
        title: "We Work: advisory services and automation frameworks",
        learningGoal: "See what System Verification offers.",
        keyPoints: [
          "System Verification supports test automation frameworks.",
          "Playwright, Selenium, Cypress, and Ranorex belong on the capabilities slide.",
          "Advisory services and workshops define part of the capability mix.",
        ],
      },
      {
        title: "Data Flow Validation and Automated Testing Reduce Deployment Risk",
        learningGoal:
          "See how Playwright, Selenium, Cypress, and Ranorex in CI/CD pipelines create value.",
        keyPoints: [
          "Playwright and Selenium framework validation reduces deployment risk.",
          "CI/CD pipeline checks make automated testing part of the value story.",
          "Cypress and Ranorex coverage turns framework detail into customer impact.",
        ],
        examples: [
          "Validating data flows for custom features in a complex ERP transformation to ensure reliability.",
          "Identifying integration risks early in a system migration project to prevent deployment delays.",
        ],
      },
    ],
    input,
  );
  const shapedValue = shaped[3] as {
    title: string;
    learningGoal: string;
    keyPoints: string[];
    examples?: string[];
  };
  const shapedOperations = shaped[1] as {
    title: string;
    learningGoal: string;
    keyPoints: string[];
  };
  const shapedCapabilities = shaped[2] as { title: string };
  const shapedOperationsText = [
    shapedOperations.title,
    shapedOperations.learningGoal,
    ...shapedOperations.keyPoints,
  ].join(" ");
  const shapedValueText = [
    shapedValue.title,
    shapedValue.learningGoal,
    ...shapedValue.keyPoints,
    ...(shapedValue.examples ?? []),
  ].join(" ");

  assert.doesNotMatch(
    shapedOperationsText,
    /AI-powered|automated validation|CI\/CD|client development pipeline|Playwright|Selenium|Cypress|Ranorex|matters because/i,
  );
  assert.doesNotMatch(shapedCapabilities.title, /\bwe\b|\bour\b|\byou\b|\byour\b/i);
  assert.equal(shapedValue.title, "Practical consequence");
  assert.match(shapedValueText, /evidence-backed|practical consequence|early risk|critical defects/i);
  assert.doesNotMatch(
    shapedValueText,
    /Playwright|Selenium|Cypress|Ranorex|CI\/CD|pipeline|framework|customer|proprietary|portal|ERP transformation|migration project|deployment delays/i,
  );
});

test("organization orientation key points avoid leaking raw contract scaffolding", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
    },
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Who System Verification is",
      objective: "What System Verification offers and where it creates value",
    },
    [
      "System Verification provides independent software testing and quality assurance services.",
      "Its teams support clients with specialized QA expertise across complex engineering projects.",
      "What Systemverification does and where it creates value.",
    ],
  );

  assert.equal(points.length, 3);
  assert.doesNotMatch(
    points.join(" "),
    /What Systemverification does and where it creates value\b/i,
  );
});

test("organization onboarding orientation slide stays newcomer-facing instead of borrowing later-slide examples", () => {
  const orientedSlide = buildOrientationSlideFromContext(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Independent software testing and quality assurance services",
        ],
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Understand who System Verification is, what it offers, and where it fits.",
        ],
        storyline: [
          "Company overview",
          "Capabilities and services",
          "Delivery and QA operations",
          "Customer value example",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "QA operations and verification support for complex engineering teams",
      ],
      groundingHighlights: [
        "Global QA operations across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark",
        "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
      ],
    } as any,
    {
      id: "slide_intro",
      order: 0,
      title: "System Verification",
      learningGoal: "",
      keyPoints: [],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      visuals: {
        layoutTemplate: "hero-focus",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    } as any,
    {
      slides: [
        {
          id: "slide_intro",
          order: 0,
          title: "System Verification",
          learningGoal: "",
          keyPoints: [],
          speakerNotes: [],
          examples: [],
          likelyQuestions: [],
          beginnerExplanation: "",
          advancedExplanation: "",
          visuals: {
            layoutTemplate: "hero-focus",
            cards: [],
            callouts: [],
            diagramNodes: [],
            diagramEdges: [],
            imagePrompt: "",
            imageSlots: [],
          },
          requiredContext: [],
          dependenciesOnOtherSlides: [],
          visualNotes: [],
          sourceIds: [],
        },
        {
          id: "slide_later",
          order: 1,
          title: "Capabilities",
          learningGoal: "See what the company offers.",
          keyPoints: [
            "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
          ],
          speakerNotes: [],
          examples: [
            "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
          ],
          likelyQuestions: [],
          beginnerExplanation:
            "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
          advancedExplanation: "",
          visuals: {
            layoutTemplate: "hero-focus",
            cards: [],
            callouts: [],
            diagramNodes: [],
            diagramEdges: [],
            imagePrompt: "",
            imageSlots: [],
          },
          requiredContext: [],
          dependenciesOnOtherSlides: [],
          visualNotes: [],
          sourceIds: [],
        },
      ],
    } as any,
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Who System Verification is",
      objective: "What System Verification offers and how a newcomer should place it",
    },
  ) as any;

  assert.match(
    orientedSlide.learningGoal,
    /newcomer|who System Verification is|where it operates|day-to-day work/i,
  );
  assert.equal(orientedSlide.keyPoints.some((point: string) => /financial client|audit findings/i.test(point)), false);
  assert.equal(orientedSlide.examples.some((example: string) => /financial client|audit findings/i.test(example)), false);
  assert.match(
    orientedSlide.keyPoints.join(" "),
    /organization|onboarding|operates|delivery|quality assurance|creates value/i,
  );
});

test("mixed organization workshops keep the organization identity visible in the opening slide", () => {
  const orientedSlide = buildOrientationSlideFromContext(
    {
      topic: "Using AI tools in their daily work",
      presentationBrief:
        "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
      intent: {
        subject: "Using AI tools in their daily work",
        presentationFrame: "mixed",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        presentationGoal:
          "How project managers, product owners, and test leads at VGR can use AI tools in their daily work",
        audienceCues: ["project managers", "product owners", "test leads"],
        activityRequirement:
          "at least one practical exercise for the audience to complete during the workshop",
        coverageRequirements: [
          "Specific use cases for AI in drafting, summarizing, and testing",
          "VGR's constraints on data privacy and political decision-making protocols",
        ],
      },
      plan: {
        title: "AI Tools for Daily Work at VGR",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain how project managers, product owners, and test leads at VGR can use AI tools in daily work.",
        ],
        storyline: [
          "Why this matters at VGR",
          "Role-based use cases",
          "Constraints and safe use",
          "Practical exercise",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Practical use of AI tools in documentation, planning, and testing work at VGR",
      ],
      groundingHighlights: [
        "VGR handles politically governed public-sector work where documentation, decisions, and privacy constraints must remain reviewable.",
        "AI can help draft summaries, status updates, and test materials when sensitive information is excluded and outputs are reviewed.",
      ],
    } as any,
    {
      id: "slide_intro_vgr",
      order: 0,
      title: "Using AI tools in their daily work",
      learningGoal: "",
      keyPoints: [],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      visuals: {
        layoutTemplate: "hero-focus",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "How project managers, product owners, and test leads at VGR use AI tools in daily work",
      objective: "How AI tools fit into daily work at VGR",
    },
  ) as any;

  assert.match(orientedSlide.title, /VGR|Västra Götalandsregionen/i);
  assert.match(orientedSlide.learningGoal, /AI tools|checked first drafts/i);
  assert.doesNotMatch(orientedSlide.learningGoal, /\bwho Using AI tools in their daily work is\b/i);
  assert.match(orientedSlide.keyPoints[0] ?? "", /AI workflow|meeting notes|draft requirement/i);
});

test("organization orientation prefers concrete support over broad marketing copy when both exist", () => {
  const orientedSlide = buildOrientationSlideFromContext(
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
        coverageRequirements: [
          "Independent software testing and quality assurance services",
          "QA operations and verification support",
        ],
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Understand who System Verification is, what it offers, and where it fits.",
        ],
        storyline: [
          "Company overview",
          "Capabilities and services",
          "Delivery and QA operations",
          "Customer value example",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "QA operations and verification support for complex engineering teams",
      ],
      groundingHighlights: [
        "Wherever you are in your quality journey, our solutions help you move forward more safely and efficiently.",
        "Global QA operations across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark",
      ],
    } as any,
    {
      id: "slide_intro_sv",
      order: 0,
      title: "System Verification",
      learningGoal: "",
      keyPoints: [],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      visuals: {
        layoutTemplate: "hero-focus",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Who System Verification is",
      objective: "What System Verification offers and how a newcomer should place it",
    },
  ) as any;

  assert.doesNotMatch(orientedSlide.keyPoints.join(" "), /quality journey|move forward more safely/i);
  assert.match(
    orientedSlide.keyPoints.join(" "),
    /Sweden|Germany|Bosnia and Herzegovina|Poland|Denmark|quality assurance|QA operations|verification support/i,
  );
});

test("source-backed subject contracts allocate detail, implication, and takeaway roles", () => {
  const contracts = buildSlideContracts(
    {
      topic: "What World of Warcraft teaches us about disease spread",
      presentationBrief:
        "Create a short presentation about the Corrupted Blood incident in World of Warcraft. More information is available at https://en.wikipedia.org/wiki/Corrupted_Blood_incident",
      intent: {
        subject: "World of Warcraft",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://en.wikipedia.org/wiki/Corrupted_Blood_incident"],
        focusAnchor: "Corrupted Blood plague event",
        presentationGoal:
          "Explain what happened, why it spread, why researchers cared, and what it teaches about disease spread.",
      },
      plan: {
        title: "Virtual plagues and disease spread",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain what the Corrupted Blood incident was.",
          "Explain how pets and player movement spread the incident beyond the raid.",
          "Explain why researchers treated the incident as a useful model.",
          "Explain what the incident teaches about outbreak behavior.",
        ],
        storyline: [
          "What happened",
          "How it spread",
          "Why researchers cared",
          "What it teaches",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "How pets and player movement carried the debuff beyond the intended area",
        "Why epidemiologists treated the incident as a useful observational case",
      ],
      groundingHighlights: [
        "A raid boss curse escaped into cities when players teleported away and pets retained the debuff.",
        "Researchers studied the event because player behavior exposed panic, risk-taking, and avoidance patterns.",
        "The incident showed how social behavior can amplify or dampen simulated outbreaks.",
      ],
    },
    4,
  );

  assert.deepEqual(
    contracts.map((contract: { kind: string }) => contract.kind),
    ["orientation", "subject-detail", "subject-implication", "subject-takeaway"],
  );

  const laterFoci = contracts
    .slice(1)
    .map((contract: { focus: string }) => contract.focus.trim().toLowerCase());
  assert.equal(new Set(laterFoci).size, laterFoci.length);
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /Corrupted Blood|raid boss curse|teleported|debuff|pets/i,
  );
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /pets|teleported|debuff/i,
  );
  assert.match(
    `${contracts[2]?.focus ?? ""} ${contracts[2]?.evidence ?? ""}`,
    /researchers|behavior|panic/i,
  );
});

test("source-backed subject contracts without explicit focus anchors still pull concrete grounded detail into slide two", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      presentationBrief:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      plan: {
        title: "The 1999 Premiere of SpongeBob SquarePants",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain what the first broadcast was.",
          "Explain what made the first aired episode distinct from pilot material.",
          "Explain why that distinction mattered for the series launch.",
          "Explain the strongest takeaway from that debut.",
        ],
        storyline: [
          "What the debut was",
          "One concrete detail",
          "Why it mattered",
          "What it teaches",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    },
    4,
  );

  assert.equal(contracts[1]?.kind, "subject-detail");
  assert.doesNotMatch(contracts[1]?.focus ?? "", /^Spongebob Squarepants first episode that was aired in 1999$/i);
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /Help Wanted|televised episode|Nickelodeon|broadcast debut|first aired episode|pilot material/i,
  );
});

test("source-backed broad subject openings introduce the subject before grounded details", () => {
  const input = {
    topic: "Photosynthesis",
    presentationBrief: "Create a short presentation about photosynthesis.",
    intent: {
      subject: "Photosynthesis",
      presentationFrame: "subject",
      explicitSourceUrls: ["https://example.com/photosynthesis"],
    },
    plan: {
      title: "Photosynthesis",
      recommendedSlideCount: 4,
      learningObjectives: [],
      storyline: [],
      audienceLevel: "beginner",
    },
    groundingHighlights: [
      "Chlorophyll in plant cells absorbs light energy for photosynthesis.",
      "Photosynthesis converts carbon dioxide and water into glucose and oxygen.",
      "The process supports plant growth and releases oxygen into the atmosphere.",
    ],
  } as any;
  const contracts = buildSlideContracts(input, 4);

  assert.equal(contracts[0]?.kind, "orientation");
  assert.equal(contracts[0]?.focus, "Photosynthesis");
  assert.equal(contracts[0]?.objective ?? "", "");
  assert.doesNotMatch(
    `${contracts[0]?.focus ?? ""} ${contracts[0]?.objective ?? ""}`,
    /Chlorophyll|glucose|oxygen/i,
  );
  assert.match(
    `${contracts[1]?.focus ?? ""} ${contracts[1]?.evidence ?? ""}`,
    /Chlorophyll|carbon dioxide|water|glucose|oxygen/i,
  );
  assert.equal(buildContractTitle(input, contracts[0] as any), "Photosynthesis");
  assert.match(
    buildContractLearningGoal(input, contracts[0] as any),
    /Photosynthesis has a clear role, mechanism, and operating context/i,
  );
});

test("source-backed subject opening does not prioritize takeaway language over concrete grounded setup", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      presentationBrief:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      plan: {
        title: "SpongeBob SquarePants: The 1999 Premiere",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain what the first broadcast was.",
          "Explain what made the first aired episode distinct from pilot material.",
          "Explain why that distinction mattered for the series launch.",
          "Explain the strongest takeaway from that debut.",
        ],
        storyline: [
          "What the debut was",
          "One concrete detail",
          "Why it mattered",
          "What it teaches",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    },
    4,
  );

  assert.equal(contracts[0]?.kind, "orientation");
  assert.doesNotMatch(contracts[0]?.focus ?? "", /what it teaches|strongest takeaway|cultural impact/i);
  assert.match(
    `${contracts[0]?.focus ?? ""} ${contracts[0]?.objective ?? ""}`,
    /Help Wanted|televised episode|Nickelodeon|what the first broadcast was|debut/i,
  );
});

test("source-backed subject derives a concrete case anchor from grounding when the prompt lacks one", () => {
  const caseAnchor = resolveSourceBackedCaseAnchor({
    topic: "Spongebob Squarepants first episode that was aired in 1999",
    presentationBrief:
      "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
    intent: {
      subject: "Spongebob Squarepants first episode that was aired in 1999",
      presentationFrame: "subject",
      explicitSourceUrls: ["https://example.com/spongebob-premiere"],
    },
    groundingCoverageGoals: [
      "Which episode actually aired first and how that differed from earlier pilot material",
      "Why the first broadcast mattered for the show's launch",
    ],
    groundingHighlights: [
      "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
      "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
    ],
  } as any);

  assert.ok(caseAnchor);
  assert.match(
    caseAnchor ?? "",
    /Help Wanted|first televised episode|1999|Nickelodeon|broadcast debut|Bikini Bottom/i,
  );
});

test("source-backed subject opening goals stay anchored to the concrete case when grounding provides it", () => {
  const goal = buildContractLearningGoal(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      presentationBrief:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    },
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Spongebob Squarepants first episode that was aired in 1999",
      objective: "What the first broadcast was",
    },
  );

  assert.match(goal, /Help Wanted|first broadcast|concrete case|1999|Nickelodeon/i);
  assert.doesNotMatch(goal, /why it matters, and one concrete way to recognize it/i);
});

test("source-backed opening slides are rejected when they drift into broad unsupported generalities", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Spongebob Squarepants first episode that was aired in 1999",
      objective: "What the first broadcast was",
    },
    {
      title: "SpongeBob SquarePants",
      learningGoal: "See why the show matters.",
      keyPoints: [
        "The show established a recognizable comic tone.",
        "The series created a broad template for humor and personality.",
        "The topic can be understood through its main ideas and themes.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    },
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /supported source details|concrete grounded case/i,
  );
});

test("source-backed concrete learning goals are not rejected just because they start with see", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "Help Wanted as the 1999 broadcast premiere",
          learningGoal: "See the verified title, date, and network of the first broadcast.",
          keyPoints: [
            "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
            "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
            "The first broadcast is the concrete anchor for the rest of the premiere story.",
          ],
          examples: [],
          beginnerExplanation: "",
          advancedExplanation: "",
        },
      ],
    } as any,
    {
      index: 1,
      label: "concrete detail",
      kind: "subject-detail",
      focus: "Help Wanted as the 1999 broadcast premiere",
      objective: "How the 1999 broadcast debut makes the subject concrete",
      evidence:
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
    },
    {
      title: "Help Wanted as the 1999 broadcast premiere",
      learningGoal:
        "See how 'Help Wanted' airing on Nickelodeon in 1999 makes the first SpongeBob episode concrete.",
      keyPoints: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "That broadcast detail separates the aired premiere from earlier pilot material.",
        "The 1999 Nickelodeon airing gives the explanation a concrete starting point instead of a broad franchise overview.",
      ],
      examples: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
      ],
      beginnerExplanation:
        "The premiere story starts with the verified broadcast: 'Help Wanted' aired on Nickelodeon in 1999.",
      advancedExplanation:
        "Using the broadcast title, network, and year keeps the explanation anchored to the source-backed event instead of broad franchise impact.",
    } as any,
  );

  assert.equal(assessment.retryable, false);
});

test("source-backed reception slides can discuss audience reaction without being treated as meta", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
        "The first broadcast let Nickelodeon test audience reaction before the series launch.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 1,
      label: "launch implication",
      kind: "subject-implication",
      focus: "May 1 sneak peek and July 17 official premiere",
      objective: "Why the two 1999 airings shaped the launch",
      evidence:
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
    },
    {
      title: "May 1 sneak peek and July 17 premiere",
      learningGoal:
        "See why the two 1999 airings shaped the launch of SpongeBob SquarePants.",
      keyPoints: [
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
        "The first broadcast let Nickelodeon test audience reaction before the series launch.",
        "The staggered launch sequence makes the premiere story more specific than a broad franchise overview.",
      ],
      examples: [
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
      ],
      beginnerExplanation:
        "The two 1999 airings matter because they show the first episode moving from preview to official launch.",
      advancedExplanation:
        "The May and July dates connect audience reception to a concrete broadcast sequence rather than generic cultural-impact language.",
    } as any,
  );

  assert.equal(assessment.retryable, false);
});

test("source-backed subject detail slides do not fall back to generic deterministic overview mode", () => {
  const shouldUseOverview = shouldUseDeterministicSubjectOverviewSlide(
    {
      topic: "SpongeBob SquarePants first episode that was aired in 1999",
      presentationBrief:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      intent: {
        subject: "SpongeBob SquarePants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the show version audiences still recognize.",
      ],
      groundingCoverageGoals: [
        "Which episode actually aired first and how that differed from earlier pilot material",
      ],
    } as any,
    {
      id: "slide-2",
      order: 1,
      title: "SpongeBob SquarePants first episode that was aired in 1999",
      learningGoal: "See one concrete detail that defines SpongeBob SquarePants first episode that was aired in 1999.",
      keyPoints: [
        "A concrete example, consequence, or real-world application of SpongeBob SquarePants first episode that was aired in 1999.",
      ],
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      narrationPointCount: 3,
      visuals: {
        layoutTemplate: "cards",
        heroStatement: "",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imagePrompt: "",
        imageSlots: [],
      },
      requiredContext: [],
      dependenciesOnOtherSlides: [],
      visualNotes: [],
      sourceIds: [],
    },
    {
      index: 1,
      label: "concrete detail",
      kind: "subject-detail",
      focus: "Help Wanted as the 1999 broadcast premiere",
      objective: "How the 1999 broadcast debut makes the subject concrete",
      evidence:
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
    },
  );

  assert.equal(shouldUseOverview, false);
});

test("source-backed implication slides are rejected when they drift into unsupported broad claims", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
      ],
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "Spongebob Squarepants first episode that was aired in 1999",
          learningGoal: "See the verified title, date, and network of the first broadcast.",
          keyPoints: [
            "The first televised episode was 'Help Wanted', which aired in 1999 on Nickelodeon.",
          ],
          examples: [],
          beginnerExplanation: "",
          advancedExplanation: "",
        },
      ],
    } as any,
    {
      index: 2,
      label: "Why it mattered",
      kind: "subject-implication",
      focus: "Why the first broadcast mattered for the show's launch",
      objective: "What that first broadcast changed for the series launch",
      evidence:
        "The broadcast debut established the version of SpongeBob and Bikini Bottom that audiences came to recognize.",
    },
    {
      title: "A cultural reset for children's television",
      learningGoal: "See how the global legacy of the 1999 debut changed animation forever.",
      keyPoints: [
        "The premiere instantly rewrote the rules of children's programming worldwide.",
        "Its global merchandising impact made SpongeBob a cultural reset.",
        "The episode proved that all later animation had to follow its model.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /grounded case|supported source details|unsupported claims/i,
  );
});

test("source-backed takeaway slides reject unsupported points even when the heading is grounded", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        presentationFrame: "subject",
        explicitSourceUrls: ["https://example.com/spongebob-premiere"],
      },
      groundingCoverageGoals: [
        "Why the first broadcast mattered for the show's launch",
      ],
      groundingHighlights: [
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
        "The first broadcast let Nickelodeon test audience reaction before the series launch.",
      ],
    } as any,
    { slides: [] } as any,
    {
      index: 3,
      label: "takeaway",
      kind: "subject-takeaway",
      focus: "May 1 sneak peek and July 17 official premiere",
      objective: "What the first broadcast teaches about the launch",
      evidence:
        "Nickelodeon aired 'Help Wanted' as a sneak peek on May 1, 1999, before the July 17, 1999 official premiere.",
    },
    {
      title: "May 1 sneak peek and July 17 premiere",
      learningGoal:
        "See what the May 1 sneak peek teaches about the launch.",
      keyPoints: [
        "The first aired episode taught viewers that comedy could thrive in a tightly packed environment where visual gags drive the story.",
        "The first aired episode proves that structural limitation can directly generate a show's most enduring comedic identity.",
        "The opening broadcast relied on a tightly compressed visual sequence that delivered immediate comedic payoff without exposition.",
      ],
      examples: [],
      beginnerExplanation:
        "The first aired episode taught viewers that comedy could thrive in a tightly packed environment where visual gags drive the story.",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(assessment.reasons.join(" "), /grounded case|supported source details/i);
});

test("workshop contracts reserve a practical exercise slide instead of collapsing into another summary slide", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Using AI tools in daily work",
      presentationBrief:
        "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
      intent: {
        subject: "Using AI tools in daily work",
        presentationFrame: "organization",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        activityRequirement:
          "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
        presentationGoal:
          "Help project managers, product owners, and test leads use AI tools in their daily work.",
      },
      plan: {
        title: "AI tools at VGR",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain where AI tools help in everyday planning, coordination, and follow-up work.",
          "Show realistic use cases for project managers, product owners, and test leads.",
          "Show how governance, quality, and practical constraints shape AI use.",
          "Let participants practice one realistic AI-assisted workflow.",
        ],
        storyline: [
          "Why this matters at VGR",
          "Real use cases",
          "Constraints and guardrails",
          "Practical exercise",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "AI tools in planning, documentation, analysis, and communication",
        "Public-sector governance, privacy, and quality constraints",
      ],
      groundingHighlights: [
        "Summarize meeting notes into action items for project follow-up",
        "Draft first-pass risk lists or requirement clarifications",
        "Check outputs against policy, privacy, and public-sector quality constraints",
      ],
    },
    4,
  );

  assert.equal(contracts.at(-1)?.kind, "workshop-practice");
  assert.match(
    contracts.at(-1)?.evidence ?? "",
    /workflow|meeting notes|constraint|risk lists|requirement clarifications|use cases/i,
  );
  assert.match(
    buildContractLearningGoal(
      {
        topic: "Using AI tools in daily work",
        intent: {
          subject: "Using AI tools in daily work",
        },
      },
      contracts.at(-1)!,
    ),
    /reviewable draft|practical exercise/i,
  );
});

test("organization workshop openings prioritize role-based daily work framing over guardrail text", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Using AI tools in daily work",
      presentationBrief:
        "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
      intent: {
        subject: "Using AI tools in daily work",
        presentationFrame: "organization",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        activityRequirement:
          "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
        presentationGoal:
          "How project managers, product owners, and test leads can use AI tools in their daily work",
        audienceCues: [
          "project managers",
          "product owners",
          "test leads",
        ],
        coverageRequirements: [
          "AI support in planning, documentation, and follow-up work",
        ],
      },
      plan: {
        title: "AI tools at VGR",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain where AI tools help in everyday planning, coordination, and follow-up work.",
          "Show realistic use cases for project managers, product owners, and test leads.",
          "Show how governance, quality, and practical constraints shape AI use.",
          "Let participants practice one realistic AI-assisted workflow.",
        ],
        storyline: [
          "Why this matters at VGR",
          "Real use cases",
          "Constraints and guardrails",
          "Practical exercise",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Sensitive patient and personnel data must stay out of public AI tools",
        "Approved tools, review steps, and privacy boundaries shape AI use in public-sector work",
      ],
      groundingHighlights: [
        "Summarize meeting notes into action items for project follow-up",
        "Draft first-pass risk lists or requirement clarifications",
        "Check outputs against policy, privacy, and public-sector quality constraints",
      ],
    },
    4,
  );

  assert.equal(contracts[0]?.kind, "orientation");
  assert.match(
    `${contracts[0]?.focus ?? ""} ${contracts[0]?.objective ?? ""}`,
    /daily work|planning|coordination|follow-up|project managers|product owners|test leads/i,
  );
  assert.doesNotMatch(
    `${contracts[0]?.focus ?? ""} ${contracts[0]?.objective ?? ""}`,
    /sensitive patient|personnel data|privacy boundaries|public AI tools/i,
  );
});

test("source-backed learning goals decode HTML entities and avoid untranslated source phrases in English prompts", () => {
  const learningGoal = buildContractLearningGoal(
    {
      topic:
        "Presentation for product owners, project managers and test leads in using AI in their daily work",
      groundingSourceIds: ["https://www.vgregion.se/politik/protokoll-och-handlingar"],
      groundingHighlights: [
        "Protokoll och handlingar V&#xE4;stra G&#xF6;talandsregionen styrs genom politiska beslut.",
      ],
      groundingCoverageGoals: [
        "Use VGR source material to ground the presentation.",
      ],
    },
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus:
        "Protokoll och handlingar V&#xE4;stra G&#xF6;talandsregionen styrs genom politiska beslut",
      objective:
        "Protokoll och handlingar V&#xE4;stra G&#xF6;talandsregionen styrs genom politiska beslut",
    },
  );

  assert.doesNotMatch(learningGoal, /&#x/i);
  assert.doesNotMatch(learningGoal, /protokoll och handlingar/i);
  assert.doesNotMatch(learningGoal, /frames the concrete case within Presentation for/i);
  assert.match(learningGoal, /starts with identity, origin, and practical role/i);
});

test("organization workshop openings are rejected when policy constraints take over the opening slide", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        presentationFrame: "mixed",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        audienceCues: ["project managers", "product owners", "test leads"],
        presentationGoal:
          "How project managers, product owners, and test leads can use AI tools in their daily work",
      },
    } as any,
    { slides: [] } as any,
    {
      index: 0,
      label: "orientation",
      kind: "orientation",
      focus: "Using AI tools in their daily work",
      objective:
        "See specific use cases for AI tools relevant to project management, product ownership and testing work",
    },
    {
      title: "Using AI tools in their daily work",
      learningGoal:
        "See specific use cases for AI tools relevant to project management, product ownership and why it matters.",
      keyPoints: [
        "AI tools must only process non-sensitive, public, or anonymized data to comply with VGR’s data protection standards.",
        "Users are responsible for verifying AI-generated outputs before applying them to official project documentation or decisions.",
        "Approved AI tools are integrated into VGR’s secure infrastructure to ensure auditability and data residency compliance.",
      ],
      examples: [
        "AI tools must only process non-sensitive, public, or anonymized data to comply with VGR’s data protection standards.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /assigned role|role|focus|objective/i,
  );
});

test("organization-grounded workshop constraint slides are not rejected as company-role drift", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        presentationFrame: "mixed",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        audienceCues: ["project managers", "product owners", "test leads"],
        presentationGoal:
          "How project managers, product owners, and test leads can use AI tools in their daily work",
      },
      groundingHighlights: [
        "Public AI tools must not receive sensitive patient data or confidential regional information.",
        "AI-generated content requires human review against official sources before it enters project documentation.",
      ],
    } as any,
    { slides: [] } as any,
    {
      index: 2,
      label: "constraints and safe use",
      kind: "entity-operations",
      focus: "Which guardrails and review steps keep AI tools safe in practice",
      objective:
        "Which review steps, approved tools, and policy boundaries keep AI tools safe in daily work",
      evidence:
        "Public AI tools must not receive sensitive patient data or confidential regional information.",
    },
    {
      title: "Constraints and safe use",
      learningGoal:
        "See which constraints and review steps keep AI-assisted work safe in daily work.",
      keyPoints: [
        "Public AI tools must never receive sensitive patient data or confidential regional information from Västra Götaland.",
        "All AI-generated content requires a human review step before it is used in official project documentation.",
        "Policy boundaries keep prompts focused on anonymized or public information rather than internal records.",
      ],
      examples: [
        "A project update can use anonymized milestone text and a review checklist before it is shared.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.doesNotMatch(
    assessment.reasons.join(" "),
    /wrong organization role|slide body signals the wrong organization role/i,
  );
});

test("mixed workshop prompts with organization context still use the organization workshop arc", () => {
  const contracts = buildSlideContracts(
    {
      topic: "Using AI tools in daily work",
      presentationBrief:
        "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
      intent: {
        subject: "Using AI tools in daily work",
        presentationFrame: "mixed",
        organization: "VGR, Västra Götalandsregionen",
        deliveryFormat: "workshop",
        activityRequirement:
          "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
        presentationGoal:
          "How project managers, product owners, and test leads can use AI tools in their daily work",
        audienceCues: [
          "project managers",
          "product owners",
          "test leads",
        ],
      },
      plan: {
        title: "AI tools at VGR",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain where AI tools help in everyday planning, coordination, and follow-up work.",
          "Show realistic use cases for project managers, product owners, and test leads.",
          "Show how governance, quality, and practical constraints shape AI use.",
          "Let participants practice one realistic AI-assisted workflow.",
        ],
        storyline: [
          "Why this matters at VGR",
          "Real use cases",
          "Constraints and guardrails",
          "Practical exercise",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "AI tools in planning, documentation, analysis, and communication",
        "Public-sector governance, privacy, and quality constraints",
      ],
      groundingHighlights: [
        "Summarize meeting notes into action items for project follow-up",
        "Draft first-pass risk lists or requirement clarifications",
        "Check outputs against policy, privacy, and public-sector quality constraints",
      ],
    },
    4,
  );

  assert.deepEqual(
    contracts.map((contract: { kind: string }) => contract.kind),
    ["orientation", "entity-capabilities", "entity-operations", "workshop-practice"],
  );
});

test("topic-only concept decks are not treated as source-backed just because they have generated highlights", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "How an interruption-aware AI teacher works",
      intent: {
        subject: "How an interruption-aware AI teacher works",
      },
      groundingHighlights: [
        "Mental model: The AI acts as a patient tutor that remembers context.",
        "Structure: The AI detects, pauses, and resumes the lesson.",
      ],
      groundingCoverageGoals: [
        "The pause-and-resume mechanism",
        "A concrete learner interruption example",
      ],
    } as any,
    { slides: [] } as any,
    {
      index: 1,
      label: "concrete mechanism",
      kind: "subject-detail",
      focus: "The AI manages and resumes interrupted interactions",
      objective:
        "How the system preserves lesson context across breaks so tutoring can continue",
      evidence:
        "Mental model: The AI acts as a patient tutor that remembers context.",
    },
    {
      title: "The AI manages and resumes interrupted interactions",
      learningGoal:
        "Understand how the system tracks and restores conversation context after a pause.",
      keyPoints: [
        "The AI stores the current lesson state when a learner pauses.",
        "The saved context includes the recent dialogue, current task, and next teaching step.",
        "When the learner returns, the tutor resumes from the saved point instead of restarting.",
      ],
      examples: [
        "A student pauses during an algebra problem and returns to the same step with the same hint ready.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.doesNotMatch(
    assessment.reasons.join(" "),
    /grounded case|supported source details|source details/i,
  );
});

test("question-shaped concept subjects do not produce 'works is' contract titles", () => {
  const input = {
    topic: "How an interactive AI tutor works",
    intent: {
      subject: "How an interactive AI tutor works",
    },
    plan: {
      title: "How an Interactive AI Tutor Works",
      learningObjectives: [
        "Understand how an interactive AI tutor works.",
        "Understand the three layers of the system: input processing, knowledge retrieval, and response generation.",
        "Understand feedback loops in personalized learning.",
        "Understand why the approach matters.",
      ],
      storyline: [
        "What How an interactive AI tutor works is",
        "The three layers of the system",
        "Feedback loops in personalized learning",
        "Key takeaway",
      ],
      recommendedSlideCount: 5,
      audienceLevel: "beginner",
    },
  } as any;
  const contracts = buildSlideContracts(input, 5);
  const titles = contracts.map((contract: any) =>
    buildContractTitle(input, contract),
  );

  assert.doesNotMatch(
    [...contracts.map((contract: any) => contract.focus), ...titles].join(" "),
    /\bworks is\b|^\s*is\s*$/i,
  );
  assert.match(
    contracts[0]?.focus ?? "",
    /starting situation for an interactive AI tutor/i,
  );
  assert.match(contracts[1]?.focus ?? "", /three layers/i);
  assert.match(contracts[2]?.focus ?? "", /feedback loops/i);
  assert.doesNotMatch(
    titles.join(" "),
    /One consequence, interpretation, or lesson revealed by|by How$/i,
  );
  assert.ok(titles.every((title: string) => title.trim().length > 3));
});

test("question-shaped concept contracts recover from generic and repeated plan steps", () => {
  const input = {
    topic: "How an interactive AI tutor works",
    intent: {
      subject: "How an interactive AI tutor works",
    },
    plan: {
      title: "How an Interactive AI Tutor Works",
      learningObjectives: ["Understand how an interactive AI tutor works."],
      storyline: [
        "What How an interactive AI tutor works is",
        "One concrete detail",
        "Key components—user interface, language model, knowledge base,",
        "Key takeaway",
      ],
      recommendedSlideCount: 4,
      audienceLevel: "beginner",
    },
  } as any;
  const contracts = buildSlideContracts(input, 4);
  const titles = contracts.map((contract: any) =>
    buildContractTitle(input, contract),
  );
  const foci = contracts.map((contract: any) => contract.focus);

  assert.doesNotMatch([...foci, ...titles].join(" "), /one concrete detail/i);
  assert.equal(
    new Set(foci.map((focus: string) => focus.toLowerCase())).size,
    foci.length,
  );
  assert.match(foci[1] ?? "", /key components|main mechanism/i);
  assert.doesNotMatch(foci[2] ?? "", /key components/i);
});

test("ungrounded how-it-works decks use a distinct deterministic mechanism arc", () => {
  const input = {
    topic: "Explain how an interruption-aware AI teacher works",
    intent: {
      subject: "How an interruption-aware AI teacher works",
    },
    plan: {
      storyline: [
        "How an interruption-aware AI teacher works",
        "The trigger, state change, and output loop",
        "How the state change affects the next response",
        "It matters",
      ],
      learningObjectives: [
        "Understand how an interruption-aware AI teacher works.",
        "Understand how the mechanism turns learner input into a useful response.",
        "Understand why the mechanism changes the next response.",
        "Understand what the audience should check to know the mechanism worked.",
      ],
    },
    groundingHighlights: [],
    groundingCoverageGoals: [],
  } as any;
  const contracts = buildSlideContracts(input, 4);
  const titles = contracts.map((contract: any) =>
    buildContractTitle(input, contract),
  );
  const deterministicSlides = contracts.slice(1).map((contract: any) =>
    buildRoleSpecificSlideRecoveryFromContext(
      input,
      { slides: [] } as any,
      {
        id: `slide_${contract.index}`,
        order: contract.index,
        title: titles[contract.index],
        learningGoal: buildContractLearningGoal(input, contract),
        keyPoints: [],
        examples: [],
        likelyQuestions: [],
        visualNotes: [],
        speakerNotes: [],
        beginnerExplanation: "",
        advancedExplanation: "",
      } as any,
      contract,
    ),
  );

  assert.deepEqual(titles, [
    "Interruption-aware AI teacher",
    "The thread uses three signals",
    "The link uses shared terms",
    "Resume from the next action",
  ]);
  assert.ok(contracts.slice(1).every((contract: any) =>
    shouldUseDeterministicHowWorksSlide(input, contract),
  ));
  assert.ok(deterministicSlides.every((slide) => slide));
  assert.match(
    deterministicSlides
      .flatMap((slide: any) => slide.keyPoints)
      .join(" "),
    /lesson path|active concept|shared term|continuous after an interruption/i,
  );
  assert.doesNotMatch(
    deterministicSlides
      .flatMap((slide: any) => [
        slide.title,
        slide.learningGoal,
        ...slide.keyPoints,
      ])
      .join(" "),
    /more accurate picture|personalized learning|dynamic conversation|It matters/i,
  );
});

test("stringified key point arrays from structured output are assessed as separate points", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "How an interruption-aware AI teacher works",
      intent: {
        subject: "How an interruption-aware AI teacher works",
      },
    } as any,
    { slides: [] } as any,
    {
      index: 1,
      label: "input priority",
      kind: "subject-detail",
      focus: "How the system prioritizes new input over old context",
      objective:
        "How dynamic input priority lets the tutor answer interruptions without losing the lesson thread",
    },
    {
      title: "How the system prioritizes new input over old context",
      learningGoal:
        "See how dynamic input priority keeps an interrupted tutoring session coherent.",
      keyPoints: [
        JSON.stringify([
          "Fresh student input is treated as a priority signal that can pause the current explanation.",
          "Earlier context stays available so the tutor can bridge back after answering the interruption.",
          "The system resumes the original lesson thread after the immediate question is resolved.",
        ]),
      ],
      examples: [
        "A learner asks a clarification mid-explanation and the tutor answers it before continuing.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.doesNotMatch(
    assessment.reasons.join(" "),
    /key points as three complete|fragmentary|not specific enough/i,
  );
});

test("workshop practice recovery preserves a concrete applied task when llm drafts fail", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
      },
      groundingHighlights: [
        "Summarize meeting notes into action items for project follow-up.",
        "Check outputs against policy, privacy, and public-sector quality constraints.",
      ],
      groundingCoverageGoals: [
        "AI tools in planning, documentation, analysis, and communication",
      ],
      plan: {
        learningObjectives: [
          "Let participants practice one realistic AI-assisted workflow.",
        ],
        storyline: ["Practical exercise"],
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "Why AI matters at VGR",
          examples: [],
          keyPoints: [
            "AI tools automate routine documentation and status reporting.",
          ],
        },
      ],
    } as any,
    {
      id: "slide-workshop",
      order: 3,
      title: "Draft exercise",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      objective:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      evidence:
        "Summarize meeting notes into action items for project follow-up.",
    },
  );

  assert.ok(recovered);
  assert.equal(recovered?.title ?? "", "Practical exercise");
  assert.match((recovered?.keyPoints ?? []).join(" "), /Participants map|reviewable draft|human checks|reused/i);
  assert.doesNotMatch((recovered?.keyPoints ?? []).join(" "), /^How project managers/i);
  assert.match((recovered?.examples ?? []).join(" "), /meeting notes|workflow/i);
});

test("workshop practice recovery ignores prompt requirement wording as activity text", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        deliveryFormat: "workshop",
        activityRequirement:
          "At least one practical exercise for the audience to complete during the workshop.",
      },
      groundingHighlights: [
        "Draft first-pass risk lists or requirement clarifications.",
        "Check outputs against policy, privacy, and public-sector quality constraints.",
      ],
      groundingCoverageGoals: [
        "AI tools in planning, documentation, analysis, and communication",
      ],
      plan: {
        learningObjectives: [
          "Let participants practice one realistic AI-assisted workflow.",
        ],
        storyline: ["Practical exercise"],
      },
    } as any,
    { slides: [] } as any,
    {
      id: "slide-workshop",
      order: 3,
      title: "Draft exercise",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      objective:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      evidence:
        "At least one practical exercise for the audience to complete during the workshop.",
    },
  );

  const visibleText = [
    ...(recovered?.keyPoints ?? []),
    ...(recovered?.examples ?? []),
  ].join(" ");
  assert.doesNotMatch(visibleText, /at least one practical exercise/i);
  assert.match(visibleText, /work artifact|reviewable draft|constraint|policy/i);
});

test("workshop practice slides allow exercise-style action points", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        deliveryFormat: "workshop",
      },
      groundingHighlights: [
        "Draft first-pass risk lists or requirement clarifications.",
        "Check outputs against policy, privacy, and public-sector quality constraints.",
      ],
    } as any,
    { slides: [] } as any,
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      objective:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      evidence:
        "Draft first-pass risk lists or requirement clarifications.",
    },
    {
      title: "Practical exercise: Draft a safe AI prompt",
      learningGoal:
        "Practice mapping one daily work task to an AI-assisted workflow.",
      keyPoints: [
        "Draft a prompt for a specific work task such as creating a risk list or requirement clarification.",
        "Review the prompt against policy, privacy, and quality constraints before using it.",
        "Refine the prompt so it includes useful context while excluding sensitive information.",
      ],
      examples: [
        "Draft first-pass risk lists or requirement clarifications while checking outputs against policy boundaries.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.doesNotMatch(
    assessment.reasons.join(" "),
    /key points still read like commands/i,
  );
});

test("workshop practice slides reject truncated example fragments", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        deliveryFormat: "workshop",
      },
      groundingHighlights: [
        "Draft first-pass risk lists or requirement clarifications.",
        "Check outputs against policy, privacy, and public-sector quality constraints.",
      ],
    } as any,
    { slides: [] } as any,
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      objective:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      evidence:
        "Draft first-pass risk lists or requirement clarifications.",
    },
    {
      title: "Practical exercise: Draft a safe AI prompt",
      learningGoal:
        "Practice mapping one daily work task to an AI-assisted workflow.",
      keyPoints: [
        "Draft a prompt for a specific work task such as creating a risk list or requirement clarification.",
        "Review the prompt against policy, privacy, and quality constraints before using it.",
        "Refine the prompt so it includes useful context while excluding sensitive information.",
      ],
      examples: [
        "project managers, product owners, and test leads can use AI tools in their daily",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.match(
    assessment.reasons.join(" "),
    /malformed examples|complete, concrete prompts/i,
  );
});

test("entity value recovery stays anchored to a concrete outcome instead of generic company messaging", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
      },
      groundingHighlights: [
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
      ],
      groundingCoverageGoals: [
        "QA operations and verification support for complex engineering teams",
      ],
      plan: {
        learningObjectives: [
          "Explain one practical example or customer outcome that shows the company's value.",
        ],
        storyline: ["Customer value example"],
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "System Verification",
          examples: [],
          keyPoints: [
            "System Verification is a QA network in the Nordics.",
            "System Verification integrates into development workflows to catch defects before production.",
          ],
        },
      ],
    } as any,
    {
      id: "slide-value",
      order: 3,
      title: "Draft value slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective: "One concrete customer outcome that shows the company's value",
      evidence:
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
    },
  );

  assert.ok(recovered);
  assert.match((recovered?.examples ?? []).join(" "), /forty percent|financial services/i);
  assert.doesNotMatch(recovered?.title ?? "", /mission|vision/i);
});

test("entity value key points rank concrete outcome evidence ahead of broad value language", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
      },
    },
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective: "One concrete customer outcome that shows the company's value",
      evidence:
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
    },
    [
      "System Verification creates value through flexible QA support across many different situations.",
      "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
      "The strongest value slide ties the organization to one recognizable result or scenario.",
    ],
  );

  assert.match(points[0] ?? "", /forty percent|financial services/i);
  assert.doesNotMatch(points[0] ?? "", /flexible QA support across many different situations/i);
});

test("entity value recovery uses practical consequences when no customer case evidence exists", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
        "Project-specific QA helps teams keep release decisions visible and evidence-based.",
      ],
      groundingCoverageGoals: [
        "Risk identification and data flow validation for complex software teams",
      ],
      plan: {
        learningObjectives: [
          "Explain one evidence-backed practical consequence that shows the company's value.",
        ],
        storyline: ["Practical consequence"],
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "System Verification",
          examples: [
            "A regional logistics provider used advisory workshops to reduce release risk.",
          ],
          keyPoints: [
            "System Verification integrates into development workflows to catch defects before production.",
          ],
        },
      ],
    } as any,
    {
      id: "slide-value",
      order: 3,
      title: "Draft value slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective:
        "One evidence-backed practical consequence that shows the company's value",
      evidence:
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
    },
  );

  const recoveredText = [
    recovered?.title ?? "",
    recovered?.learningGoal ?? "",
    ...(recovered?.keyPoints ?? []),
    ...(recovered?.examples ?? []),
    recovered?.beginnerExplanation ?? "",
    recovered?.advancedExplanation ?? "",
  ].join(" ");

  assert.ok(recovered);
  assert.equal(recovered?.title ?? "", "Practical consequence");
  assert.match(recoveredText, /risk identification|data flow validation|critical defects/i);
  assert.doesNotMatch(recoveredText, /QA network in the Nordics/i);
  assert.doesNotMatch(recoveredText, /regional logistics|customer|client|provider/i);
});

test("entity value slides reject fabricated customer scenarios without case evidence", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective:
        "One evidence-backed practical consequence that shows the company's value",
      evidence:
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
    },
    {
      title: "Practical consequence",
      learningGoal:
        "See one evidence-backed consequence that shows where System Verification creates value.",
      keyPoints: [
        "Early risk identification and data flow validation make release risk visible before it reaches production.",
        "A regional logistics provider used advisory workshops to reduce release risk.",
        "The consequence is clearer when evidence stays tied to validation and risk identification.",
      ],
      examples: [
        "A regional logistics provider used advisory workshops to reduce release risk.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /invents a customer|provider|not present in the evidence|practical consequence/i,
  );
});

test("entity value slides reject customer-impact labels without case evidence", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective:
        "One evidence-backed practical consequence that shows the company's value",
      evidence:
        "Early risk identification and data flow validation reduce the chance that critical defects reach production.",
    },
    {
      title: "Practical consequence",
      learningGoal:
        "See one evidence-backed consequence that shows where System Verification creates value.",
      keyPoints: [
        "Early risk identification and data flow validation make release risk visible before it reaches production.",
        "Customer Impact: A concrete example of identifying risks early and validating data flows.",
        "The consequence is clearer when evidence stays tied to validation and risk identification.",
      ],
      examples: [
        "Customer Impact: A concrete example of identifying risks early and validating data flows.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /organization slide invents a customer|not present in the evidence|source-backed organization facts/i,
  );
});

test("organization operations slides are rejected when they collapse into a service catalog without operational evidence", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "Delivery teams integrate QA operations, verification support, and quality management into daily engineering work.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 1,
      label: "how it works",
      kind: "entity-operations",
      focus: "How System Verification works in practice",
      objective: "Delivery teams integrate QA operations, verification support, and quality management into daily engineering work.",
      evidence:
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
    },
    {
      title: "Our Offerings: Advisory, Workshops, and Test Automation",
      learningGoal: "See what System Verification offers through advisory support and testing services.",
      keyPoints: [
        "System Verification offers advisory services for quality assurance strategy.",
        "The company provides workshops and project-specific QA support.",
        "Its testing services adapt to complex engineering needs.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /operations slide lost its concrete operating anchor|wrong organization role|service catalog/i,
  );
});

test("organization operations recovery prioritizes concrete source facts over generic role templates", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "Delivery teams integrate QA operations, verification support, and quality management into daily engineering work.",
      ],
    } as any,
    { slides: [] } as any,
    {
      id: "slide_operations",
      order: 1,
      title: "Where it operates and how it works",
      learningGoal:
        "See how System Verification works in practice through delivery, teamwork, and geographic footprint.",
      keyPoints: [
        "System Verification integrates test automation into CI/CD pipelines.",
        "The organization uses Playwright and Selenium in customer environments.",
        "Advisory workshops validate ERP data flows before deployment.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "1C7C7D",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imageSlots: [],
      },
    } as any,
    {
      index: 1,
      label: "how it works",
      kind: "entity-operations",
      focus: "Where it operates and how it works",
      objective:
        "See how System Verification works in practice through delivery, teamwork, and geographic footprint.",
      evidence:
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
    },
  );

  const recoveredText = (recovered?.keyPoints ?? []).join(" ");

  assert.ok(recovered);
  assert.match(
    recoveredText,
    /Sweden|Germany|Bosnia|Poland|Denmark|QA operations|quality management/i,
  );
  assert.match(
    (recovered?.keyPoints ?? []).slice(0, 2).join(" "),
    /Sweden|Germany|Bosnia|Poland|Denmark|QA operations|quality management/i,
  );
});

test("organization capability slides reject fabricated customer scenarios without source evidence", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification uses Playwright, Selenium, Cypress, and Ranorex for automated testing and CI/CD integration.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 2,
      label: "core capabilities",
      kind: "entity-capabilities",
      focus: "Automation frameworks and CI/CD integration",
      objective:
        "What System Verification offers through automation frameworks and CI/CD integration",
      evidence:
        "System Verification uses Playwright, Selenium, Cypress, and Ranorex for automated testing and CI/CD integration.",
    },
    {
      title: "Automation frameworks and CI/CD integration",
      learningGoal:
        "See what System Verification offers through automation frameworks and CI/CD integration.",
      keyPoints: [
        "System Verification uses Playwright, Selenium, Cypress, and Ranorex for automated testing and CI/CD integration.",
        "Automation frameworks make regression checks repeatable inside the delivery pipeline.",
        "A regional logistics client reduced post-release defects by forty percent after System Verification deployed Cypress and Ranorex.",
      ],
      examples: [
        "A regional logistics client reduced post-release defects by forty percent after System Verification deployed Cypress and Ranorex.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /organization slide invents a customer|not present in the evidence|source-backed organization facts/i,
  );
});

test("organization capability slides reject named frameworks that are absent from grounding", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification offers advisory services, quality assurance support, and structured workshops.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 2,
      label: "core capabilities",
      kind: "entity-capabilities",
      focus: "Advisory services and quality assurance support",
      objective:
        "What System Verification offers through advisory services and quality assurance support",
      evidence:
        "System Verification offers advisory services, quality assurance support, and structured workshops.",
    },
    {
      title: "Automation frameworks and CI/CD integration",
      learningGoal:
        "See what System Verification offers through automation frameworks and CI/CD integration.",
      keyPoints: [
        "System Verification uses Playwright, Selenium, Cypress, and Ranorex for automated testing and CI/CD integration.",
        "Automation frameworks make regression checks repeatable inside the delivery pipeline.",
        "The organization connects test automation to client delivery pipelines.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /named tools|frameworks|CI\/CD details|unsupported implementation/i,
  );
});

test("plan-driven shaping removes unsupported framework examples from organization slides", () => {
  const shaped = applyPlanDrivenDeckShape(
    [
      {
        title: "System Verification",
        learningGoal: "See who System Verification is.",
        keyPoints: [
          "System Verification is a QA network based in the Nordics.",
          "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
          "System Verification offers quality assurance support.",
        ],
        examples: [],
        beginnerExplanation: "",
        advancedExplanation: "",
      },
      {
        title: "Core capabilities",
        learningGoal: "See what System Verification offers.",
        keyPoints: [
          "System Verification offers advisory services and structured workshops for quality assurance work.",
          "The organization supports teams with quality management and QA operations.",
          "Services include advisory support for identifying risks early.",
        ],
        examples: [
          "Playwright and Cypress for modern web application testing.",
          "Selenium and Ranorex for traditional and desktop application automation.",
        ],
        beginnerExplanation: "",
        advancedExplanation: "",
      },
    ],
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification offers advisory services, quality assurance support, and structured workshops.",
      ],
      plan: {
        title: "System Verification overview",
        recommendedSlideCount: 2,
        learningObjectives: [
          "Introduce System Verification.",
          "Explain advisory services and quality assurance support.",
        ],
        storyline: ["Who System Verification is", "Core capabilities"],
        audienceLevel: "beginner",
      },
    } as any,
  );

  assert.doesNotMatch(
    JSON.stringify(shaped[1]),
    /Playwright|Cypress|Selenium|Ranorex/i,
  );
});

test("organization slides reject synthetic deployment stories without explicit customer wording", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification validates data flows and custom features beyond standard ERP or CRM systems.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 2,
      label: "core capabilities",
      kind: "entity-capabilities",
      focus: "Data-flow validation and custom feature testing",
      objective:
        "What System Verification offers through data-flow validation and custom feature testing",
      evidence:
        "System Verification validates data flows and custom features beyond standard ERP or CRM systems.",
    },
    {
      title: "Data-flow validation and custom feature testing",
      learningGoal:
        "See what System Verification offers through data-flow validation and custom feature testing.",
      keyPoints: [
        "System Verification validates data flows and custom features beyond standard ERP or CRM systems.",
        "During a custom ERP and CRM transformation, System Verification validated end-to-end data flows through targeted workshops.",
        "The organization uses automated test suites to check integrations before deployment.",
      ],
      examples: [
        "During a custom ERP and CRM transformation, System Verification validated end-to-end data flows through targeted workshops.",
      ],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /organization slide invents a customer|deployment story|source-backed organization facts/i,
  );
});

test("organization onboarding slides reject second-person marketing copy", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification integrates QA operations into software delivery workflows and CI/CD pipelines.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 1,
      label: "how it works",
      kind: "entity-operations",
      focus: "How System Verification works in practice",
      objective:
        "How System Verification operates through delivery, teamwork, and quality workflows",
      evidence:
        "System Verification integrates QA operations into software delivery workflows and CI/CD pipelines.",
    },
    {
      title: "We Work: Nordic QA delivery",
      learningGoal:
        "See how System Verification works in practice through delivery, teamwork, and quality workflows.",
      keyPoints: [
        "System Verification operates as the leading QA network in the Nordics.",
        "Our advisory workshops embed specialists directly into your development pipelines.",
        "Predictive testing workflows begin with structured advisory sessions that map data flows and automation gaps, ensuring risks.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /third-person organization language|promotional|navigation copy|concrete claims/i,
  );
});

test("entity value slides are rejected when they lack a concrete example slot", () => {
  const assessment = assessGeneratedSlideDraft(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
      ],
    } as any,
    {
      slides: [],
    } as any,
    {
      index: 3,
      label: "practical value",
      kind: "entity-value",
      focus: "How System Verification creates value in practice",
      objective: "One concrete customer outcome that shows the company's value",
      evidence:
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
    },
    {
      title: "Where System Verification creates value",
      learningGoal: "See how one practical customer outcome shows where System Verification creates value.",
      keyPoints: [
        "A financial services client reduced post-deployment incidents by forty percent after a unified QA service replaced fragmented testing.",
        "That concrete result shows why the company mattered in a high-risk delivery context.",
        "The example is easier to understand when the slide stays close to one measurable consequence.",
      ],
      examples: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    } as any,
  );

  assert.equal(assessment.retryable, true);
  assert.match(
    assessment.reasons.join(" "),
    /concrete example in the example slot|value slide/i,
  );
});

test("organization role fallback points stay subject-facing instead of slide-meta language", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
    },
    {
      index: 1,
      label: "how it works",
      kind: "entity-operations",
      focus: "How System Verification works in practice",
      objective: "Delivery teams integrate QA operations into daily engineering work.",
      evidence:
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
    },
    [
      "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
    ],
  );

  assert.equal(points.length, 3);
  assert.doesNotMatch(points.join(" "), /\bslide\b/i);
  assert.doesNotMatch(points.join(" "), /\bshould\b/i);
});

test("workshop practice key points rank task-and-scenario evidence ahead of generic summary language", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
      },
    },
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      objective:
        "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      evidence:
        "Summarize meeting notes into action items for project follow-up.",
    },
    [
      "AI tools reduce information overload in project work.",
      "Summarize meeting notes into action items for project follow-up.",
      "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
    ],
  );

  assert.match(`${points[0]} ${points[1]}`, /meeting notes|workflow|constraint/i);
  assert.doesNotMatch(points[0] ?? "", /reduce information overload/i);
});

test("organization fallback points reject short fragmentary evidence phrases", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
    },
    {
      index: 2,
      label: "core capabilities",
      kind: "entity-capabilities",
      focus: "What System Verification offers and which capabilities define it",
      objective: "Core capabilities, services, and responsibilities",
      evidence: "Advisory services and workshops for engineering teams.",
    },
    [
      "Through advisory services and workshops.",
      "System Verification provides advisory services and workshops for engineering teams that need quality assurance support.",
      "System Verification offers project-specific QA support and quality management capabilities.",
    ],
  );

  assert.doesNotMatch(points.join(" "), /\bThrough advisory services and workshops\./i);
  assert.match(points.join(" "), /provides advisory services|project-specific QA support/i);
});

test("workshop practice learning goals use a stable audience-facing action phrase", () => {
  const goal = buildContractLearningGoal(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        deliveryFormat: "workshop",
        audienceCues: ["project managers", "product owners", "test leads"],
        activityRequirement:
          "Map one current work task to an AI-assisted workflow and identify one real constraint or policy boundary.",
      },
    },
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus:
        "Leave with one concrete way to practice Using AI tools in daily work through the workshop exercise.",
      objective:
        "Leave with one concrete way to practice Using AI tools in daily work through the workshop exercise.",
      evidence:
        "Summarize meeting notes into action items for project follow-up.",
    },
  );

  assert.equal(
    goal,
    "A practical exercise turns one real work artifact into a reviewable draft for AI-assisted work.",
  );
});

test("workshop practice fallback points avoid raw gerund subject phrasing", () => {
  const points = buildContractAnchoredKeyPoints(
    {
      topic: "Using AI tools in daily work",
      intent: {
        subject: "Using AI tools in daily work",
        deliveryFormat: "workshop",
        audienceCues: ["project managers", "product owners", "test leads"],
      },
    },
    {
      index: 3,
      label: "practical exercise",
      kind: "workshop-practice",
      focus: "One practical exercise that helps people use AI tools in daily work",
      objective: "One practical exercise that helps people use AI tools in daily work",
    },
    [],
  );

  assert.match(points.join(" "), /use AI tools|AI-assisted work|reusable prompt/i);
  assert.doesNotMatch(points.join(" "), /Using AI tools in daily work works/i);
  assert.doesNotMatch(points.join(" "), /using Using AI tools/i);
});

test("final teaching slides close with concrete content instead of question instructions", () => {
  const takeawayPoints = buildContractAnchoredKeyPoints(
    {
      topic: "SpongeBob SquarePants premiere",
      intent: {
        subject: "SpongeBob SquarePants premiere",
      },
    },
    {
      index: 3,
      label: "key takeaway",
      kind: "subject-takeaway",
      focus:
        "The premiere established a visual rhythm and character conflict that made the show memorable.",
      objective:
        "The premiere established a visual rhythm and character conflict that made the show memorable.",
      evidence:
        "The first episode introduced SpongeBob's optimism, Squidward's irritation, and the Krusty Krab setting.",
    },
    [
      "The first episode introduced SpongeBob's optimism, Squidward's irritation, and the Krusty Krab setting.",
      "Fast visual timing made the character contrast easy to understand.",
      "The opening story made the show's comic world feel specific.",
    ],
  );

  const organizationPoints = buildContractAnchoredKeyPoints(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
    },
    {
      index: 3,
      label: "practical consequence",
      kind: "entity-value",
      focus: "Evidence-backed consequence",
      objective: "Evidence-backed consequence",
      evidence:
        "System Verification helps teams reduce release risk through project-specific QA support.",
    },
    [
      "System Verification helps teams reduce release risk through project-specific QA support.",
      "Project-specific QA support makes release decisions easier to review.",
      "A concrete QA outcome is clearer than broad quality language.",
    ],
  );

  assert.doesNotMatch(takeawayPoints.join(" "), /closing question|final questions/i);
  assert.doesNotMatch(organizationPoints.join(" "), /closing question|final questions/i);
  assert.match(takeawayPoints.join(" "), /premiere|visual rhythm|comic world/i);
  assert.match(organizationPoints.join(" "), /release risk|QA support|release decisions/i);
});

test("subject implication recovery stays anchored to consequence instead of repeating the same detail", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "Corrupted Blood incident in World of Warcraft",
      intent: {
        subject: "World of Warcraft",
        focusAnchor: "Corrupted Blood plague event",
      },
      groundingHighlights: [
        "Players carried the debuff into crowded cities when they left the raid and pets retained the infection.",
        "Researchers noticed panic, avoidance, reckless exposure, and volunteer healing behavior during the outbreak.",
      ],
      groundingCoverageGoals: [
        "Why researchers cared about player behavior during the outbreak",
      ],
      plan: {
        learningObjectives: [
          "Explain why researchers treated the incident as a useful model.",
        ],
        storyline: ["Why researchers cared"],
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "What happened",
          examples: [],
          keyPoints: [
            "Players carried the debuff into crowded cities when they left the raid.",
          ],
        },
      ],
    } as any,
    {
      id: "slide-implication",
      order: 2,
      title: "Draft implication slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 2,
      label: "why it matters",
      kind: "subject-implication",
      focus: "Why researchers cared about player behavior during the outbreak",
      objective: "Explain what the observed behavior revealed about outbreak dynamics",
      evidence:
        "Researchers noticed panic, avoidance, reckless exposure, and volunteer healing behavior during the outbreak.",
    },
  );

  assert.ok(recovered);
  assert.match((recovered?.examples ?? []).join(" "), /panic|avoidance|healing/i);
  assert.match(recovered?.advancedExplanation ?? "", /consequence|significance|revealed/i);
});

test("source-backed recovery rejects non-slideable prompt coverage text", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "Spongebob Squarepants first episode that was aired in 1999",
      intent: {
        subject: "Spongebob Squarepants first episode that was aired in 1999",
        focusAnchor: "Help Wanted",
      },
      groundingHighlights: [
        "The first episode, Help Wanted, aired as a sneak peek on May 1, 1999 after the Kids' Choice Awards.",
        "The official series premiere followed on July 17, 1999.",
      ],
      groundingCoverageGoals: [
        "The specific case study or research angle requested in the prompt: Spongebob Squarepants first episode that was aired in 1999.",
        "The May 1, 1999 sneak peek and July 17, 1999 official premiere dates.",
      ],
      plan: {
        learningObjectives: ["Explain why the launch timing mattered."],
        storyline: ["Launch timing"],
      },
    } as any,
    { slides: [] } as any,
    {
      id: "slide-spongebob",
      order: 2,
      title: "Draft implication slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 2,
      label: "why the launch mattered",
      kind: "subject-implication",
      focus: "The significance of the 1999 premiere dates for SpongeBob SquarePants",
      objective: "Explain why the launch timing mattered.",
      evidence:
        "The first episode, Help Wanted, aired as a sneak peek on May 1, 1999 after the Kids' Choice Awards.",
    },
  );

  const visibleText = [
    ...(recovered?.keyPoints ?? []),
    ...(recovered?.examples ?? []),
    recovered?.beginnerExplanation ?? "",
  ].join(" ");
  assert.doesNotMatch(visibleText, /specific case study|requested in the prompt/i);
  assert.match(visibleText, /May 1, 1999|Help Wanted|Kids' Choice Awards/i);
});

test("subject detail recovery stays anchored to the concrete event instead of drifting into summary", () => {
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "Corrupted Blood incident in World of Warcraft",
      intent: {
        subject: "World of Warcraft",
        focusAnchor: "Corrupted Blood plague event",
      },
      groundingHighlights: [
        "A raid boss curse escaped into cities when players teleported away and pets retained the debuff.",
        "The outbreak spread rapidly through crowded hubs because infected players and pets continued interacting with others.",
      ],
      groundingCoverageGoals: [
        "How pets and player movement carried the debuff beyond the intended area",
      ],
      plan: {
        learningObjectives: [
          "Explain how pets and player movement spread the incident beyond the raid.",
        ],
        storyline: ["How it spread"],
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "What happened",
          examples: [],
          keyPoints: [
            "A raid boss curse escaped into cities when players teleported away.",
          ],
        },
      ],
    } as any,
    {
      id: "slide-detail",
      order: 1,
      title: "Draft detail slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 1,
      label: "concrete detail",
      kind: "subject-detail",
      focus: "How pets and player movement spread the incident beyond the raid",
      objective: "Explain how the outbreak escaped the intended raid area",
      evidence:
        "A raid boss curse escaped into cities when players teleported away and pets retained the debuff.",
    },
  );

  assert.ok(recovered);
  assert.match((recovered?.keyPoints ?? []).join(" "), /pets|teleported|debuff|cities/i);
  assert.match(
    recovered?.advancedExplanation ?? "",
    /pets|teleported|debuff|cities/i,
  );
});

test("plan-driven deck shaping repairs generic later-slide titles in source-backed subject decks", () => {
  const shaped = applyPlanDrivenDeckShape(
    [
      {
        title: "World of Warcraft",
        learningGoal: "See what the Corrupted Blood incident reveals and why it matters.",
        keyPoints: [
          "World of Warcraft is a persistent online world where social systems can be observed.",
          "The Corrupted Blood incident became a useful case because player behavior created visible outbreak patterns.",
          "The case ties a virtual event to larger questions about contagion and response.",
        ],
        beginnerExplanation:
          "The Corrupted Blood incident became a useful case because player behavior created visible outbreak patterns.",
        advancedExplanation:
          "The case ties a virtual event to larger questions about contagion and response.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "World of Warcraft",
        learningGoal: "Explain how pets and player movement spread the incident beyond the raid.",
        keyPoints: [
          "Players carried the debuff into crowded cities when they left the raid and pets retained the infection.",
          "The outbreak spread through hubs because infected pets and players continued interacting with others.",
          "The event escaped its intended area through normal travel and pet mechanics.",
        ],
        beginnerExplanation:
          "Players carried the debuff into crowded cities when they left the raid and pets retained the infection.",
        advancedExplanation:
          "The event escaped its intended area through normal travel and pet mechanics.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "World of Warcraft",
        learningGoal: "Explain why researchers treated the incident as a useful model.",
        keyPoints: [
          "Researchers noticed panic, avoidance, reckless exposure, and volunteer healing behavior during the outbreak.",
          "The event exposed social patterns that ordinary epidemiological models rarely observe directly.",
          "The case mattered because player choices amplified or dampened the outbreak.",
        ],
        beginnerExplanation:
          "Researchers noticed panic, avoidance, reckless exposure, and volunteer healing behavior during the outbreak.",
        advancedExplanation:
          "The case mattered because player choices amplified or dampened the outbreak.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "World of Warcraft",
        learningGoal: "Explain what the incident teaches about outbreak behavior.",
        keyPoints: [
          "The event showed how travel, trust, and risk-taking can reshape an outbreak faster than formal rules alone.",
          "Virtual worlds can expose behavioral patterns that also matter in real outbreaks.",
          "The strongest lesson is that social response changes contagion, not only biology or code.",
        ],
        beginnerExplanation:
          "Virtual worlds can expose behavioral patterns that also matter in real outbreaks.",
        advancedExplanation:
          "The strongest lesson is that social response changes contagion, not only biology or code.",
        examples: [],
        speakerNotes: [],
      },
    ] as any,
    {
      topic: "World of Warcraft",
      presentationBrief:
        "Create a short presentation about World of Warcraft. Include at least one slide about the Corrupted Blood plague event and explain why researchers were interested in it as a model of disease spread.",
      intent: {
        subject: "World of Warcraft",
        presentationFrame: "subject",
        focusAnchor: "Corrupted Blood plague event",
        explicitSourceUrls: ["https://en.wikipedia.org/wiki/Corrupted_Blood_incident"],
        presentationGoal:
          "Explain what happened, why it spread, why researchers cared, and what it teaches about disease spread.",
      },
      plan: {
        title: "Virtual plagues and disease spread",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Explain what the Corrupted Blood incident was.",
          "Explain how pets and player movement spread the incident beyond the raid.",
          "Explain why researchers treated the incident as a useful model.",
          "Explain what the incident teaches about outbreak behavior.",
        ],
        storyline: [
          "What happened",
          "How it spread",
          "Why researchers cared",
          "What it teaches",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "How pets and player movement carried the debuff beyond the intended area",
        "Why epidemiologists treated the incident as a useful observational case",
      ],
      groundingHighlights: [
        "A raid boss curse escaped into cities when players teleported away and pets retained the debuff.",
        "Researchers studied the event because player behavior exposed panic, risk-taking, and avoidance patterns.",
        "The incident showed how social behavior can amplify or dampen simulated outbreaks.",
      ],
    } as any,
  );

  assert.notEqual(shaped[1]?.title, "World of Warcraft");
  assert.notEqual(shaped[2]?.title, "World of Warcraft");
  assert.notEqual(shaped[3]?.title, "World of Warcraft");
});

test("plan-driven deck shaping refreshes stale visuals when slide content is repaired", () => {
  const shaped = applyPlanDrivenDeckShape(
    [
      {
        title: "System Verification",
        learningGoal: "See who System Verification is and why it matters.",
        keyPoints: [
          "System Verification provides structured software testing and QA services.",
          "The company works with complex engineering teams across multiple domains.",
          "Its teams help customers strengthen release quality and decision-making.",
        ],
        beginnerExplanation:
          "System Verification provides structured software testing and QA services.",
        advancedExplanation:
          "Its teams help customers strengthen release quality and decision-making.",
        examples: [],
        speakerNotes: [],
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          heroStatement:
            "Wherever you are in your quality journey, our solutions help you move forward safely and efficiently.",
          cards: [
            {
              id: "old-card-1",
              title: "Key point 1",
              body: "Wherever you are in your quality journey, our solutions help you move forward safely and efficiently.",
              tone: "accent",
            },
          ],
          callouts: [],
          diagramNodes: [
            {
              id: "old-node-1",
              label:
                "Whether you need expert support, project-specific QA, or strategic insights, we help you optimize software quality.",
              tone: "info",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        title: "System Verification",
        learningGoal: "See what System Verification does.",
        keyPoints: [
          "Generic quality message.",
          "Generic quality message.",
          "Generic quality message.",
        ],
        beginnerExplanation: "Generic quality message.",
        advancedExplanation: "Generic quality message.",
        examples: [],
        speakerNotes: [],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          heroStatement:
            "Whether you need expert support, project-specific QA, or strategic insights, we help you optimize software quality.",
          cards: [
            {
              id: "old-card-2",
              title: "Key point 1",
              body: "Whether you need expert support, project-specific QA, or strategic insights, we help you optimize software quality.",
              tone: "accent",
            },
          ],
          callouts: [],
          diagramNodes: [
            {
              id: "old-node-2",
              label:
                "Whether you need help with software testing, strategy, or actionable insights, we provide flexible QA services tailored to your needs.",
              tone: "info",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ] as any,
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 2,
        learningObjectives: [
          "Understand what System Verification is and why it matters.",
          "Explain how delivery, QA operations, and verification support work in practice.",
        ],
        storyline: [
          "Company overview",
          "Delivery and QA operations",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "QA operations and verification support for complex engineering teams",
      ],
      groundingHighlights: [
        "System Verification engineers execute structured testing cycles that align directly with development sprints and release schedules.",
        "Delivery teams track defect resolution metrics and generate compliance reports that integrate directly into project dashboards.",
      ],
    } as any,
  );

  assert.doesNotMatch(
    shaped[1]?.visuals?.cards?.map((card: { body: string }) => card.body).join(" ") ?? "",
    /Wherever you are in your quality journey|Whether you need expert support/i,
  );
  assert.equal(
    shaped[1]?.visuals?.cards?.[0]?.body,
    shaped[1]?.keyPoints?.[0],
  );
  assert.equal(
    shaped[1]?.visuals?.diagramNodes?.[0]?.label?.trim().length > 0,
    true,
  );
});

test("plan-driven deck shaping repairs crossed-over organization role slides", () => {
  const shaped = applyPlanDrivenDeckShape(
    [
      {
        title: "System Verification",
        learningGoal:
          "See who System Verification is, where it operates, and how a newcomer can place it in day-to-day work.",
        keyPoints: [
          "System Verification is an independent QA organization operating across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
          "The company integrates quality assurance into day-to-day engineering work for complex software teams.",
          "Its footprint and delivery model help newcomers place the organization quickly.",
        ],
        beginnerExplanation:
          "System Verification is an independent QA organization operating across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        advancedExplanation:
          "The company integrates quality assurance into day-to-day engineering work for complex software teams.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "What We Offer: Advisory services and workshops",
        learningGoal:
          "See how advisory services and workshops show how System Verification works in practice.",
        keyPoints: [
          "Flexible QA services cover software testing, quality management, and project-specific advisory support.",
          "Advisory workshops help teams map risks and identify where automated checks should be added.",
          "The company offers framework expertise through Playwright, Selenium, and Cypress.",
        ],
        beginnerExplanation:
          "Flexible QA services cover software testing, quality management, and project-specific advisory support.",
        advancedExplanation:
          "The company offers framework expertise through Playwright, Selenium, and Cypress.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "How We Work: Delivery across customer teams",
        learningGoal:
          "See how delivery teams and QA operations show what System Verification offers.",
        keyPoints: [
          "Delivery teams integrate quality assurance directly into sprint routines and release planning.",
          "QA operations align defect tracking and reporting with customer delivery workflows.",
          "The company works across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        ],
        beginnerExplanation:
          "Delivery teams integrate quality assurance directly into sprint routines and release planning.",
        advancedExplanation:
          "QA operations align defect tracking and reporting with customer delivery workflows.",
        examples: [],
        speakerNotes: [],
      },
      {
        title: "Advisory services and workshops",
        learningGoal:
          "See how advisory services and workshops create measurable value by supporting teams.",
        keyPoints: [
          "Advisory services and workshops help teams clarify scope before release.",
          "Flexible QA services support software testing and quality management across delivery teams.",
          "Framework expertise helps automate regression checks in CI/CD pipelines.",
        ],
        beginnerExplanation:
          "Advisory services and workshops help teams clarify scope before release.",
        advancedExplanation:
          "Framework expertise helps automate regression checks in CI/CD pipelines.",
        examples: [],
        speakerNotes: [],
      },
    ] as any,
    {
      topic: "System Verification",
      presentationBrief:
        "Create an onboarding presentation about our company. Use https://www.systemverification.com/ and https://www.systemverification.com/about-us for grounding.",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
        framing: "onboarding presentation about our company",
        presentationGoal:
          "Help a newcomer understand who System Verification is, what it offers, how it works, and where it creates value.",
      },
      plan: {
        title: "System Verification onboarding",
        recommendedSlideCount: 4,
        learningObjectives: [
          "Understand who System Verification is, where it operates, and how it fits into day-to-day work.",
          "Explain how delivery, QA operations, and verification support work in practice.",
          "Explain the company's main capabilities and services.",
          "Explain one practical customer outcome or example that shows the company's value.",
        ],
        storyline: [
          "Company overview",
          "Delivery and QA operations",
          "Capabilities and services",
          "Customer outcome",
        ],
        audienceLevel: "beginner",
      },
      groundingCoverageGoals: [
        "Delivery, QA operations, and verification support for complex engineering teams",
        "Flexible QA services cover software testing, quality management, and project-specific advisory support",
      ],
      groundingHighlights: [
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
        "Delivery teams integrate QA operations, verification support, and quality management into daily engineering work.",
        "Flexible QA services cover software testing, quality management, and project-specific advisory support.",
        "A customer example showed how earlier risk detection kept a complex delivery on schedule without disrupting daily work.",
      ],
    } as any,
  );

  assert.match(
    shaped[1]?.title ?? "",
    /where it operates and how it works|delivery, qa operations, and verification support work in practice/i,
  );
  assert.match(shaped[1]?.learningGoal ?? "", /works in practice/i);
  assert.doesNotMatch(
    `${shaped[1]?.title ?? ""} ${shaped[1]?.learningGoal ?? ""}`,
    /\bwhat we offer\b|\bservices\b|\bcapabilities\b/i,
  );
  assert.match(
    (shaped[1]?.keyPoints ?? []).join(" "),
    /\boperates\b|\bdelivery\b|\bday-to-day\b|\bqa operations\b/i,
  );

  assert.match(
    shaped[2]?.title ?? "",
    /core capabilities|focus areas|main capabilities and services/i,
  );
  assert.match(shaped[2]?.learningGoal ?? "", /\boffers\b|\bcapabilities\b/i);
  assert.doesNotMatch(
    `${shaped[2]?.title ?? ""} ${shaped[2]?.learningGoal ?? ""}`,
    /\bhow we work\b|\bworks in practice\b/i,
  );

  assert.match(shaped[3]?.learningGoal ?? "", /\bcreates value\b|concrete example/i);
});
