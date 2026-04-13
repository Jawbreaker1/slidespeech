import type { AudioChunk, SpeechToTextProvider } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockSTTProvider implements SpeechToTextProvider {
  readonly name = "mock-stt";

  async healthCheck() {
    return healthy(this.name, "Mock STT provider is ready.");
  }

  async transcribe(audioChunk: AudioChunk) {
    const size = audioChunk.dataBase64.length;
    let text = "Can you explain that more simply?";

    if (size < 8_000) {
      text = "stop";
    } else if (size > 24_000) {
      text = "Give me an example";
    }

    return {
      text,
      confidence: 0.99,
      isFinal: true,
    };
  }
}
