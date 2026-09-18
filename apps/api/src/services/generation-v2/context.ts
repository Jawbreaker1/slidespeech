import { resolve } from "node:path";
import { GenerationV2Pipeline, PresentationQuestionPipeline } from "@slidespeech/core";
import { FileGenerationTraceRecorder, HostedGenerationResearchProvider, OpenAICompatibleGenerationAgent, createSlidePreviewRenderer, PublishedPresentationStore, QuestionAgent, StructuredGenerationClient } from "@slidespeech/providers";
import { env, envRoot } from "../../config/env";
import { GenerationV2Jobs } from "./jobs";
import { GenerationTimingHistory } from "./timing-history";

export const publishedPresentations = new PublishedPresentationStore(resolve(envRoot, env.STORAGE_ROOT, "published-v2"));
const timings = new GenerationTimingHistory(resolve(envRoot, env.STORAGE_ROOT, "generation-runs"), env.LMSTUDIO_MODEL);
void timings.refresh();

export function createPresentationQuestions() {
  if (env.LLM_PROVIDER === "mock") throw new Error("Published Q&A requires a real LLM. No mock answer fallback is available.");
  return new PresentationQuestionPipeline(new QuestionAgent(new StructuredGenerationClient({
    providerName: `${env.LLM_PROVIDER}-questions-v2`, baseUrl: env.LMSTUDIO_BASE_URL, model: env.LMSTUDIO_MODEL,
    apiKey: env.LMSTUDIO_API_KEY, timeoutMs: 60_000, reasoningEffort: "low",
  })), new FileGenerationTraceRecorder({ rootDir: resolve(envRoot, env.STORAGE_ROOT) }));
}

export const generationV2Jobs = new GenerationV2Jobs(async (request, options) => {
  try {
  if (env.LLM_PROVIDER === "mock" || env.WEB_RESEARCH_PROVIDER === "mock") {
    throw new Error("V2 research requires real LLM and research providers. Mock fallback is not available.");
  }
  const agent = new OpenAICompatibleGenerationAgent({
    providerName: `${env.LLM_PROVIDER}-generation-v2`,
    baseUrl: env.LMSTUDIO_BASE_URL,
    model: env.LMSTUDIO_MODEL,
    apiKey: env.LMSTUDIO_API_KEY,
    timeoutMs: env.LLM_TIMEOUT_MS,
    reasoningEffort: "low",
  });
  const pipeline = new GenerationV2Pipeline({
    agent,
    researchProvider: new HostedGenerationResearchProvider({ timeoutMs: env.WEB_RESEARCH_TIMEOUT_MS }),
    recorder: new FileGenerationTraceRecorder({ rootDir: resolve(envRoot, env.STORAGE_ROOT) }),
    onProgress: options.onProgress,
  });
  const slides = await pipeline.execute(request, { agent: agent.slides, images: agent.images, render: await createSlidePreviewRenderer() }, { signal: options.signal });
  if (slides.status !== "succeeded") return slides;
  const narrated = await pipeline.narrateSlides(slides, agent.narration, { signal: options.signal });
  if (narrated.status !== "succeeded") return narrated;
  const result = await pipeline.publishNarratedSlides(narrated, agent.publication, { signal: options.signal });
  if (result.status === "succeeded") {
    options.signal.throwIfAborted();
    await publishedPresentations.save({ presentation: result.publication, scenes: result.scenes });
  }
  return result;
  } finally { void timings.refresh(); }
}, 4, (job) => timings.estimate(job));
