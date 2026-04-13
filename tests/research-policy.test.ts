import test from "node:test";
import assert from "node:assert/strict";

import {
  extractExplicitSourceUrls,
  shouldUseWebResearchForTopic,
  stripExplicitSourceUrls,
  topicLooksEntitySpecific,
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

test("builds guessed official urls for compact brand prompts", () => {
  assert.deepEqual(
    buildGuessedOfficialUrls(
      "Make a presentation about Volvo for an audience of children. Make sure to add many pictures of cars.",
    ),
    [
      "https://www.volvo.com/",
      "https://volvo.com/",
      "https://www.volvocars.com/",
    ],
  );
});
