import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import readline from "node:readline";

import type { AudioChunk, SpeechToTextProvider } from "@slidespeech/types";
import { SpeechToTextResultSchema } from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

const execFileAsync = promisify(execFile);
const DEFAULT_PYTHON_BIN = ".venv-stt/bin/python";
const DEFAULT_MODEL = "base";
const DEFAULT_COMPUTE_TYPE = "int8";
const DEFAULT_BEAM_SIZE = 3;
const FFMPEG_BIN = "ffmpeg";
const WORKER_PATH = join(
  __dirname,
  "faster-whisper-worker.py",
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
  requestTimeoutMs?: number;
  workerPath?: string;
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
      const health = await this.sendWorkerRequest("health", {}) as { ready?: unknown };
      if (health.ready !== true) throw new Error("STT worker did not confirm readiness.");

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

  async transcribe(audioChunk: AudioChunk, options?: { signal?: AbortSignal }) {
    const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.config.requestTimeoutMs ?? 60_000)]) : AbortSignal.timeout(this.config.requestTimeoutMs ?? 60_000);
    signal.throwIfAborted();
    const workingDirectory = await mkdtemp(join(tmpdir(), "slidespeech-stt-"));
    const sourcePath = join(
      workingDirectory,
      `input${mimeTypeToExtension(audioChunk.mimeType)}`,
    );
    const outputPath = join(workingDirectory, "normalized.wav");

    try {
      await writeFile(sourcePath, Buffer.from(audioChunk.dataBase64, "base64"));
      await execFileAsync(FFMPEG_BIN, [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "wav,matroska,webm,mov,ogg,mp3,aiff",
        "-i",
        sourcePath,
        "-t", "91",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ], { signal, timeout: 15_000 });

      const payload = (await this.sendWorkerRequest("transcribe", {
        audio_path: outputPath,
      }, signal));
      return SpeechToTextResultSchema.parse(payload);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }

  private pythonBin() {
    return this.config.pythonBin?.trim() || DEFAULT_PYTHON_BIN;
  }

  dispose(): void {
    if (this.workerProcess) this.stopWorker(new Error("STT provider stopped."), this.workerProcess);
  }

  private ensureWorker() {
    if (this.workerProcess) {
      return;
    }

    const process = spawn(
      this.pythonBin(),
      [
        this.config.workerPath ?? WORKER_PATH,
        this.config.model || DEFAULT_MODEL,
        this.config.computeType || DEFAULT_COMPUTE_TYPE,
        String(this.config.beamSize ?? DEFAULT_BEAM_SIZE),
        this.config.language || "auto",
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

    process.on("error", (error) => this.stopWorker(error, process));
    process.stdin.on("error", (error) => this.stopWorker(error, process));

    process.on("exit", (code, signal) => {
      if (this.workerProcess !== process) return;
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.ensureWorker();

    if (!this.workerProcess) {
      throw new Error("faster-whisper worker is not running.");
    }

    const id = `stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const worker = this.workerProcess!;
      const abort = () => this.stopWorker(signal?.reason ?? new Error("STT cancelled."), worker);
      const timer = setTimeout(() => this.stopWorker(new Error("STT worker timed out."), worker), this.config.requestTimeoutMs ?? 60_000);
      const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pendingRequests.set(id, { resolve: (value) => { finish(); resolve(value); }, reject: (error) => { finish(); reject(error); } });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      this.workerProcess!.stdin.write(
        `${JSON.stringify({ id, action, ...payload })}\n`,
        (error) => { if (error) this.stopWorker(error, worker); },
      );
    });
  }

  private stopWorker(error: unknown, worker: ChildProcessWithoutNullStreams): void {
    if (this.workerProcess !== worker) return;
    this.workerProcess = null; this.lineReader?.close(); this.lineReader = null;
    const requests = [...this.pendingRequests.values()]; this.pendingRequests.clear();
    worker.kill("SIGKILL");
    for (const request of requests) request.reject(error);
  }
}

export const FASTER_WHISPER_STT_DEFAULTS = {
  pythonBin: DEFAULT_PYTHON_BIN,
  model: DEFAULT_MODEL,
  computeType: DEFAULT_COMPUTE_TYPE,
  beamSize: DEFAULT_BEAM_SIZE,
  language: "en",
} satisfies FasterWhisperSTTProviderConfig;
