import test from "node:test";
import assert from "node:assert/strict";

import {
  derivePresentationIntent,
  extractPresentationSubject,
  extractCoverageRequirements,
} from "../apps/api/src/services/presentation-intent";

test("derivePresentationIntent separates audience, format, coverage, and activity for workshop prompts", () => {
  const intent = derivePresentationIntent(
    "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
  );

  assert.equal(intent.deliveryFormat, "workshop");
  assert.ok(intent.explicitSourceUrls.includes("https://www.vgregion.se/"));
  assert.match(intent.subject, /^Using AI tools/i);
  assert.ok(intent.audienceCues.some((value) => /project managers/i.test(value)));
  assert.ok(intent.audienceCues.some((value) => /product owners/i.test(value)));
  assert.ok(intent.audienceCues.some((value) => /test leads/i.test(value)));
  assert.equal(intent.organization, "VGR, Västra Götalandsregionen");
  assert.match(
    intent.presentationGoal ?? "",
    /How project managers, product owners, and test leads can use AI tools in their daily work/i,
  );
  assert.ok(
    intent.activityRequirement &&
      /exercise|workshop/i.test(intent.activityRequirement),
  );
});

test("extractCoverageRequirements keeps explicit case-study requirements split into concrete coverage items", () => {
  const requirements = extractCoverageRequirements(
    "Include at least one slide about the Corrupted Blood plague event and explain why researchers were interested in it as a model of disease spread.",
  );

  assert.ok(requirements.some((value) => /Corrupted Blood plague event/i.test(value)));
  assert.ok(
    requirements.some((value) => /Why researchers were interested/i.test(value)),
  );
});

test("derivePresentationIntent normalizes procedural subjects without leaving them as raw imperatives", () => {
  const intent = derivePresentationIntent(
    "Create a short presentation about how to make the perfect salsa dip.",
  );

  assert.equal(intent.contentMode, "procedural");
  assert.equal(intent.presentationFrame, "subject");
  assert.equal(intent.subject, "Making the perfect salsa dip");
});

test("derivePresentationIntent classifies company-overview prompts as organization presentations without hardcoding the domain", () => {
  const intent = derivePresentationIntent(
    "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
  );

  assert.equal(intent.presentationFrame, "organization");
  assert.ok(intent.explicitSourceUrls.includes("https://www.systemverification.com/"));
  assert.match(intent.organization ?? "", /systemverification/i);
  assert.match(intent.subject, /systemverification/i);
});

test("derivePresentationIntent keeps a broad subject while deriving a concrete focus anchor from explicit coverage", () => {
  const intent = derivePresentationIntent(
    "Create a short presentation about World of Warcraft. Include at least one slide about the Corrupted Blood plague event and explain why researchers were interested in it as a model of disease spread.",
  );

  assert.equal(intent.presentationFrame, "subject");
  assert.equal(intent.subject, "World of Warcraft");
  assert.equal(intent.focusAnchor, "The Corrupted Blood plague event");
});

test("derivePresentationIntent keeps organization-context prompts separate from pure company-overview prompts", () => {
  const intent = derivePresentationIntent(
    "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work.",
  );

  assert.equal(intent.presentationFrame, "mixed");
  assert.equal(intent.organization, "VGR, Västra Götalandsregionen");
  assert.match(intent.subject, /^Using AI tools/i);
});

test("extractPresentationSubject drops leading imperative framing and trailing question sentences", () => {
  const subject = extractPresentationSubject(
    "Present spongebob squarepants and his adventures in bikinibottom. Who created the series and when did it start airing.",
  );

  assert.equal(subject, "Spongebob squarepants and his adventures in bikinibottom");
});
