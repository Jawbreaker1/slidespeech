import { z } from "zod";
import { PRESENTATION_THEME_IDS, type PresentationThemeId } from "../presentation-themes";
import { SlideDesignSpecSchema, SlideDraftSchema, SlideDraftContentSchema, SlideSourceAttributionSchema } from "./presentation";
import type { SlideDesignSpecSet, SlideDraftSet, SlideDraft } from "./presentation";
import type { OutlineReviewAgentInput } from "./outline";
import type { GenerationAgentCall, GenerationAgentCallOptions } from "./agent-provider";
import type { EvidenceSet } from "./research";
import type { ReviewDecision } from "./review";
import { SLIDE_LAYOUTS } from "./slide-scene";
import type { SlideImageAsset } from "./slide-images";

export interface SlideDesignAgentInput extends OutlineReviewAgentInput {
  availableImages?: Omit<SlideImageAsset, "dataUrl">[];
}
export type SlideWritingLayout = {
  layoutId: string;
  maximumItemsPerGroup: number;
  fields: Array<{ path: Array<string | number>; width: number; height: number; font: string; size: number; lineHeight: number; maximumLines: number; fontIdentity: string }>;
};
export interface SlideWritingAgentInput extends SlideDesignAgentInput {
  designs: SlideDesignSpecSet;
  sources: EvidenceSet["sources"];
  slideIndex: number;
  previousSlides: SlideDraft[];
  layoutContract: SlideWritingLayout;
  revision?: { previous: SlideDraft; feedback: string[] };
}
export interface SlideReviewAgentInput extends SlideDesignAgentInput {
  designs: SlideDesignSpecSet;
  slides: SlideDraftSet;
}

export function createDesignDecisionSchema(slideCount: number, images: SlideDesignAgentInput["availableImages"] = [], slideIds: string[] = [], requestedTheme?: PresentationThemeId) {
  const availableIds = images.map((image) => image.id);
  return z.object({ themeId: requestedTheme ? z.literal(requestedTheme) : z.enum(PRESENTATION_THEME_IDS), designs: z.array(SlideDesignSpecSchema.pick({
    contentDensity: true, visualRole: true,
  }).extend({ layoutId: z.enum(SLIDE_LAYOUTS.filter((layout) => availableIds.length || !layout.image).map((layout) => layout.id) as [string, ...string[]]),
    imageAssetId: (availableIds.length ? z.enum(availableIds as [string, ...string[]]).nullable() : z.null()).optional(),
  })).length(slideCount) }).strict().superRefine((decision, context) => {
    decision.designs.forEach((design, index) => {
      const usesImage = SLIDE_LAYOUTS.find((layout) => layout.id === design.layoutId)!.image;
      if (usesImage !== Boolean(design.imageAssetId) || (design.imageAssetId && !images.some((image) => image.id === design.imageAssetId && image.approvedForSlideId === slideIds[index]))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["designs", index], message: "Choose an image layout only with an asset approved for this exact slide." });
      }
    });
  });
}
export type SlideDesignDecision = z.infer<ReturnType<typeof createDesignDecisionSchema>>;

export function createSlideWritingDecisionSchema(input: SlideWritingAgentInput) {
  const plan = input.slidePlans.slides[input.slideIndex]!;
  const design = input.designs.designs[input.slideIndex]!;
  const layout = SLIDE_LAYOUTS.find((item) => item.id === design.layoutId);
  const content = SlideDraftContentSchema.options.find((option) => option.shape.kind.value === layout?.contentKind);
  if (!content) throw new Error("Selected layout has no content contract.");
  const ids = (values: string[]) => z.array(values.length ? z.enum(values as [string, ...string[]]) : z.never())
    .refine((items) => new Set(items).size === items.length, "References must be unique.");
  const sourceIds = input.sources.map((source) => source.id);
  return SlideDraftSchema.omit({ slideId: true, imagePrompt: true }).extend({
    content,
    usedFactIds: ids(plan.allowedFactIds),
    sourceAttributions: z.array(SlideSourceAttributionSchema.omit({ url: true }).extend({
      sourceId: sourceIds.length ? z.enum(sourceIds as [string, ...string[]]) : z.never(),
    })).max(30),
  }).superRefine((draft, context) => {
    const counts = draft.content.kind === "process" ? [draft.content.steps.length]
      : draft.content.kind === "comparison" ? [draft.content.left.items.length, draft.content.right.items.length] : [];
    if (counts.some((count) => count > layout!.maximumItems)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: `This layout supports at most ${layout!.maximumItems} items per group.` });
    if (plan.requiredFactIds.some((id) => !draft.usedFactIds.includes(id))) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["usedFactIds"], message: "Cover each required fact in visible content or speaker notes.",
    });
  });
}
export type SlideWritingDecision = z.infer<ReturnType<typeof createSlideWritingDecisionSchema>>;

export interface GenerationV2SlideAgentProvider {
  selectSlideDesigns(input: SlideDesignAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<SlideDesignDecision>>;
  writeSlide(input: SlideWritingAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<SlideWritingDecision>>;
  reviewSlides(input: SlideReviewAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<ReviewDecision>>;
}
