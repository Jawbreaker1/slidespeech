import test from "node:test";
import assert from "node:assert/strict";

import type { GenerateDeckInput } from "@slidespeech/types";
import { buildSlideBriefs } from "../packages/providers/src/llm/deck-blueprint";
import { buildSlideContracts } from "../packages/providers/src/llm/slide-contract-builder";

const organizationInput: GenerateDeckInput = {
  topic: "System Verification",
  presentationBrief: "Create an onboarding overview for a new employee.",
  intent: {
    subject: "System Verification",
    framing: "Create an onboarding overview for a new employee.",
    presentationFrame: "organization",
    explicitSourceUrls: ["https://www.systemverification.com/about-us"],
    coverageRequirements: ["Who the company is", "How it works", "What it offers"],
    audienceCues: ["new employee"],
    organization: "System Verification",
    presentationGoal: "Orient a newcomer to the organization.",
    deliveryFormat: "presentation",
  },
  pedagogicalProfile: {
    audienceLevel: "beginner",
    tone: "supportive and concrete",
    pace: "balanced",
    preferredExampleStyle: "real_world",
    wantsFrequentChecks: true,
    detailLevel: "standard",
  },
  groundingFacts: [
    {
      id: "fact_identity",
      role: "identity",
      claim: "System Verification was founded in 2002 as a QA-focused company.",
      evidence: "System Verification was founded in 2002.",
      sourceIds: ["https://www.systemverification.com/about-us"],
      confidence: "high",
    },
    {
      id: "fact_operations",
      role: "operations",
      claim: "System Verification works through expert QA support and project teams.",
      evidence: "The company describes expert QA support and project-specific work.",
      sourceIds: ["https://www.systemverification.com/services"],
      confidence: "high",
    },
    {
      id: "fact_capabilities",
      role: "capabilities",
      claim: "System Verification offers quality assurance services and testing expertise.",
      evidence: "The services page describes quality assurance and testing expertise.",
      sourceIds: ["https://www.systemverification.com/services"],
      confidence: "high",
    },
    {
      id: "fact_example",
      role: "example",
      claim: "A concrete customer outcome is used as the value proof.",
      evidence: "A customer case describes the outcome.",
      sourceIds: ["https://www.systemverification.com/cases"],
      confidence: "medium",
    },
  ],
  targetSlideCount: 4,
};

test("buildSlideBriefs scopes organization facts to matching slide roles", () => {
  const contracts = buildSlideContracts(organizationInput, 4);
  const briefs = buildSlideBriefs(organizationInput, contracts);
  const operationsIndex = contracts.findIndex(
    (contract) => contract.kind === "entity-operations",
  );
  const capabilitiesIndex = contracts.findIndex(
    (contract) => contract.kind === "entity-capabilities",
  );
  const valueIndex = contracts.findIndex(
    (contract) => contract.kind === "entity-value",
  );

  assert.equal(briefs.length, 4);
  assert.equal(briefs[0]?.evidenceFactIds[0], "fact_identity");
  assert.ok(operationsIndex > -1);
  assert.ok(capabilitiesIndex > -1);
  assert.ok(valueIndex > -1);
  assert.ok(briefs[operationsIndex]?.evidenceFactIds.includes("fact_operations"));
  assert.ok(briefs[capabilitiesIndex]?.evidenceFactIds.includes("fact_capabilities"));
  assert.ok(briefs[valueIndex]?.evidenceFactIds.includes("fact_example"));
  assert.match(briefs.at(-1)?.closingIntent ?? "", /questions are welcome/i);
});

test("buildSlideBriefs preserves distinctness through forbidden overlap", () => {
  const contracts = buildSlideContracts(organizationInput, 4);
  const briefs = buildSlideBriefs(organizationInput, contracts);

  assert.ok((briefs[1]?.forbiddenOverlap.length ?? 0) > 0);
  assert.ok(
    briefs[2]?.forbiddenOverlap.some((value) =>
      /System Verification works through expert QA support/i.test(value),
    ),
  );
});
