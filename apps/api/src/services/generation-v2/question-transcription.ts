import { QuestionAudioSchema, QuestionTranscriptSchema } from "@slidespeech/types";
import type { SpeechToTextProvider } from "@slidespeech/types";
import { SerialWorkQueue } from "./work-queue";

export class QuestionTranscription {
  private readonly queue = new SerialWorkQueue("Speech recognition", 4, 60_000);
  constructor(private readonly provider: SpeechToTextProvider) {}
  async transcribe(raw: unknown, signal: AbortSignal) {
    const audio = QuestionAudioSchema.parse(raw);
    const mediaType = audio.mimeType.split(";", 1)[0]!.trim().toLowerCase();
    if (!["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg"].includes(mediaType)) throw new Error("Unsupported recording format.");
    const bytes = Buffer.from(audio.dataBase64, "base64");
    if (!bytes.length || bytes.length > 5_000_000 || bytes.toString("base64") !== audio.dataBase64) throw new Error("The recording is invalid or too large.");
    signal.throwIfAborted();
    return this.queue.run(async () => {
      const result = await this.provider.transcribe({ ...audio, chunkId: crypto.randomUUID() }, { signal });
      signal.throwIfAborted();
      return QuestionTranscriptSchema.parse(result);
    }, signal);
  }
}
