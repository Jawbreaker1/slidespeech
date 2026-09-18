import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GenerationV2Pipeline } from "@slidespeech/core";
import type { GenerationV2PipelineSuccess, GenerationV2NarrationSuccess } from "@slidespeech/core";
import { FileGenerationTraceRecorder, HostedGenerationResearchProvider, OpenAICompatibleGenerationAgent } from "@slidespeech/providers";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Supply a saved successful full slide-pipeline result. This is a narration continuation, not fresh research.");
  const slides: GenerationV2PipelineSuccess = JSON.parse(await readFile(resolve(path), "utf8"));
  if (slides.status !== "succeeded" || !slides.slideReview || !slides.slides || !slides.researchReview) throw new Error("A complete reviewed slide result is required.");
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real model first.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "lmstudio-generation-v2", baseUrl, model, reasoningEffort: "low" });
  if (!(await agent.healthCheck()).ok) throw new Error("Configured model unavailable.");
  const publish = process.argv[3] === "--publish";
  if (publish && !("spokenPresentation" in slides)) throw new Error("Publication continuation requires the reviewed narration result.");
  const runId = `${publish ? "publication" : "narration"}_eval_${Date.now().toString(36)}`;
  const pipeline = new GenerationV2Pipeline({ agent, researchProvider: new HostedGenerationResearchProvider(),
    recorder: new FileGenerationTraceRecorder({ rootDir: resolve("data") }), onProgress: (event) => console.log(JSON.stringify(event)) });
  const started = Date.now();
  const result = publish ? await pipeline.publishNarratedSlides({ ...slides, runId } as GenerationV2NarrationSuccess, agent.publication)
    : await pipeline.narrateSlides({ ...slides, runId }, agent.narration);
  const output = resolve(`data/generation-evals/${runId}.json`);
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, output, durationMs: Date.now() - started,
    ...(result.status === "succeeded" ? { spokenPresentation: result.spokenPresentation } : { diagnostics: result.diagnostics }) }));
  if (result.status !== "succeeded") process.exitCode = 1;
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
