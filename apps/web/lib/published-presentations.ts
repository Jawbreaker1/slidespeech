import { PublishedPresentationViewSchema, PresentationQuestionResponseSchema, QuestionTranscriptSchema, PublishedLibraryPageSchema, type PublishedLibraryQuery, type PresentationQuestion, type QuestionProgress } from "@slidespeech/types";
import { readQuestionStream } from "./question-progress";

const base = "/api/generation-v2/presentations";
export async function listPublishedPresentations(query: PublishedLibraryQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ query: query.query, order: query.order, offset: String(query.offset), limit: String(query.limit) });
  const response = await fetch(`${base}?${params}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Your library could not be loaded.");
  return PublishedLibraryPageSchema.parse(body);
}
export async function archivePublishedPresentation(id: string) {
  const response = await fetch(`${base}/${encodeURIComponent(id)}/archive`, { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).error ?? "The presentation could not be archived.");
}
export async function getPublishedPresentation(id: string, signal?: AbortSignal) {
  const response = await fetch(`${base}/${encodeURIComponent(id)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load the published presentation.");
  return PublishedPresentationViewSchema.parse(body);
}
export const publishedSlideAudioUrl = (id: string, slideIndex: number, passageIndex: number) => `${base}/${encodeURIComponent(id)}/slides/${slideIndex}/audio?passage=${passageIndex}`;

export async function getAnswerAudio(id: string, answerId: string, signal: AbortSignal, includeBridge = true) {
  const response = await fetch(`${base}/${encodeURIComponent(id)}/answers/${encodeURIComponent(answerId)}/audio?bridge=${includeBridge}`, { signal });
  if (!response.ok) throw new Error((await response.json()).error ?? "Answer audio could not be prepared.");
  return response.blob();
}

export async function transcribeQuestionAudio(id: string, recording: Blob, signal: AbortSignal) {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read recording."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]!); reader.readAsDataURL(recording);
  });
  signal.throwIfAborted();
  const response = await fetch(`${base}/${encodeURIComponent(id)}/transcriptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mimeType: recording.type, dataBase64 }), signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not transcribe your recording.");
  return QuestionTranscriptSchema.parse(body);
}

export async function askPresentationQuestion(id: string, question: PresentationQuestion, signal: AbortSignal, onProgress?: (progress: QuestionProgress) => void) {
  const response = await fetch(`${base}/${encodeURIComponent(id)}/questions`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(question), signal });
  if (!response.ok) throw new Error((await response.json()).error ?? "The question could not be answered. Please try again.");
  const result = response.headers.get("Content-Type")?.includes("application/x-ndjson")
    ? await readQuestionStream(response, signal, onProgress)
    : PresentationQuestionResponseSchema.parse(await response.json());
  signal.throwIfAborted();
  if (result.presentationId !== id || result.answer.question !== question.text || result.resume.slideIndex !== question.slideIndex || result.resume.passageIndex !== question.passageIndex || result.resume.playbackSeconds !== 0) throw new Error("The answer does not match this question or playback position.");
  return result;
}
