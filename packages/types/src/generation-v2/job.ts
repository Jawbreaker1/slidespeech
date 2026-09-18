import { z } from "zod";
import { GeneratePresentationRequestSchema } from "../domain";
import { GenerationStageProgressEventSchema, GenerationArtifactIdSchema } from "./common";
import { FactBankSchema, ResearchSourceSchema } from "./research";
import { DeckStrategySchema, SlidePlanSetSchema, SlideDraftSetSchema, SlideDesignSpecSetSchema } from "./presentation";
import { assertSlideTextLayout, type LaidOutSlideScene } from "./slide-text-layout";
import { ReviewResultSchema } from "./review";
import { ReviewedNarrationSchema } from "./narration";

// Transport state only. An approved outline never authorizes publication.
const GenerationV2JobBaseSchema = z.object({
  id: z.string().uuid(),
  request: GeneratePresentationRequestSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  stageStartedAt: z.string().datetime().optional(),
  estimate: z.object({
    lowerMs: z.number().int().nonnegative(),
    upperMs: z.number().int().nonnegative(),
    sampleCount: z.number().int().positive(),
    lengthAdjusted: z.boolean(),
  }).strict().refine((estimate) => estimate.upperMs >= estimate.lowerMs).optional(),
  progress: z.array(GenerationStageProgressEventSchema).max(100),
});

export const GenerationV2JobSchema = z.discriminatedUnion("status", [
  GenerationV2JobBaseSchema.extend({ status: z.literal("queued"), queuePosition: z.number().int().positive() }).strict(),
  GenerationV2JobBaseSchema.extend({ status: z.literal("running") }).strict(),
  GenerationV2JobBaseSchema.extend({
    status: z.literal("slides-ready"),
    result: z.object({
      subject: z.string(),
      factBank: FactBankSchema,
      sources: z.array(ResearchSourceSchema),
      reviewSummary: z.string(),
      strategy: DeckStrategySchema,
      slidePlans: SlidePlanSetSchema,
      outlineReview: ReviewResultSchema.refine((review) => review.targetStage === "outline-review" && review.approved && !review.retryRecommended && !review.issues.some((issue) => issue.severity === "error"), "Outline readiness requires an unambiguous approval."),
      designs: SlideDesignSpecSetSchema,
      slides: SlideDraftSetSchema,
      slideReview: ReviewResultSchema.refine((review) => review.targetStage === "slide-review" && review.approved && !review.retryRecommended && !review.issues.some((issue) => issue.severity === "error"), "Slide readiness requires an unambiguous approval."),
      spokenPresentation: ReviewedNarrationSchema.optional(),
      publication: z.object({ id: GenerationArtifactIdSchema, publishedAt: z.string().datetime() }).strict().optional(),
      scenes: z.array(z.custom<LaidOutSlideScene>((value) => {
        try { assertSlideTextLayout(value as LaidOutSlideScene); return true; } catch { return false; }
      })).min(2).max(30),
    }).strict().superRefine((result, context) => {
      const ids = result.slidePlans.slides.map((slide) => slide.slideId);
      for (const values of [result.designs.designs, result.slides.slides, result.scenes]) {
        if (values.length !== ids.length || values.some((slide, index) => slide.slideId !== ids[index])) context.addIssue({ code: z.ZodIssueCode.custom, message: "Preview requires the same ordered slides in every artifact." });
      }
      if (result.slideReview.targetArtifactIds.join() !== [result.designs.artifactId, result.slides.artifactId].join()) context.addIssue({ code: z.ZodIssueCode.custom, message: "Preview review must target these exact designs and drafts." });
      const narration = result.spokenPresentation?.narrations;
      if (result.publication && !narration) context.addIssue({ code: z.ZodIssueCode.custom, message: "A published result requires reviewed narration." });
      if (narration && (narration.deckStrategyArtifactId !== result.strategy.artifactId || narration.slideDraftSetArtifactId !== result.slides.artifactId
        || narration.scripts.length !== ids.length || narration.scripts.some((script, index) => script.slideId !== ids[index]))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Spoken scripts must belong to these exact slides and strategy, in order." });
      }
    }),
  }).strict(),
  GenerationV2JobBaseSchema.extend({
    status: z.enum(["failed", "rejected", "cancelled"]),
    error: z.string(),
  }).strict(),
]);

export type GenerationV2Job = z.infer<typeof GenerationV2JobSchema>;
