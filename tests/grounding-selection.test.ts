import test from "node:test";
import assert from "node:assert/strict";

import { buildGroundingBundle, deriveGroundingExcerpts } from "../apps/api/src/services/grounding-selection";

test("buildGroundingBundle accepts useful LLM-classified facts that are source-supported", () => {
  const bundle = buildGroundingBundle({
    subject: "System Verification",
    coverageGoals: ["Who the company is", "Where it operates"],
    findings: [
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
          "System Verification describes predictive testing, strategic intelligence, and advisory services for software quality work.",
      },
    ],
    classification: {
      highlights: [
        "System Verification was founded in 2002 as Sweden's first quality assurance company.",
        "System Verification operates across Sweden, Germany, Bosnia and Herzegovina, Poland, and Denmark.",
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
          claim:
            "System Verification was founded in 2002 as Sweden's first quality assurance company.",
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
  assert.equal(bundle.groundingFacts.length, 2);
  assert.deepEqual(
    bundle.groundingFacts.map((fact) => fact.id),
    ["fact_identity", "fact_footprint"],
  );
  assert.match(bundle.groundingHighlights.join(" "), /founded in 2002/i);
});

test("buildGroundingBundle does not synthesize facts when classification is empty", () => {
  const bundle = buildGroundingBundle({
    subject: "Example product",
    coverageGoals: ["What the product does", "Where it is used"],
    findings: [
      {
        url: "https://example.com/product",
        title: "Example product",
        content:
          "Example product provides approval workflows and audit logs for regulated teams.",
      },
    ],
    classification: {
      highlights: [],
      excerpts: [],
      relevantSourceUrls: [],
      facts: [],
      sourceAssessments: [],
    },
  });

  assert.deepEqual(bundle.groundingHighlights, []);
  assert.deepEqual(bundle.groundingExcerpts, []);
  assert.deepEqual(bundle.groundingFacts, []);
  assert.deepEqual(bundle.groundingSourceIds, ["https://example.com/product"]);
});

test("buildGroundingBundle rejects malformed, unsupported, and low-value classified facts without fallback synthesis", () => {
  const bundle = buildGroundingBundle({
    subject: "Example product",
    coverageGoals: ["What the product does"],
    findings: [
      {
        url: "https://example.com/product",
        title: "Example product",
        content:
          "Example product coordinates approval workflows and audit logs for regulated teams.",
      },
    ],
    classification: {
      highlights: [
        "Example product provides approval workflows for regulated teams.",
      ],
      excerpts: [
        "Example product provides approval workflows and audit logs for regulated teams.",
      ],
      relevantSourceUrls: ["https://example.com/product"],
      facts: [
        {
          id: "bad_bullet",
          role: "capabilities",
          claim:
            "- Example product provides approvals. - Example product stores audit logs.",
          evidence:
            "Example product provides approval workflows and audit logs for regulated teams.",
          sourceIds: ["https://example.com/product"],
          confidence: "high",
        },
        {
          id: "bad_fragment",
          role: "timeline",
          claim: "Created in,",
          evidence: "Created in 2024.",
          sourceIds: ["https://example.com/product"],
          confidence: "high",
        },
        {
          id: "unsupported",
          role: "value",
          claim:
            "Example product became the global standard for public-sector procurement.",
          evidence:
            "Example product became the global standard for public-sector procurement.",
          sourceIds: ["https://example.com/product"],
          confidence: "high",
        },
      ],
      sourceAssessments: [
        {
          url: "https://example.com/product",
          title: "Example product",
          role: "capabilities",
          relevance: "high",
          notes: "Contains product capabilities.",
        },
      ],
    },
  });

  assert.deepEqual(bundle.groundingFacts, []);
  assert.ok(
    bundle.groundingExcerpts.some((excerpt) => /approval workflows/i.test(excerpt)),
  );
});

test("buildGroundingBundle rejects classified facts that are only supported by the prompt", () => {
  const bundle = buildGroundingBundle({
    subject: "Molted Email",
    coverageGoals: [
      "What Molted Email is and why it matters",
      "the creator Magnus Junghard Jägryd",
    ],
    findings: [
      {
        url: "https://molted.email/",
        title: "Molted Email",
        content:
          "Molted Email is email infrastructure for AI agents. It checks policy rules before sending and scans inbound replies for prompt injection.",
      },
    ],
    classification: {
      highlights: [
        "Molted Email checks policy rules before sending.",
        "The creator is Magnus Junghard Jägryd.",
      ],
      excerpts: [
        "Molted Email is email infrastructure for AI agents.",
        "Magnus Junghard Jägryd",
      ],
      relevantSourceUrls: ["https://molted.email/"],
      facts: [
        {
          id: "fact_product",
          role: "identity",
          claim: "Molted Email is email infrastructure for AI agents.",
          evidence: "Molted Email is email infrastructure for AI agents.",
          sourceIds: ["https://molted.email/"],
          confidence: "high",
        },
        {
          id: "fact_creator",
          role: "identity",
          claim: "Magnus Junghard Jägryd is the creator of Molted Email.",
          evidence: "Magnus Junghard Jägryd",
          sourceIds: ["https://molted.email/"],
          confidence: "high",
        },
      ],
      sourceAssessments: [
        {
          url: "https://molted.email/",
          title: "Molted Email",
          role: "identity",
          relevance: "high",
          notes: "Contains product identity and operations.",
        },
      ],
    },
  });

  assert.deepEqual(
    bundle.groundingFacts.map((fact) => fact.id),
    ["fact_product"],
  );
  assert.doesNotMatch(
    [
      ...bundle.groundingHighlights,
      ...bundle.groundingExcerpts,
      ...bundle.groundingFacts.flatMap((fact) => [fact.claim, fact.evidence]),
    ].join(" "),
    /Junghard|Jägryd|creator/i,
  );
});

test("buildGroundingBundle preserves explicit side coverage when the side source is classified and source-supported", () => {
  const bundle = buildGroundingBundle({
    subject: "Molted Email",
    coverageGoals: [
      "What Molted Email is and why it matters",
      "Creator background for Magnus Junghard Jägryd",
    ],
    findings: [
      {
        url: "https://molted.email/",
        title: "Molted Email",
        content:
          "Molted Email is email infrastructure for AI agents. It checks policy rules before sending and scans inbound replies for prompt injection.",
      },
      {
        url: "https://example.com/magnus-junghard-jagryd",
        title: "Magnus Junghard Jägryd",
        content:
          "Magnus Junghard Jägryd created privacy-minded developer tools for AI agents and focuses on safer communication workflows.",
      },
    ],
    classification: {
      highlights: [
        "Molted Email is email infrastructure for AI agents.",
        "Magnus Junghard Jägryd created privacy-minded developer tools for AI agents.",
      ],
      excerpts: [
        "Molted Email is email infrastructure for AI agents.",
        "Magnus Junghard Jägryd created privacy-minded developer tools for AI agents and focuses on safer communication workflows.",
      ],
      relevantSourceUrls: [
        "https://molted.email/",
        "https://example.com/magnus-junghard-jagryd",
      ],
      facts: [
        {
          id: "fact_product",
          role: "identity",
          claim: "Molted Email is email infrastructure for AI agents.",
          evidence: "Molted Email is email infrastructure for AI agents.",
          sourceIds: ["https://molted.email/"],
          confidence: "high",
        },
        {
          id: "fact_creator_background",
          role: "background",
          claim:
            "Magnus Junghard Jägryd created privacy-minded developer tools for AI agents.",
          evidence:
            "Magnus Junghard Jägryd created privacy-minded developer tools for AI agents.",
          sourceIds: ["https://example.com/magnus-junghard-jagryd"],
          confidence: "high",
        },
      ],
      sourceAssessments: [
        {
          url: "https://molted.email/",
          title: "Molted Email",
          role: "identity",
          relevance: "high",
          notes: "Contains product identity.",
        },
        {
          url: "https://example.com/magnus-junghard-jagryd",
          title: "Magnus Junghard Jägryd",
          role: "background",
          relevance: "high",
          notes: "Contains requested creator background coverage.",
        },
      ],
    },
  });

  assert.ok(
    bundle.groundingSourceIds.includes("https://example.com/magnus-junghard-jagryd"),
  );
  assert.ok(
    bundle.groundingFacts.some((fact) =>
      /Magnus Junghard Jägryd created privacy-minded developer tools/i.test(
        fact.claim,
      ),
    ),
  );
});

test("buildGroundingBundle rejects adjacent generic sources that do not mention the requested entity", () => {
  const bundle = buildGroundingBundle({
    subject: "The brand and cars Ferarri",
    coverageGoals: ["What The brand and cars Ferarri is and why it matters"],
    findings: [
      {
        url: "https://www.ama.org/brand-strategy",
        title: "How brand strategy drives business growth",
        content:
          "A strong brand is designed to get people to buy more, pay more, make quicker purchasing decisions and stick with the company until they become brand advocates.",
      },
      {
        url: "https://www.ama.org/tangible-marketing",
        title: "Marketing's overlooked advantage",
        content:
          "Well-designed tangible marketing often outperforms expectations when it comes to brand recall and loyalty.",
      },
    ],
    classification: {
      highlights: [
        "A strong brand is designed to get people to buy more and make quicker purchasing decisions.",
      ],
      excerpts: [
        "Well-designed tangible marketing often outperforms expectations when it comes to brand recall and loyalty.",
      ],
      relevantSourceUrls: ["https://www.ama.org/brand-strategy"],
      facts: [
        {
          id: "generic_brand_fact",
          role: "value",
          claim:
            "A strong brand is designed to get people to buy more and make quicker purchasing decisions.",
          evidence:
            "A strong brand is designed to get people to buy more, pay more, make quicker purchasing decisions.",
          sourceIds: ["https://www.ama.org/brand-strategy"],
          confidence: "high",
        },
      ],
      sourceAssessments: [
        {
          url: "https://www.ama.org/brand-strategy",
          title: "How brand strategy drives business growth",
          role: "value",
          relevance: "medium",
          notes: "Generic brand strategy, not the requested entity.",
        },
      ],
    },
  });

  assert.deepEqual(bundle.groundingSourceIds, []);
  assert.deepEqual(bundle.groundingHighlights, []);
  assert.deepEqual(bundle.groundingFacts, []);
});

test("deriveGroundingExcerpts filters source artifacts and keeps useful source sentences", () => {
  const excerpts = deriveGroundingExcerpts({
    subject: "Example product",
    coverageGoals: ["What the product does"],
    findings: [
      {
        url: "https://example.com/product",
        title: "Example product",
        content:
          "Example product provides approval workflows for regulated teams. [ 2 ] [ 3 ] As of November 28, 2025, [update] the page lists archived source metadata.",
      },
    ],
  });

  assert.ok(excerpts.length > 0);
  assert.match(excerpts.join(" "), /approval workflows/i);
  assert.ok(excerpts.every((excerpt) => !/\[update\]|\[\s*\d+\s*\]/i.test(excerpt)));
});

test("deriveGroundingExcerpts does not split source sentences at common abbreviations", () => {
  const excerpts = deriveGroundingExcerpts({
    subject: "Example training",
    coverageGoals: ["How the training works"],
    findings: [
      {
        url: "https://example.com/training",
        title: "Example training",
        content:
          "Example training uses role play with Dr. Rivera and Mrs. Chen so teams can practice escalation decisions.",
      },
    ],
  });

  assert.match(excerpts.join(" "), /Dr\. Rivera and Mrs\. Chen/);
  assert.doesNotMatch(excerpts.join(" "), /Mrs\.$/);
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
