import {
  EvidenceSetSchema,
  type EvidenceSegmentCandidate,
  type EvidenceSet,
  type GenerationDiagnostic,
  type GenerationStageTelemetry,
  type GenerationV2AgentProvider,
  type PromptClassification,
  type ResearchBundle,
  type ResearchPlan,
  type ReviewResult,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";
import { DEFAULT_GENERATION_STAGE_DEADLINE_MS, withExecutionDeadline } from "./execution-deadline";

export interface EvidenceSelectionStageInput {
  classification: PromptClassification;
  researchPlan: ResearchPlan;
  researchBundle: ResearchBundle;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

export interface EvidenceSelectionLimits {
  segmentCharacters: number;
  segmentOverlapCharacters: number;
  maximumEvidenceCharacters: number;
  maximumSelectionsPerPage: number;
}

export const DEFAULT_EVIDENCE_SELECTION_LIMITS: EvidenceSelectionLimits = {
  segmentCharacters: 2_400,
  segmentOverlapCharacters: 240,
  maximumEvidenceCharacters: 60_000,
  maximumSelectionsPerPage: 6,
};

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

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: string[],
): boolean => {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
};

export const segmentEvidenceText = (
  text: string,
  segmentCharacters: number,
  overlapCharacters: number,
  unit: "sentence" | "line" = "sentence",
): EvidenceSegmentCandidate[] => {
  if (
    !Number.isSafeInteger(segmentCharacters) ||
    !Number.isSafeInteger(overlapCharacters) ||
    segmentCharacters <= 0 ||
    overlapCharacters < 0 ||
    overlapCharacters >= segmentCharacters
  ) {
    throw new Error("Evidence segment limits are invalid.");
  }

  const segments: EvidenceSegmentCandidate[] = [];
  if (!text.length) return segments;
  const boundaries: number[] = [];
  if (unit === "line") {
    let offset = 0;
    for (const line of text.split("\n")) {
      if (offset < text.length) boundaries.push(offset);
      offset += line.length + 1;
    }
  } else {
    boundaries.push(...[...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)].map((sentence) => sentence.index));
  }
  boundaries.push(text.length);
  let start = 0;
  while (start < boundaries.length - 1) {
    let end = start + 1;
    while (end < boundaries.length - 1 && boundaries[end + 1]! - boundaries[start]! <= segmentCharacters) end++;
    const startOffset = boundaries[start]!;
    const endOffset = boundaries[end]!;
    segments.push({
      key: `segment_${segments.length + 1}`,
      startOffset,
      endOffset,
      text: text.slice(startOffset, endOffset),
    });
    if (endOffset === text.length) {
      break;
    }
    // Overlap only whole sentences, and always advance beyond the previous start.
    let next = end;
    while (next > start + 1 && endOffset - boundaries[next]! < overlapCharacters) next--;
    start = next;
  }
  return segments;
};

const aggregateTelemetry = (
  telemetry: GenerationStageTelemetry[],
): GenerationStageTelemetry | undefined => {
  const first = telemetry[0];
  if (!first) {
    return undefined;
  }
  const sum = (field: keyof GenerationStageTelemetry): number | undefined => {
    const values = telemetry
      .map((item) => item[field])
      .filter((value): value is number => typeof value === "number");
    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : undefined;
  };
  return {
    provider: first.provider,
    model: first.model,
    ...(sum("promptTokens") !== undefined
      ? { promptTokens: sum("promptTokens") }
      : {}),
    ...(sum("completionTokens") !== undefined
      ? { completionTokens: sum("completionTokens") }
      : {}),
    ...(sum("reasoningTokens") !== undefined
      ? { reasoningTokens: sum("reasoningTokens") }
      : {}),
    ...(sum("totalTokens") !== undefined
      ? { totalTokens: sum("totalTokens") }
      : {}),
  };
};

export const createEvidenceSelectionStage = (input: {
  agent: Pick<GenerationV2AgentProvider, "selectEvidence">;
  artifactFactory?: GenerationArtifactFactory | undefined;
  limits?: Partial<EvidenceSelectionLimits> | undefined;
  unitDeadlineMs?: number | undefined;
}): GenerationStageDefinition<EvidenceSelectionStageInput, EvidenceSet> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;
  const limits = { ...DEFAULT_EVIDENCE_SELECTION_LIMITS, ...input.limits };

  return {
    name: "evidence-selection",
    parseArtifact: (value) => EvidenceSetSchema.parse(value),
    execute: async (
      {
        classification,
        researchPlan,
        researchBundle,
        reviewFeedback,
        stageFeedback,
      },
      context,
    ) => {
      const evidenceSet = EvidenceSetSchema.parse({
        ...createGenerationArtifactIdentity("evidence_set", artifactFactory),
        researchPlanArtifactId: researchPlan.artifactId,
        researchBundleArtifactId: researchBundle.artifactId,
        sources: researchBundle.sources.map((source) => ({
          id: source.id,
          url: source.url,
          title: source.title,
          fetchedAt: source.fetchedAt,
          retrievedBy: source.retrievedBy,
          ...(source.contentType ? { contentType: source.contentType } : {}),
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          ...(source.author ? { author: source.author } : {}),
        })),
        snippets: [],
      });

      if (researchBundle.pages.length === 0) {
        if (researchPlan.requiresExternalResearch) {
          return {
            status: "rejected",
            artifact: evidenceSet,
            errors: [
              contractDiagnostic(
                "evidence_selection_has_no_pages",
                "External research produced no page content for evidence selection.",
                ["researchBundle", "pages"],
              ),
            ],
          };
        }
        return { status: "succeeded", artifact: evidenceSet };
      }

      const maximumSelectionsPerPage = Math.max(
        1,
        Math.min(
          limits.maximumSelectionsPerPage,
          Math.floor(
            limits.maximumEvidenceCharacters /
              researchBundle.pages.length /
              limits.segmentCharacters,
          ),
        ),
      );
      const telemetry: GenerationStageTelemetry[] = [];
      const diagnostics: GenerationDiagnostic[] = [];
      let selectedCharacters = 0;

      for (const [pageIndex, page] of researchBundle.pages.entries()) {
        context.reportProgress({
          completedUnits: pageIndex,
          totalUnits: researchBundle.pages.length,
        });
        const segments = segmentEvidenceText(
          page.content,
          limits.segmentCharacters,
          limits.segmentOverlapCharacters,
          page.contentFormat === "rendered-layout" ? "line" : "sentence",
        );
        const agentCall = await withExecutionDeadline(input.unitDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS, context.signal, (signal) => input.agent.selectEvidence(
          {
            subject: classification.subject,
            researchQuestions: researchPlan.researchQuestions.map(
              (question) => ({
                question: question.question,
              }),
            ),
            evidenceRequirements: researchPlan.evidenceRequirements.map(
              (requirement) => ({
                id: requirement.id,
                description: requirement.description,
                required: requirement.required,
              }),
            ),
            page: { title: page.title, url: page.url },
            segments,
            maximumSelections: maximumSelectionsPerPage,
            ...(reviewFeedback ? { reviewFeedback } : {}),
            ...(stageFeedback ? { stageFeedback } : {}),
          },
          { signal },
        ), "work-unit");
        telemetry.push(agentCall.telemetry);

        if (
          !hasExactKeys(
            agentCall.value.segmentAssessments,
            segments.map((segment) => segment.key),
          )
        ) {
          diagnostics.push(
            contractDiagnostic(
              "evidence_segment_assessment_count_mismatch",
              "Segment assessments must contain exactly the supplied segment ID keys.",
              ["pages", pageIndex, "segmentAssessments"],
            ),
          );
        }

        const selectedSegments = segments.flatMap((segment, segmentIndex) => {
          const assessment = agentCall.value.segmentAssessments[segment.key];
          return assessment?.status === "selected"
            ? [{ assessment, segmentIndex }]
            : [];
        });
        if (selectedSegments.length > maximumSelectionsPerPage) {
          diagnostics.push(
            contractDiagnostic(
              "evidence_selection_limit_exceeded",
              "Evidence selection exceeded the supplied per-page limit.",
              ["pages", pageIndex, "segmentAssessments"],
            ),
          );
        }
        if (diagnostics.length > 0) {
          break;
        }

        for (const { segmentIndex } of selectedSegments) {
          const segment = segments[segmentIndex]!;
          selectedCharacters += segment.text.length;
          if (selectedCharacters > limits.maximumEvidenceCharacters) {
            diagnostics.push(
              contractDiagnostic(
                "evidence_selection_budget_exceeded",
                "Selected evidence exceeded the configured character budget.",
                ["snippets"],
              ),
            );
            break;
          }
          const snippetId = artifactFactory.createId("evidence_snippet");
          evidenceSet.snippets.push({
            id: snippetId,
            sourceId: page.sourceId,
            pageId: page.id,
            pageUrl: page.url,
            pageTitle: page.title,
            text: segment.text,
            ...(page.contentFormat ? { contentFormat: page.contentFormat } : {}),
            location: `characters ${segment.startOffset}-${segment.endOffset}`,
          });
        }
        if (diagnostics.length > 0) {
          break;
        }
      }

      const aggregate = aggregateTelemetry(telemetry);
      if (diagnostics.length > 0) {
        return {
          status: "rejected",
          errors: diagnostics as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          ...(aggregate ? { telemetry: aggregate } : {}),
        };
      }
      if (researchPlan.requiresExternalResearch && evidenceSet.snippets.length === 0) {
        return {
          status: "rejected",
          artifact: evidenceSet,
          errors: [
            contractDiagnostic(
              "evidence_selection_found_no_relevant_material",
              "No acquired page segment was selected as relevant evidence.",
              ["snippets"],
            ),
          ],
          ...(aggregate ? { telemetry: aggregate } : {}),
        };
      }

      return {
        status: "succeeded",
        artifact: evidenceSet,
        ...(aggregate ? { telemetry: aggregate } : {}),
      };
    },
  };
};
