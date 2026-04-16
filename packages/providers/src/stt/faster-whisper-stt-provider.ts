import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import readline from "node:readline";

import type { AudioChunk, SpeechToTextProvider } from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

const execFileAsync = promisify(execFile);
const DEFAULT_PYTHON_BIN = ".venv-stt/bin/python";
const DEFAULT_MODEL = "base.en";
const DEFAULT_COMPUTE_TYPE = "int8";
const DEFAULT_BEAM_SIZE = 3;
const FFMPEG_BIN = "ffmpeg";
const WORKER_PATH = join(
  process.cwd(),
  "packages/providers/src/stt/faster-whisper-worker.py",
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

export interface FasterWhisperSTTProviderConfig {
  pythonBin?: string;
  model: string;
  computeType?: string;
  beamSize?: number;
  language?: string;
}

const mimeTypeToExtension = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("webm")) {
    return ".webm";
  }

  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return ".m4a";
  }

  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return ".mp3";
  }

  if (normalized.includes("wav")) {
    return ".wav";
  }

  if (normalized.includes("aiff")) {
    return ".aiff";
  }

  if (normalized.includes("ogg")) {
    return ".ogg";
  }

  return ".bin";
};

export class FasterWhisperSTTProvider implements SpeechToTextProvider {
  readonly name = "faster-whisper";

  private workerProcess: ChildProcessWithoutNullStreams | null = null;

  private lineReader: readline.Interface | null = null;

  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(private readonly config: FasterWhisperSTTProviderConfig) {}

  async healthCheck() {
    try {
      await execFileAsync(this.pythonBin(), ["--version"]);
      await execFileAsync(FFMPEG_BIN, ["-version"]);
      await this.sendWorkerRequest("health", {});

      return healthy(
        this.name,
        `faster-whisper is ready with model "${this.config.model}".`,
      );
    } catch (error) {
      return unhealthy(
        this.name,
        `faster-whisper is unavailable: ${(error as Error).message}`,
      );
    }
  }

  async transcribe(audioChunk: AudioChunk) {
    const workingDirectory = await mkdtemp(join(tmpdir(), "slidespeech-stt-"));
    const sourcePath = join(
      workingDirectory,
      `input${mimeTypeToExtension(audioChunk.mimeType)}`,
    );
    const outputPath = join(workingDirectory, "normalized.wav");

    try {
      await writeFile(sourcePath, Buffer.from(audioChunk.dataBase64, "base64"));
      await execFileAsync(FFMPEG_BIN, [
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ]);

      const payload = (await this.sendWorkerRequest("transcribe", {
        audio_path: outputPath,
      })) as {
        text?: unknown;
        confidence?: unknown;
        isFinal?: unknown;
      };

      return {
        text: typeof payload.text === "string" ? payload.text : "",
        confidence:
          typeof payload.confidence === "number" ? payload.confidence : 0,
        isFinal: payload.isFinal !== false,
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private pythonBin() {
    return this.config.pythonBin?.trim() || DEFAULT_PYTHON_BIN;
  }

  private ensureWorker() {
    if (this.workerProcess) {
      return;
    }

    const process = spawn(
      this.pythonBin(),
      [
        WORKER_PATH,
        this.config.model || DEFAULT_MODEL,
        this.config.computeType || DEFAULT_COMPUTE_TYPE,
        String(this.config.beamSize ?? DEFAULT_BEAM_SIZE),
        this.config.language || "en",
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
            new Error(`Invalid STT worker response: ${(error as Error).message}`),
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

      pending.reject(
        new Error(message.error || "faster-whisper worker request failed."),
      );
    });

    process.stderr.on("data", () => {
      // stderr is surfaced indirectly if the process exits or a request fails.
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
            `faster-whisper worker exited unexpectedly (${signal ?? code ?? "unknown"}).`,
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
      throw new Error("faster-whisper worker is not running.");
    }

    const id = `stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.workerProcess!.stdin.write(
        `${JSON.stringify({ id, action, ...payload })}\n`,
      );
    });
  }
}

export const FASTER_WHISPER_STT_DEFAULTS = {
  pythonBin: DEFAULT_PYTHON_BIN,
  model: DEFAULT_MODEL,
  computeType: DEFAULT_COMPUTE_TYPE,
  beamSize: DEFAULT_BEAM_SIZE,
  language: "en",
} satisfies FasterWhisperSTTProviderConfig;
