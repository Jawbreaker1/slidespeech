import test from "node:test";
import assert from "node:assert/strict";

import {
  presentationRequestRequiresGroundedFacts,
  resolvePresentationSubject,
} from "../apps/api/src/services/generation-context-service";

test("resolvePresentationSubject corrects close entity typos from fetched source titles", () => {
  const subject = resolvePresentationSubject({
    prompt: "The brand and cars Ferarri",
    researchSubject: "Ferarri",
    directFindings: [
      {
        url: "https://en.wikipedia.org/wiki/Ferarri",
        title: "Ferrari - Wikipedia",
        content:
          "Ferrari was founded in 1939 by Enzo Ferrari and began producing road cars in 1947.",
      },
    ],
    supplementalFindings: [],
    searchFindings: [],
  });

  assert.equal(subject, "Ferrari");
});

test("resolvePresentationSubject does not adopt unrelated source titles but can trim descriptor framing", () => {
  const subject = resolvePresentationSubject({
    prompt: "The brand and cars Ferarri",
    researchSubject: "Ferarri",
    directFindings: [],
    supplementalFindings: [],
    searchFindings: [
      {
        url: "https://www.ama.org/brand-strategy",
        title: "How Your Brand Strategy Drives Business Growth",
        content:
          "A strong brand can improve recall, loyalty, and purchasing decisions.",
      },
    ],
  });

  assert.equal(subject, "Ferarri");
});

test("resolvePresentationSubject preserves specific prompt modifiers over broad one-word research subjects", () => {
  const subject = resolvePresentationSubject({
    prompt:
      "Create a presentation about a marketing strategy for newly built residential properties.",
    researchSubject: "Marketing",
    directFindings: [],
    supplementalFindings: [],
    searchFindings: [],
  });

  assert.equal(subject, "Marketing strategy for newly built residential properties");
});

test("explicit web research requests require grounded facts even for otherwise stable topics", () => {
  assert.equal(
    presentationRequestRequiresGroundedFacts({
      normalizedTopic:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      explicitSourceUrls: [],
      useWebResearch: true,
    }),
    true,
  );
});

test("stable topic-only requests do not require grounded facts when web research is not requested", () => {
  assert.equal(
    presentationRequestRequiresGroundedFacts({
      normalizedTopic:
        "Create a presentation about Spongebob Squarepants first episode that was aired in 1999.",
      explicitSourceUrls: [],
      useWebResearch: false,
    }),
    false,
  );
});
