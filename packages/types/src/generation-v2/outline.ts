import { z } from "zod";
import { DeckStoryBeatSchema, LayoutVarietyPolicySchema, SlidePlanSchema } from "./presentation";
import { ReviewDecisionSchema, ReviewIssueDecisionSchema } from "./review";
import type { DeckStrategy, SlidePlanSet } from "./presentation";
import type { FactBank, PresentationRequestArtifact, PromptClassification } from "./research";
import type { GenerationAgentCall, GenerationAgentCallOptions } from "./agent-provider";

export const DeckStrategyDecisionSchema = z.object({
  canPlan: z.boolean(),
  blockingReason: z.string().min(1).nullable(),
  strategy: z.object({
    storyArc: z.array(DeckStoryBeatSchema.omit({ order: true })).min(2).max(30),
    durationMinutes: z.number().positive().max(60),
    tone: z.string().min(1).max(500),
    layoutVarietyPolicy: LayoutVarietyPolicySchema,
    narrationStyle: z.string().min(1).max(1_000),
  }).strict().nullable(),
}).strict().superRefine((decision, context) => {
  if (decision.canPlan !== (decision.strategy !== null) || decision.canPlan === (decision.blockingReason !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Supply a strategy when planning succeeds, or a blocking reason when it cannot proceed." });
  }
  if (decision.strategy && (decision.strategy.storyArc[0]?.role !== "intro" || decision.strategy.storyArc.at(-1)?.role !== "conclusion")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Plan an introductory first slide and a concluding final slide before allocating material.", path: ["strategy", "storyArc"] });
  }
});
export type DeckStrategyDecision = z.infer<typeof DeckStrategyDecisionSchema>;

const AllocationSlideSchema = SlidePlanSchema.omit({ slideId: true, order: true }).extend({
  modelKnowledgeScope: z.object({ allowed: z.boolean(), scope: z.string().min(1).nullable() }).strict(),
  overlapPolicy: SlidePlanSchema.shape.overlapPolicy.extend({ rationale: z.string().min(1).nullable() }),
});
export const SlideAllocationDecisionSchema = z.object({ slides: z.array(AllocationSlideSchema).min(2).max(30) }).strict();
export type SlideAllocationDecision = z.infer<typeof SlideAllocationDecisionSchema>;

const factList = (ids: string[]) => z.array(ids.length ? z.enum(ids as [string, ...string[]]) : z.never())
  .max(ids.length).refine((values) => new Set(values).size === values.length, "Fact references must be unique.");

export function createSlideAllocationDecisionSchema(strategy: DeckStrategy, bank: FactBank) {
  const usableIds = bank.facts.filter((fact) => fact.allowedUse === undefined || fact.allowedUse === "visible-slide" || fact.allowedUse === "narration-only").map((fact) => fact.id);
  return SlideAllocationDecisionSchema.extend({ slides: z.array(AllocationSlideSchema.extend({
    allowedFactIds: factList(usableIds), requiredFactIds: factList(usableIds),
    overlapPolicy: AllocationSlideSchema.shape.overlapPolicy.extend({ factIds: factList(usableIds) }),
  })).length(strategy.slideCount) }).superRefine((decision, context) => {
    decision.slides.forEach((slide, index) => {
      const invalid = slide.requiredFactIds.some((id) => !slide.allowedFactIds.includes(id)) ||
        slide.overlapPolicy.factIds.some((id) => !slide.allowedFactIds.includes(id));
      if (invalid) context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", index], message: "Required and overlap facts must be allocated to the slide." });
      if (slide.modelKnowledgeScope.allowed && (!bank.modelKnowledgeAllowed || !slide.modelKnowledgeScope.scope)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", index, "modelKnowledgeScope"], message: "Model knowledge needs an explicit scope and permission from the research policy." });
      }
      if (slide.role !== strategy.storyArc[index]?.role) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides", index, "role"], message: "Allocation must preserve the role already chosen in the strategy." });
      }
    });
  });
}

export function createOutlineReviewDecisionSchema(slideCount: number, factCount: number, targetArtifactCount = 2) {
  return ReviewDecisionSchema.extend({ issues: z.array(ReviewIssueDecisionSchema.extend({
    targetArtifactIndex: z.number().int().min(0).max(targetArtifactCount - 1).nullable(),
    slideIndex: z.number().int().min(0).max(slideCount - 1).nullable(),
    factIndexes: z.array(z.number().int().min(0).max(factCount - 1)).max(factCount)
      .refine((ids) => new Set(ids).size === ids.length, "Fact references must be unique."),
  })).max(500) }).superRefine((review, context) => {
    if (review.approved && (review.retryRecommended || review.issues.some((issue) => issue.severity === "error"))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "An approval cannot also reject the outline or recommend a retry." });
    }
  });
}

export interface DeckStrategyAgentInput {
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  factBank: FactBank;
}
export interface SlideAllocationAgentInput extends DeckStrategyAgentInput { strategy: DeckStrategy }
export interface OutlineReviewAgentInput extends SlideAllocationAgentInput { slidePlans: SlidePlanSet }
export interface GenerationV2OutlineAgentProvider {
  planDeckStrategy(input: DeckStrategyAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<DeckStrategyDecision>>;
  allocateSlides(input: SlideAllocationAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<SlideAllocationDecision>>;
  reviewOutline(input: OutlineReviewAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<z.infer<typeof ReviewDecisionSchema>>>;
}
