import type {
  GeneratePresentationResponse,
  PresentationGenerationJobStatusResponse,
} from "@slidespeech/types";
import { PresentationGenerationJobStatusResponseSchema } from "@slidespeech/types";

import { createId, nowIso } from "@slidespeech/core";

import { createPresentation } from "./presentation-service";

type GenerationJobInput = Parameters<typeof createPresentation>[0];

type GenerationJobRecord = {
  id: string;
  status: PresentationGenerationJobStatusResponse["status"];
  input: GenerationJobInput;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  sessionId?: string;
  deckId?: string;
  error?: string;
};

type GenerationExecutor = (
  input: GenerationJobInput,
) => Promise<GeneratePresentationResponse>;

const MAX_COMPLETED_JOBS = 200;

export const createPresentationGenerationQueue = (
  execute: GenerationExecutor = createPresentation,
) => {
  const jobs = new Map<string, GenerationJobRecord>();
  const queuedJobIds: string[] = [];
  let activeJobId: string | null = null;

  const trimCompletedJobs = () => {
    const completedJobIds = Array.from(jobs.values())
      .filter((job) => job.status === "completed" || job.status === "failed")
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((job) => job.id);

    const excess = completedJobIds.length - MAX_COMPLETED_JOBS;
    if (excess <= 0) {
      return;
    }

    for (const jobId of completedJobIds.slice(0, excess)) {
      jobs.delete(jobId);
    }
  };

  const toStatusResponse = (
    job: GenerationJobRecord,
  ): PresentationGenerationJobStatusResponse =>
    PresentationGenerationJobStatusResponseSchema.parse({
      jobId: job.id,
      status: job.status,
      ...(job.status === "queued"
        ? {
            queuePosition: queuedJobIds.indexOf(job.id) + 1,
            jobsAhead:
              queuedJobIds.indexOf(job.id) + (activeJobId === null ? 0 : 1),
          }
        : {
            jobsAhead: 0,
          }),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.startedAt ? { startedAt: job.startedAt } : {}),
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(job.sessionId ? { sessionId: job.sessionId } : {}),
      ...(job.deckId ? { deckId: job.deckId } : {}),
      ...(job.error ? { error: job.error } : {}),
    });

  const runNextJob = () => {
    if (activeJobId !== null) {
      return;
    }

    const nextJobId = queuedJobIds.shift();
    if (!nextJobId) {
      return;
    }

    const job = jobs.get(nextJobId);
    if (!job) {
      runNextJob();
      return;
    }

    const startedAt = nowIso();
    activeJobId = nextJobId;
    job.status = "generating";
    job.startedAt = startedAt;
    job.updatedAt = startedAt;

    void execute(job.input)
      .then((result) => {
        const completedAt = nowIso();
        job.status = "completed";
        job.updatedAt = completedAt;
        job.completedAt = completedAt;
        job.sessionId = result.session.id;
        job.deckId = result.deck.id;
      })
      .catch((error) => {
        const completedAt = nowIso();
        job.status = "failed";
        job.updatedAt = completedAt;
        job.completedAt = completedAt;
        job.error = (error as Error).message;
      })
      .finally(() => {
        activeJobId = null;
        trimCompletedJobs();
        runNextJob();
      });
  };

  return {
    enqueue(
      input: GenerationJobInput,
    ): PresentationGenerationJobStatusResponse {
      const createdAt = nowIso();
      const job: GenerationJobRecord = {
        id: createId("genjob"),
        status: "queued",
        input,
        createdAt,
        updatedAt: createdAt,
      };

      jobs.set(job.id, job);

      if (activeJobId === null && queuedJobIds.length === 0) {
        queuedJobIds.push(job.id);
        runNextJob();
      } else {
        queuedJobIds.push(job.id);
      }

      return toStatusResponse(jobs.get(job.id) ?? job);
    },

    getStatus(jobId: string): PresentationGenerationJobStatusResponse | null {
      const job = jobs.get(jobId);

      if (!job) {
        return null;
      }

      return toStatusResponse(job);
    },
  };
};

export const presentationGenerationQueue = createPresentationGenerationQueue();
