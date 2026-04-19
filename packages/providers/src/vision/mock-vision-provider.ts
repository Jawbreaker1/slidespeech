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
      visualIssues: ["Visual analysis is mocked in phase 1."],
      pedagogicalHints: ["Add rendered slide screenshots in phase 4."],
    };
  }

  async analyzeDeckImages(input: { slides: Array<{ slideId: string }> }) {
    return Promise.all(
      input.slides.map((slide) => this.analyzeSlideImage({ slideId: slide.slideId })),
    );
  }

  async describeVisualIssues() {
    return ["Visual issue detection is mocked in phase 1."];
  }

  async extractPedagogicalVisualHints() {
    return ["Pedagogical visual hints are mocked in phase 1."];
  }
}
