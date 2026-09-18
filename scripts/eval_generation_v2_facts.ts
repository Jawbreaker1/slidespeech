import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { OpenAICompatibleGenerationAgent } from "@slidespeech/providers";
import { assessFactCurationDecision } from "../packages/core/src/generation/v2/fact-curation-stage";
import { createFactCurationStage, createResearchReviewStage, executeGenerationStage, InMemoryGenerationTraceRecorder } from "@slidespeech/core";
import type { FactBankDecision, FactCurationAgentInput } from "@slidespeech/types";

// Diagnostic replays only: raw model responses never enter publication storage.
async function main() {
  const directories = process.argv.slice(2);
  if (!directories.length) throw new Error("Supply recorded generation-run directories.");
  const evidenceDirectory = process.env.FACT_EVAL_EVIDENCE_DIR;
  if (evidenceDirectory && directories.length !== 1) throw new Error("An explicit evidence replay directory requires exactly one original run.");
  const temperatures = (process.env.FACT_EVAL_TEMPERATURES ?? "0.1,1").split(",").map(Number);
  const tokenLimit = process.env.FACT_EVAL_TOKEN_LIMIT === undefined ? undefined : Number(process.env.FACT_EVAL_TOKEN_LIMIT);
  if (temperatures.some(value => !Number.isFinite(value) || value < 0 || value > 2)
    || (tokenLimit !== undefined && (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1 || tokenLimit > 14_000))) {
    throw new Error("Diagnostic temperature must be 0-2 and token limit 1-14000.");
  }
  const baseUrl = process.env.LMSTUDIO_BASE_URL, model = process.env.LMSTUDIO_MODEL;
  if (!baseUrl || !model) throw new Error("Configure the real generation model.");
  const agent = new OpenAICompatibleGenerationAgent({ providerName: "fact-diagnostic", baseUrl, model,
    apiKey: process.env.LMSTUDIO_API_KEY, reasoningEffort: "low", timeoutMs: 180_000 });
  const health = await agent.healthCheck();
  if (!health.ok) throw new Error(health.detail);
  const output = resolve("data/generation-evals/fact-sampling", Date.now().toString(36));
  await mkdir(output, { recursive: true });
  console.log(JSON.stringify({ output, model, mode: "captured-evidence-diagnostic" }));
  for (const directory of directories) {
    const load = async (stage: string) => {
      const record = JSON.parse(await readFile(resolve(stage === "evidence-selection" && evidenceDirectory ? evidenceDirectory : directory, `${stage}-01.json`), "utf8"));
      if (record.status !== "succeeded" || !record.artifact) throw new Error(`Missing successful ${stage}.`);
      return record.artifact;
    };
    const input: FactCurationAgentInput = { classification: await load("prompt-classification"),
      researchPlan: await load("research-planning"), evidence: await load("evidence-selection") };
    if (input.evidence.researchPlanArtifactId !== input.researchPlan.artifactId
      || input.evidence.researchBundleArtifactId !== (await load("research-execution")).artifactId) {
      throw new Error("Replayed evidence must belong to this exact original research plan and acquisition.");
    }
    let captured: Record<string, unknown> | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      throw new Error("Diagnostic request captured; no model request sent.");
    };
    try { await agent.curateFacts(input); } catch (error) { if (!captured) throw error; }
    finally { globalThis.fetch = realFetch; }
    if (!captured) throw new Error("No fact-curation request captured.");
    const orderedTemperatures = [...temperatures];
    // Alternate order between subjects to avoid always giving one setting a warm cache.
    if (directories.indexOf(directory) % 2) orderedTemperatures.reverse();
    for (const temperature of orderedTemperatures) {
      const body = { ...captured, temperature, ...(tokenLimit === undefined ? {} : { max_tokens: tokenLimit }) };
      const start = performance.now();
      const response = await realFetch(`${baseUrl}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json",
          ...(process.env.LMSTUDIO_API_KEY ? { Authorization: `Bearer ${process.env.LMSTUDIO_API_KEY}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
      });
      const result = await response.json();
      const durationMs = Math.round(performance.now() - start);
      const choice = result.choices?.[0];
      let decision: FactBankDecision | undefined;
      let diagnostics: Array<{ message: string }>;
      try {
        const parsedDecision: FactBankDecision = JSON.parse(choice?.message?.content ?? "");
        decision = parsedDecision;
        diagnostics = assessFactCurationDecision({ researchPlan: input.researchPlan,
          evidenceSet: input.evidence, decision: parsedDecision });
      } catch (error) { diagnostics = [{ message: (error as Error).message }]; }
      const path = resolve(output, `${basename(directory)}-temperature-${temperature}.json`);
      const summary = { path, subject: input.classification.subject, temperature, tokenLimit: body.max_tokens, durationMs,
        invariantRequestHash: createHash("sha256").update(JSON.stringify({ ...body, temperature: null })).digest("hex"),
        status: response.status, finishReason: choice?.finish_reason, usage: result.usage,
        factCount: decision?.facts?.length, diagnostics };
      await writeFile(path, JSON.stringify({ summary, originalDirectory: resolve(directory), evidenceDirectory: resolve(evidenceDirectory ?? directory), input, request: body, result }, null, 2));
      console.log(JSON.stringify(summary));
      const complete = response.ok && choice?.finish_reason === "stop" && diagnostics.length === 0;
      if (!complete) process.exitCode = 1;
      if (complete && decision && process.env.FACT_EVAL_REVIEW === "true") {
        const capturedDecision = decision;
        const recorder = new InMemoryGenerationTraceRecorder();
        const context = { runId: `fact_diagnostic_${basename(directory)}_${Math.round(temperature * 1000)}`, attempt: 1,
          inputArtifactIds: [input.classification.artifactId, input.researchPlan.artifactId, input.evidence.artifactId],
          sourceIds: input.evidence.sources.map(source => source.id) };
        // Assemble the captured real response through the ordinary artifact contract.
        // This is an isolated review diagnostic, never a resumed/public app run.
        const curated = await executeGenerationStage({ definition: createFactCurationStage({ agent: {
          curateFacts: async () => ({ value: capturedDecision, telemetry: { provider: "captured-real-response", model } }),
        } }), input: { classification: input.classification, researchPlan: input.researchPlan, evidenceSet: input.evidence },
        context, recorder, deadlineMs: 180_000 });
        console.log(JSON.stringify({ path, factStageStatus: curated.status,
          ...(curated.status === "succeeded" ? {} : { errors: curated.errors }) }));
        if (curated.status === "succeeded") {
          const reviewed = await executeGenerationStage({ definition: createResearchReviewStage({ agent }),
            input: { request: await load("request-capture"), classification: input.classification,
              researchPlan: input.researchPlan, researchBundle: await load("research-execution"),
              evidenceSet: input.evidence, factBank: curated.artifact }, context, recorder, deadlineMs: 180_000 });
          console.log(JSON.stringify({ path, reviewStatus: reviewed.status, durationMs: reviewed.durationMs,
            telemetry: reviewed.telemetry, ...(reviewed.status === "succeeded" ? { review: reviewed.artifact } : { errors: reviewed.errors }) }));
          if (reviewed.status !== "succeeded" || !reviewed.artifact.approved) process.exitCode = 1;
        } else process.exitCode = 1;
        await writeFile(`${path}.review.json`, JSON.stringify(recorder.records, null, 2));
      }
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
