import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PresentationQuestionPipeline } from "@slidespeech/core";
import { QuestionAgent, StructuredGenerationClient, FileGenerationTraceRecorder } from "@slidespeech/providers";
import { PublishedPresentationRecordSchema, PresentationRequestArtifactSchema, PromptClassificationSchema, FactBankSchema, EvidenceSetSchema, SlideDraftSetSchema, ReviewedNarrationSchema } from "@slidespeech/types";

async function main() {
  const [file, question] = process.argv.slice(2);
  if (!file || !question) throw new Error("Supply a saved publication or reviewed narration result and a question. This tests Q&A on existing material, not fresh generation.");
  const saved = JSON.parse(await readFile(resolve(file), "utf8"));
  const record = PublishedPresentationRecordSchema.safeParse(saved);
  const continuation = !record.success;
  const material = record.success ? record.data.presentation : {
    artifactId: saved.runId,
    request: PresentationRequestArtifactSchema.parse(saved.request),
    classification: PromptClassificationSchema.parse(saved.classification),
    factBank: FactBankSchema.parse(saved.factBank), evidenceSet: EvidenceSetSchema.parse(saved.evidenceSet),
    slides: SlideDraftSetSchema.parse(saved.slides), narrations: ReviewedNarrationSchema.parse(saved.spokenPresentation).narrations,
  };
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real LLM first.");
  const client = new StructuredGenerationClient({ providerName: "live-questions-v2", baseUrl, model, reasoningEffort: "low", timeoutMs: 60_000 });
  const health = await client.healthCheck(); if (!health.ok) throw new Error("Configured model unavailable.");
  const started = Date.now();
  const result = await new PresentationQuestionPipeline(new QuestionAgent(client), new FileGenerationTraceRecorder({ rootDir: resolve("data") }))
    .answer(material, { text: question, slideIndex: 0, passageIndex: 0, playbackSeconds: 0 });
  const output = resolve(`data/generation-evals/${result.answer.artifactId}.json`);
  await writeFile(output, JSON.stringify({ continuation, model, durationMs: Date.now() - started, result }, null, 2));
  console.log(JSON.stringify({ continuation, model, durationMs: Date.now() - started, output, result }));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
