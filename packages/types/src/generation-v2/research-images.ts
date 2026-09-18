import { z } from "zod";
import { GenerationArtifactIdSchema } from "./common";

const ImageUrlSchema = z.string().url().max(8_192).refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, "Image candidates must use credential-free HTTP(S) URLs.");
export const ResearchImageMetadataSchema = z.object({
  url: ImageUrlSchema,
  discoveredVia: z.enum(["img", "open-graph", "twitter"]),
  alt: z.string().max(4_000).optional(),
  caption: z.string().max(4_000).optional(),
  declaredWidth: z.number().int().positive().optional(),
  declaredHeight: z.number().int().positive().optional(),
  responsiveVariants: z.array(z.object({ url: ImageUrlSchema, width: z.number().positive().optional(), density: z.number().positive().optional() }).strict()).max(20).optional(),
}).strict();

export type ResearchImageMetadata = z.infer<typeof ResearchImageMetadataSchema>;
export const ResearchImageCandidateSchema = ResearchImageMetadataSchema.extend({ id: GenerationArtifactIdSchema });
export const ResearchImageDiscoverySchema = z.object({
  candidates: z.array(ResearchImageCandidateSchema).max(100),
  totalCandidates: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.totalCandidates < value.candidates.length || value.truncated !== (value.totalCandidates > value.candidates.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Image discovery must report its actual candidate count and truncation." });
  }
  if (new Set(value.candidates.map((candidate) => candidate.id)).size !== value.candidates.length ||
      new Set(value.candidates.map((candidate) => candidate.url)).size !== value.candidates.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Image candidates must have unique IDs and URLs within their source page." });
  }
});
export type ResearchImageDiscovery = z.infer<typeof ResearchImageDiscoverySchema>;
export type DiscoveredResearchImages = Omit<ResearchImageDiscovery, "candidates"> & { candidates: ResearchImageMetadata[] };
