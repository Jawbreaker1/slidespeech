import "dotenv/config";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GenerationV2Pipeline } from "@slidespeech/core";
import { FileGenerationTraceRecorder, HostedGenerationResearchProvider, OpenAICompatibleGenerationAgent, createSlidePreviewRenderer } from "@slidespeech/providers";
import {
  GenerationStageResultRecordSchema, PresentationRequestArtifactSchema,
  PromptClassificationSchema, ResearchPlanSchema, ResearchBundleSchema,
  EvidenceSetSchema, FactBankSchema, ResearchReviewResultSchema,
  DeckStrategySchema, SlidePlanSetSchema, ReviewResultSchema,
} from "@slidespeech/types";

// Controlled continuation from recorded research, not a fresh research benchmark.
async function main() {
  const [mode, directory] = process.argv.slice(2);
  if (!directory || !["outline", "slides", "plan-and-slides"].includes(mode ?? "")) throw new Error("Usage: eval_generation_v2_recorded.ts <outline|slides|plan-and-slides> <recorded-run-directory>");
  const records = [];
  for (const file of await readdir(directory)) {
    if (file.endsWith(".json")) records.push(GenerationStageResultRecordSchema.parse(JSON.parse(await readFile(resolve(directory, file), "utf8"))));
  }
  if (new Set(records.map((record) => record.runId)).size !== 1) throw new Error("Input must contain exactly one recorded run.");
  function artifact(stage: string) {
    const record = records.filter((item) => item.stage === stage).sort((a, b) => b.attempt - a.attempt)[0];
    if (record?.status !== "succeeded") throw new Error(`The latest ${stage} attempt must have succeeded.`);
    return record.artifact;
  }
  const baseUrl = process.env.LMSTUDIO_BASE_URL;
  const model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("LMSTUDIO_BASE_URL and LMSTUDIO_MODEL are required.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "lmstudio-generation-v2", baseUrl, model, reasoningEffort: "low" });
  const health = await agent.healthCheck();
  if (!health.ok) throw new Error(JSON.stringify(health));
  const pipeline = new GenerationV2Pipeline({
    agent,
    researchProvider: new HostedGenerationResearchProvider(),
    recorder: new FileGenerationTraceRecorder({ rootDir: resolve(process.env.STORAGE_ROOT ?? "data") }),
    onProgress: (event) => console.log(JSON.stringify(event)),
  });
  const started = Date.now();
  const research = {
    status: "succeeded" as const, runId: `${mode}_eval_${Date.now().toString(36)}`,
    request: PresentationRequestArtifactSchema.parse(artifact("request-capture")),
    classification: PromptClassificationSchema.parse(artifact("prompt-classification")),
    researchPlan: ResearchPlanSchema.parse(artifact("research-planning")),
    researchBundle: ResearchBundleSchema.parse(artifact("research-execution")),
    evidenceSet: EvidenceSetSchema.parse(artifact("evidence-selection")),
    factBank: FactBankSchema.parse(artifact("fact-curation")),
    researchReview: ResearchReviewResultSchema.parse(artifact("research-review")),
  };
  const outline = mode === "slides" ? {
    ...research, strategy: DeckStrategySchema.parse(artifact("deck-strategy")), slidePlans: SlidePlanSetSchema.parse(artifact("slide-allocation")), outlineReview: ReviewResultSchema.parse(artifact("outline-review")),
  } : await pipeline.planOutline(research);
  const result = mode === "outline" || outline.status !== "succeeded" ? outline
    : await pipeline.draftOutline(outline, { agent: agent.slides, render: await createSlidePreviewRenderer() });
  const outputDirectory = resolve(process.env.STORAGE_ROOT ?? "data", "generation-evals");
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, `${research.runId}.json`);
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    inputResearchRun: records[0]!.runId, durationMs: Date.now() - started, output,
    ...(result.status === "succeeded" ? { status: result.status, runId: result.runId, ...( "slides" in result ? { slides: result.slides.slides.map((slide) => ({ title: slide.title, content: slide.content })) } : { strategy: result.strategy }) } : result),
  }, null, 2));
  if (result.status !== "succeeded") process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
