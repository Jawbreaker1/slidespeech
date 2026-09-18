import { createNarrationDecisionSchema, createOutlineReviewDecisionSchema, NarrationScriptSetSchema, ReviewResultSchema } from "@slidespeech/types";
import type { GenerationV2NarrationAgentProvider, NarrationAgentInput, NarrationReviewAgentInput, NarrationScriptSet, ReviewResult } from "@slidespeech/types";
import { createGenerationArtifactIdentity, defaultGenerationArtifactFactory } from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export function createNarrationStages(agent: GenerationV2NarrationAgentProvider, factory: GenerationArtifactFactory = defaultGenerationArtifactFactory) {
  const writing: GenerationStageDefinition<NarrationAgentInput, NarrationScriptSet> = {
    name: "narration-generation", parseArtifact: (value) => NarrationScriptSetSchema.parse(value),
    execute: async (input, context) => {
      const call = await agent.writeNarration(input, { signal: context.signal });
      const decision = createNarrationDecisionSchema(input).parse(call.value);
      return { status: "succeeded", telemetry: call.telemetry, artifact: {
        ...createGenerationArtifactIdentity("narration_scripts", factory),
        deckStrategyArtifactId: input.strategy.artifactId, slideDraftSetArtifactId: input.slides.artifactId,
        scripts: decision.scripts.map(({ sourceIndexes, questionInvitation, ...script }, index) => ({
          ...script, slideId: input.slides.slides[index]!.slideId,
          sourceMentions: sourceIndexes.map((position) => input.sources[position]!.id),
          ...(questionInvitation !== null ? { questionInvitation } : {}),
        })),
      } };
    },
  };
  const review: GenerationStageDefinition<NarrationReviewAgentInput, ReviewResult> = {
    name: "narration-review", parseArtifact: (value) => ReviewResultSchema.parse(value),
    execute: async (input, context) => {
      const call = await agent.reviewNarration(input, { signal: context.signal });
      const decision = createOutlineReviewDecisionSchema(input.slidePlans.slides.length, input.factBank.facts.length).parse(call.value);
      const targets = [input.slides.artifactId, input.narrations.artifactId];
      const artifact = ReviewResultSchema.parse({ ...createGenerationArtifactIdentity("narration_review", factory), ...decision,
        targetStage: "narration-review", targetArtifactIds: targets,
        issues: decision.issues.map(({ targetArtifactIndex, slideIndex, factIndexes, retryInstruction, ...issue }) => ({
          ...issue, ...(targetArtifactIndex !== null ? { artifactId: targets[targetArtifactIndex] } : {}),
          ...(slideIndex !== null ? { slideId: input.slidePlans.slides[slideIndex]!.slideId } : {}),
          factIds: factIndexes.map((index) => input.factBank.facts[index]!.id),
          ...(retryInstruction !== null ? { retryInstruction } : {}),
        })),
      });
      return artifact.approved ? { status: "succeeded", artifact, telemetry: call.telemetry } : {
        status: "rejected", artifact, telemetry: call.telemetry,
        errors: [{ code: "narration_review_rejected", category: "semantic", message: artifact.summary,
          retryable: artifact.retryRecommended, artifactPath: [], sourceIds: [] }],
      };
    },
  };
  return { writing, review };
}
