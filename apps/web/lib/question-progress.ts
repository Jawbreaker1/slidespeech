import { QuestionStreamEventSchema, type PresentationQuestionResponse, type QuestionProgress } from "@slidespeech/types";

export const questionSteps = [
  { stage: "qa-classification", label: "Understand", title: "Understanding your question", detail: "Checking what you are asking and which information is available." },
  { stage: "qa-answer", label: "Answer", title: "Writing your answer", detail: "Preparing an answer using the presentation material and permitted knowledge." },
  { stage: "qa-review", label: "Review", title: "Checking your answer", detail: "Checking accuracy, relevance and the return to the presentation." },
] as const;

export async function readQuestionStream(response: Response, signal: AbortSignal, onProgress?: (progress: QuestionProgress) => void): Promise<PresentationQuestionResponse> {
  if (!response.body) throw new Error("The answer connection is unavailable. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("The answer connection returned an oversized message.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0 || (done && buffer.length > 0)) {
        const line = newline < 0 ? buffer : buffer.slice(0, newline);
        buffer = newline < 0 ? "" : buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const event = QuestionStreamEventSchema.parse(JSON.parse(line));
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") return event.result;
        onProgress?.(event.progress);
      }
      if (done) throw new Error("The answer connection ended before a reviewed answer arrived. Please try again.");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
