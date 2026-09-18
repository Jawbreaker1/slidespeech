import { z } from "zod";
import { NarrationScriptSchema, NarrationScriptSetSchema } from "./presentation";
import { ReviewResultSchema } from "./review";
import type { ReviewDecision, ReviewResult } from "./review";
import type { OutlineReviewAgentInput } from "./outline";
import type { SlideDraftSet, NarrationScriptSet } from "./presentation";
import type { EvidenceSet } from "./research";
import type { GenerationAgentCall, GenerationAgentCallOptions } from "./agent-provider";

export interface NarrationAgentInput extends OutlineReviewAgentInput {
  slides: SlideDraftSet;
  sources: EvidenceSet["sources"];
  revision?: { previous: NarrationScriptSet; feedback: ReviewResult };
}
export type NarrationReviewAgentInput = Omit<NarrationAgentInput, "revision"> & { narrations: NarrationScriptSet };

const ScriptDecisionSchema = NarrationScriptSchema.omit({ slideId: true, sourceMentions: true, pausePrompts: true }).extend({
  sourceIndexes: z.array(z.number().int().nonnegative()),
  questionInvitation: z.string().min(1).max(2_000).nullable().describe("Spoken invitation for audience questions, or null when no invitation is spoken."),
});
export const NarrationDecisionSchema = z.object({ scripts: z.array(ScriptDecisionSchema).min(2).max(100) }).strict();
export type NarrationDecision = z.infer<typeof NarrationDecisionSchema>;

export function createNarrationDecisionSchema(input: NarrationAgentInput) {
  return NarrationDecisionSchema.extend({ scripts: z.array(ScriptDecisionSchema.extend({
    sourceIndexes: z.array(z.number().int().min(0).max(Math.max(0, input.sources.length - 1))).max(input.sources.length)
      .refine((indexes) => new Set(indexes).size === indexes.length, "Source references must be unique."),
  })).length(input.slides.slides.length) }).superRefine((decision, context) => {
    if (!decision.scripts.at(-1)?.questionInvitation) context.addIssue({ code: z.ZodIssueCode.custom,
      path: ["scripts", decision.scripts.length - 1, "questionInvitation"], message: "The closing script must include its question invitation." });
  });
}

export const ReviewedNarrationSchema = z.object({
  narrations: NarrationScriptSetSchema,
  review: ReviewResultSchema,
}).strict().superRefine(({ narrations, review }, context) => {
  const targets = [narrations.slideDraftSetArtifactId, narrations.artifactId];
  if (review.targetStage !== "narration-review" || !review.approved || review.retryRecommended
    || review.issues.some((issue) => issue.severity === "error")
    || review.targetArtifactIds.length !== targets.length || review.targetArtifactIds.some((id, index) => id !== targets[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Narration readiness requires explicit approval of this exact complete script and slide set." });
  }
  if (!narrations.scripts.at(-1)?.questionInvitation) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The reviewed closing script must include its question invitation." });
  }
});
export type ReviewedNarration = z.infer<typeof ReviewedNarrationSchema>;

export interface GenerationV2NarrationAgentProvider {
  writeNarration(input: NarrationAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<NarrationDecision>>;
  reviewNarration(input: NarrationReviewAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<ReviewDecision>>;
}
