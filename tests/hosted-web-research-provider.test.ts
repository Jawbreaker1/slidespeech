import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchQueries,
  rankSearchResults,
  sanitizeResearchQuery,
  scoreSearchResult,
} from "../packages/providers/src/web-research/hosted-web-research-provider";
import type { WebSearchResult } from "@slidespeech/types";

test("builds targeted search query variants for known entities", () => {
  const queries = buildSearchQueries("Latest OpenAI model releases in 2026");

  assert.ok(queries.includes("Latest OpenAI model releases in 2026"));
  assert.ok(queries.includes("Latest OpenAI model releases in 2026 official"));
  assert.ok(queries.includes("site:openai.com Latest OpenAI model releases in 2026"));
});

test("sanitizes instructional prompts into actual research subjects", () => {
  assert.equal(
    sanitizeResearchQuery(
      "Make a presentation about Volvo for an audience of children. Make sure to add many pictures of cars.",
    ),
    "Volvo",
  );
});

test("builds direct site guesses for compact brand subjects", () => {
  const queries = buildSearchQueries(
    "Make a presentation about Volvo for an audience of children. Make sure to add many pictures of cars.",
  );

  assert.ok(queries.includes("site:volvo.com Volvo"));
  assert.ok(queries.includes("site:volvocars.com Volvo"));
});

test("ranking favors relevant and trusted domains", () => {
  const query = "Latest OpenAI model releases in 2026";
  const results: WebSearchResult[] = [
    {
      title: "Belgium aviation policy update",
      url: "https://www.aviation24.be/",
      snippet: "Recent aviation regulation changes in Belgium.",
    },
    {
      title: "Introducing new OpenAI models",
      url: "https://openai.com/index/new-models",
      snippet: "Latest OpenAI model release announcement and details.",
    },
  ];

  const ranked = rankSearchResults(query, results);

  assert.equal(ranked[0]?.url, "https://openai.com/index/new-models");
  assert.ok(
    scoreSearchResult(query, results[1]!) >
      scoreSearchResult(query, results[0]!),
  );
});

test("ranking penalizes low-trust domains for entity lookups", () => {
  const query = "Make a presentation about Volvo for children";
  const results: WebSearchResult[] = [
    {
      title: "What does Volvo mean in Chinese?",
      url: "https://www.zhihu.com/en/answer/903952600",
      snippet: "Explanation of Chinese characters for a term.",
    },
    {
      title: "Volvo Cars - Official site",
      url: "https://www.volvocars.com/intl/",
      snippet: "Official Volvo cars homepage and model overview.",
    },
  ];

  const ranked = rankSearchResults(query, results);

  assert.equal(ranked[0]?.url, "https://www.volvocars.com/intl/");
});
