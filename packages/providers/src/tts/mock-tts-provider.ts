import type {
  TextToSpeechOptions,
  TextToSpeechProvider,
} from "@slidespeech/types";

import { healthy } from "../shared";

const SAMPLE_RATE = 16_000;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const createWavToneBase64 = (input: {
  durationMs: number;
  frequencyHz: number;
  amplitude?: number;
}): string => {
  const durationSeconds = input.durationMs / 1000;
  const sampleCount = Math.max(1, Math.floor(SAMPLE_RATE * durationSeconds));
  const pcmData = Buffer.alloc(sampleCount * 2);
  const amplitude = clamp(input.amplitude ?? 0.22, 0, 0.95);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = index < SAMPLE_RATE * 0.02 ? index / (SAMPLE_RATE * 0.02) : 1;
    const sample = Math.sin(2 * Math.PI * input.frequencyHz * time);
    const scaled = Math.round(sample * envelope * amplitude * 32767);
    pcmData.writeInt16LE(scaled, index * 2);
  }

  const header = Buffer.alloc(44);
  const dataByteLength = pcmData.length;
  const totalByteLength = 36 + dataByteLength;

  header.write("RIFF", 0);
  header.writeUInt32LE(totalByteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataByteLength, 40);

  return Buffer.concat([header, pcmData]).toString("base64");
};

const durationForText = (text: string, speakingRate = 1): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const estimated = Math.round((words / Math.max(speakingRate, 0.6)) * 340);
  return clamp(estimated, 700, 8000);
};

const frequencyForStyle = (style?: TextToSpeechOptions["style"]): number => {
  switch (style) {
    case "answer":
      return 520;
    case "summary":
      return 460;
    case "narration":
    default:
      return 400;
  }
};

export class MockTTSProvider implements TextToSpeechProvider {
  readonly name = "mock-tts";

  async healthCheck() {
    return healthy(this.name, "Mock TTS provider is ready.");
  }

  async synthesize(text: string, options?: TextToSpeechOptions) {
    const durationMs = durationForText(text, options?.speakingRate);

    return {
      audioBase64: createWavToneBase64({
        durationMs,
        frequencyHz: frequencyForStyle(options?.style),
      }),
      mimeType: "audio/wav",
      durationMs,
    };
  }
}
