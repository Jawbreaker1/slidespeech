import {
  DeckStrategyDecisionSchema, DeckStrategySchema, SlidePlanSetSchema, ReviewResultSchema,
  createSlideAllocationDecisionSchema, createOutlineReviewDecisionSchema,
} from "@slidespeech/types";
import type {
  DeckStrategy, DeckStrategyAgentInput, SlideAllocationAgentInput, OutlineReviewAgentInput,
  SlidePlanSet, ReviewResult, GenerationV2OutlineAgentProvider,
} from "@slidespeech/types";
import { createGenerationArtifactIdentity, defaultGenerationArtifactFactory } from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export function createOutlineStages(agent: GenerationV2OutlineAgentProvider, factory: GenerationArtifactFactory = defaultGenerationArtifactFactory) {
  const strategy: GenerationStageDefinition<DeckStrategyAgentInput, DeckStrategy> = {
    name: "deck-strategy", parseArtifact: (value) => DeckStrategySchema.parse(value),
    execute: async (input, context) => {
      if (input.factBank.facts.length === 0 || ("sufficientForDeck" in input.factBank && !input.factBank.sufficientForDeck)) throw new Error("Strategy requires nonempty facts without a historical insufficiency verdict.");
      const call = await agent.planDeckStrategy(input, { signal: context.signal });
      const decision = DeckStrategyDecisionSchema.parse(call.value);
      if (!decision.canPlan || !decision.strategy) return {
        status: "rejected", telemetry: call.telemetry,
        errors: [{ code: "strategy_rejected", message: decision.blockingReason!, category: "semantic", retryable: false, artifactPath: [], sourceIds: [] }],
      };
      const { storyArc, ...choices } = decision.strategy;
      return { status: "succeeded", telemetry: call.telemetry, artifact: {
        ...createGenerationArtifactIdentity("deck_strategy", factory), ...choices,
        classificationArtifactId: input.classification.artifactId, factBankArtifactId: input.factBank.artifactId,
        deckMode: input.classification.deckMode, language: input.classification.language, audience: input.classification.audience,
        requiredIntro: true, requiredConclusion: true, slideCount: storyArc.length,
        storyArc: storyArc.map((beat, order) => ({ ...beat, order })),
      } };
    },
  };
  const allocation: GenerationStageDefinition<SlideAllocationAgentInput, SlidePlanSet> = {
    name: "slide-allocation", parseArtifact: (value) => SlidePlanSetSchema.parse(value),
    execute: async (input, context) => {
      if (input.strategy.factBankArtifactId !== input.factBank.artifactId || input.strategy.classificationArtifactId !== input.classification.artifactId) throw new Error("Allocation requires the strategy's original classification and fact bank.");
      const call = await agent.allocateSlides(input, { signal: context.signal });
      const decision = createSlideAllocationDecisionSchema(input.strategy, input.factBank).parse(call.value);
      return { status: "succeeded", telemetry: call.telemetry, artifact: {
        ...createGenerationArtifactIdentity("slide_plans", factory), deckStrategyArtifactId: input.strategy.artifactId, factBankArtifactId: input.factBank.artifactId,
        slides: decision.slides.map(({ modelKnowledgeScope, overlapPolicy, ...slide }, order) => ({
          ...slide, order, slideId: factory.createId("slide"),
          modelKnowledgeScope: { allowed: modelKnowledgeScope.allowed, ...(modelKnowledgeScope.scope !== null ? { scope: modelKnowledgeScope.scope } : {}) },
          overlapPolicy: { mode: overlapPolicy.mode, factIds: overlapPolicy.factIds, ...(overlapPolicy.rationale !== null ? { rationale: overlapPolicy.rationale } : {}) },
        })),
      } };
    },
  };
  const review: GenerationStageDefinition<OutlineReviewAgentInput, ReviewResult> = {
    name: "outline-review", parseArtifact: (value) => ReviewResultSchema.parse(value),
    execute: async (input, context) => {
      if (input.slidePlans.deckStrategyArtifactId !== input.strategy.artifactId || input.slidePlans.factBankArtifactId !== input.factBank.artifactId) throw new Error("Outline review requires the original strategy and allocated material.");
      const call = await agent.reviewOutline(input, { signal: context.signal });
      const decision = createOutlineReviewDecisionSchema(input.slidePlans.slides.length, input.factBank.facts.length).parse(call.value);
      const targets = [input.strategy.artifactId, input.slidePlans.artifactId];
      const artifact = ReviewResultSchema.parse({
        ...createGenerationArtifactIdentity("outline_review", factory), ...decision,
        targetStage: "outline-review", targetArtifactIds: targets,
        issues: decision.issues.map(({ targetArtifactIndex, slideIndex, factIndexes, retryInstruction, ...issue }) => ({
          ...issue, ...(targetArtifactIndex !== null ? { artifactId: targets[targetArtifactIndex] } : {}),
          ...(slideIndex !== null ? { slideId: input.slidePlans.slides[slideIndex]!.slideId } : {}),
          factIds: factIndexes.map((index) => input.factBank.facts[index]!.id),
          ...(retryInstruction !== null ? { retryInstruction } : {}),
        })),
      });
      if (!artifact.approved) return { status: "rejected", artifact, telemetry: call.telemetry,
        errors: [{ code: "outline_review_rejected", message: artifact.summary, category: "semantic", retryable: artifact.retryRecommended, artifactPath: [], sourceIds: [] }],
      };
      return { status: "succeeded", artifact, telemetry: call.telemetry };
    },
  };
  return { strategy, allocation, review };
}
