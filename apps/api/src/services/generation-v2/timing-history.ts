import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GenerationStageNameSchema, type GenerationStageName, type GenerationV2Job } from "@slidespeech/types";

export type TimingSample = { slides: number; durationMs: number; remainingByStage: Partial<Record<GenerationStageName, number>> };
const traceSchema = z.object({
  stage: GenerationStageNameSchema, startedAt: z.string().datetime(), completedAt: z.string().datetime(),
  status: z.string(), telemetry: z.object({ model: z.string() }).optional(),
});
const publicationSchema = traceSchema.extend({
  status: z.literal("succeeded"), stage: z.literal("publication"),
  artifact: z.object({ slides: z.object({ slides: z.array(z.unknown()).min(2).max(30) }) }),
});

export function estimateGeneration(job: GenerationV2Job, samples: readonly TimingSample[], now = Date.now()): GenerationV2Job["estimate"] {
  if (job.status !== "running" && job.status !== "queued") return undefined;
  const latest = job.progress.at(-1);
  const slideCount = [...job.progress].reverse().find((event) => event.stage === "slide-generation" && event.totalUnits)?.totalUnits ?? job.request.targetSlideCount;
  const exact = samples.filter((sample) => sample.slides === slideCount);
  const available = exact.length ? exact : samples;
  const elapsed = job.status === "queued" ? 0 : Math.max(0, now - Date.parse(job.stageStartedAt ?? job.startedAt ?? job.createdAt));
  const durations = available.flatMap((sample) => {
    const remaining = latest ? sample.remainingByStage[latest.stage] : sample.durationMs;
    if (remaining === undefined) return [];
    // Numerical workload projection only, never an input to generation/review.
    const scale = slideCount ? slideCount / sample.slides : 1;
    return [Math.max(0, Math.round(remaining * scale - elapsed))];
  });
  if (!durations.length) return undefined;
  return { lowerMs: Math.min(...durations), upperMs: Math.max(...durations), sampleCount: durations.length,
    lengthAdjusted: Boolean(slideCount && !exact.length) };
}

/** Bounded, optional operational measurements. No prompts or content leave this reader. */
export class GenerationTimingHistory {
  private samples: TimingSample[] = [];
  private loading: Promise<void> | undefined;
  constructor(private readonly root: string, private readonly model: string) {}

  estimate(job: GenerationV2Job) { return estimateGeneration(job, this.samples); }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.load().catch(() => { /* Missing/corrupt history cannot block generation. */ }).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async load() {
    const entries = await readdir(this.root, { withFileTypes: true });
    const recent = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const directory = join(this.root, entry.name);
      return { directory, time: (await stat(directory)).mtimeMs };
    }));
    const samples: TimingSample[] = [];
    for (const { directory } of recent.sort((a, b) => b.time - a.time).slice(0, 100)) {
      try {
        const publication = publicationSchema.parse(JSON.parse(await readFile(join(directory, "publication-01.json"), "utf8")));
        const classification = traceSchema.parse(JSON.parse(await readFile(join(directory, "prompt-classification-01.json"), "utf8")));
        if (classification.telemetry?.model !== this.model) continue;
        const traces = [];
        for (const file of (await readdir(directory)).filter((file) => file.endsWith(".json"))) {
          traces.push(traceSchema.parse(JSON.parse(await readFile(join(directory, file), "utf8"))));
        }
        const end = Date.parse(publication.completedAt);
        const start = Math.min(...traces.map((trace) => Date.parse(trace.startedAt)));
        if (end <= start) continue;
        const remainingByStage: TimingSample["remainingByStage"] = {};
        for (const trace of traces) remainingByStage[trace.stage] = Math.max(remainingByStage[trace.stage] ?? 0, end - Date.parse(trace.startedAt));
        samples.push({ slides: publication.artifact.slides.slides.length, durationMs: end - start, remainingByStage });
        if (samples.length === 20) break;
      } catch { /* Incomplete/foreign runs are not completion-time evidence. */ }
    }
    this.samples = samples;
  }
}
