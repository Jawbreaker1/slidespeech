import { createFactBankDecisionSchema, CurrentFactBankSchema } from "@slidespeech/types";
import type {
  FactBankDecision,
  FactBank,
  EvidenceSet,
  GenerationDiagnostic,
  GenerationV2AgentProvider,
  PromptClassification,
  ResearchPlan,
  ReviewResult,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export interface FactCurationStageInput {
  classification: PromptClassification;
  researchPlan: ResearchPlan;
  evidenceSet: EvidenceSet;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

const factDiagnostic = (
  code: string,
  message: string,
  artifactPath: Array<string | number>,
  sourceIds: string[] = [],
  category: GenerationDiagnostic["category"] = "source",
): GenerationDiagnostic => ({
  code,
  message,
  category,
  retryable: true,
  artifactPath,
  sourceIds,
});

const modelKnowledgeIsAllowed = (
  classification: PromptClassification,
): boolean =>
  classification.groundingMode === "model-knowledge" ||
  classification.groundingMode === "mixed";

export const assessFactCurationDecision = (input: {
  researchPlan: ResearchPlan;
  evidenceSet: EvidenceSet;
  decision: FactBankDecision;
}): GenerationDiagnostic[] => {
  const parsed = createFactBankDecisionSchema({
    evidenceRequirementIds: input.researchPlan.evidenceRequirements.map(
      (requirement) => requirement.id,
    ),
    evidenceSnippetIds: input.evidenceSet.snippets.map((snippet) => snippet.id),
  }).safeParse(input.decision);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) =>
      factDiagnostic("invalid_fact_decision", issue.message, issue.path, [], "contract"),
    );
  }

  return [];
};

export const assessFactBank = (input: {
  researchPlan: ResearchPlan;
  evidenceSet: EvidenceSet;
  factBank: FactBank;
}): GenerationDiagnostic[] => {
  const diagnostics: GenerationDiagnostic[] = [];
  const sourceById = new Map(
    input.evidenceSet.sources.map((source) => [source.id, source]),
  );
  const snippetById = new Map(
    input.evidenceSet.snippets.map((snippet) => [snippet.id, snippet]),
  );
  const requirementById = new Map(
    input.researchPlan.evidenceRequirements.map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );

  input.factBank.facts.forEach((fact, factIndex) => {
    fact.evidenceRequirementIds.forEach((requirementId, requirementIndex) => {
      if (!requirementById.has(requirementId)) {
        diagnostics.push(
          factDiagnostic(
            "fact_references_unknown_evidence_requirement",
            `Fact ${fact.id} references unknown evidence requirement ${requirementId}.`,
            ["facts", factIndex, "evidenceRequirementIds", requirementIndex],
          ),
        );
      }
    });

    if (fact.origin !== "source") {
      return;
    }
    const factSourceIds = new Set(fact.sourceIds);
    fact.sourceIds.forEach((sourceId, sourceIndex) => {
      if (!sourceById.has(sourceId)) {
        diagnostics.push(
          factDiagnostic(
            "fact_references_unknown_source",
            `Fact ${fact.id} references unknown source ${sourceId}.`,
            ["facts", factIndex, "sourceIds", sourceIndex],
            [sourceId],
          ),
        );
      }
    });
    fact.evidenceSnippetIds.forEach((snippetId, snippetIndex) => {
      const snippet = snippetById.get(snippetId);
      if (!snippet) {
        diagnostics.push(
          factDiagnostic(
            "fact_references_unknown_snippet",
            `Fact ${fact.id} references unknown evidence snippet ${snippetId}.`,
            ["facts", factIndex, "evidenceSnippetIds", snippetIndex],
          ),
        );
      } else if (!factSourceIds.has(snippet.sourceId)) {
        diagnostics.push(
          factDiagnostic(
            "fact_snippet_source_mismatch",
            `Fact ${fact.id} does not include the source owning snippet ${snippetId}.`,
            ["facts", factIndex, "evidenceSnippetIds", snippetIndex],
            [snippet.sourceId],
          ),
        );
      }
    });
  });

  if ("uncertainties" in input.factBank) input.factBank.uncertainties.forEach((uncertainty, index) => {
    for (const [field, available] of [
      ["evidenceSnippetIds", snippetById],
      ["evidenceRequirementIds", requirementById],
    ] as const) {
      uncertainty[field].forEach((id, referenceIndex) => {
        if (!available.has(id)) diagnostics.push(factDiagnostic(
          "uncertainty_references_unknown_evidence",
          `Uncertainty references unknown ${field}: ${id}.`,
          ["uncertainties", index, field, referenceIndex],
        ));
      });
    }
  });

  return diagnostics;
};

export const createFactCurationStage = (input: {
  agent: Pick<GenerationV2AgentProvider, "curateFacts">;
  artifactFactory?: GenerationArtifactFactory | undefined;
}): GenerationStageDefinition<FactCurationStageInput, FactBank> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;

  return {
    name: "fact-curation",
    parseArtifact: (value) => CurrentFactBankSchema.parse(value),
    execute: async (stageInput, context) => {
      const agentCall = await input.agent.curateFacts(
        {
          classification: stageInput.classification,
          researchPlan: stageInput.researchPlan,
          evidence: {
            ...stageInput.evidenceSet,
          },
          ...(stageInput.reviewFeedback
            ? { reviewFeedback: stageInput.reviewFeedback }
            : {}),
          ...(stageInput.stageFeedback
            ? { stageFeedback: stageInput.stageFeedback }
            : {}),
        },
        { signal: context.signal },
      );
      const knowledgeAllowed = modelKnowledgeIsAllowed(
        stageInput.classification,
      );
      if (
        !knowledgeAllowed &&
        agentCall.value.facts.some((fact) => fact.origin === "model-knowledge")
      ) {
        return {
          status: "rejected",
          errors: [
            factDiagnostic(
              "model_knowledge_not_allowed",
              "The fact-curation agent used model knowledge outside the classified grounding policy.",
              ["facts"],
              [],
              "policy",
            ),
          ],
          telemetry: agentCall.telemetry,
        };
      }

      const decisionDiagnostics = assessFactCurationDecision({
        researchPlan: stageInput.researchPlan,
        evidenceSet: stageInput.evidenceSet,
        decision: agentCall.value,
      });
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

      const factBank = CurrentFactBankSchema.parse({
        ...createGenerationArtifactIdentity("fact_bank", artifactFactory),
        facts: agentCall.value.facts.map((fact) => {
          const base = {
            id: artifactFactory.createId("fact"),
            claim: fact.claim,
            role: fact.role,
            language: fact.language,
            evidenceRequirementIds: fact.evidenceRequirementIds,
          };
          if (fact.origin === "model-knowledge") {
            return {
              ...base,
              origin: fact.origin,
              knowledgeBasis: fact.knowledgeBasis,
            };
          }
          const snippets = stageInput.evidenceSet.snippets.filter(
            (snippet) => fact.evidenceSnippetIds.includes(snippet.id),
          );
          return {
            ...base,
            origin: fact.origin,
            sourceIds: [...new Set(snippets.map((snippet) => snippet.sourceId))],
            evidenceSnippetIds: snippets.map((snippet) => snippet.id),
          };
        }),
        uncertainties: agentCall.value.uncertainties,
        classificationArtifactId: stageInput.classification.artifactId,
        evidenceSetArtifactId: stageInput.evidenceSet.artifactId,
        modelKnowledgeAllowed: knowledgeAllowed,
      });
      const diagnostics = assessFactBank({
        researchPlan: stageInput.researchPlan,
        evidenceSet: stageInput.evidenceSet,
        factBank,
      });
      if (diagnostics.length > 0) {
        return {
          status: "rejected",
          artifact: factBank,
          errors: diagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          telemetry: agentCall.telemetry,
        };
      }
      return {
        status: "succeeded",
        artifact: factBank,
        telemetry: agentCall.telemetry,
      };
    },
  };
};
