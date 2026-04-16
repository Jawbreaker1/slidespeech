import test from "node:test";
import assert from "node:assert/strict";

import {
  compactPresentationBrief,
  deriveGroundingHighlights,
} from "../apps/api/src/services/presentation-context";

test("compacts presentation brief into framing rather than prompt instructions", () => {
  assert.equal(
    compactPresentationBrief(
      "onboarding presentation about our company",
      "System Verification",
    ),
    "onboarding",
  );

  assert.equal(
    compactPresentationBrief(
      "short presentation about Volvo for children",
      "Volvo",
    ),
    "short for children",
  );
});

test("derives grounded highlights from fetched source content", () => {
  const highlights = deriveGroundingHighlights({
    subject: "System Verification",
    findings: [
      {
        title: "System Verification - Home",
        url: "https://www.systemverification.com/",
        content:
          "System Verification - Home Solutions DD & Insights Quality Management QA Operations About us Sweden Germany. We make AI-accelerated software trustworthy. As QA specialists, we combine deep expertise with AI-driven insights to support the full development lifecycle. Our quality assurance solutions help clients improve reliability, reduce risk, and boost customer satisfaction.",
      },
    ],
  });

  assert.ok(
    highlights.some((highlight) =>
      /AI-driven insights|quality assurance solutions/i.test(highlight),
    ),
  );
  assert.ok(
    highlights.some((highlight) =>
      /DD & Insights|Quality Management|QA Operations/i.test(highlight),
    ),
  );
});

test("deriveGroundingHighlights filters promotional source noise", () => {
  const highlights = deriveGroundingHighlights({
    subject: "World of Warcraft",
    findings: [
      {
        title: "World of Warcraft",
        url: "https://worldofwarcraft.blizzard.com/",
        content:
          "Subscribe Now Learn More 6-Month Subscription Offer Blaze Through New Adventures. World of Warcraft is a massively multiplayer online role-playing game where millions of players inhabit a persistent world. Researchers later studied the Corrupted Blood outbreak as a model of disease spread in social systems.",
      },
    ],
  });

  assert.ok(
    highlights.every(
      (highlight) =>
        !/subscribe now|learn more|6-month subscription offer|blaze through/i.test(
          highlight,
        ),
    ),
  );
  assert.ok(
    highlights.some((highlight) =>
      /massively multiplayer|corrupted blood|disease spread/i.test(highlight),
    ),
  );
});

test("deriveGroundingHighlights deprioritizes dated homepage news when coverage goals target historical facts", () => {
  const highlights = deriveGroundingHighlights({
    subject: "World of Warcraft",
    coverageGoals: [
      "Corrupted Blood outbreak",
      "researchers studied it as a model of disease spread",
    ],
    freshnessSensitive: false,
    findings: [
      {
        title: "World of Warcraft",
        url: "https://worldofwarcraft.com/",
        content:
          "April 10, 2026 This Week in WoW. Catch up on all the latest World of Warcraft news from the last week! Researchers later studied the Corrupted Blood outbreak as a model of contagion and quarantine behavior.",
      },
    ],
  });

  assert.ok(
    highlights.some((highlight) => /corrupted blood|contagion|quarantine/i.test(highlight)),
  );
  assert.ok(
    highlights.every((highlight) => !/this week in wow|latest world of warcraft news/i.test(highlight)),
  );
});
