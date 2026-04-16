import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuessedKnowledgeUrls,
  buildExplicitSourceFallbackQuery,
  sanitizeFetchedFinding,
} from "../apps/api/src/services/web-research-service";

test("sanitizeFetchedFinding removes promotional homepage copy from game research", () => {
  const finding = sanitizeFetchedFinding(
    "World of Warcraft corrupted blood plague contagion research",
    {
      url: "https://worldofwarcraft.com/",
      title: "World of Warcraft",
      content:
        "World of Warcraft Buy Now Learn More The Roofus Pack Adopt Roofus and Support Habitat for Humanity! By purchasing The Roofus Pack, you'll be supporting Habitat for Humanity. In 2005, a bug created the Corrupted Blood plague that spread uncontrollably between players in-game. Researchers studied the incident as a model for contagion and quarantine behavior. Subscribe Now Learn More.",
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /Corrupted Blood|contagion|Researchers studied/i);
  assert.doesNotMatch(finding.content, /Roofus|Habitat for Humanity|Buy Now|Subscribe Now/i);
});

test("sanitizeFetchedFinding drops discussion sources from grounding", () => {
  const finding = sanitizeFetchedFinding(
    "World of Warcraft corrupted blood plague contagion research",
    {
      url: "https://us.forums.blizzard.com/en/wow/",
      title: "World of Warcraft Forums",
      content:
        "Community discussion about raids, classes, and bugs.",
    },
  );

  assert.equal(finding, null);
});

test("sanitizeFetchedFinding drops low-signal Q&A pages for specialized research queries", () => {
  const finding = sanitizeFetchedFinding(
    "\"Corrupted Blood\" plague event researchers disease spread World of Warcraft",
    {
      url: "https://english.stackexchange.com/questions/269489/for-computer-science-are-the-files-corrupted-or-corrupt",
      title: "For computer science, are the files corrupted or corrupt?",
      content:
        "A possible difference I can think of is that a corrupted file may refer to an existing file which is altered at some point, while a corrupt file contains alterations from the start.",
    },
  );

  assert.equal(finding, null);
});

test("sanitizeFetchedFinding keeps informative explicit-source organization content with relaxed matching", () => {
  const finding = sanitizeFetchedFinding(
    "Using AI tools in daily work",
    {
      url: "https://www.vgregion.se/",
      title: "Västra Götalandsregionen",
      content:
        "Västra Götalandsregionen is responsible for healthcare, public transport, regional development, and culture in western Sweden. The region coordinates services for residents, patients, and partner organizations across many daily operations.",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /healthcare|public transport|regional development/i);
});

test("sanitizeFetchedFinding keeps trusted explicit-source content even when the source language is not English", () => {
  const finding = sanitizeFetchedFinding(
    "Using AI tools in daily work",
    {
      url: "https://www.vgregion.se/",
      title: "Västra Götalandsregionen",
      content:
        "Startsida för Västra Götalandsregionen. Det här gör vi. Vi ser till att du får god hälso- och sjukvård. Dessutom arbetar vi för hållbar utveckling, tillväxt och bra miljö. Vi bidrar till bättre folkhälsa, ett rikt kulturliv och smidiga kommunikationer i hela Västra Götaland.",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /hälso- och sjukvård|hållbar utveckling|folkhälsa/i);
});

test("sanitizeFetchedFinding trims navigation-heavy trusted explicit sources before extracting content", () => {
  const finding = sanitizeFetchedFinding(
    "Using AI tools in daily work",
    {
      url: "https://www.vgregion.se/",
      title: "Västra Götalandsregionen",
      content:
        "Västra Götalandsregionen - Västra Götalandsregionen Till huvudinnehåll Gå till startsidan Kontakt Change language Current language english Hälsa och vård Regional utveckling Kultur Kollektivtrafik Om VGR Det här gör vi Vi ser till att du får god hälso- och sjukvård. Dessutom arbetar vi för hållbar utveckling, tillväxt och bra miljö. Vi bidrar till bättre folkhälsa, ett rikt kulturliv och smidiga kommunikationer i hela Västra Götaland.",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.doesNotMatch(finding.content, /Till huvudinnehåll|Gå till startsidan|Change language/i);
  assert.match(finding.content, /hälso- och sjukvård|hållbar utveckling|folkhälsa/i);
});

test("buildGuessedKnowledgeUrls generates encyclopedic candidates for specialized named-entity queries", () => {
  const urls = buildGuessedKnowledgeUrls(
    "\"Corrupted Blood\" plague event researchers disease spread World of Warcraft",
  );

  assert.ok(urls.includes("https://en.wikipedia.org/wiki/Corrupted_Blood"));
  assert.ok(urls.includes("https://en.wikipedia.org/wiki/Corrupted_Blood_incident"));
  assert.ok(urls.includes("https://en.wikipedia.org/wiki/World_of_Warcraft"));
});

test("buildExplicitSourceFallbackQuery prefers site-scoped search terms over raw host concatenation", () => {
  const query = buildExplicitSourceFallbackQuery({
    topic: "Using AI tools in their daily work",
    urls: ["https://www.vgregion.se/"],
  });

  assert.match(query, /site:vgregion\.se/i);
  assert.match(query, /AI tools in their daily work/i);
  assert.doesNotMatch(query, /^Using\b/);
});
