import { z } from "zod";
import { GenerationArtifactIdSchema } from "./common";
import { PublishablePresentationSchema, NarrationScriptSchema } from "./presentation";
import { assertSlideTextLayout, type LaidOutSlideScene } from "./slide-text-layout";

const ScenesSchema = z.array(z.custom<LaidOutSlideScene>((value) => {
  try { assertSlideTextLayout(value as LaidOutSlideScene); return true; } catch { return false; }
})).min(2).max(100);

export const PublishedPresentationRecordSchema = z.object({ presentation: PublishablePresentationSchema, scenes: ScenesSchema }).strict()
  .superRefine(({ presentation, scenes }, context) => {
    if (scenes.length !== presentation.slides.slides.length || scenes.some((scene, index) => scene.slideId !== presentation.slides.slides[index]!.slideId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Published scenes must match the approved ordered slide set." });
    }
  });
export type PublishedPresentationRecord = z.infer<typeof PublishedPresentationRecordSchema>;

export const PublishedPresentationViewSchema = z.object({
  id: GenerationArtifactIdSchema, title: z.string().min(1), publishedAt: z.string().datetime(),
  scenes: ScenesSchema, scripts: z.array(NarrationScriptSchema).min(2).max(100),
}).strict().superRefine(({ scenes, scripts }, context) => {
  if (scenes.length !== scripts.length || scenes.some((scene, index) => scene.slideId !== scripts[index]!.slideId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Playback needs one reviewed script for every displayed slide." });
  }
});
export type PublishedPresentationView = z.infer<typeof PublishedPresentationViewSchema>;

export const PublishedLibraryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(24).default(12),
  query: z.string().trim().max(200).default(""),
  order: z.enum(["newest", "oldest"]).default("newest"),
}).strict();
export type PublishedLibraryQuery = z.infer<typeof PublishedLibraryQuerySchema>;

export const PublishedLibraryItemSchema = z.object({
  id: GenerationArtifactIdSchema,
  title: z.string().min(1),
  subject: z.string().min(1),
  publishedAt: z.string().datetime(),
  slideCount: z.number().int().min(2),
  imageCount: z.number().int().nonnegative(),
  language: z.string().min(1),
  cover: ScenesSchema.element,
}).strict();
export type PublishedLibraryItem = z.infer<typeof PublishedLibraryItemSchema>;

export const PublishedLibraryPageSchema = z.object({
  items: z.array(PublishedLibraryItemSchema).max(24),
  total: z.number().int().nonnegative(),
  unavailableCount: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
}).strict();
export type PublishedLibraryPage = z.infer<typeof PublishedLibraryPageSchema>;
