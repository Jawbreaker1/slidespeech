import type { VisionProvider } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock-vision";

  async healthCheck() {
    return healthy(this.name, "Mock vision provider is ready.");
  }

  async analyzeSlideImage(input: { slideId: string }) {
    return {
      summary: `No visual analysis available yet for ${input.slideId}.`,
      isRelevant: true,
      relevanceScore: 0.5,
      visualIssues: ["Visual analysis is test-only mocked."],
      pedagogicalHints: ["Use a real vision provider for rendered-slide review."],
    };
  }

  async analyzeDeckImages(input: { slides: Array<{ slideId: string }> }) {
    return Promise.all(
      input.slides.map((slide) => this.analyzeSlideImage({ slideId: slide.slideId })),
    );
  }

  async describeVisualIssues() {
    return ["Visual issue detection is test-only mocked."];
  }

  async extractPedagogicalVisualHints() {
    return ["Pedagogical visual hints are test-only mocked."];
  }
}
