import test from "node:test";
import assert from "node:assert/strict";

import { buildGroundingBundle, deriveGroundingExcerpts } from "../apps/api/src/services/grounding-selection";

test("buildGroundingBundle prefers classified highlights, excerpts, and relevant source urls when available", () => {
  const findings = [
    {
      url: "https://www.systemverification.com/about-us",
      title: "About us",
      content:
        "System Verification was founded in 2002 as Sweden's first company dedicated exclusively to quality assurance. The company operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
    },
    {
      url: "https://www.systemverification.com/",
      title: "System Verification",
      content:
        "System Verification is the leading QA network in the Nordics, combining predictive testing, strategic intelligence, and advisory services.",
    },
  ];

  const bundle = buildGroundingBundle({
    subject: "System Verification",
    coverageGoals: ["Who the company is", "Where it operates"],
    findings,
    classification: {
      highlights: [
        "System Verification was founded in 2002 as Sweden's first QA-only company.",
        "It operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
      ],
      excerpts: [
        "System Verification was founded in 2002 as Sweden's first company dedicated exclusively to quality assurance.",
        "The company operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
      ],
      relevantSourceUrls: ["https://www.systemverification.com/about-us"],
      facts: [
        {
          id: "fact_identity",
          role: "identity",
          claim: "System Verification was founded in 2002 as Sweden's first QA-only company.",
          evidence:
            "System Verification was founded in 2002 as Sweden's first company dedicated exclusively to quality assurance.",
          sourceIds: ["https://www.systemverification.com/about-us"],
          confidence: "high",
        },
        {
          id: "fact_footprint",
          role: "footprint",
          claim:
            "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
          evidence:
            "The company operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
          sourceIds: ["https://www.systemverification.com/about-us"],
          confidence: "high",
        },
      ],
      sourceAssessments: [
        {
          url: "https://www.systemverification.com/about-us",
          title: "About us",
          role: "identity",
          relevance: "high",
          notes: "Contains identity and footprint facts.",
        },
        {
          url: "https://www.systemverification.com/",
          title: "System Verification",
          role: "junk",
          relevance: "junk",
          notes: "Mostly broad marketing copy.",
        },
      ],
    },
  });

  assert.deepEqual(bundle.groundingSourceIds, [
    "https://www.systemverification.com/about-us",
  ]);
  assert.equal(bundle.groundingCoverageGoals[0], "Who the company is");
  assert.equal(bundle.groundingCoverageGoals[1], "Where it operates");
  assert.ok(
    bundle.groundingCoverageGoals.some((value) =>
      /Identity or definition details for System Verification/i.test(value),
    ),
  );
  assert.match(bundle.groundingHighlights[0] ?? "", /founded in 2002/i);
  assert.match(bundle.groundingHighlights[1] ?? "", /Germany|Denmark/i);
  assert.ok(bundle.groundingExcerpts.length >= 2);
  assert.match(bundle.groundingExcerpts[0] ?? "", /quality assurance/i);
  assert.match(bundle.groundingExcerpts[1] ?? "", /Bosnia and Herzegovina|Denmark/i);
  assert.ok(bundle.groundingFacts.length >= 2);
  assert.deepEqual(
    bundle.groundingFacts.slice(0, 2).map((fact) => fact.role),
    ["identity", "footprint"],
  );
  assert.match(bundle.groundingFacts[1]?.claim ?? "", /Germany|Denmark/i);
});

test("buildGroundingBundle falls back to heuristic grounding when classification is empty", () => {
  const findings = [
    {
      url: "https://www.example.com/history",
      title: "History",
      content:
        "In 1999 the first episode aired and introduced the main characters to viewers. The episode established the comic tone and pacing that shaped the rest of the series.",
    },
  ];

  const bundle = buildGroundingBundle({
    subject: "SpongeBob SquarePants",
    coverageGoals: ["When the series first premiered", "How the premiere set the tone"],
    findings,
    classification: {
      highlights: [],
      excerpts: [],
      relevantSourceUrls: [],
      sourceAssessments: [],
    },
  });

  assert.ok(bundle.groundingHighlights.length > 0);
  assert.ok(bundle.groundingExcerpts.length > 0);
  assert.ok(bundle.groundingCoverageGoals.length >= 2);
  assert.deepEqual(bundle.groundingSourceIds, ["https://www.example.com/history"]);
  assert.ok(bundle.groundingFacts.length > 0);
  assert.equal(bundle.groundingFacts[0]?.role, "reference");
});

test("deriveGroundingExcerpts ranks concrete, goal-overlapping sentences ahead of generic filler", () => {
  const excerpts = deriveGroundingExcerpts({
    subject: "System Verification",
    coverageGoals: ["Where it operates", "When it was founded"],
    findings: [
      {
        url: "https://www.systemverification.com/about-us",
        title: "About us",
        content:
          "System Verification was founded in 2002 as Sweden's first company dedicated exclusively to quality assurance. The company operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark. The homepage also describes broad advisory value and collaboration.",
      },
    ],
  });

  assert.match(excerpts[0] ?? "", /founded in 2002|operates across Sweden/i);
  assert.ok(excerpts.length >= 2);
});

test("buildGroundingBundle deduplicates equivalent source urls with and without www", () => {
  const bundle = buildGroundingBundle({
    subject: "System Verification",
    coverageGoals: ["Who the company is"],
    findings: [
      {
        url: "https://www.systemverification.com/",
        title: "Home",
        content: "System Verification was founded in 2002.",
      },
      {
        url: "https://systemverification.com/",
        title: "Home duplicate",
        content: "System Verification works across several countries.",
      },
    ],
    classification: null,
  });

  assert.equal(bundle.groundingSourceIds.length, 1);
  assert.equal(bundle.groundingSourceIds[0], "https://www.systemverification.com/");
});
