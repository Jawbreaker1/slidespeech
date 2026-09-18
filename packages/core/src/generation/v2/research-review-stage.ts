import { ResearchReviewResultSchema } from "@slidespeech/types";
import type {
  EvidenceSet,
  FactBank,
  GenerationDiagnostic,
  GenerationV2AgentProvider,
  PresentationRequestArtifact,
  PromptClassification,
  ResearchPlan,
  ResearchBundle,
  ResearchReviewDecision,
  ResearchReviewResult,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  createResearchBundleManifest,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export interface ResearchReviewStageInput {
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  researchPlan: ResearchPlan;
  researchBundle: ResearchBundle;
  evidenceSet: EvidenceSet;
  factBank: FactBank;
}

const contractDiagnostic = (
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

export const assessResearchReviewDecision = (
  decision: ResearchReviewDecision,
  evidenceRequirements: ResearchPlan["evidenceRequirements"],
  targetArtifactCount: number,
  factCount: number,
): GenerationDiagnostic[] => {
  const diagnostics: GenerationDiagnostic[] = [];
  const requirementIds = evidenceRequirements.map(
    (requirement) => requirement.id,
  );
  const assessmentIds = Object.keys(decision.requirementAssessments);
  const assessmentsMatchRequirements =
    assessmentIds.length === requirementIds.length &&
    requirementIds.every((id) =>
      Object.hasOwn(decision.requirementAssessments, id),
    );
  if (!assessmentsMatchRequirements) {
    diagnostics.push(
      contractDiagnostic(
        "research_review_requirement_keys_mismatch",
        "Research review assessments must contain exactly the supplied evidence requirement ID keys.",
        ["requirementAssessments"],
      ),
    );
  }

  const unsupportedRequiredRequirements = assessmentsMatchRequirements
    ? evidenceRequirements.filter(
        (requirement) =>
          requirement.required &&
          decision.requirementAssessments[requirement.id]?.status ===
            "unsupported",
      )
    : [];
  if (decision.approved && unsupportedRequiredRequirements.length > 0) {
    diagnostics.push(
      contractDiagnostic(
        "approved_research_review_has_unsupported_requirement",
        "An approved research review cannot mark a required evidence requirement unsupported.",
        ["requirementAssessments"],
      ),
    );
  }
  if (
    unsupportedRequiredRequirements.length > 0 &&
    !decision.retryRecommended
  ) {
    diagnostics.push(
      contractDiagnostic(
        "unsupported_research_requirement_without_retry",
        "An unsupported required evidence requirement must recommend a targeted retry.",
        ["retryRecommended"],
      ),
    );
  }
  if (
    decision.approved &&
    (decision.retryRecommended ||
      decision.issues.some((issue) => issue.severity === "error"))
  ) {
    diagnostics.push(
      contractDiagnostic(
        "approved_research_review_contains_rejection_signal",
        "An approved research review cannot contain error issues or recommend retry.",
        [],
      ),
    );
  }
  if (
    decision.retryRecommended &&
    !(
      decision.issues.some(
        (issue) =>
          issue.retryInstruction !== null &&
          issue.targetArtifactIndex !== null,
      ) ||
      Object.values(decision.requirementAssessments).some(
        (assessment) => assessment.status === "unsupported",
      )
    )
  ) {
    diagnostics.push(
      contractDiagnostic(
        "research_review_retry_has_no_instruction",
        "A research review recommending retry must attach an actionable retry instruction to a target artifact.",
        ["issues"],
      ),
    );
  }

  decision.issues.forEach((issue, issueIndex) => {
    if (
      issue.targetArtifactIndex !== null &&
      issue.targetArtifactIndex >= targetArtifactCount
    ) {
      diagnostics.push(
        contractDiagnostic(
          "research_review_unknown_artifact_position",
          "Research review issues must reference an available target-artifact position.",
          ["issues", issueIndex, "targetArtifactIndex"],
        ),
      );
    }
    if (issue.slideIndex !== null) {
      diagnostics.push(
        contractDiagnostic(
          "research_review_references_slide",
          "Research review cannot reference slides before slide generation.",
          ["issues", issueIndex, "slideIndex"],
        ),
      );
    }
    const factIndexes = new Set<number>();
    issue.factIndexes.forEach((factIndex, factReferenceIndex) => {
      if (factIndex >= factCount || factIndexes.has(factIndex)) {
        diagnostics.push(
          contractDiagnostic(
            factIndex >= factCount
              ? "research_review_unknown_fact_position"
              : "research_review_duplicate_fact_position",
            "Research review fact references must be unique valid positions in the supplied fact bank.",
            ["issues", issueIndex, "factIndexes", factReferenceIndex],
          ),
        );
      }
      factIndexes.add(factIndex);
    });
  });
  if (assessmentsMatchRequirements) {
    evidenceRequirements.forEach((requirement) => {
      const assessment = decision.requirementAssessments[requirement.id]!;
      if (assessment.status !== "unsupported") {
        return;
      }
      if (assessment.targetArtifactIndex >= targetArtifactCount) {
        diagnostics.push(contractDiagnostic(
          "research_requirement_unknown_artifact_position",
          "Requirement assessments must reference an available research artifact.",
          ["requirementAssessments", requirement.id, "targetArtifactIndex"],
        ));
      }
      const factIndexes = new Set<number>();
      assessment.factIndexes.forEach((factIndex, factReferenceIndex) => {
        if (factIndex >= factCount || factIndexes.has(factIndex)) {
          diagnostics.push(
            contractDiagnostic(
              factIndex >= factCount
                ? "research_requirement_unknown_fact_position"
                : "research_requirement_duplicate_fact_position",
              "Requirement assessments must reference unique valid fact positions in the supplied fact bank.",
              [
                "requirementAssessments",
                requirement.id,
                "factIndexes",
                factReferenceIndex,
              ],
            ),
          );
        }
        factIndexes.add(factIndex);
      });
    });
  }
  return diagnostics;
};

export const createResearchReviewStage = (input: {
  agent: GenerationV2AgentProvider;
  artifactFactory?: GenerationArtifactFactory | undefined;
}): GenerationStageDefinition<ResearchReviewStageInput, ResearchReviewResult> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;

  return {
    name: "research-review",
    parseArtifact: (value) => ResearchReviewResultSchema.parse(value),
    execute: async (stageInput, context) => {
      if (stageInput.researchBundle.researchPlanArtifactId !== stageInput.researchPlan.artifactId ||
          stageInput.evidenceSet.researchBundleArtifactId !== stageInput.researchBundle.artifactId) {
        return { status: "rejected", errors: [contractDiagnostic(
          "research_review_acquisition_lineage_mismatch",
          "Review requires the acquisition bundle that produced the selected evidence for this plan.",
          ["researchBundle"],
        )] };
      }
      const targetArtifacts: Parameters<GenerationV2AgentProvider["reviewResearch"]>[0]["targetArtifacts"] = [
        stageInput.researchPlan,
        createResearchBundleManifest(stageInput.researchBundle),
        stageInput.evidenceSet,
        stageInput.factBank,
      ];
      const agentCall = await input.agent.reviewResearch(
        {
          request: stageInput.request,
          classification: stageInput.classification,
          targetArtifacts,
        },
        { signal: context.signal },
      );
      const diagnostics = assessResearchReviewDecision(
        agentCall.value,
        stageInput.researchPlan.evidenceRequirements,
        targetArtifacts.length,
        stageInput.factBank.facts.length,
      );
      if (agentCall.value.approved && "sufficientForDeck" in stageInput.factBank && !stageInput.factBank.sufficientForDeck) {
        diagnostics.push(contractDiagnostic(
          "approved_review_has_insufficient_fact_bank",
          "An approved review cannot override an unchanged insufficient fact bank; request revision of the owning artifact instead.",
          ["approved"],
        ));
      }
      if (agentCall.value.approved && stageInput.factBank.facts.length === 0) {
        diagnostics.push(contractDiagnostic(
          "approved_review_has_empty_fact_bank",
          "Research cannot be approved without any curated facts.",
          ["approved"],
        ));
      }
      if (diagnostics.length > 0) {
        return {
          status: "rejected",
          errors: diagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          telemetry: agentCall.telemetry,
        };
      }

      const requirementAssessments =
        stageInput.researchPlan.evidenceRequirements.map((requirement) => {
          const assessment = agentCall.value.requirementAssessments[
            requirement.id
          ]!;
          if (assessment.status === "supported") {
            return {
              evidenceRequirementId: requirement.id,
              status: assessment.status,
              rationale: assessment.rationale,
            };
          }
          return {
            evidenceRequirementId: requirement.id,
            status: assessment.status,
            rationale: assessment.rationale,
            artifactId:
              targetArtifacts[assessment.targetArtifactIndex]!.artifactId,
            factIds: assessment.factIndexes.map(
              (factIndex) => stageInput.factBank.facts[factIndex]!.id,
            ),
            retryInstruction: assessment.retryInstruction,
          };
        });
      const unsupportedRequirementIssues = requirementAssessments
        .filter(
          (assessment) =>
            assessment.status === "unsupported" &&
            stageInput.researchPlan.evidenceRequirements.find(
              (requirement) =>
                requirement.id === assessment.evidenceRequirementId,
            )?.required,
        )
        .map((assessment) => ({
          code: "research_requirement_unsupported",
          severity: "error" as const,
          dimension: "grounding" as const,
          message: assessment.rationale,
          artifactId: assessment.artifactId,
          factIds: assessment.factIds,
          retryInstruction: assessment.retryInstruction,
        }));

      const review = ResearchReviewResultSchema.parse({
        ...createGenerationArtifactIdentity("research_review", artifactFactory),
        targetStage: "research-review",
        targetArtifactIds: targetArtifacts.map(
          (artifact) => artifact.artifactId,
        ),
        approved: agentCall.value.approved,
        score: agentCall.value.score,
        summary: agentCall.value.summary,
        issues: [
          ...unsupportedRequirementIssues,
          ...agentCall.value.issues.map((issue) => ({
            code: issue.code,
            severity: issue.severity,
            dimension: issue.dimension,
            message: issue.message,
            ...(issue.targetArtifactIndex !== null
              ? {
                  artifactId:
                    targetArtifacts[issue.targetArtifactIndex]!.artifactId,
                }
              : {}),
            factIds: issue.factIndexes.map(
              (factIndex) => stageInput.factBank.facts[factIndex]!.id,
            ),
            ...(issue.retryInstruction !== null
              ? { retryInstruction: issue.retryInstruction }
              : {}),
          })),
        ],
        retryRecommended: agentCall.value.retryRecommended,
        requirementAssessments,
      });

      if (!review.approved) {
        return {
          status: "rejected",
          artifact: review,
          errors: [
            {
              code: "research_review_rejected",
              message: review.summary,
              category: "semantic",
              retryable: review.retryRecommended,
              artifactPath: [],
              sourceIds: stageInput.evidenceSet.sources.map(
                (source) => source.id,
              ),
            },
          ],
          telemetry: agentCall.telemetry,
        };
      }

      return {
        status: "succeeded",
        artifact: review,
        telemetry: agentCall.telemetry,
      };
    },
  };
};
