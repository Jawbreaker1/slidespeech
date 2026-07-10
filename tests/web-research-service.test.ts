import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExplicitSourceSupplementalQuery,
  findingLooksRelevant,
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

test("sanitizeFetchedFinding drops answers.com maintenance pages for entity research", () => {
  const finding = sanitizeFetchedFinding(
    "Volvo Cars official",
    {
      url: "https://www.answers.com/european-cars/How_do_you_replace_a_fuel_pump_on_a_Volvo_s80",
      title: "How do you replace a fuel pump on a Volvo s80? - Answers",
      content:
        "To replace the fuel pump on a Volvo S80, first disconnect the battery and relieve fuel system pressure. The 2015 Volvo S80 runs on regular unleaded.",
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

test("sanitizeFetchedFinding decodes numeric HTML entities before grounding text is reused", () => {
  const finding = sanitizeFetchedFinding(
    "Västra Götalandsregionen protocols",
    {
      url: "https://www.vgregion.se/politik/protokoll-och-handlingar",
      title: "Protokoll och handlingar V&#xE4;stra G&#xF6;talandsregionen",
      content:
        "Protokoll och handlingar V&#xE4;stra G&#xF6;talandsregionen styrs genom politiska beslut. Handlingar publiceras inf&#xF6;r sammantr&#xE4;den och protokoll publiceras efter beslut.",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.title, /Västra Götalandsregionen/);
  assert.match(finding.content, /Västra Götalandsregionen/);
  assert.doesNotMatch(`${finding.title} ${finding.content}`, /&#x/i);
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

test("sanitizeFetchedFinding removes scraped counters and faq questions from trusted explicit organization sources", () => {
  const finding = sanitizeFetchedFinding(
    "System Verification",
    {
      url: "https://www.systemverification.com/about-us",
      title: "System Verification - About us",
      content:
        "SYSTEM VERIFICATION IN NUMBERS 0 Years in QA-bussiness 0 Locations 0 Employees 0 Consultant rating. Our History 2002 – In 2002, System Verification is founded as Sweden’s first company dedicated exclusively to quality assurance. System Verification is the leading QA network in the Nordics, combining deep technical knowledge with a commitment to collaboration and innovation. What delivery models does System Verification offer?",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /founded as Sweden’s first company dedicated exclusively to quality assurance/i);
  assert.doesNotMatch(finding.content, /0 Years|0 Locations|0 Employees|consultant rating/i);
  assert.doesNotMatch(finding.content, /What delivery models does System Verification offer/i);
});

test("sanitizeFetchedFinding keeps short acronym intent and drops unrelated 'using' language matches", () => {
  const finding = sanitizeFetchedFinding(
    "Using AI tools in their daily work",
    {
      url: "https://en.cppreference.com/w/cpp/language/using_declaration.html",
      title: "using-declaration - cppreference.com",
      content:
        "In class definition, the name of a previously declared member template of the base class may be reused. A using-declaration introduces a member of a base class into the derived class definition.",
    },
  );

  assert.equal(finding, null);
});

test("sanitizeFetchedFinding preserves AI-specific content even when the key acronym is short", () => {
  const finding = sanitizeFetchedFinding(
    "Using AI tools in their daily work",
    {
      url: "https://example.com/ai-workflows",
      title: "AI workflows for project teams",
      content:
        "AI tools can summarize requirement documents, draft meeting notes, and suggest test scenarios for project teams. These workflows help reduce repetitive manual effort while keeping human review in the loop.",
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /AI tools can summarize requirement documents/i);
});

test("sanitizeFetchedFinding drops unrelated shell-tooling content for entertainment named-entity queries", () => {
  const finding = sanitizeFetchedFinding(
    "Spongebob squarepants and his adventures in bikinibottom",
    {
      url: "https://lib.rs/crates/skim",
      title: "Skim — command-line utility in Rust",
      content:
        'This is particularly useful when piping in input from rg to match on both file name and content. -name "*.rs" | sk -m) This last command lets you select files with the ".rs" extension and opens your selections in Vim. Shell Bindings for Fish, Bash and Zsh are available in the shell directory.',
    },
  );

  assert.equal(finding, null);
});

test("sanitizeFetchedFinding drops taxonomy-heavy fandom menu content for entertainment queries", () => {
  const finding = sanitizeFetchedFinding(
    "Nickelodeon official SpongeBob SquarePants character guide Bikini Bottom residents",
    {
      url: "https://nickelodeon.fandom.com/wiki/Nickelodeon_Wiki",
      title: "Nickelodeon | Fandom",
      content:
        "Ni Hao, Kai-Lan The Fresh Beat Band Bubble Guppies Shimmer and Shine Movies The Rugrats Movie Jimmy Neutron, Boy Genius The SpongeBob SquarePants Movie Rango The Adventures of Tintin Grow Up, Timmy Turner! Ni Hao, Kai-Lan The Fresh Beat Band Bubble Guppies Shimmer and Shine Movies The Rugrats Movie Jimmy Neutron, Boy Genius The SpongeBob SquarePants Movie Rango The Adventures of Tintin Grow Up, Timmy Turner! READ MORE Sign In Create a Free Account Nickelodeon Explore Main Page Discuss All Pages Community Interactive Maps Recent Blog Posts Shows Nicktoons Rugrats Ren & Stimpy Rocko's Modern Life Hey Arnold! Nickelodeon | Fandom Nickelodeon Nickipedia, the Nickelodeon Wiki Welcome to Nickipedia, a Nickelodeon database that anyone can edit.",
    },
  );

  assert.equal(finding, null);
});

test("sanitizeFetchedFinding keeps informative entertainment prose with named entities", () => {
  const finding = sanitizeFetchedFinding(
    "Nickelodeon official SpongeBob SquarePants character guide Bikini Bottom residents",
    {
      url: "https://example.com/spongebob-guide",
      title: "SpongeBob SquarePants character guide",
      content:
        "SpongeBob SquarePants is the optimistic fry cook at the center of Bikini Bottom, while Patrick Star brings impulsive energy and Squidward Tentacles provides a more cynical counterpoint. Together they define the tone of the town and its everyday adventures.",
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /SpongeBob SquarePants is the optimistic fry cook/i);
  assert.match(finding.content, /Patrick Star|Squidward Tentacles/i);
});

test("sanitizeFetchedFinding prefers query-year source sentences over adjacent release noise", () => {
  const finding = sanitizeFetchedFinding(
    "Donald Duck's first cartoon appearance released in 1934",
    {
      url: "https://en.wikipedia.org/wiki/The_Wise_Little_Hen",
      title: "The Wise Little Hen - Wikipedia",
      content:
        "[ 11 ] Theatrical release [ edit ] The Wise Little Hen had its world premiere as the underbill to Gulliver Mickey at the Carthay Circle Theater in Los Angeles, California, on May 3, 1934. The first release was in 1986 on Betamax on Donald Duck Volume 1.",
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /May 3, 1934/);
  assert.doesNotMatch(finding.content, /1986 on Betamax/);
});

test("sanitizeFetchedFinding does not split source sentences at common abbreviations", () => {
  const finding = sanitizeFetchedFinding(
    "Donald Duck's first cartoon appearance released in 1934",
    {
      url: "https://en.wikipedia.org/api/rest_v1/page/summary/The_Wise_Little_Hen",
      title: "The Wise Little Hen",
      content:
        'The Wise Little Hen is a 1934 Walt Disney produced Silly Symphonies animated short film. The film features the debut of Donald Duck. Donald and his friend Peter Pig try to avoid work by faking stomach aches until Mrs. Hen teaches them the value of labor.',
    },
    {
      allowTrustedExplicitSource: true,
    },
  );

  assert.ok(finding);
  assert.match(finding.content, /Mrs\. Hen teaches them the value of labor/);
  assert.doesNotMatch(finding.content, /until Mrs\.$/);
});

test("findingLooksRelevant rejects search false positives that miss the named phrase", () => {
  assert.equal(
    findingLooksRelevant(
      "Donald Duck first cartoon appearance 1934",
      {
        url: "https://www.whitehouse.gov/administration/donald-j-trump/",
        title: "President Donald J. Trump",
        content:
          "His first book, The Art of the Deal, is considered a business classic. President Donald J. Trump won the Presidency in his first run for political office.",
      },
    ),
    false,
  );

  assert.equal(
    findingLooksRelevant(
      "The Wise Little Hen 1934 Donald Duck debut",
      {
        url: "https://wise.com/",
        title: "Wise: The international account",
        content:
          "It takes a little more time for your money to reach Wise when bank transfers are usually the cheapest option.",
      },
    ),
    false,
  );

  assert.equal(
    findingLooksRelevant(
      "Donald Duck first cartoon appearance 1934",
      {
        url: "https://en.wikipedia.org/wiki/Donald_Duck",
        title: "Donald Duck - Wikipedia",
        content:
          "Donald's first appearance was in The Wise Little Hen (1934), before later cartoons developed his temperamental comic foil role.",
      },
    ),
    true,
  );

  assert.equal(
    findingLooksRelevant(
      "Donald Duck first cartoon appearance 1934",
      {
        url: "https://en.wikipedia.org/wiki/The_Wise_Little_Hen",
        title: "The Wise Little Hen - Wikipedia",
        content:
          "The cartoon featured Donald Duck's first appearance and premiered in 1934.",
      },
    ),
    true,
  );
});

test("buildExplicitSourceSupplementalQuery prefers site-scoped search terms over raw host concatenation", () => {
  const query = buildExplicitSourceSupplementalQuery({
    topic: "Using AI tools in their daily work",
    urls: ["https://www.vgregion.se/"],
  });

  assert.match(query, /site:vgregion\.se/i);
  assert.match(query, /AI tools in their daily work/i);
  assert.doesNotMatch(query, /^Using\b/);
});

test("buildExplicitSourceSupplementalQuery keeps company-grounded prompts site-scoped without guessed paths", () => {
  const query = buildExplicitSourceSupplementalQuery({
    topic: "System Verification",
    urls: ["https://www.systemverification.com/"],
    organization: "System Verification",
    presentationFrame: "organization",
    deliveryFormat: "presentation",
  });

  assert.match(query, /site:systemverification\.com/i);
  assert.match(query, /"System Verification"/);
  assert.doesNotMatch(query, /\babout\b|\bservices\b|\blocations\b|\boffices\b/i);
});

test("buildExplicitSourceSupplementalQuery prefers the quoted organization name over malformed duplicate topic text", () => {
  const query = buildExplicitSourceSupplementalQuery({
    topic: "Systemverification",
    urls: ["https://www.systemverification.com/"],
    organization: "System Verification",
    presentationFrame: "organization",
    deliveryFormat: "presentation",
  });

  assert.match(query, /"System Verification"/);
  assert.doesNotMatch(query, /\bSystemverification\b/);
});
