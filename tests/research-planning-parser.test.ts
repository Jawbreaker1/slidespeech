import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeResearchPlanningSuggestion,
  parseResearchPlanningText,
} from "../packages/providers/src/llm/research-planning";

const baseInput = {
  topic: "Create a presentation about System Verification",
  heuristicSubject: "System Verification",
  heuristicQueries: ["System Verification quality assurance"],
  explicitSourceUrls: [],
  targetAudience: [],
};

test("research planning parser keeps useful subject, query, coverage, and rationale lines", () => {
  const parsed = parseResearchPlanningText(
    `SUBJECT: Create a presentation about System Verification company profile and service portfolio

SEARCH QUERIES:
- query: System Verification CEO
- search for System Verification locations

COVERAGE GOALS:
1. Identify the company's geographic footprint
2. Avoid slide template and design guidance

RATIONALE:
* The prompt asks for company-specific facts.
* Source grounding should avoid generic QA claims.`,
    baseInput,
  );

  assert.equal(parsed.subject, "System Verification");
  assert.deepEqual(parsed.searchQueries, [
    "System Verification quality assurance",
    "System Verification CEO",
    "System Verification locations",
  ]);
  assert.deepEqual(parsed.coverageGoals, [
    "Identify the company's geographic footprint",
  ]);
  assert.deepEqual(parsed.rationale, [
    "The prompt asks for company-specific facts.",
    "Source grounding should avoid generic QA claims.",
  ]);
});

test("research planning normalizer accepts structured tool payloads", () => {
  const parsed = normalizeResearchPlanningSuggestion(
    {
      subject: "Create an onboarding presentation about System Verification",
      searchQueries: [
        "System Verification about",
        "System Verification locations",
        "System Verification services",
      ],
      coverageGoals: [
        "Identify the company's service areas",
        "Avoid presentation template guidance",
      ],
      rationale: ["The request needs company-specific grounding."],
    },
    baseInput,
  );

  assert.equal(parsed.subject, "System Verification");
  assert.deepEqual(parsed.searchQueries, [
    "System Verification quality assurance",
    "System Verification about",
    "System Verification locations",
    "System Verification services",
  ]);
  assert.deepEqual(parsed.coverageGoals, [
    "Identify the company's service areas",
  ]);
  assert.deepEqual(parsed.rationale, [
    "The request needs company-specific grounding.",
  ]);
});
