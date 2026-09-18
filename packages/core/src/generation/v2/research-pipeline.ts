import type {
  FactBank,
  EvidenceSet,
  GeneratePresentationRequest,
  GenerationDiagnostic,
  GenerationStageProgressListener,
  GenerationStageName,
  GenerationTraceRecorder,
  GenerationV2AgentProvider,
  GenerationV2ResearchProvider,
  PresentationRequestArtifact,
  PromptClassification,
  ResearchBundle,
  ResearchPlan,
  ResearchReviewResult,
  ReviewResult,
} from "@slidespeech/types";
import { DEFAULT_GENERATION_STAGE_DEADLINE_MS, sequentialStageDeadlineMs } from "./execution-deadline";
export { DEFAULT_GENERATION_STAGE_DEADLINE_MS } from "./execution-deadline";

import {
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import { createFactCurationStage } from "./fact-curation-stage";
import { createEvidenceSelectionStage } from "./evidence-selection-stage";
import type { EvidenceSelectionLimits } from "./evidence-selection-stage";
import { createPromptClassificationStage } from "./prompt-classification-stage";
import { createResearchExecutionStage } from "./research-execution-stage";
import type { ResearchBundleLimits } from "./research-execution-stage";
import { createResearchPlanStage } from "./research-plan-stage";
import { createResearchReviewStage } from "./research-review-stage";
import type { ResearchExecutionLimits } from "./research-plan-stage";
import { createRequestCaptureStage } from "./request-capture-stage";
import {
  executeGenerationStage,
  executeRetriableGenerationStage,
} from "./stage-runner";

export type GenerationV2ResearchPipelineStop = {
  status: "rejected" | "failed";
  runId: string;
  stage: GenerationStageName;
  diagnostics: GenerationDiagnostic[];
};

export type GenerationV2ResearchPipelineSuccess = {
  status: "succeeded";
  runId: string;
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  researchPlan: ResearchPlan;
  researchBundle: ResearchBundle;
  evidenceSet: EvidenceSet;
  factBank: FactBank;
  researchReview: ResearchReviewResult;
};

export type GenerationV2ResearchPipelineResult =
  | GenerationV2ResearchPipelineStop
  | GenerationV2ResearchPipelineSuccess;

export interface GenerationV2ResearchPipelineConfig {
  agent: GenerationV2AgentProvider;
  researchProvider: GenerationV2ResearchProvider;
  recorder: GenerationTraceRecorder;
  artifactFactory?: GenerationArtifactFactory | undefined;
  researchExecutionLimits?: ResearchExecutionLimits | undefined;
  researchBundleLimits?: ResearchBundleLimits | undefined;
  evidenceSelectionLimits?: Partial<EvidenceSelectionLimits> | undefined;
  stageDeadlineMs?: number | undefined;
  onProgress?: GenerationStageProgressListener | undefined;
}

const stopResult = (input: {
  runId: string;
  stage: GenerationStageName;
  status: "rejected" | "failed";
  diagnostics: GenerationDiagnostic[];
}): GenerationV2ResearchPipelineStop => ({
  status: input.status,
  runId: input.runId,
  stage: input.stage,
  diagnostics: input.diagnostics,
});

type ResearchRetryStartIndex = 0 | 1 | 2 | 3;

export const getResearchRetryStartIndex = (
  review: ReviewResult,
): ResearchRetryStartIndex | null => {
  const indexes = review.issues
    .filter(
      (issue) =>
        issue.retryInstruction !== undefined && issue.artifactId !== undefined,
    )
    .map((issue) => review.targetArtifactIds.indexOf(issue.artifactId!))
    .filter((index): index is ResearchRetryStartIndex =>
      index === 0 || index === 1 || index === 2 || index === 3,
    );
  return indexes.length > 0 ? Math.min(...indexes) as ResearchRetryStartIndex : null;
};

export class GenerationV2ResearchPipeline {
  private readonly artifactFactory: GenerationArtifactFactory;
  private readonly stageDeadlineMs: number;

  constructor(private readonly config: GenerationV2ResearchPipelineConfig) {
    this.artifactFactory =
      config.artifactFactory ?? defaultGenerationArtifactFactory;
    this.stageDeadlineMs =
      config.stageDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS;
  }

  async execute(
    request: GeneratePresentationRequest,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<GenerationV2ResearchPipelineResult> {
    const runId = this.artifactFactory.createId("generation_run");
    const requestResult = await executeGenerationStage({
      definition: createRequestCaptureStage({
        artifactFactory: this.artifactFactory,
      }),
      input: request,
      context: {
        runId,
        attempt: 1,
        inputArtifactIds: [],
        sourceIds: [],
      },
      recorder: this.config.recorder,
      deadlineMs: this.stageDeadlineMs,
      signal: options.signal,
      onProgress: this.config.onProgress,
    });
    if (requestResult.status !== "succeeded") {
      return stopResult({
        runId,
        stage: "request-capture",
        status: requestResult.status,
        diagnostics: requestResult.errors,
      });
    }

    const requestArtifact = requestResult.artifact;
    const classificationResult = await executeGenerationStage({
      definition: createPromptClassificationStage({
        agent: this.config.agent,
        artifactFactory: this.artifactFactory,
      }),
      input: requestArtifact,
      context: {
        runId,
        attempt: 1,
        inputArtifactIds: [requestArtifact.artifactId],
        sourceIds: [],
      },
      recorder: this.config.recorder,
      deadlineMs: this.stageDeadlineMs,
      signal: options.signal,
      onProgress: this.config.onProgress,
    });
    if (classificationResult.status !== "succeeded") {
      return stopResult({
        runId,
        stage: "prompt-classification",
        status: classificationResult.status,
        diagnostics: classificationResult.errors,
      });
    }

    const classification = classificationResult.artifact;
    let researchPlan: ResearchPlan | undefined;
    let researchBundle: ResearchBundle | undefined;
    let evidenceSet: EvidenceSet | undefined;
    let factBank: FactBank | undefined;
    let reviewFeedback: ReviewResult | undefined;
    let retryStartIndex: ResearchRetryStartIndex = 0;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (retryStartIndex <= 0) {
        const researchPlanResult = await executeRetriableGenerationStage({
          definition: createResearchPlanStage({
            agent: this.config.agent,
            artifactFactory: this.artifactFactory,
            ...(this.config.researchExecutionLimits
              ? { limits: this.config.researchExecutionLimits }
              : {}),
          }),
          createInput: (stageFeedback) => ({
              request: requestArtifact,
              classification,
              ...(reviewFeedback ? { reviewFeedback } : {}),
              ...(stageFeedback.length > 0 ? { stageFeedback } : {}),
            }),
          context: {
            runId,
            inputArtifactIds: [
              requestArtifact.artifactId,
              classification.artifactId,
              ...(reviewFeedback ? [reviewFeedback.artifactId] : []),
            ],
            sourceIds: classification.requestedSources.map(
              (source) => source.id,
            ),
          },
          startingAttempt: (attempt - 1) * 2 + 1,
          recorder: this.config.recorder,
          deadlineMs: this.stageDeadlineMs,
          signal: options.signal,
          onProgress: this.config.onProgress,
        });
        if (researchPlanResult.status !== "succeeded") {
          return stopResult({
            runId,
            stage: "research-planning",
            status: researchPlanResult.status,
            diagnostics: researchPlanResult.errors,
          });
        }
        researchPlan = researchPlanResult.artifact;
      }

      if (!researchPlan) {
        throw new Error("Research retry state is missing its plan.");
      }

      if (retryStartIndex <= 1) {
        const researchBundleResult = await executeGenerationStage({
          definition: createResearchExecutionStage({
            provider: this.config.researchProvider,
            agent: this.config.agent,
            artifactFactory: this.artifactFactory,
            ...(this.config.researchBundleLimits
              ? { limits: this.config.researchBundleLimits }
              : {}),
          }),
          input: { researchPlan, ...(reviewFeedback ? { reviewFeedback } : {}) },
          context: {
            runId,
            attempt,
            inputArtifactIds: [researchPlan.artifactId, ...(reviewFeedback ? [reviewFeedback.artifactId] : [])],
            sourceIds: classification.requestedSources.map(
              (source) => source.id,
            ),
          },
          recorder: this.config.recorder,
          deadlineMs: this.stageDeadlineMs,
          signal: options.signal,
          onProgress: this.config.onProgress,
        });
        if (researchBundleResult.status !== "succeeded") {
          return stopResult({
            runId,
            stage: "research-execution",
            status: researchBundleResult.status,
            diagnostics: researchBundleResult.errors,
          });
        }
        researchBundle = researchBundleResult.artifact;
      }

      if (!researchPlan || !researchBundle) {
        throw new Error("Research retry state is missing plan acquisition artifacts.");
      }
      const currentResearchPlan = researchPlan;
      const currentResearchBundle = researchBundle;
      if (retryStartIndex <= 2) {
        const evidenceSetResult = await executeRetriableGenerationStage({
          definition: createEvidenceSelectionStage({
            agent: this.config.agent,
            unitDeadlineMs: this.stageDeadlineMs,
            artifactFactory: this.artifactFactory,
            ...(this.config.evidenceSelectionLimits
              ? { limits: this.config.evidenceSelectionLimits }
              : {}),
          }),
          createInput: (stageFeedback) => ({
            classification,
            researchPlan: currentResearchPlan,
            researchBundle: currentResearchBundle,
            ...(reviewFeedback ? { reviewFeedback } : {}),
            ...(stageFeedback.length > 0 ? { stageFeedback } : {}),
          }),
          context: {
            runId,
            inputArtifactIds: [
              classification.artifactId,
              currentResearchPlan.artifactId,
              currentResearchBundle.artifactId,
              ...(reviewFeedback ? [reviewFeedback.artifactId] : []),
            ],
            sourceIds: currentResearchBundle.sources.map((source) => source.id),
          },
          startingAttempt: (attempt - 1) * 2 + 1,
          recorder: this.config.recorder,
          deadlineMs: sequentialStageDeadlineMs(Math.max(1, currentResearchBundle.pages.length), this.stageDeadlineMs),
          signal: options.signal,
          onProgress: this.config.onProgress,
        });
        if (evidenceSetResult.status !== "succeeded") {
          return stopResult({
            runId,
            stage: "evidence-selection",
            status: evidenceSetResult.status,
            diagnostics: evidenceSetResult.errors,
          });
        }
        evidenceSet = evidenceSetResult.artifact;
      }

      if (!evidenceSet) {
        throw new Error("Research retry state is missing selected evidence.");
      }
      const currentEvidenceSet = evidenceSet;
      const factBankResult = await executeRetriableGenerationStage({
        definition: createFactCurationStage({
          agent: this.config.agent,
          artifactFactory: this.artifactFactory,
        }),
        createInput: (stageFeedback) => ({
          classification,
          researchPlan: currentResearchPlan,
          evidenceSet: currentEvidenceSet,
          ...(reviewFeedback ? { reviewFeedback } : {}),
          ...(stageFeedback.length > 0 ? { stageFeedback } : {}),
        }),
        context: {
          runId,
          inputArtifactIds: [
            classification.artifactId,
            currentResearchPlan.artifactId,
            currentEvidenceSet.artifactId,
            ...(reviewFeedback ? [reviewFeedback.artifactId] : []),
          ],
          sourceIds: currentEvidenceSet.sources.map((source) => source.id),
        },
        startingAttempt: (attempt - 1) * 2 + 1,
        recorder: this.config.recorder,
        deadlineMs: this.stageDeadlineMs,
        signal: options.signal,
        onProgress: this.config.onProgress,
      });
      if (factBankResult.status !== "succeeded") {
        return stopResult({
          runId,
          stage: "fact-curation",
          status: factBankResult.status,
          diagnostics: factBankResult.errors,
        });
      }
      factBank = factBankResult.artifact;

      const researchReviewResult = await executeGenerationStage({
        definition: createResearchReviewStage({
          agent: this.config.agent,
          artifactFactory: this.artifactFactory,
        }),
        input: {
          request: requestArtifact,
          classification,
          researchPlan,
          researchBundle,
          evidenceSet,
          factBank,
        },
        context: {
          runId,
          attempt,
          inputArtifactIds: [
            researchPlan.artifactId,
            researchBundle.artifactId,
            evidenceSet.artifactId,
            factBank.artifactId,
          ],
          sourceIds: evidenceSet.sources.map((source) => source.id),
        },
        recorder: this.config.recorder,
        deadlineMs: this.stageDeadlineMs,
        signal: options.signal,
        onProgress: this.config.onProgress,
      });
      if (researchReviewResult.status === "succeeded") {
        return {
          status: "succeeded",
          runId,
          request: requestArtifact,
          classification,
          researchPlan,
          researchBundle,
          evidenceSet,
          factBank,
          researchReview: researchReviewResult.artifact,
        };
      }

      const rejectedReview =
        researchReviewResult.status === "rejected"
          ? researchReviewResult.artifact
          : undefined;
      const nextRetryStartIndex = rejectedReview
        ? getResearchRetryStartIndex(rejectedReview)
        : null;
      if (
        attempt === 2 ||
        !rejectedReview?.retryRecommended ||
        nextRetryStartIndex === null
      ) {
        return stopResult({
          runId,
          stage: "research-review",
          status: researchReviewResult.status,
          diagnostics: researchReviewResult.errors,
        });
      }
      reviewFeedback = rejectedReview;
      retryStartIndex = nextRetryStartIndex;
    }

    throw new Error("Research review retry loop exited without a result.");
  }
}
