import { narrationPassages, PresentationQuestionResponseSchema } from "@slidespeech/types";
import type { PublishedPresentationRecord, TextToSpeechProvider, PresentationQuestionResponse } from "@slidespeech/types";

export class PublishedPresentationSpeech {
  private readonly cache = new Map<string, Promise<Uint8Array>>();
  private readonly answers = new Map<string, { result: PresentationQuestionResponse; expiresAt: number }>();
  constructor(private readonly provider: TextToSpeechProvider) {}
  synthesize(record: PublishedPresentationRecord, slideIndex: number, passageIndex?: number): Promise<Uint8Array> {
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= record.presentation.narrations.scripts.length) {
      throw new RangeError("The requested slide does not exist.");
    }
    const passages = narrationPassages(record.presentation.narrations.scripts[slideIndex]!);
    if (passageIndex !== undefined && (!Number.isInteger(passageIndex) || passageIndex < 0 || passageIndex >= passages.length)) throw new RangeError("The requested narration passage does not exist.");
    const text = passageIndex === undefined ? passages.join("\n\n") : passages[passageIndex]!;
    const key = JSON.stringify([record.presentation.artifactId, slideIndex, passageIndex, text]);
    return this.audio(key, text, "narration");
  }
  registerAnswer(result: PresentationQuestionResponse): void {
    const approved = PresentationQuestionResponseSchema.parse(result);
    this.answers.set(approved.answer.artifactId, { result: approved, expiresAt: Date.now() + 30 * 60_000 });
    while (this.answers.size > 64) this.answers.delete(this.answers.keys().next().value!);
  }
  answerAudio(presentationId: string, answerId: string, includeBridge = true): Promise<Uint8Array> | undefined {
    const entry = this.answers.get(answerId);
    if (!entry || entry.result.presentationId !== presentationId) return undefined;
    if (entry.expiresAt <= Date.now()) { this.answers.delete(answerId); return undefined; }
    const text = includeBridge ? `${entry.result.answer.answer}\n\n${entry.result.resume.bridgeText}` : entry.result.answer.answer;
    return this.audio(JSON.stringify([presentationId, answerId, text]), text, "answer");
  }
  private audio(key: string, text: string, style: "narration" | "answer"): Promise<Uint8Array> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.provider.synthesize(text, { style, speakingRate: 1 }).then((audio) => {
      if (audio.mimeType !== "audio/wav" || !audio.audioBase64 || !(audio.durationMs > 0)) throw new Error("Speech provider returned no playable WAV audio.");
      const bytes = Buffer.from(audio.audioBase64, "base64");
      if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Speech provider returned invalid audio bytes.");
      return bytes;
    }).catch((error) => { if (this.cache.get(key) === pending) this.cache.delete(key); throw error; });
    this.cache.set(key, pending);
    while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    return pending;
  }
}
