import type {
  RenderSlideIllustrationInput,
  SlideIllustrationProvider,
} from "@slidespeech/types";
import { getPrimarySlideIllustration } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockIllustrationProvider implements SlideIllustrationProvider {
  readonly name = "mock-illustration-svg";

  async healthCheck() {
    return healthy(
      this.name,
      "Mock illustration provider is ready with local SVG rendering.",
    );
  }

  async renderSlideIllustration(input: RenderSlideIllustrationInput) {
    const illustration = getPrimarySlideIllustration(input.slide);

    if (!illustration) {
      throw new Error(`Slide ${input.slide.id} does not define an image slot.`);
    }

    return {
      slideId: input.slide.id,
      slotId: illustration.id,
      mimeType: "image/svg+xml",
      dataUri: illustration.dataUri,
      ...(illustration.altText ? { altText: illustration.altText } : {}),
      ...(illustration.caption ? { caption: illustration.caption } : {}),
    };
  }
}
