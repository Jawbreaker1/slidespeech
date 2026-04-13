import test from "node:test";
import assert from "node:assert/strict";

import { MockTTSProvider } from "@slidespeech/providers";

test("mock tts provider returns playable wav metadata", async () => {
  const provider = new MockTTSProvider();
  const result = await provider.synthesize("Explain this segment clearly.", {
    style: "narration",
  });

  assert.equal(result.mimeType, "audio/wav");
  assert.ok(result.audioBase64.length > 100);
  assert.ok(result.durationMs >= 700);
});
