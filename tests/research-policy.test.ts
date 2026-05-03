import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResearchPlan,
  extractPresentationBrief,
  extractPresentationSubject,
  extractExplicitSourceUrls,
  mergeResearchPlanWithSuggestion,
  shouldUseWebResearchForTopic,
  stripExplicitSourceUrls,
  subjectIsGenericEntityReference,
  topicLooksEntitySpecific,
  topicLooksResearchSpecific,
  topicRequiresGroundedFacts,
  topicLooksTimeSensitive,
} from "../apps/api/src/services/research-policy";
import { buildGuessedOfficialUrls } from "../apps/api/src/services/web-research-service";

test("detects time-sensitive topics heuristically", () => {
  assert.equal(
    topicLooksTimeSensitive("Latest AI chip export restrictions in 2026"),
    true,
  );
  assert.equal(
    topicLooksTimeSensitive("What is a state machine and why it helps runtimes"),
    false,
  );
});

test("explicit web research override wins over heuristic", () => {
  assert.equal(
    shouldUseWebResearchForTopic({
      topic: "How to explain recursion",
      requestedUseWebResearch: true,
    }),
    true,
  );
  assert.equal(
    shouldUseWebResearchForTopic({
      topic: "Latest company earnings",
      requestedUseWebResearch: false,
    }),
    false,
  );
});

test("explicitly disabled web research does not require grounding for heuristic entity topics", () => {
  const plan = buildResearchPlan({
    topic: "Create a concise 4-slide presentation about why API startup validation matters for demos.",
    requestedUseWebResearch: false,
  });

  assert.equal(plan.requiresGroundedFacts, false);
  assert.equal(
    shouldUseWebResearchForTopic({
      topic: "Create a concise 4-slide presentation about why API startup validation matters for demos.",
      requestedUseWebResearch: false,
    }),
    false,
  );
});

test("explicit source urls still require grounding when web research is disabled", () => {
  const plan = buildResearchPlan({
    topic: "Create a company presentation. Use https://www.systemverification.com/ for grounding.",
    requestedUseWebResearch: false,
  });

  assert.equal(plan.requiresGroundedFacts, true);
});

test("extracts and normalizes explicit source urls from the topic prompt", () => {
  assert.deepEqual(
    extractExplicitSourceUrls(
      "Create a company overview for System Verification. More info: www.systemverification.com.",
    ),
    ["https://www.systemverification.com/"],
  );
  assert.equal(
    stripExplicitSourceUrls(
      "Create a company overview for System Verification. More info: www.systemverification.com.",
    ),
    "Create a company overview for System Verification. More info:",
  );
});

test("detects company and organization prompts as requiring grounded research", () => {
  assert.equal(
    topicLooksEntitySpecific("Create a company presentation about System Verification"),
    true,
  );
  assert.equal(
    topicRequiresGroundedFacts("Create a company presentation about System Verification"),
    true,
  );
  assert.equal(
    shouldUseWebResearchForTopic({
      topic: "Create a company presentation about System Verification",
    }),
    true,
  );
});

test("detects brand and presentation-about prompts as requiring grounded research", () => {
  assert.equal(
    topicLooksEntitySpecific("Make a presentation about Volvo for children"),
    true,
  );
  assert.equal(
    shouldUseWebResearchForTopic({
      topic: "Make a presentation about Volvo for children",
    }),
    true,
  );
});

test("does not force grounded research for generic how-to presentation prompts", () => {
  const topic = "Create a short presentation about how to make the perfect salsa dip.";

  assert.equal(topicLooksEntitySpecific(topic), false);
  assert.equal(topicRequiresGroundedFacts(topic), false);
  assert.equal(
    shouldUseWebResearchForTopic({
      topic,
    }),
    false,
  );
});

test("builds procedural coverage goals for generic how-to prompts", () => {
  const plan = buildResearchPlan({
    topic: "Create a short presentation about how to make the perfect salsa dip.",
  });

  assert.ok(plan.coverageGoals.includes("Essential ingredients"));
  assert.ok(plan.coverageGoals.includes("Key preparation steps"));
  assert.ok(plan.coverageGoals.includes("Taste, texture, and adjustment"));
  assert.equal(
    plan.coverageGoals.some((goal) => /core mechanisms|real-world application/i.test(goal)),
    false,
  );
});

test("buildResearchPlan uses a cleaned subject for imperative entertainment prompts", () => {
  const topic =
    "Present spongebob squarepants and his adventures in bikinibottom. Who created the series and when did it start airing.";
  const plan = buildResearchPlan({ topic });

  assert.equal(
    plan.subject,
    "Spongebob squarepants and his adventures in bikinibottom",
  );
  assert.ok(
    plan.searchQueries.some(
      (query) =>
        query === "Spongebob squarepants and his adventures in bikinibottom",
    ),
  );
  assert.equal(
    plan.searchQueries.some((query) => /who created the series/i.test(query)),
    false,
  );
});

test("builds guessed official urls for compact brand prompts", () => {
  assert.deepEqual(
    buildGuessedOfficialUrls(
      "Make a presentation about Volvo for an audience of children. Make sure to add many pictures of cars.",
    ),
    [
      "https://www.volvo.com/",
      "https://volvo.com/",
      "https://www.volvocars.com/",
      "https://www.volvocars.com/intl/",
    ],
  );
});

test("builds direct site guesses for car-brand subjects without duplicated cars suffixes", () => {
  assert.deepEqual(
    buildGuessedOfficialUrls("Volvo Cars"),
    [
      "https://www.volvocars.com/",
      "https://volvocars.com/",
      "https://www.volvocars.com/intl/",
    ],
  );
});

test("builds a research plan with direct urls and targeted queries", () => {
  const plan = buildResearchPlan({
    topic: "Create a company presentation about System Verification. More info: https://www.systemverification.com/",
  });

  assert.equal(plan.subject, "System Verification");
  assert.equal(plan.requiresGroundedFacts, true);
  assert.ok(plan.directUrls.includes("https://www.systemverification.com/"));
  assert.ok(plan.searchQueries.some((query) => /official/i.test(query)));
  assert.ok(plan.coverageGoals.length >= 2);
});

test("buildResearchPlan preserves multiple explicit urls for direct grounding", () => {
  const plan = buildResearchPlan({
    topic: "Create an onboarding presentation about our company. Use https://www.systemverification.com/ and https://www.systemverification.com/about-us for grounding.",
  });

  assert.ok(plan.directUrls.includes("https://www.systemverification.com/"));
  assert.ok(plan.directUrls.includes("https://www.systemverification.com/about-us"));
});

test("buildResearchPlan does not leak google instructions into search queries", () => {
  const plan = buildResearchPlan({
    topic:
      "Create a short presentation about the Corrupted Blood incident in World of Warcraft. Use Google for additional information.",
  });

  assert.equal(
    plan.searchQueries.some((query) => /\buse google\b|\badditional information\b/i.test(query)),
    false,
  );
  assert.ok(plan.searchQueries.some((query) => /corrupted blood/i.test(query)));
});

test("builds organization-focused coverage goals for company-overview prompts", () => {
  const plan = buildResearchPlan({
    topic:
      "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
  });

  assert.notEqual(plan.subject, "Our company");
  assert.match(plan.subject, /systemverification/i);
  assert.ok(
    plan.coverageGoals.some((goal) =>
      /what .* does and (?:why it matters|where it creates value)/i.test(goal),
    ),
  );
  assert.ok(
    plan.coverageGoals.some((goal) =>
      /services, capabilities, or focus areas connected to /i.test(goal),
    ),
  );
  assert.ok(plan.searchQueries.some((query) => /systemverification/i.test(query)));
});

test("extracts presentation brief and subject separately from an instructional prompt", () => {
  assert.equal(
    extractPresentationBrief(
      "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
    ),
    "onboarding presentation about our company",
  );
  assert.equal(
    extractPresentationSubject(
      "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
    ),
    "Our company",
  );
  assert.equal(subjectIsGenericEntityReference("Our company"), true);
});

test("builds a freshness-sensitive research plan for current topics", () => {
  const plan = buildResearchPlan({
    topic: "Latest OpenAI announcements in 2026",
  });

  assert.equal(plan.freshnessSensitive, true);
  assert.ok(plan.searchQueries.some((query) => /latest/i.test(query)));
  assert.equal(plan.maxResults, 4);
});

test("detects research-specific prompts and avoids guessed official urls", () => {
  const topic =
    "Create a short presentation about World of Warcraft. Include at least one slide about the Corrupted Blood plague event and explain why researchers were interested in it as a model of disease spread.";
  const plan = buildResearchPlan({ topic });

  assert.equal(topicLooksResearchSpecific(topic), true);
  assert.equal(plan.requiresGroundedFacts, true);
  assert.equal(plan.directUrls.length, 0);
  assert.match(plan.searchQueries[0] ?? "", /corrupted blood/i);
  assert.equal(plan.searchQueries.includes("World of Warcraft"), false);
  assert.ok(
    plan.searchQueries.some((query) => /corrupted blood/i.test(query)),
  );
  assert.ok(
    plan.coverageGoals.some((goal) => /corrupted blood plague event/i.test(goal)),
  );
  assert.ok(
    plan.coverageGoals.some((goal) => /why researchers were interested/i.test(goal)),
  );
  assert.equal(
    plan.coverageGoals.some((goal) => /requested in the prompt/i.test(goal)),
    false,
  );
});

test("requested coverage goals suppress generic fallback coverage phrasing", () => {
  const topic =
    "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.";
  const plan = buildResearchPlan({ topic });

  assert.ok(
    plan.coverageGoals.some((goal) => /how project managers, product owners, and test leads can use ai tools in their daily work/i.test(goal)),
  );
  assert.ok(
    plan.coverageGoals.some((goal) => /project managers|product owners|test leads/i.test(goal)),
  );
  assert.ok(
    plan.coverageGoals.some((goal) => /VGR|Västra Götalandsregionen/i.test(goal)),
  );
  assert.ok(
    plan.coverageGoals.some((goal) => /practical exercise|audience/i.test(goal)),
  );
  assert.equal(
    plan.coverageGoals.some((goal) => /defining ideas behind|real-world application/i.test(goal)),
    false,
  );
  assert.equal(
    plan.coverageGoals.some((goal) => /what .* is and why it matters/i.test(goal)),
    false,
  );
});

test("merges llm-assisted research planning conservatively", () => {
  const basePlan = buildResearchPlan({
    topic: "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
  });

  const merged = mergeResearchPlanWithSuggestion({
    basePlan,
    topic:
      "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
    suggestion: {
      subject: "System Verification Company Profile and Service Portfolio",
      searchQueries: [
        "System Verification official",
        "System Verification QA operations",
        "presentation layout examples",
      ],
      coverageGoals: [
        "Document the company’s core services and quality focus.",
        "Show how quality management and QA operations fit together.",
        "Avoid talking about slide templates.",
      ],
      rationale: [
        "The explicit company site should remain the primary source.",
      ],
    },
  });

  assert.equal(merged.subject, "System Verification");
  assert.ok(merged.searchQueries.includes("System Verification official"));
  assert.ok(merged.searchQueries.includes("System Verification QA operations"));
  assert.equal(merged.searchQueries.includes("our company"), false);
  assert.equal(
    merged.searchQueries.includes("presentation layout examples"),
    false,
  );
  assert.ok(
    merged.coverageGoals.some((goal) => /core services/i.test(goal)),
  );
  assert.equal(
    merged.coverageGoals.some((goal) => /our company/i.test(goal)),
    false,
  );
  assert.equal(
    merged.coverageGoals.some((goal) => /slide templates/i.test(goal)),
    false,
  );
  assert.equal(merged.planningMode, "llm-assisted");
});
