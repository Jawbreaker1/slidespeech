import type { WebResearchProvider } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockWebResearchProvider implements WebResearchProvider {
  readonly name = "mock-web-research";

  async healthCheck() {
    return healthy(this.name, "Mock web research provider is ready.");
  }

  async search(query: string) {
    return [
      {
        title: `Mock result for ${query}`,
        url: "https://example.com/mock",
        snippet: "Phase 1 uses a mock web research provider.",
      },
    ];
  }

  async fetch(url: string) {
    return {
      url,
      title: "Mock fetched page",
      content: "This is a mocked fetch response.",
    };
  }

  async summarizeFindings(input: { query: string }) {
    return `Mock summary for query "${input.query}".`;
  }
}

