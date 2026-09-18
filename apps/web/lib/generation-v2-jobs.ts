import { GenerationV2JobSchema } from "@slidespeech/types";
import type { GeneratePresentationRequest, GenerationV2Job } from "@slidespeech/types";

const baseUrl = "/api/generation-v2/jobs";

async function requestJob(url: string, options: RequestInit = {}): Promise<GenerationV2Job> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Presentation request failed.");
  return GenerationV2JobSchema.parse(body);
}

export const startGenerationV2Job = (request: GeneratePresentationRequest) => requestJob(baseUrl, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
});
export const getGenerationV2Job = (id: string, signal?: AbortSignal) => requestJob(`${baseUrl}/${encodeURIComponent(id)}`, signal ? { signal } : {});
export const cancelGenerationV2Job = (id: string) => requestJob(`${baseUrl}/${encodeURIComponent(id)}/cancel`, { method: "POST" });
