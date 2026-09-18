import { z } from "zod";
import { GenerationStageTelemetrySchema } from "./common";
import type { SlideDesignAgentInput } from "./slide-generation";
import type { ResearchBundle } from "./research";

export const SlideImageAssetSchema = z.object({
  id: z.string().min(1), candidateId: z.string().min(1), sourceId: z.string().min(1),
  sourcePageUrl: z.string().url(), sourceImageUrl: z.string().url(), retrievedUrl: z.string().url(),
  originalSha256: z.string().length(64), sha256: z.string().length(64),
  dataUrl: z.string().startsWith("data:image/jpeg;base64,").max(3_000_000),
  width: z.number().int().positive().max(1600), height: z.number().int().positive().max(1600),
  sourceCaption: z.string().max(4000).optional(), rightsStatus: z.literal("unverified"),
  approvedForSlideId: z.string().min(1), description: z.string().min(1).max(1000),
  assessment: z.string().min(1).max(2000), model: z.string().min(1),
}).strict();
export type SlideImageAsset = z.infer<typeof SlideImageAssetSchema>;
export const SlideImageDecisionSchema = z.object({
  slideId: z.string().min(1), candidateId: z.string().nullable(), assetId: z.string().nullable(),
  status: z.enum(["approved", "omitted", "rejected", "unavailable"]), reason: z.string().min(1),
  required: z.boolean(),
}).strict();
export const SlideImagePreparationSchema = z.object({
  assets: z.array(SlideImageAssetSchema).max(4), decisions: z.array(SlideImageDecisionSchema),
  modelCalls: z.array(GenerationStageTelemetrySchema).max(5).optional(),
}).strict().superRefine((result, context) => {
  const slides = new Set<string>();
  for (const decision of result.decisions) {
    const asset = result.assets.find((asset) => asset.id === decision.assetId && asset.candidateId === decision.candidateId && asset.approvedForSlideId === decision.slideId);
    if (slides.has(decision.slideId) || (decision.status === "approved" ? !asset : decision.assetId !== null) || (decision.required && decision.status !== "approved")) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Image decisions require unique slide ownership and exact approved assets; required images cannot be absent." });
    }
    slides.add(decision.slideId);
  }
  for (const asset of result.assets) if (!result.decisions.some((decision) => decision.status === "approved" && decision.assetId === asset.id && decision.slideId === asset.approvedForSlideId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Every retained image asset requires its own approval decision." });
  }
});
export type SlideImagePreparation = z.infer<typeof SlideImagePreparationSchema>;
export interface GenerationSlideImageProvider {
  prepare(input: SlideDesignAgentInput, bundle: ResearchBundle, signal: AbortSignal): Promise<SlideImagePreparation>;
}
