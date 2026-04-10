import type { VoiceActivityProvider } from "@slidespeech/types";

import { healthy, nowIso } from "../shared";

export class MockVADProvider implements VoiceActivityProvider {
  readonly name = "mock-vad";

  async healthCheck() {
    return healthy(this.name, "Mock VAD provider is ready.");
  }

  async detectSpeech() {
    return {
      hasSpeech: false,
      confidence: 0.5,
      startedAt: nowIso(),
    };
  }

  async *detectSegments() {
    yield {
      hasSpeech: false,
      confidence: 0.5,
      startedAt: nowIso(),
    };
  }
}

