import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executeGenerationStage } from "@slidespeech/core";
import { FileGenerationTraceRecorder, OpenAICompatibleGenerationAgent, createSlidePreviewRenderer } from "@slidespeech/providers";
import type { SlideReviewAgentInput } from "@slidespeech/types";
import { createSlideStages, slideRevisionFromReview } from "../packages/core/src/generation/v2/slide-stages";
import { sequentialStageDeadlineMs } from "../packages/core/src/generation/v2/execution-deadline";
import { fidelityCases, fidelityInput } from "../tests/fixtures/slide-fidelity";

// Real-model diagnostics on authored controls and an optional recorded draft.
// Never publishes, regenerates research, edits the record or supplies replacement prose.
async function main() {
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real model first.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "slide-revision-eval", baseUrl, model, reasoningEffort: "low", timeoutMs: 180_000 });
  if (!(await agent.healthCheck()).ok) throw new Error("Configured model unavailable.");
  const outputDirectory = resolve("data/generation-evals", `slide-revision-${Date.now().toString(36)}`);
  await mkdir(outputDirectory, { recursive: true });
  const results: unknown[] = [];
  for (const item of fidelityCases) {
    for (const defect of [undefined, "notes"] as const) {
      const input = fidelityInput(item, defect);
      if (!defect) input.slides.slides[0]!.speakerNotes.push(item.language === "sv"
        ? "Tänk er att ni gör ett liknande försök själva. Det är ett exempel, inte ännu ett uppmätt resultat."
        : "Imagine explaining this idea to a colleague. The main points is to understand the observation, not memorize the wording.");
      const started = Date.now();
      const review = await agent.slides.reviewSlides(input, { signal: AbortSignal.timeout(180_000) });
      const result = { scenario: `${item.id}-${defect ?? "useful-imperfect"}`, expectedApproval: !defect, durationMs: Date.now() - started, review };
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(resolve(outputDirectory, "controls.json"), JSON.stringify(results, null, 2));
      if (review.value.approved !== !defect) process.exitCode = 1;
    }
  }
  const directory = process.argv[2];
  if (!directory) return;
  const load = async (stage: string) => JSON.parse(await readFile(resolve(directory, `${stage}-01.json`), "utf8")).artifact;
  const input: SlideReviewAgentInput = { request: await load("request-capture"), classification: await load("prompt-classification"),
    factBank: await load("fact-curation"), strategy: await load("deck-strategy"), slidePlans: await load("slide-allocation"),
    designs: await load("design-selection"), slides: (await load("slide-generation")).slides };
  const previous = await load("slide-generation");
  const evidence = await load("evidence-selection");
  const runId = `revision_eval_${Date.now().toString(36)}`;
  const recorder = new FileGenerationTraceRecorder({ rootDir: resolve("data") });
  const stages = createSlideStages(agent.slides, await createSlidePreviewRenderer());
  const run = <I, A>(definition: import("../packages/core/src/generation/v2/stage-runner").GenerationStageDefinition<I, A>, value: I, ids: string[], attempt: number) => executeGenerationStage({
    definition, input: value, recorder, context: { runId, attempt, inputArtifactIds: ids, sourceIds: evidence.sources.map((source: { id: string }) => source.id) },
    deadlineMs: definition.name === "slide-generation" ? sequentialStageDeadlineMs(input.slides.slides.length, 180_000) : 180_000,
    onProgress: event => console.log(JSON.stringify(event)),
  });
  const review = await run(stages.review, input, [input.designs.artifactId, input.slides.artifactId], 1);
  if (review.status !== "rejected" || !review.artifact) throw new Error("Recorded negative was not rejected; no revision test can be claimed.");
  const revision = slideRevisionFromReview(previous, review.artifact);
  if (!revision) throw new Error("Review did not identify an actionable slide-owned revision.");
  const { slides, ...authorInput } = input;
  const writing = await run(stages.writing, { ...authorInput, sources: evidence.sources, revision }, [input.designs.artifactId, input.slides.artifactId, review.artifact.artifactId], 2);
  if (writing.status !== "succeeded") throw new Error(JSON.stringify(writing.errors));
  const recheck = await run(stages.review, { ...input, slides: writing.artifact.slides }, [input.designs.artifactId, writing.artifact.slides.artifactId], 2);
  await writeFile(resolve(outputDirectory, "revision.json"), JSON.stringify({ sourceDirectory: directory, runId, review, writing, recheck }, null, 2));
  console.log(JSON.stringify({ outputDirectory, runId, status: recheck.status }));
  if (recheck.status !== "succeeded") process.exitCode = 1;
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
