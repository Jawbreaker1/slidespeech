import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createEvidenceSelectionStage, executeGenerationStage } from "@slidespeech/core";
import { FileGenerationTraceRecorder, OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import type { PromptClassification, ResearchBundle, ResearchPlan } from "@slidespeech/types";
import { sequentialStageDeadlineMs } from "../packages/core/src/generation/v2/execution-deadline";

// Controlled replay of real acquired pages, not a fresh search or a published deck.
async function main() {
  const directories = process.argv.slice(2);
  if (!directories.length) throw new Error("Supply one or more recorded generation-run directories.");
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real generation model.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "lmstudio-generation-v2", baseUrl, model,
    apiKey: process.env.LMSTUDIO_API_KEY, timeoutMs: 120_000, reasoningEffort: "low" });
  const health = await agent.healthCheck();
  if (!health.ok) throw new Error(health.detail);
  const output = resolve("data/generation-evals/evidence-relevance", Date.now().toString(36));
  await mkdir(output, { recursive: true });
  for (const directory of directories) {
    const load = async <T>(stage: string): Promise<T> => {
      const record = JSON.parse(await readFile(resolve(directory, `${stage}-01.json`), "utf8"));
      if (record.status !== "succeeded" || !record.artifact) throw new Error(`Recorded ${stage} did not succeed.`);
      return record.artifact;
    };
    const classification = await load<PromptClassification>("prompt-classification");
    const researchPlan = await load<ResearchPlan>("research-planning");
    const researchBundle = await load<ResearchBundle>("research-execution");
    const runId = `evidence_replay_${basename(directory)}_${Date.now().toString(36)}`;
    const result = await executeGenerationStage({
      definition: createEvidenceSelectionStage({ agent }), input: { classification, researchPlan, researchBundle },
      context: { runId, attempt: 1, inputArtifactIds: [researchPlan.artifactId, researchBundle.artifactId], sourceIds: researchBundle.sources.map(s => s.id) },
      recorder: new FileGenerationTraceRecorder({ rootDir: output }), deadlineMs: sequentialStageDeadlineMs(Math.max(1, researchBundle.pages.length), 180_000),
      onProgress: event => console.log(JSON.stringify(event)),
    });
    const path = resolve(output, `${runId}.json`);
    await writeFile(path, JSON.stringify({ mode: "recorded-acquisition-replay", originalDirectory: resolve(directory), result }, null, 2));
    console.log(JSON.stringify({ path, subject: classification.subject, pages: researchBundle.pages.length, requirements: researchPlan.evidenceRequirements.length,
      status: result.status, durationMs: result.durationMs, telemetry: result.telemetry, errors: result.errors,
      snippets: result.status === "succeeded" ? result.artifact.snippets.map(s => ({ id: s.id, page: s.pageTitle, text: s.text })) : [] }));
    if (result.status !== "succeeded") process.exitCode = 1;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
