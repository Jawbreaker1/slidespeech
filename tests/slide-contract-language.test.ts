import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../packages/providers/src/llm/openai-compatible";

const {
  buildSlideFromPlainText,
  assessGeneratedSlideDraft,
  applyPlanDrivenDeckShape,
  buildSlideContracts,
  resolveSourceBackedCaseAnchor,
  buildContractAnchoredKeyPoints,
  buildContractLearningGoal,
  buildOutlineDeckSummary,
  buildProceduralOrientationKeyPoints,
  buildRoleSpecificSlideRecoveryFromContext,
  normalizePresentationPlan,
  shouldUseDeterministicSubjectOverviewSlide,
} = __testables;

test("procedural learning goals use direct observational language instead of awkward understand phrasing", () => {
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

  assert.match(introGoal, /^See\b/);
  assert.doesNotMatch(introGoal, /^Understand\b/);
  assert.match(qualityGoal, /^See\b/);
  assert.doesNotMatch(qualityGoal, /\bhow to\b/i);
});

test("procedural orientation key points stay declarative and non-imperative", () => {
  const points = buildProceduralOrientationKeyPoints("Making the perfect salsa dip");

  assert.equal(points.length, 3);
  for (const point of points) {
    assert.match(point, /^[A-Z]/);
    assert.match(point, /[.!?]$/);
    assert.doesNotMatch(point, /^(Use|Start|Taste|Add|Mix)\b/i);
  }
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
      ],
    },
    4,
  );

  assert.deepEqual(
    contracts.map((contract: { kind: string }) => contract.kind),
    ["orientation", "entity-capabilities", "entity-operations", "entity-value"],
  );

  const laterFoci = contracts
    .slice(1)
    .map((contract: { focus: string }) => contract.focus.trim().toLowerCase());
  assert.equal(new Set(laterFoci).size, laterFoci.length);
  assert.match(contracts.at(-1)?.evidence ?? "", /AI projects|Sweden|software testing/i);
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
  assert.match(contracts.at(-1)?.evidence ?? "", /workflow|meeting notes|constraint/i);
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
    /^Practice\b/,
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
  assert.match(recovered?.title ?? "", /workflow|AI-assisted|work task/i);
  assert.match((recovered?.examples ?? []).join(" "), /meeting notes|workflow/i);
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
  assert.match(recovered?.advancedExplanation ?? "", /concrete detail/i);
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
    shaped[1]?.visuals?.diagramNodes?.[0]?.label,
    shaped[1]?.keyPoints?.[0],
  );
});
