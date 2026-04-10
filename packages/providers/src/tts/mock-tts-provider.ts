import type { TextToSpeechProvider } from "@slidespeech/types";

import { healthy } from "../shared";

export class MockTTSProvider implements TextToSpeechProvider {
  readonly name = "mock-tts";

  async healthCheck() {
    return healthy(this.name, "Mock TTS provider is ready.");
  }

  async synthesize() {
    return {
      audioBase64: "",
      mimeType: "audio/wav",
      durationMs: 0,
    };
  }
}

