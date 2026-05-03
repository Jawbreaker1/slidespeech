import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

import type {
  ProviderHealthStatus,
  TextToSpeechOptions,
  TextToSpeechProvider,
  TextToSpeechResult,
} from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

const DEFAULT_PYTHON_BIN = ".venv-tts/bin/python";
const DEFAULT_MODEL_PATH = "models/tts/en_US-hfc_male-medium.onnx";
const DEFAULT_CONFIG_PATH = "models/tts/en_US-hfc_male-medium.onnx.json";
const DEFAULT_SENTENCE_SILENCE_MS = 80;
const FALLBACK_MODEL_CANDIDATES = [
  "models/tts/en_US-hfc_male-medium.onnx",
  "models/tts/en_US-bryce-medium.onnx",
  "models/tts/en_US-lessac-high.onnx",
  "models/tts/en_US-lessac-medium.onnx",
] as const;
const WORKER_PATH = join(
  __dirname,
  "piper-tts-worker.py",
);

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type WorkerResponse = {
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
};

type PiperModelSelection = {
  modelPath: string;
  configPath: string;
};

export interface PiperTTSProviderConfig {
  pythonBin?: string;
  modelPath?: string;
  configPath?: string;
  speakerId?: number;
  sentenceSilenceMs?: number;
}

const clampSpeakingRate = (speakingRate: number | undefined): number | undefined => {
  if (speakingRate === undefined || !Number.isFinite(speakingRate)) {
    return undefined;
  }

  return Math.max(0.7, Math.min(1.35, speakingRate));
};

const parseSpeakerOverride = (voice: string | undefined): number | undefined => {
  if (!voice) {
    return undefined;
  }

  const parsed = Number.parseInt(voice, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildConfigPathForModel = (modelPath: string): string => `${modelPath}.json`;

const trimOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const resolvePiperModelSelection = (
  config: PiperTTSProviderConfig,
): PiperModelSelection => {
  const configuredModelPath = trimOrUndefined(config.modelPath);
  const configuredConfigPath = trimOrUndefined(config.configPath);
  const candidates: PiperModelSelection[] = [];

  if (configuredModelPath) {
    candidates.push({
      modelPath: configuredModelPath,
      configPath:
        configuredConfigPath ?? buildConfigPathForModel(configuredModelPath),
    });
  }

  for (const modelPath of FALLBACK_MODEL_CANDIDATES) {
    candidates.push({
      modelPath,
      configPath: buildConfigPathForModel(modelPath),
    });
  }

  const preferredCandidate = candidates.find(
    (candidate, index) =>
      candidates.findIndex(
        (otherCandidate) =>
          otherCandidate.modelPath === candidate.modelPath &&
          otherCandidate.configPath === candidate.configPath,
      ) === index,
  );

  for (const candidate of candidates) {
    if (
      existsSync(candidate.modelPath) &&
      existsSync(candidate.configPath)
    ) {
      return candidate;
    }
  }

  return preferredCandidate ?? {
    modelPath: configuredModelPath ?? DEFAULT_MODEL_PATH,
    configPath:
      configuredConfigPath ??
      buildConfigPathForModel(configuredModelPath ?? DEFAULT_MODEL_PATH),
  };
};

export class PiperTTSProvider implements TextToSpeechProvider {
  readonly name = "piper-tts";

  private workerProcess: ChildProcessWithoutNullStreams | null = null;

  private lineReader: readline.Interface | null = null;

  private readonly pendingRequests = new Map<string, PendingRequest>();

  private readonly resolvedModelSelection: PiperModelSelection;

  constructor(private readonly config: PiperTTSProviderConfig) {
    this.resolvedModelSelection = resolvePiperModelSelection(config);
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try {
      await access(this.pythonBin(), fsConstants.X_OK);
      await access(this.modelPath(), fsConstants.R_OK);
      await access(this.configPath(), fsConstants.R_OK);
      await this.sendWorkerRequest("health", {});

      return healthy(
        this.name,
        `Piper TTS is ready with model "${this.modelPath()}".`,
      );
    } catch (error) {
      return unhealthy(
        this.name,
        `Piper TTS is unavailable: ${(error as Error).message}`,
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

    const payload = (await this.sendWorkerRequest("synthesize", {
      text: trimmedText,
      speaking_rate: clampSpeakingRate(options?.speakingRate),
      speaker_id:
        parseSpeakerOverride(options?.voice) ?? this.config.speakerId,
    })) as {
      audioBase64?: unknown;
      mimeType?: unknown;
      durationMs?: unknown;
    };

    return {
      audioBase64:
        typeof payload.audioBase64 === "string" ? payload.audioBase64 : "",
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : "audio/wav",
      durationMs:
        typeof payload.durationMs === "number" ? payload.durationMs : 0,
    };
  }

  private pythonBin(): string {
    return this.config.pythonBin?.trim() || DEFAULT_PYTHON_BIN;
  }

  private modelPath(): string {
    return this.resolvedModelSelection.modelPath;
  }

  private configPath(): string {
    return this.resolvedModelSelection.configPath;
  }

  private sentenceSilenceMs(): number {
    return Math.max(
      0,
      Math.round(this.config.sentenceSilenceMs ?? DEFAULT_SENTENCE_SILENCE_MS),
    );
  }

  private ensureWorker() {
    if (this.workerProcess) {
      return;
    }

    const process = spawn(
      this.pythonBin(),
      [
        WORKER_PATH,
        this.modelPath(),
        this.configPath(),
        String(this.config.speakerId ?? ""),
        String(this.sentenceSilenceMs()),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.workerProcess = process;
    this.lineReader = readline.createInterface({ input: process.stdout });
    this.lineReader.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let message: WorkerResponse;
      try {
        message = JSON.parse(line) as WorkerResponse;
      } catch (error) {
        const pending = [...this.pendingRequests.values()];
        this.pendingRequests.clear();
        for (const request of pending) {
          request.reject(
            new Error(`Invalid Piper worker response: ${(error as Error).message}`),
          );
        }
        return;
      }

      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.id);
      if (message.ok) {
        pending.resolve(message.payload ?? {});
        return;
      }

      pending.reject(new Error(message.error || "Piper TTS worker request failed."));
    });

    process.stderr.on("data", () => {
      // surfaced indirectly if the worker exits or a request fails.
    });

    process.on("exit", (code, signal) => {
      const pending = [...this.pendingRequests.values()];
      this.pendingRequests.clear();
      this.workerProcess = null;
      this.lineReader?.close();
      this.lineReader = null;

      for (const request of pending) {
        request.reject(
          new Error(
            `Piper TTS worker exited unexpectedly (${signal ?? code ?? "unknown"}).`,
          ),
        );
      }
    });
  }

  private async sendWorkerRequest(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    this.ensureWorker();

    if (!this.workerProcess) {
      throw new Error("Piper TTS worker is not running.");
    }

    const id = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.workerProcess!.stdin.write(
        `${JSON.stringify({ id, action, ...payload })}\n`,
      );
    });
  }
}

export const PIPER_TTS_DEFAULTS = {
  pythonBin: DEFAULT_PYTHON_BIN,
  modelPath: DEFAULT_MODEL_PATH,
  configPath: DEFAULT_CONFIG_PATH,
  sentenceSilenceMs: DEFAULT_SENTENCE_SILENCE_MS,
} satisfies PiperTTSProviderConfig;
