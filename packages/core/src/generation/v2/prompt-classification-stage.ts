import {
  PromptClassificationSchema,
} from "@slidespeech/types";
import type {
  GenerationDiagnostic,
  GenerationV2AgentProvider,
  PresentationRequestArtifact,
  PromptClassification,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

const clarificationDiagnostic = (
  classification: PromptClassification,
): GenerationDiagnostic => ({
  code: "prompt_requires_clarification",
  message:
    classification.clarificationReason ??
    "The prompt-classification agent requires user clarification.",
  category: "semantic",
  retryable: false,
  artifactPath: ["requiresUserClarification"],
  sourceIds: [],
});

const classificationDiagnostic = (
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

export const assessPromptClassification = (
  request: PresentationRequestArtifact,
  classification: PromptClassification,
): GenerationDiagnostic[] => {
  const diagnostics: GenerationDiagnostic[] = [];
  const hasExplicitSources = classification.requestedSources.length > 0;

  if (classification.requestArtifactId !== request.artifactId) {
    diagnostics.push(
      classificationDiagnostic(
        "classification_request_reference_mismatch",
        "The classification must reference its immutable request artifact.",
        ["requestArtifactId"],
      ),
    );
  }

  if (
    classification.groundingMode === "explicit-sources" &&
    !hasExplicitSources
  ) {
    diagnostics.push(
      classificationDiagnostic(
        "explicit_source_mode_without_sources",
        "The agent selected explicit-source grounding without identifying an explicit source.",
        ["groundingMode"],
      ),
    );
  }
  if (
    hasExplicitSources &&
    classification.groundingMode !== "explicit-sources" &&
    classification.groundingMode !== "mixed"
  ) {
    diagnostics.push(
      classificationDiagnostic(
        "explicit_sources_not_reflected_in_grounding_mode",
        "The grounding mode must account for the explicit sources identified by the agent.",
        ["groundingMode"],
      ),
    );
  }
  if (
    request.request.useWebResearch === true &&
    classification.groundingMode !== "web-research" &&
    classification.groundingMode !== "mixed"
  ) {
    diagnostics.push(
      classificationDiagnostic(
        "requested_web_research_not_classified",
        "The structured request requires web research, but the grounding mode does not permit it.",
        ["groundingMode"],
      ),
    );
  }
  if (
    request.request.useWebResearch === false &&
    (classification.groundingMode === "web-research" ||
      classification.groundingMode === "mixed")
  ) {
    diagnostics.push(
      classificationDiagnostic(
        "disabled_web_research_classified",
        "The grounding mode requests web research even though the structured request disabled it.",
        ["groundingMode"],
      ),
    );
  }

  return diagnostics;
};

export const createPromptClassificationStage = (input: {
  agent: GenerationV2AgentProvider;
  artifactFactory?: GenerationArtifactFactory | undefined;
}): GenerationStageDefinition<
  PresentationRequestArtifact,
  PromptClassification
> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;

  return {
    name: "prompt-classification",
    parseArtifact: (value) => PromptClassificationSchema.parse(value),
    execute: async (request, context) => {
      const agentCall = await input.agent.classifyPrompt(request, {
        signal: context.signal,
      });
      const {
        requestedCoverage,
        requestedSlideCount,
        requestedDurationMinutes,
        visualPreference,
        voicePreference,
        sourceCandidateIndexes,
        ...classificationDecision
      } = agentCall.value;
      const candidates = request.sourceCandidates ?? [];
      const selected = sourceCandidateIndexes ?? [];
      if ((candidates.length > 0 && sourceCandidateIndexes === undefined) ||
          new Set(selected).size !== selected.length ||
          selected.some(index => !Number.isInteger(index) || index < 0 || index >= candidates.length)) {
        return { status: "rejected", errors: [classificationDiagnostic(
          "invalid_source_candidate_selection", "Classification must explicitly select valid, unique source candidate positions or an empty list.", ["sourceCandidateIndexes"],
        )], telemetry: agentCall.telemetry };
      }
      const sourceUrls = [...new Set([...request.explicitUrls, ...selected.map(index => candidates[index]!.url)])];
      const identity = createGenerationArtifactIdentity(
        "classification",
        artifactFactory,
      );
      const classification = PromptClassificationSchema.parse({
        ...identity,
        ...classificationDecision,
        requestArtifactId: request.artifactId,
        originalPrompt: request.request.topic,
        requestedSources: sourceUrls.map((url) => ({
          id: artifactFactory.createId("requested_source"),
          url,
        })),
        requestedCoverage: requestedCoverage.map(
          (coverage) => ({
            ...coverage,
            id: artifactFactory.createId("coverage"),
          }),
        ),
        ...(request.request.targetSlideCount !== undefined
          ? { requestedSlideCount: request.request.targetSlideCount }
          : requestedSlideCount !== null
            ? { requestedSlideCount }
            : {}),
        ...(request.request.targetDurationMinutes !== undefined
          ? { requestedDurationMinutes: request.request.targetDurationMinutes }
          : requestedDurationMinutes !== null
            ? { requestedDurationMinutes }
            : {}),
        ...(visualPreference !== null ? { visualPreference } : {}),
        ...(voicePreference !== null ? { voicePreference } : {}),
      });

      if (classification.requiresUserClarification) {
        return {
          status: "rejected",
          artifact: classification,
          errors: [clarificationDiagnostic(classification)],
          telemetry: agentCall.telemetry,
        };
      }

      const diagnostics = assessPromptClassification(request, classification);
      if (diagnostics.length > 0) {
        return {
          status: "rejected",
          artifact: classification,
          errors: diagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          telemetry: agentCall.telemetry,
        };
      }

      return {
        status: "succeeded",
        artifact: classification,
        telemetry: agentCall.telemetry,
      };
    },
  };
};
