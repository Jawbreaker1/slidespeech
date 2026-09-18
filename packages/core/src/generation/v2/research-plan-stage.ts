import { ResearchPlanSchema } from "@slidespeech/types";
import type {
  GenerationDiagnostic,
  GenerationV2AgentProvider,
  PresentationRequestArtifact,
  PromptClassification,
  ResearchPlan,
  ResearchPlanDecision,
  ReviewResult,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export interface ResearchExecutionLimits {
  maximumSources: number;
  maximumPagesPerDomain: number;
}

export const DEFAULT_RESEARCH_EXECUTION_LIMITS: ResearchExecutionLimits = {
  maximumSources: 12,
  maximumPagesPerDomain: 4,
};

export interface ResearchPlanStageInput {
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

const planDiagnostic = (
  code: string,
  message: string,
  artifactPath: Array<string | number>,
): GenerationDiagnostic => ({
  code,
  message,
  category: "contract",
  retryable: true,
  artifactPath,
  sourceIds: [],
});

export const assessResearchPlan = (
  request: PresentationRequestArtifact,
  classification: PromptClassification,
  plan: ResearchPlan,
): GenerationDiagnostic[] => {
  const diagnostics: GenerationDiagnostic[] = [];

  if (
    classification.requestArtifactId !== request.artifactId ||
    plan.requestArtifactId !== request.artifactId
  ) {
    diagnostics.push(
      planDiagnostic(
        "research_plan_request_reference_mismatch",
        "The research plan and classification must reference the immutable request artifact.",
        ["requestArtifactId"],
      ),
    );
  }
  if (plan.classificationArtifactId !== classification.artifactId) {
    diagnostics.push(
      planDiagnostic(
        "research_plan_classification_reference_mismatch",
        "The research plan must reference the supplied classification artifact.",
        ["classificationArtifactId"],
      ),
    );
  }
  const requestedSourceById = new Map(
    classification.requestedSources.map((source) => [source.id, source]),
  );
  const coverageIds = new Set(
    classification.requestedCoverage.map((coverage) => coverage.id),
  );
  if (plan.sourceTargets.length > plan.stopCriteria.maximumSources) {
    diagnostics.push(
      planDiagnostic(
        "research_target_count_exceeds_plan_limit",
        "The number of source targets exceeds the plan's own maximum source count.",
        ["sourceTargets"],
      ),
    );
  }

  plan.researchQuestions.forEach((question, questionIndex) => {
    question.coverageRequirementIds.forEach((coverageId, coverageIndex) => {
      if (!coverageIds.has(coverageId)) {
        diagnostics.push(
          planDiagnostic(
            "unknown_coverage_reference",
            `Research question ${question.id} references undeclared coverage ${coverageId}.`,
            [
              "researchQuestions",
              questionIndex,
              "coverageRequirementIds",
              coverageIndex,
            ],
          ),
        );
      }
    });
  });

  plan.evidenceRequirements.forEach((requirement, requirementIndex) => {
    requirement.coverageRequirementIds.forEach(
      (coverageId, coverageIndex) => {
        if (!coverageIds.has(coverageId)) {
          diagnostics.push(
            planDiagnostic(
              "unknown_evidence_coverage_reference",
              `Evidence requirement ${requirement.id} references undeclared coverage ${coverageId}.`,
              [
                "evidenceRequirements",
                requirementIndex,
                "coverageRequirementIds",
                coverageIndex,
              ],
            ),
          );
        }
      },
    );
  });

  classification.requestedCoverage
    .filter((coverage) => coverage.required)
    .forEach((coverage) => {
      const allocated = plan.researchQuestions.some((question) =>
        question.coverageRequirementIds.includes(coverage.id),
      );
      if (!allocated) {
        diagnostics.push(
          planDiagnostic(
            "required_coverage_not_planned",
            `Required coverage ${coverage.id} is not assigned to any research question.`,
            ["researchQuestions"],
          ),
        );
      }
      const hasRequiredEvidence = plan.evidenceRequirements.some(
        (requirement) =>
          requirement.required &&
          requirement.coverageRequirementIds.includes(coverage.id),
      );
      if (!hasRequiredEvidence) {
        diagnostics.push(
          planDiagnostic(
            "required_coverage_has_no_evidence_requirement",
            `Required coverage ${coverage.id} has no required evidence requirement.`,
            ["evidenceRequirements"],
          ),
        );
      }
    });

  const explicitTargetSourceIds = new Set<string>();
  plan.sourceTargets.forEach((target, targetIndex) => {
    if (target.kind !== "explicit-url") {
      return;
    }
    const requestedSource = requestedSourceById.get(target.requestedSourceId);
    if (!requestedSource) {
      diagnostics.push(
        planDiagnostic(
          "unknown_requested_source_reference",
          `Explicit target ${target.id} references undeclared source ${target.requestedSourceId}.`,
          ["sourceTargets", targetIndex, "requestedSourceId"],
        ),
      );
      return;
    }
    explicitTargetSourceIds.add(target.requestedSourceId);
    if (target.url !== requestedSource.url) {
      diagnostics.push(
        planDiagnostic(
          "explicit_source_url_changed",
          `Explicit target ${target.id} must preserve the user's exact source URL.`,
          ["sourceTargets", targetIndex, "url"],
        ),
      );
    }
  });

  classification.requestedSources.forEach((source) => {
    if (!explicitTargetSourceIds.has(source.id)) {
      diagnostics.push(
        planDiagnostic(
          "explicit_source_not_planned",
          `Requested source ${source.id} has no explicit research target.`,
          ["sourceTargets"],
        ),
      );
    }
  });

  return diagnostics;
};

const assessResearchPlanDecisionReferences = (
  classification: PromptClassification,
  decision: ResearchPlanDecision,
): GenerationDiagnostic[] => {
  const diagnostics: GenerationDiagnostic[] = [];

  decision.researchQuestions.forEach((question, questionIndex) => {
    const seenIndexes = new Set<number>();
    question.coverageRequirementIndexes.forEach(
      (coverageIndex, coverageReferenceIndex) => {
        if (
          coverageIndex >= classification.requestedCoverage.length ||
          seenIndexes.has(coverageIndex)
        ) {
          diagnostics.push(
            planDiagnostic(
              coverageIndex >= classification.requestedCoverage.length
                ? "research_plan_unknown_coverage_index"
                : "research_plan_duplicate_coverage_index",
              "Research coverage references must be unique valid positions in the supplied classification.",
              [
                "researchQuestions",
                questionIndex,
                "coverageRequirementIndexes",
                coverageReferenceIndex,
              ],
            ),
          );
        }
        seenIndexes.add(coverageIndex);
      },
    );
  });

  const seenSourceIndexes = new Set<number>();
  decision.sourceTargets.forEach((target, targetIndex) => {
    if (target.kind !== "explicit-url") {
      return;
    }
    if (
      target.requestedSourceIndex >= classification.requestedSources.length ||
      seenSourceIndexes.has(target.requestedSourceIndex)
    ) {
      diagnostics.push(
        planDiagnostic(
          target.requestedSourceIndex >= classification.requestedSources.length
            ? "research_plan_unknown_source_index"
            : "research_plan_duplicate_source_index",
          "Explicit source references must be unique valid positions in the supplied classification.",
          ["sourceTargets", targetIndex, "requestedSourceIndex"],
        ),
      );
    }
    seenSourceIndexes.add(target.requestedSourceIndex);
  });

  classification.requestedSources.forEach((_source, sourceIndex) => {
    if (!seenSourceIndexes.has(sourceIndex)) {
      diagnostics.push(
        planDiagnostic(
          "explicit_source_not_planned",
          "Every requested source must have one explicit research target.",
          ["sourceTargets"],
        ),
      );
    }
  });

  return diagnostics;
};

export const createResearchPlanStage = (input: {
  agent: GenerationV2AgentProvider;
  artifactFactory?: GenerationArtifactFactory | undefined;
  limits?: ResearchExecutionLimits | undefined;
}): GenerationStageDefinition<ResearchPlanStageInput, ResearchPlan> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;
  const limits = input.limits ?? DEFAULT_RESEARCH_EXECUTION_LIMITS;

  return {
    name: "research-planning",
    parseArtifact: (value) => ResearchPlanSchema.parse(value),
    execute: async (
      { request, classification, reviewFeedback, stageFeedback },
      context,
    ) => {
      const agentCall = await input.agent.planResearch(
        {
          request,
          classification,
          ...(reviewFeedback ? { reviewFeedback } : {}),
          ...(stageFeedback ? { stageFeedback } : {}),
        },
        { signal: context.signal },
      );
      const decisionDiagnostics = assessResearchPlanDecisionReferences(
        classification,
        agentCall.value,
      );
      if (decisionDiagnostics.length > 0) {
        return {
          status: "rejected",
          errors: decisionDiagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          telemetry: agentCall.telemetry,
        };
      }
      const researchQuestions = agentCall.value.researchQuestions.map(
        (question) => ({
          id: artifactFactory.createId("research_question"),
          question: question.question,
          coverageRequirementIds: question.coverageRequirementIndexes.map(
            (coverageIndex) =>
              classification.requestedCoverage[coverageIndex]!.id,
          ),
        }),
      );
      const evidenceRequirements = agentCall.value.researchQuestions.flatMap(
        (question) =>
          question.evidenceRequirements.map((requirement) => ({
            id: artifactFactory.createId("evidence_requirement"),
            description: requirement.description,
            required: requirement.required,
            coverageRequirementIds: question.coverageRequirementIndexes.map(
              (coverageIndex) =>
                classification.requestedCoverage[coverageIndex]!.id,
            ),
          })),
      );
      const sourceTargets = agentCall.value.sourceTargets.map((target) => {
        const id = artifactFactory.createId("source_target");
        if (target.kind !== "explicit-url") {
          return { id, ...target };
        }
        const requestedSource =
          classification.requestedSources[target.requestedSourceIndex]!;
        const { requestedSourceIndex: _requestedSourceIndex, ...semanticTarget } =
          target;
        return {
          id,
          ...semanticTarget,
          requestedSourceId: requestedSource.id,
          url: requestedSource.url,
        };
      });
      const plan = ResearchPlanSchema.parse({
        ...createGenerationArtifactIdentity("research_plan", artifactFactory),
        requestArtifactId: request.artifactId,
        classificationArtifactId: classification.artifactId,
        canExecute: agentCall.value.canExecute,
        blockingReason: agentCall.value.blockingReason,
        requiresExternalResearch: agentCall.value.requiresExternalResearch,
        researchQuestions,
        evidenceRequirements,
        sourceTargets,
        stopCriteria: {
          maximumSources: limits.maximumSources,
          maximumPagesPerDomain: limits.maximumPagesPerDomain,
        },
        knownRiskAreas: agentCall.value.knownRiskAreas,
      });

      if (!plan.canExecute) {
        return {
          status: "rejected",
          artifact: plan,
          errors: [
            {
              code: "research_plan_not_executable",
              message:
                plan.blockingReason ??
                "The research-planning agent rejected the request.",
              category: "semantic",
              retryable: false,
              artifactPath: ["canExecute"],
              sourceIds: [],
            },
          ],
          telemetry: agentCall.telemetry,
        };
      }

      const diagnostics = assessResearchPlan(request, classification, plan);
      if (diagnostics.length > 0) {
        return {
          status: "rejected",
          artifact: plan,
          errors: diagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          telemetry: agentCall.telemetry,
        };
      }

      return {
        status: "succeeded",
        artifact: plan,
        telemetry: agentCall.telemetry,
      };
    },
  };
};
