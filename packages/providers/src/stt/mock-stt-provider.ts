import type { SpeechToTextProvider } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockSTTProvider implements SpeechToTextProvider {
  readonly name = "mock-stt";

  async healthCheck() {
    return healthy(this.name, "Mock STT provider is ready.");
  }

  async transcribe() {
    return {
      text: "mock transcription",
      confidence: 0.99,
      isFinal: true,
    };
  }
}

