import { z } from "zod";

import {
  DeckModeSchema,
  GenerationArtifactIdSchema,
  GenerationArtifactIdentitySchema,
  GenerationStageNameSchema,
} from "./common";
import {
  FactBankSchema,
  PromptClassificationSchema,
} from "./research";

export const DeckStoryBeatSchema = z
  .object({
    order: z.number().int().nonnegative(),
    purpose: z.string().min(1).max(2_000),
  })
  .strict();

export const LayoutVarietyPolicySchema = z
  .object({
    minimumUniqueLayouts: z.number().int().positive(),
    maximumConsecutiveSameFamily: z.number().int().positive(),
    allowIntentionalRepetition: z.boolean(),
  })
  .strict();

export const DeckStrategySchema = GenerationArtifactIdentitySchema.extend({
  classificationArtifactId: GenerationArtifactIdSchema,
  factBankArtifactId: GenerationArtifactIdSchema,
  deckMode: DeckModeSchema,
  storyArc: z.array(DeckStoryBeatSchema).min(2).max(100),
  requiredIntro: z.literal(true),
  requiredConclusion: z.literal(true),
  slideCount: z.number().int().min(2).max(100),
  durationMinutes: z.number().positive().max(480),
  language: z.string().min(2).max(40),
  audience: z.string().min(1).max(500),
  tone: z.string().min(1).max(500),
  layoutVarietyPolicy: LayoutVarietyPolicySchema,
  narrationStyle: z.string().min(1).max(1_000),
})
  .strict()
  .superRefine((strategy, context) => {
    if (strategy.storyArc.length !== strategy.slideCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Story arc length must match the planned slide count.",
        path: ["storyArc"],
      });
    }
    strategy.storyArc.forEach((beat, index) => {
      if (beat.order !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Story arc order must be contiguous and zero-based.",
          path: ["storyArc", index, "order"],
        });
      }
    });
  });

export type DeckStrategy = z.infer<typeof DeckStrategySchema>;

export const SlideRoleSchema = z.enum([
  "intro",
  "context",
  "evidence",
  "mechanism",
  "example",
  "comparison",
  "implication",
  "activity",
  "decision",
  "summary",
  "conclusion",
]);

export type SlideRole = z.infer<typeof SlideRoleSchema>;

export const SlideModelKnowledgeScopeSchema = z
  .object({
    allowed: z.boolean(),
    scope: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const SlideOverlapPolicySchema = z
  .object({
    mode: z.enum(["none", "preview", "recap", "intentional"]),
    factIds: z.array(GenerationArtifactIdSchema),
    rationale: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const SlidePlanSchema = z
  .object({
    slideId: GenerationArtifactIdSchema,
    order: z.number().int().nonnegative(),
    role: SlideRoleSchema,
    audienceQuestion: z.string().min(1).max(2_000),
    learningPurpose: z.string().min(1).max(2_000),
    allowedFactIds: z.array(GenerationArtifactIdSchema),
    requiredFactIds: z.array(GenerationArtifactIdSchema),
    forbiddenFactIds: z.array(GenerationArtifactIdSchema),
    modelKnowledgeScope: SlideModelKnowledgeScopeSchema,
    overlapPolicy: SlideOverlapPolicySchema,
    narrationIntent: z.string().min(1).max(2_000),
  })
  .strict();

export type SlidePlan = z.infer<typeof SlidePlanSchema>;

export const SlidePlanSetSchema = GenerationArtifactIdentitySchema.extend({
  deckStrategyArtifactId: GenerationArtifactIdSchema,
  factBankArtifactId: GenerationArtifactIdSchema,
  slides: z.array(SlidePlanSchema).min(2).max(100),
})
  .strict()
  .superRefine((planSet, context) => {
    const ids = new Set<string>();
    planSet.slides.forEach((slide, index) => {
      if (ids.has(slide.slideId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Slide ids must be unique.",
          path: ["slides", index, "slideId"],
        });
      }
      ids.add(slide.slideId);
      if (slide.order !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Slide order must be contiguous and zero-based.",
          path: ["slides", index, "order"],
        });
      }
    });
    if (planSet.slides[0]?.role !== "intro") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The first slide plan must have the intro role.",
        path: ["slides", 0, "role"],
      });
    }
    const lastIndex = planSet.slides.length - 1;
    if (planSet.slides[lastIndex]?.role !== "conclusion") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The final slide plan must have the conclusion role.",
        path: ["slides", lastIndex, "role"],
      });
    }
  });

export type SlidePlanSet = z.infer<typeof SlidePlanSetSchema>;

export const SlideLayoutFamilySchema = z.enum([
  "hero",
  "editorial",
  "evidence",
  "process",
  "comparison",
  "timeline",
  "spatial",
  "gallery",
  "dashboard",
  "activity",
  "closing",
]);

export const SlideVisualRoleSchema = z.enum([
  "hero",
  "evidence",
  "process",
  "comparison",
  "quote",
  "timeline",
  "map",
  "gallery",
  "checklist",
  "dashboard",
  "question",
]);

export const SlideDesignSpecSchema = z
  .object({
    slideId: GenerationArtifactIdSchema,
    layoutId: GenerationArtifactIdSchema,
    layoutFamily: SlideLayoutFamilySchema,
    contentDensity: z.enum(["sparse", "balanced", "dense"]),
    visualRole: SlideVisualRoleSchema,
    imageStrategy: z.enum([
      "source-image",
      "curated-fallback",
      "generated",
      "none",
    ]),
    imageQuery: z.string().min(1).max(2_000).optional(),
    variationSeed: z.number().int().nonnegative(),
    emphasis: z.array(z.string().min(1).max(500)).max(20),
    speakerSupport: z.array(z.string().min(1).max(1_000)).max(20),
  })
  .strict();

export type SlideDesignSpec = z.infer<typeof SlideDesignSpecSchema>;

export const SlideDesignSpecSetSchema = GenerationArtifactIdentitySchema.extend({
  deckStrategyArtifactId: GenerationArtifactIdSchema,
  slidePlanSetArtifactId: GenerationArtifactIdSchema,
  designs: z.array(SlideDesignSpecSchema).min(2).max(100),
})
  .strict()
  .superRefine((designSet, context) => {
    const ids = new Set<string>();
    designSet.designs.forEach((design, index) => {
      if (ids.has(design.slideId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each slide may have only one design spec.",
          path: ["designs", index, "slideId"],
        });
      }
      ids.add(design.slideId);
    });
  });

export type SlideDesignSpecSet = z.infer<typeof SlideDesignSpecSetSchema>;

const SlideListItemSchema = z
  .object({
    heading: z.string().min(1).max(500).optional(),
    body: z.string().min(1).max(2_000),
  })
  .strict();

const SlideCardSchema = z
  .object({
    title: z.string().min(1).max(500),
    body: z.string().min(1).max(2_000),
  })
  .strict();

const SlideProcessStepSchema = z
  .object({
    label: z.string().min(1).max(500),
    description: z.string().min(1).max(2_000),
  })
  .strict();

const SlideComparisonSideSchema = z
  .object({
    heading: z.string().min(1).max(500),
    items: z.array(z.string().min(1).max(1_000)).min(1).max(10),
  })
  .strict();

const SlideTimelineEventSchema = z
  .object({
    label: z.string().min(1).max(500),
    description: z.string().min(1).max(2_000),
  })
  .strict();

const SlideMetricSchema = z
  .object({
    label: z.string().min(1).max(500),
    value: z.string().min(1).max(500),
    context: z.string().min(1).max(1_000).optional(),
  })
  .strict();

export const SlideDraftContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("statement"),
      statement: z.string().min(1).max(3_000),
      supportingText: z.string().min(1).max(3_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("list"),
      items: z.array(SlideListItemSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cards"),
      cards: z.array(SlideCardSchema).min(2).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("process"),
      steps: z.array(SlideProcessStepSchema).min(2).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("comparison"),
      left: SlideComparisonSideSchema,
      right: SlideComparisonSideSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("quote"),
      quote: z.string().min(1).max(4_000),
      attribution: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("timeline"),
      events: z.array(SlideTimelineEventSchema).min(2).max(10),
    })
    .strict(),
  z
    .object({
      kind: z.literal("metrics"),
      metrics: z.array(SlideMetricSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("activity"),
      instruction: z.string().min(1).max(3_000),
      steps: z.array(z.string().min(1).max(1_000)).min(1).max(10),
      expectedOutput: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("source-excerpt"),
      excerpt: z.string().min(1).max(5_000),
      attribution: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("question"),
      question: z.string().min(1).max(2_000),
      guidance: z.string().min(1).max(2_000).optional(),
    })
    .strict(),
]);

export type SlideDraftContent = z.infer<typeof SlideDraftContentSchema>;

export const SlideSourceAttributionSchema = z
  .object({
    sourceId: GenerationArtifactIdSchema,
    label: z.string().min(1).max(1_000),
    url: z.string().url().optional(),
  })
  .strict();

export const SlideDraftSchema = z
  .object({
    slideId: GenerationArtifactIdSchema,
    title: z.string().min(1).max(500),
    subtitle: z.string().min(1).max(1_000).optional(),
    content: SlideDraftContentSchema,
    usedFactIds: z.array(GenerationArtifactIdSchema),
    speakerNotes: z.array(z.string().min(1).max(3_000)).max(20),
    imagePrompt: z.string().min(1).max(2_000).optional(),
    sourceAttributions: z.array(SlideSourceAttributionSchema).max(30),
    likelyQuestions: z.array(z.string().min(1).max(1_000)).max(20),
  })
  .strict();

export type SlideDraft = z.infer<typeof SlideDraftSchema>;

export const SlideDraftSetSchema = GenerationArtifactIdentitySchema.extend({
  deckStrategyArtifactId: GenerationArtifactIdSchema,
  slidePlanSetArtifactId: GenerationArtifactIdSchema,
  slideDesignSpecSetArtifactId: GenerationArtifactIdSchema,
  slides: z.array(SlideDraftSchema).min(2).max(100),
})
  .strict()
  .superRefine((draftSet, context) => {
    const ids = new Set<string>();
    draftSet.slides.forEach((slide, index) => {
      if (ids.has(slide.slideId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each slide may have only one slide draft.",
          path: ["slides", index, "slideId"],
        });
      }
      ids.add(slide.slideId);
    });
  });

export type SlideDraftSet = z.infer<typeof SlideDraftSetSchema>;

export const NarrationScriptSchema = z
  .object({
    slideId: GenerationArtifactIdSchema,
    openingBridge: z.string().min(1).max(3_000),
    segments: z.array(z.string().min(1).max(4_000)).min(1).max(30),
    transitionOut: z.string().min(1).max(3_000),
    pausePrompts: z.array(z.string().min(1).max(1_000)).max(20),
    sourceMentions: z.array(GenerationArtifactIdSchema).max(30),
    questionInvitation: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export type NarrationScript = z.infer<typeof NarrationScriptSchema>;

export const NarrationScriptSetSchema = GenerationArtifactIdentitySchema.extend({
  deckStrategyArtifactId: GenerationArtifactIdSchema,
  slideDraftSetArtifactId: GenerationArtifactIdSchema,
  scripts: z.array(NarrationScriptSchema).min(2).max(100),
})
  .strict()
  .superRefine((scriptSet, context) => {
    const ids = new Set<string>();
    scriptSet.scripts.forEach((script, index) => {
      if (ids.has(script.slideId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each slide may have only one narration script.",
          path: ["scripts", index, "slideId"],
        });
      }
      ids.add(script.slideId);
    });
  });

export type NarrationScriptSet = z.infer<typeof NarrationScriptSetSchema>;

export const ReviewIssueSchema = z
  .object({
    code: z.string().min(1).max(120),
    severity: z.enum(["info", "warning", "error"]),
    dimension: z.enum([
      "contract",
      "grounding",
      "role-fidelity",
      "repetition",
      "language",
      "renderer",
      "narration",
      "coherence",
      "publication",
    ]),
    message: z.string().min(1).max(3_000),
    artifactId: GenerationArtifactIdSchema.optional(),
    slideId: GenerationArtifactIdSchema.optional(),
    factIds: z.array(GenerationArtifactIdSchema),
    retryInstruction: z.string().min(1).max(3_000).optional(),
  })
  .strict();

export const ReviewResultSchema = GenerationArtifactIdentitySchema.extend({
  targetStage: GenerationStageNameSchema,
  targetArtifactIds: z.array(GenerationArtifactIdSchema).min(1),
  approved: z.boolean(),
  score: z.number().min(0).max(1),
  summary: z.string().min(1).max(5_000),
  issues: z.array(ReviewIssueSchema).max(500),
  retryRecommended: z.boolean(),
}).strict();

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const PublishablePresentationSchema = GenerationArtifactIdentitySchema.extend({
  classification: PromptClassificationSchema,
  factBank: FactBankSchema,
  strategy: DeckStrategySchema,
  slidePlans: SlidePlanSetSchema,
  designs: SlideDesignSpecSetSchema,
  slides: SlideDraftSetSchema,
  narrations: NarrationScriptSetSchema,
  reviews: z.array(ReviewResultSchema).min(1),
  publishedAt: z.string().datetime(),
})
  .strict()
  .superRefine((presentation, context) => {
    const expectedSlideIds = presentation.slidePlans.slides.map(
      (slide) => slide.slideId,
    );
    const designSlideIds = presentation.designs.designs.map(
      (design) => design.slideId,
    );
    const draftSlideIds = presentation.slides.slides.map((slide) => slide.slideId);
    const narrationSlideIds = presentation.narrations.scripts.map(
      (script) => script.slideId,
    );
    const sameSlideIds = (actual: string[]): boolean =>
      actual.length === expectedSlideIds.length &&
      actual.every((slideId, index) => slideId === expectedSlideIds[index]);

    if (!sameSlideIds(designSlideIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Design specs must match the ordered slide plan ids.",
        path: ["designs", "designs"],
      });
    }
    if (!sameSlideIds(draftSlideIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slide drafts must match the ordered slide plan ids.",
        path: ["slides", "slides"],
      });
    }
    if (!sameSlideIds(narrationSlideIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Narration scripts must match the ordered slide plan ids.",
        path: ["narrations", "scripts"],
      });
    }
    if (presentation.strategy.classificationArtifactId !== presentation.classification.artifactId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deck strategy must reference the included classification artifact.",
        path: ["strategy", "classificationArtifactId"],
      });
    }
    if (presentation.strategy.factBankArtifactId !== presentation.factBank.artifactId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deck strategy must reference the included fact bank artifact.",
        path: ["strategy", "factBankArtifactId"],
      });
    }
    if (
      presentation.reviews.some((review) => !review.approved) ||
      !presentation.reviews.some(
        (review) => review.targetStage === "publication-review",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Publishable presentations require approved reviews including publication review.",
        path: ["reviews"],
      });
    }
  });

export type PublishablePresentation = z.infer<
  typeof PublishablePresentationSchema
>;
