import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GenerationV2Pipeline } from "@slidespeech/core";
import { FileGenerationTraceRecorder, HostedGenerationResearchProvider, OpenAICompatibleGenerationAgent, createSlidePreviewRenderer } from "@slidespeech/providers";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";

async function main() {
  const topic = process.argv[2];
  if (!topic) throw new Error("Supply the presentation brief as the first argument.");
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real model first.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "lmstudio-generation-v2", baseUrl, model, reasoningEffort: "low" });
  const health = await agent.healthCheck();
  if (!health.ok) throw new Error(JSON.stringify(health));
  const started = Date.now();
  const pipeline = new GenerationV2Pipeline({ agent, researchProvider: new HostedGenerationResearchProvider(),
    recorder: new FileGenerationTraceRecorder({ rootDir: resolve("data") }), onProgress: (event) => console.log(JSON.stringify(event)) });
  const slides = await pipeline.execute({ topic, targetSlideCount: 3 }, { agent: agent.slides, images: agent.images, render: await createSlidePreviewRenderer() });
  const spoken = process.argv[3] === "--complete" && slides.status === "succeeded" ? await pipeline.narrateSlides(slides, agent.narration) : slides;
  const result = spoken.status === "succeeded" && "spokenPresentation" in spoken ? await pipeline.publishNarratedSlides(spoken, agent.publication) : spoken;
  await mkdir("data/generation-evals", { recursive: true });
  const path = resolve(`data/generation-evals/images-${result.runId}.json`);
  await writeFile(path, JSON.stringify(result, null, 2));
  if (result.status === "succeeded") {
    await writeFile(`${path}.pptx`, await renderSlideScenesToPptx(result.scenes));
    console.log(JSON.stringify({ status: result.status, path, durationMs: Date.now() - started, images: result.designs.images?.decisions, slides: result.slides.slides }));
  } else { console.error(JSON.stringify({ ...result, path, durationMs: Date.now() - started })); process.exitCode = 1; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
