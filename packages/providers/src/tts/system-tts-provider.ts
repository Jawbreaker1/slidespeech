import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ProviderHealthStatus,
  TextToSpeechOptions,
  TextToSpeechProvider,
  TextToSpeechResult,
} from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

const execFileAsync = promisify(execFile);
const DEFAULT_RATE_WPM = 180;
const SAY_BIN = "/usr/bin/say";
const FFMPEG_BIN = "ffmpeg";

export interface SystemTTSProviderConfig {
  voice: string;
  defaultRateWpm: number;
}

const clampRateWpm = (rateWpm: number): number =>
  Math.max(120, Math.min(Math.round(rateWpm), 260));

const mapSpeakingRateToWpm = (
  speakingRate: number | undefined,
  defaultRateWpm: number,
): number => {
  if (speakingRate === undefined) {
    return clampRateWpm(defaultRateWpm);
  }

  return clampRateWpm(defaultRateWpm * speakingRate);
};

const estimateDurationMs = (text: string, rateWpm: number): number => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = words / Math.max(rateWpm, 1);
  return Math.max(500, Math.round(minutes * 60_000));
};

export class SystemTTSProvider implements TextToSpeechProvider {
  readonly name = "system-tts";

  constructor(private readonly config: SystemTTSProviderConfig) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      await execFileAsync(SAY_BIN, ["-v", "?"]);
      await execFileAsync(FFMPEG_BIN, ["-version"]);

      return healthy(
        this.name,
        `System TTS is available via say voice "${this.config.voice}".`,
      );
    } catch (error) {
      return unhealthy(
        this.name,
        `System TTS is unavailable: ${(error as Error).message}`,
      );
    }
  }

  async synthesize(
    text: string,
    options?: TextToSpeechOptions,
  ): Promise<TextToSpeechResult> {
    const trimmedText = text.trim();

    if (!trimmedText) {
      return {
        audioBase64: "",
        mimeType: "audio/wav",
        durationMs: 0,
      };
    }

    const workingDirectory = await mkdtemp(join(tmpdir(), "slidespeech-tts-"));
    const sourcePath = join(workingDirectory, "speech.aiff");
    const outputPath = join(workingDirectory, "speech.wav");
    const voice = options?.voice ?? this.config.voice;
    const rateWpm = mapSpeakingRateToWpm(
      options?.speakingRate,
      this.config.defaultRateWpm,
    );

    try {
      await execFileAsync(SAY_BIN, [
        "-v",
        voice,
        "-r",
        String(rateWpm),
        "-o",
        sourcePath,
        trimmedText,
      ]);
      await execFileAsync(FFMPEG_BIN, [
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        outputPath,
      ]);

      const audioBuffer = await readFile(outputPath);

      return {
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/wav",
        durationMs: estimateDurationMs(trimmedText, rateWpm),
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}

export const SYSTEM_TTS_DEFAULTS = {
  voice: "Daniel",
  defaultRateWpm: DEFAULT_RATE_WPM,
} satisfies SystemTTSProviderConfig;
