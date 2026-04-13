import type { AudioChunk, VoiceActivityProvider } from "@slidespeech/types";

import { healthy, nowIso } from "../shared";

export class MockVADProvider implements VoiceActivityProvider {
  readonly name = "mock-vad";

  async healthCheck() {
    return healthy(this.name, "Mock VAD provider is ready.");
  }

  async detectSpeech(audioChunk: AudioChunk) {
    const hasSpeech = audioChunk.dataBase64.trim().length > 0;
    return {
      hasSpeech,
      confidence: hasSpeech ? 0.86 : 0.25,
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
