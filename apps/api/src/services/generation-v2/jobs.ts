import { randomUUID } from "node:crypto";
import { GeneratePresentationRequestSchema, GenerationV2JobSchema, ReviewedNarrationSchema, PublishablePresentationSchema } from "@slidespeech/types";
import type { GeneratePresentationRequest, GenerationStageProgressListener, GenerationV2Job } from "@slidespeech/types";
import type { GenerationV2PublishedResult } from "@slidespeech/core";

export type GenerationV2JobExecutor = (
  request: GeneratePresentationRequest,
  options: { signal: AbortSignal; onProgress: GenerationStageProgressListener },
) => Promise<GenerationV2PublishedResult>;

export class GenerationV2JobBusyError extends Error {}

export class GenerationV2Jobs {
  private readonly jobs = new Map<string, GenerationV2Job>();
  private readonly queued: string[] = [];
  private active: { id: string; controller: AbortController } | undefined;

  constructor(private readonly execute: GenerationV2JobExecutor, private readonly maximumQueued = 4,
    private readonly estimate?: (job: GenerationV2Job) => GenerationV2Job["estimate"]) {
    if (!Number.isInteger(maximumQueued) || maximumQueued < 1 || maximumQueued > 19) throw new RangeError("Queue capacity must be between 1 and 19.");
  }

  get(id: string): GenerationV2Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const estimate = this.estimate?.(job);
    return structuredClone({ ...job, ...(job.status === "queued" ? { queuePosition: this.queued.indexOf(id) + 1 } : {}), ...(estimate ? { estimate } : {}) });
  }

  start(input: unknown): GenerationV2Job {
    const request = GeneratePresentationRequestSchema.parse(input);
    if (this.queued.length >= this.maximumQueued) throw new GenerationV2JobBusyError("The presentation queue is full. Please try again after a presentation finishes.");
    // Process-local history must never evict waiting or still-unwinding work.
    while (this.jobs.size >= 20) {
      const oldest = [...this.jobs.values()].find((job) => job.status !== "queued" && job.id !== this.active?.id);
      if (!oldest) break;
      this.jobs.delete(oldest.id);
    }
    const now = new Date().toISOString();
    const job: GenerationV2Job = { id: randomUUID(), request, status: "queued", queuePosition: this.queued.length + 1, createdAt: now, updatedAt: now, progress: [] };
    this.jobs.set(job.id, job);
    this.queued.push(job.id);
    this.dispatch();
    return this.get(job.id)!;
  }

  cancel(id: string): GenerationV2Job | undefined {
    const job = this.jobs.get(id);
    if (job?.status === "queued") {
      this.queued.splice(this.queued.indexOf(id), 1);
      const { queuePosition: _position, ...base } = job;
      this.jobs.set(id, { ...base, status: "cancelled", error: "Presentation removed from the queue.", updatedAt: new Date().toISOString() });
    }
    if (job?.status === "running" && this.active?.id === id) {
      this.jobs.set(id, { ...job, status: "cancelled", error: "Presentation planning cancelled.", updatedAt: new Date().toISOString() });
      this.active.controller.abort(new Error("Cancelled by user."));
    }
    return this.get(id);
  }

  private dispatch(): void {
    if (this.active) return;
    const id = this.queued.shift();
    if (!id) return;
    const waiting = this.jobs.get(id);
    if (waiting?.status !== "queued") throw new Error("Queued presentation state is inconsistent.");
    const { queuePosition: _position, ...base } = waiting;
    const startedAt = new Date().toISOString();
    const job: GenerationV2Job = { ...base, status: "running", startedAt, updatedAt: startedAt };
    const controller = new AbortController();
    this.jobs.set(id, job);
    this.active = { id, controller };
    void this.run(job, controller);
  }

  private async run(job: GenerationV2Job, controller: AbortController): Promise<void> {
    try {
      const result = await this.execute(structuredClone(job.request), {
        signal: controller.signal,
        onProgress: (event) => {
          const current = this.jobs.get(job.id)!;
          if (current.status !== "running") return;
          const previous = current.progress.at(-1);
          const progress = [...current.progress];
          if (previous?.stage === event.stage && previous.attempt === event.attempt) progress.pop();
          progress.push(event);
          const stageStartedAt = previous?.stage === event.stage && previous.attempt === event.attempt
            ? current.stageStartedAt ?? event.occurredAt : event.occurredAt;
          this.jobs.set(job.id, { ...current, stageStartedAt, progress: progress.slice(-100), updatedAt: event.occurredAt });
        },
      });
      if (controller.signal.aborted) return;
      const current = this.jobs.get(job.id)!;
      const updatedAt = new Date().toISOString();
      if (result.status === "succeeded") {
        ReviewedNarrationSchema.parse(result.spokenPresentation);
        PublishablePresentationSchema.parse(result.publication);
      }
      this.jobs.set(job.id, GenerationV2JobSchema.parse(result.status === "succeeded" ? {
        ...current, updatedAt, status: "slides-ready",
        result: { subject: result.classification.subject, factBank: result.factBank, sources: result.researchBundle.sources, reviewSummary: result.researchReview.summary, strategy: result.strategy, slidePlans: result.slidePlans, outlineReview: result.outlineReview,
          designs: result.designs, slides: result.slides, scenes: result.scenes, slideReview: result.slideReview,
          spokenPresentation: result.spokenPresentation,
          publication: { id: result.publication.artifactId, publishedAt: result.publication.publishedAt } },
      } : {
        ...current, updatedAt, status: result.status,
        error: result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      }));
    } catch (error) {
      if (!controller.signal.aborted) {
        this.jobs.set(job.id, { ...this.jobs.get(job.id)!, status: "failed", error: error instanceof Error ? error.message : "Presentation planning could not complete.", updatedAt: new Date().toISOString() });
      }
    } finally {
      if (this.active?.id === job.id) { this.active = undefined; this.dispatch(); }
    }
  }
}
