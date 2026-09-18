import { z } from "zod";
import { PRESENTATION_THEME_IDS } from "../presentation-themes";
import { SlideImagePreparationSchema } from "./slide-images";

import {
  DeckModeSchema,
  GenerationArtifactIdSchema,
  GenerationArtifactIdentitySchema,
} from "./common";
import {
  EvidenceSetSchema,
  FactBankSchema,
  PresentationRequestArtifactSchema,
  PromptClassificationSchema,
  ResearchPlanSchema,
  ResearchBundleManifestSchema,
} from "./research";
import { ResearchReviewResultSchema } from "./research-review";
import { ReviewResultSchema } from "./review";

export const SlideRoleSchema = z.enum([
  "intro", "context", "evidence", "mechanism", "example", "comparison",
  "implication", "activity", "decision", "summary", "conclusion",
]);
export type SlideRole = z.infer<typeof SlideRoleSchema>;

export const DeckStoryBeatSchema = z
  .object({
    order: z.number().int().nonnegative(),
    role: SlideRoleSchema,
    audienceQuestion: z.string().min(1).max(2_000),
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
      if ((index === 0 && beat.role !== "intro") || (index === strategy.storyArc.length - 1 && beat.role !== "conclusion")) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "The strategy must begin with an intro and end with a conclusion.", path: ["storyArc", index, "role"] });
      }
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
    allowedFactIds: z.array(GenerationArtifactIdSchema),
    requiredFactIds: z.array(GenerationArtifactIdSchema),
    modelKnowledgeScope: SlideModelKnowledgeScopeSchema,
    overlapPolicy: SlideOverlapPolicySchema,
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
    themeId: z.enum(PRESENTATION_THEME_IDS).optional(),
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
    imageAssetId: GenerationArtifactIdSchema.optional(),
    variationSeed: z.number().int().nonnegative(),
  })
  .strict();

export type SlideDesignSpec = z.infer<typeof SlideDesignSpecSchema>;

export const SlideDesignSpecSetSchema = GenerationArtifactIdentitySchema.extend({
  deckStrategyArtifactId: GenerationArtifactIdSchema,
  slidePlanSetArtifactId: GenerationArtifactIdSchema,
  designs: z.array(SlideDesignSpecSchema).min(2).max(100),
  images: SlideImagePreparationSchema.optional(),
})
  .strict()
  .superRefine((designSet, context) => {
    if (new Set(designSet.designs.map((design) => design.themeId ?? "editorial")).size !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["designs"], message: "A presentation must use one coherent theme." });
    }
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
      const approved = designSet.images?.assets.find((asset) => asset.id === design.imageAssetId && asset.approvedForSlideId === design.slideId);
      const required = designSet.images?.decisions.find((decision) => decision.slideId === design.slideId)?.required;
      if ((design.imageAssetId && !approved) || (required && !design.imageAssetId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["designs", index], message: "The selected design must honor its exact image approval and required visual." });
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
    openingBridge: z.string().min(1).max(3_000).describe("Audience-heard opening or bridge, spoken verbatim."),
    segments: z.array(z.string().min(1).max(4_000)).min(1).max(30).describe("Consecutive spoken paragraphs, never authoring or delivery instructions. Every item is read aloud verbatim."),
    transitionOut: z.string().min(1).max(3_000).describe("Audience-heard transition or closing, spoken verbatim."),
    // Read compatibility only. New writers do not generate unused delivery cues.
    pausePrompts: z.array(z.string().min(1).max(1_000)).max(20).optional(),
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

export const PublicationReviewSchema = z.discriminatedUnion("targetStage", [
  ResearchReviewResultSchema,
  ReviewResultSchema.extend({
    targetStage: z.enum([
      "outline-review", "slide-review", "narration-review", "publication-review",
    ]),
  }),
]);

const PublishablePresentationObjectSchema = GenerationArtifactIdentitySchema.extend({
  request: PresentationRequestArtifactSchema,
  classification: PromptClassificationSchema,
  researchPlan: ResearchPlanSchema,
  researchBundle: ResearchBundleManifestSchema,
  evidenceSet: EvidenceSetSchema,
  factBank: FactBankSchema.refine((bank) => bank.facts.length > 0 && !("sufficientForDeck" in bank && !bank.sufficientForDeck), {
    message: "Publication requires nonempty facts without a historical insufficiency verdict.",
    path: ["facts"],
  }),
  strategy: DeckStrategySchema,
  slidePlans: SlidePlanSetSchema,
  designs: SlideDesignSpecSetSchema,
  slides: SlideDraftSetSchema,
  narrations: NarrationScriptSetSchema,
  reviews: z.array(PublicationReviewSchema).min(1),
  publishedAt: z.string().datetime(),
}).strict();

type PublishablePresentationCandidate = z.infer<
  typeof PublishablePresentationObjectSchema
>;
type IssuePath = Array<string | number>;

const addContractIssue = (
  context: z.RefinementCtx,
  message: string,
  path: IssuePath,
): void => {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path });
};

const sameIdSet = (actual: string[], expected: string[]): boolean =>
  actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  actual.every((id) => expected.includes(id));

const expectKnownIds = (
  context: z.RefinementCtx,
  actual: string[],
  known: Set<string>,
  path: IssuePath,
  message: string,
): void => {
  actual.forEach((id, index) => {
    if (!known.has(id)) {
      addContractIssue(context, message, [...path, index]);
    }
  });
};

const validateArtifactChain = (
  presentation: PublishablePresentationCandidate,
  context: z.RefinementCtx,
): string[] => {
  const contentArtifactIds = [
    presentation.request.artifactId,
    presentation.classification.artifactId,
    presentation.researchPlan.artifactId,
    presentation.researchBundle.artifactId,
    presentation.evidenceSet.artifactId,
    presentation.factBank.artifactId,
    presentation.strategy.artifactId,
    presentation.slidePlans.artifactId,
    presentation.designs.artifactId,
    presentation.slides.artifactId,
    presentation.narrations.artifactId,
  ];
  const allArtifactIds = [
    presentation.artifactId,
    ...contentArtifactIds,
    ...presentation.reviews.map((review) => review.artifactId),
  ];
  if (new Set(allArtifactIds).size !== allArtifactIds.length) {
    addContractIssue(
      context,
      "Published presentation artifact ids must be globally unique.",
      [],
    );
  }

  const references: Array<{
    actual: string;
    expected: string;
    path: IssuePath;
    message: string;
  }> = [
    {
      actual: presentation.researchBundle.researchPlanArtifactId,
      expected: presentation.researchPlan.artifactId,
      path: ["researchBundle", "researchPlanArtifactId"],
      message: "Acquisition must reference the included research plan.",
    },
    {
      actual: presentation.evidenceSet.researchBundleArtifactId,
      expected: presentation.researchBundle.artifactId,
      path: ["evidenceSet", "researchBundleArtifactId"],
      message: "Evidence must reference the included acquisition manifest.",
    },
    {
      actual: presentation.classification.requestArtifactId,
      expected: presentation.request.artifactId,
      path: ["classification", "requestArtifactId"],
      message: "Classification must reference the included request artifact.",
    },
    {
      actual: presentation.researchPlan.requestArtifactId,
      expected: presentation.request.artifactId,
      path: ["researchPlan", "requestArtifactId"],
      message: "Research plan must reference the included request artifact.",
    },
    {
      actual: presentation.researchPlan.classificationArtifactId,
      expected: presentation.classification.artifactId,
      path: ["researchPlan", "classificationArtifactId"],
      message: "Research plan must reference the included classification artifact.",
    },
    {
      actual: presentation.evidenceSet.researchPlanArtifactId,
      expected: presentation.researchPlan.artifactId,
      path: ["evidenceSet", "researchPlanArtifactId"],
      message: "Evidence set must reference the included research plan artifact.",
    },
    {
      actual: presentation.factBank.classificationArtifactId,
      expected: presentation.classification.artifactId,
      path: ["factBank", "classificationArtifactId"],
      message: "Fact bank must reference the included classification artifact.",
    },
    {
      actual: presentation.factBank.evidenceSetArtifactId,
      expected: presentation.evidenceSet.artifactId,
      path: ["factBank", "evidenceSetArtifactId"],
      message: "Fact bank must reference the included evidence set artifact.",
    },
    {
      actual: presentation.strategy.classificationArtifactId,
      expected: presentation.classification.artifactId,
      path: ["strategy", "classificationArtifactId"],
      message: "Deck strategy must reference the included classification artifact.",
    },
    {
      actual: presentation.strategy.factBankArtifactId,
      expected: presentation.factBank.artifactId,
      path: ["strategy", "factBankArtifactId"],
      message: "Deck strategy must reference the included fact bank artifact.",
    },
    {
      actual: presentation.slidePlans.deckStrategyArtifactId,
      expected: presentation.strategy.artifactId,
      path: ["slidePlans", "deckStrategyArtifactId"],
      message: "Slide plans must reference the included deck strategy artifact.",
    },
    {
      actual: presentation.slidePlans.factBankArtifactId,
      expected: presentation.factBank.artifactId,
      path: ["slidePlans", "factBankArtifactId"],
      message: "Slide plans must reference the included fact bank artifact.",
    },
    {
      actual: presentation.designs.deckStrategyArtifactId,
      expected: presentation.strategy.artifactId,
      path: ["designs", "deckStrategyArtifactId"],
      message: "Design specs must reference the included deck strategy artifact.",
    },
    {
      actual: presentation.designs.slidePlanSetArtifactId,
      expected: presentation.slidePlans.artifactId,
      path: ["designs", "slidePlanSetArtifactId"],
      message: "Design specs must reference the included slide plan artifact.",
    },
    {
      actual: presentation.slides.deckStrategyArtifactId,
      expected: presentation.strategy.artifactId,
      path: ["slides", "deckStrategyArtifactId"],
      message: "Slide drafts must reference the included deck strategy artifact.",
    },
    {
      actual: presentation.slides.slidePlanSetArtifactId,
      expected: presentation.slidePlans.artifactId,
      path: ["slides", "slidePlanSetArtifactId"],
      message: "Slide drafts must reference the included slide plan artifact.",
    },
    {
      actual: presentation.slides.slideDesignSpecSetArtifactId,
      expected: presentation.designs.artifactId,
      path: ["slides", "slideDesignSpecSetArtifactId"],
      message: "Slide drafts must reference the included design artifact.",
    },
    {
      actual: presentation.narrations.deckStrategyArtifactId,
      expected: presentation.strategy.artifactId,
      path: ["narrations", "deckStrategyArtifactId"],
      message: "Narrations must reference the included deck strategy artifact.",
    },
    {
      actual: presentation.narrations.slideDraftSetArtifactId,
      expected: presentation.slides.artifactId,
      path: ["narrations", "slideDraftSetArtifactId"],
      message: "Narrations must reference the included slide draft artifact.",
    },
  ];
  references.forEach(({ actual, expected, path, message }) => {
    if (actual !== expected) {
      addContractIssue(context, message, path);
    }
  });

  if (presentation.classification.originalPrompt !== presentation.request.request.topic) {
    addContractIssue(
      context,
      "Classification must preserve the exact captured request topic.",
      ["classification", "originalPrompt"],
    );
  }
  const requestedUrls = presentation.classification.requestedSources.map((source) => source.url);
  const allowedUrls = new Set([...presentation.request.explicitUrls, ...(presentation.request.sourceCandidates ?? []).map(candidate => candidate.url)]);
  if (new Set(requestedUrls).size !== requestedUrls.length ||
      presentation.request.explicitUrls.some(url => !requestedUrls.includes(url)) ||
      requestedUrls.some(url => !allowedUrls.has(url))) {
    addContractIssue(
      context,
      "Classification must preserve explicit URLs and may add only captured source candidates.",
      ["classification", "requestedSources"],
    );
  }
  return contentArtifactIds;
};

const validateResearchLineage = (
  presentation: PublishablePresentationCandidate,
  context: z.RefinementCtx,
): { factIds: Set<string>; sourceIds: Set<string> } => {
  if (!sameIdSet(
    presentation.researchBundle.targetOutcomes.map((outcome) => outcome.targetId),
    presentation.researchPlan.sourceTargets.map((target) => target.id),
  )) {
    addContractIssue(context, "Acquisition must record every exact planned target.", ["researchBundle", "targetOutcomes"]);
  }
  const acquiredSources = new Map(presentation.researchBundle.sources.map((source) => [source.id, source]));
  const acquiredPages = new Map(presentation.researchBundle.pages.map((page) => [page.id, page]));
  presentation.evidenceSet.sources.forEach((source, index) => {
    if (acquiredSources.get(source.id)?.url !== source.url) {
      addContractIssue(context, "Selected evidence sources must match the acquired source identity and URL.", ["evidenceSet", "sources", index]);
    }
  });
  presentation.evidenceSet.snippets.forEach((snippet, index) => {
    const page = acquiredPages.get(snippet.pageId);
    if (!page || page.sourceId !== snippet.sourceId || page.url !== snippet.pageUrl) {
      addContractIssue(context, "Selected snippets must reference the acquired page and its source.", ["evidenceSet", "snippets", index]);
    }
  });
  const requestedCoverageIds = new Set(
    presentation.classification.requestedCoverage.map((item) => item.id),
  );
  const requestedSourceIds = new Set(
    presentation.classification.requestedSources.map((item) => item.id),
  );
  presentation.researchPlan.researchQuestions.forEach((question, index) => {
    expectKnownIds(
      context,
      question.coverageRequirementIds,
      requestedCoverageIds,
      ["researchPlan", "researchQuestions", index, "coverageRequirementIds"],
      "Research questions may reference only captured coverage requirements.",
    );
  });
  presentation.researchPlan.evidenceRequirements.forEach(
    (requirement, index) => {
      expectKnownIds(
        context,
        requirement.coverageRequirementIds,
        requestedCoverageIds,
        [
          "researchPlan",
          "evidenceRequirements",
          index,
          "coverageRequirementIds",
        ],
        "Evidence requirements may reference only captured coverage requirements.",
      );
    },
  );
  presentation.researchPlan.sourceTargets.forEach((target, index) => {
    if (
      target.kind === "explicit-url" &&
      !requestedSourceIds.has(target.requestedSourceId)
    ) {
      addContractIssue(
        context,
        "Explicit research targets must reference a captured requested source.",
        ["researchPlan", "sourceTargets", index, "requestedSourceId"],
      );
    }
  });

  const evidenceRequirementIds = new Set(
    presentation.researchPlan.evidenceRequirements.map((item) => item.id),
  );
  presentation.evidenceSet.selectionCoverage?.forEach((coverage, index) => {
    if (!evidenceRequirementIds.has(coverage.evidenceRequirementId)) {
      addContractIssue(
        context,
        "Evidence selection may reference only requirements from the included research plan.",
        ["evidenceSet", "selectionCoverage", index, "evidenceRequirementId"],
      );
    }
  });

  const sourceIds = new Set(
    presentation.evidenceSet.sources.map((source) => source.id),
  );
  const snippetById = new Map(
    presentation.evidenceSet.snippets.map((snippet) => [snippet.id, snippet]),
  );
  const snippetIds = new Set(snippetById.keys());
  const factIds = new Set(presentation.factBank.facts.map((fact) => fact.id));
  presentation.factBank.facts.forEach((fact, index) => {
    expectKnownIds(
      context,
      fact.evidenceRequirementIds,
      evidenceRequirementIds,
      ["factBank", "facts", index, "evidenceRequirementIds"],
      "Facts may reference only requirements from the included research plan.",
    );
    if (fact.origin === "source") {
      expectKnownIds(
        context,
        fact.sourceIds,
        sourceIds,
        ["factBank", "facts", index, "sourceIds"],
        "Source facts may reference only sources from the included evidence set.",
      );
      expectKnownIds(
        context,
        fact.evidenceSnippetIds,
        snippetIds,
        ["factBank", "facts", index, "evidenceSnippetIds"],
        "Source facts may reference only snippets from the included evidence set.",
      );
      const snippetSourceIds = [
        ...new Set(
          fact.evidenceSnippetIds
            .map((snippetId) => snippetById.get(snippetId)?.sourceId)
            .filter((sourceId): sourceId is string => sourceId !== undefined),
        ),
      ];
      if (!sameIdSet(fact.sourceIds, snippetSourceIds)) {
        addContractIssue(
          context,
          "Source fact provenance must match the sources of its evidence snippets.",
          ["factBank", "facts", index, "sourceIds"],
        );
      }
    }
  });
  if ("uncertainties" in presentation.factBank) {
    presentation.factBank.uncertainties.forEach((uncertainty, index) => {
      expectKnownIds(context, uncertainty.evidenceSnippetIds, snippetIds,
        ["factBank", "uncertainties", index, "evidenceSnippetIds"],
        "Uncertainties may reference only included evidence snippets.");
      expectKnownIds(context, uncertainty.evidenceRequirementIds, evidenceRequirementIds,
        ["factBank", "uncertainties", index, "evidenceRequirementIds"],
        "Uncertainties may reference only included evidence requirements.");
    });
  } else {
    presentation.factBank.sourceSummaries.forEach((summary, index) => {
      if (!sourceIds.has(summary.sourceId)) {
        addContractIssue(
          context,
          "Source summaries may reference only included evidence sources.",
          ["factBank", "sourceSummaries", index, "sourceId"],
        );
      }
    });
    presentation.factBank.sourceQuality.forEach((quality, index) => {
      if (!sourceIds.has(quality.sourceId)) {
        addContractIssue(
          context,
          "Source quality assessments may reference only included evidence sources.",
          ["factBank", "sourceQuality", index, "sourceId"],
        );
      }
    });
    presentation.factBank.missingFacts.forEach((missingFact, index) => {
      if (
        missingFact.evidenceRequirementId !== null &&
        !evidenceRequirementIds.has(missingFact.evidenceRequirementId)
      ) {
        addContractIssue(
          context,
          "Missing facts may reference only requirements from the included research plan.",
          ["factBank", "missingFacts", index, "evidenceRequirementId"],
        );
      }
    });
  }
  return { factIds, sourceIds };
};

const validateSlideLineage = (
  presentation: PublishablePresentationCandidate,
  context: z.RefinementCtx,
  factIds: Set<string>,
  sourceIds: Set<string>,
): Set<string> => {
  const expectedSlideIds = presentation.slidePlans.slides.map(
    (slide) => slide.slideId,
  );
  const orderedSlideIdSets = [
    {
      ids: presentation.designs.designs.map((design) => design.slideId),
      path: ["designs", "designs"] as IssuePath,
      message: "Design specs must match the ordered slide plan ids.",
    },
    {
      ids: presentation.slides.slides.map((slide) => slide.slideId),
      path: ["slides", "slides"] as IssuePath,
      message: "Slide drafts must match the ordered slide plan ids.",
    },
    {
      ids: presentation.narrations.scripts.map((script) => script.slideId),
      path: ["narrations", "scripts"] as IssuePath,
      message: "Narration scripts must match the ordered slide plan ids.",
    },
  ];
  orderedSlideIdSets.forEach(({ ids, path, message }) => {
    if (
      ids.length !== expectedSlideIds.length ||
      !ids.every((slideId, index) => slideId === expectedSlideIds[index])
    ) {
      addContractIssue(context, message, path);
    }
  });
  if (presentation.strategy.slideCount !== presentation.slidePlans.slides.length) {
    addContractIssue(
      context,
      "Deck strategy slide count must match the included slide plans.",
      ["strategy", "slideCount"],
    );
  }

  presentation.slidePlans.slides.forEach((plan, index) => {
    const factReferences: Array<{ ids: string[]; path: IssuePath }> = [
      { ids: plan.allowedFactIds, path: ["allowedFactIds"] },
      { ids: plan.requiredFactIds, path: ["requiredFactIds"] },
      { ids: plan.overlapPolicy.factIds, path: ["overlapPolicy", "factIds"] },
    ];
    factReferences.forEach(({ ids, path }) => {
      expectKnownIds(
        context,
        ids,
        factIds,
        ["slidePlans", "slides", index, ...path],
        "Slide plans may reference only facts from the included fact bank.",
      );
    });
    const allowedFactIds = new Set(plan.allowedFactIds);
    expectKnownIds(
      context,
      plan.requiredFactIds,
      allowedFactIds,
      ["slidePlans", "slides", index, "requiredFactIds"],
      "Required slide facts must also be allowed on that slide.",
    );
    if (plan.role !== presentation.strategy.storyArc[index]?.role) {
      addContractIssue(context, "Slide plans must preserve the strategy's roles.", ["slidePlans", "slides", index, "role"]);
    }
  });

  presentation.slides.slides.forEach((slide, index) => {
    expectKnownIds(
      context,
      slide.usedFactIds,
      factIds,
      ["slides", "slides", index, "usedFactIds"],
      "Slide drafts may use only facts from the included fact bank.",
    );
    slide.sourceAttributions.forEach((attribution, attributionIndex) => {
      const source = presentation.evidenceSet.sources.find(
        (item) => item.id === attribution.sourceId,
      );
      if (!source) {
        addContractIssue(
          context,
          "Slide source attributions must reference an included evidence source.",
          [
            "slides",
            "slides",
            index,
            "sourceAttributions",
            attributionIndex,
            "sourceId",
          ],
        );
      } else if (attribution.url !== undefined && attribution.url !== source.url) {
        addContractIssue(
          context,
          "Slide attribution URLs must match the referenced evidence source.",
          [
            "slides",
            "slides",
            index,
            "sourceAttributions",
            attributionIndex,
            "url",
          ],
        );
      }
    });

    const plan = presentation.slidePlans.slides[index];
    if (plan !== undefined) {
      const usedFactIds = new Set(slide.usedFactIds);
      expectKnownIds(
        context,
        slide.usedFactIds,
        new Set(plan.allowedFactIds),
        ["slides", "slides", index, "usedFactIds"],
        "Slide drafts may use only facts allocated to their slide plan.",
      );
      plan.requiredFactIds.forEach((factId) => {
        if (!usedFactIds.has(factId)) {
          addContractIssue(
            context,
            "Slide drafts must use every fact required by their slide plan.",
            ["slides", "slides", index, "usedFactIds"],
          );
        }
      });
    }
  });
  presentation.narrations.scripts.forEach((script, index) => {
    expectKnownIds(
      context,
      script.sourceMentions,
      sourceIds,
      ["narrations", "scripts", index, "sourceMentions"],
      "Narration source mentions must reference included evidence sources.",
    );
  });
  return new Set(expectedSlideIds);
};

const validatePublicationReviews = (
  presentation: PublishablePresentationCandidate,
  context: z.RefinementCtx,
  contentArtifactIds: string[],
  factIds: Set<string>,
  slideIds: Set<string>,
): void => {
  const knownArtifactIds = new Set(contentArtifactIds);
  const requiredReviews = new Map<string, string[]>([
    [
      "research-review",
      [
        presentation.researchPlan.artifactId,
        presentation.researchBundle.artifactId,
        presentation.evidenceSet.artifactId,
        presentation.factBank.artifactId,
      ],
    ],
    [
      "outline-review",
      [presentation.strategy.artifactId, presentation.slidePlans.artifactId],
    ],
    [
      "slide-review",
      [presentation.designs.artifactId, presentation.slides.artifactId],
    ],
    [
      "narration-review",
      [presentation.slides.artifactId, presentation.narrations.artifactId],
    ],
    ["publication-review", contentArtifactIds],
  ]);

  presentation.reviews.forEach((review, reviewIndex) => {
    if (!review.approved) {
      addContractIssue(
        context,
        "Every review included in a publishable presentation must be approved.",
        ["reviews", reviewIndex, "approved"],
      );
    }
    if (
      review.retryRecommended ||
      review.issues.some((issue) => issue.severity === "error")
    ) {
      addContractIssue(
        context,
        "A publication approval cannot contain blocking errors or request a retry.",
        ["reviews", reviewIndex],
      );
    }
    if (review.targetStage === "research-review") {
      const requirements = presentation.researchPlan.evidenceRequirements;
      const assessments = review.requirementAssessments;
      if (
        !sameIdSet(
          assessments.map((assessment) => assessment.evidenceRequirementId),
          requirements.map((requirement) => requirement.id),
        )
      ) {
        addContractIssue(
          context,
          "Research review must assess every exact evidence requirement once.",
          ["reviews", reviewIndex, "requirementAssessments"],
        );
      }
      assessments.forEach((assessment, assessmentIndex) => {
        if (assessment.status !== "unsupported") {
          return;
        }
        const path = ["reviews", reviewIndex, "requirementAssessments", assessmentIndex];
        if (
          requirements.some((requirement) =>
            requirement.id === assessment.evidenceRequirementId && requirement.required,
          )
        ) {
          addContractIssue(
            context, "Required research evidence must be approved before publication.", path,
          );
        }
        if (!review.targetArtifactIds.includes(assessment.artifactId)) {
          addContractIssue(
            context,
            "Assessments must reference reviewed research artifacts.",
            [...path, "artifactId"],
          );
        }
        expectKnownIds(
          context, assessment.factIds, factIds, [...path, "factIds"],
          "Assessments must reference facts in the included fact bank.",
        );
      });
    }
    expectKnownIds(
      context,
      review.targetArtifactIds,
      knownArtifactIds,
      ["reviews", reviewIndex, "targetArtifactIds"],
      "Reviews may target only artifacts included in the presentation.",
    );
    review.issues.forEach((issue, issueIndex) => {
      if (
        issue.artifactId !== undefined &&
        !knownArtifactIds.has(issue.artifactId)
      ) {
        addContractIssue(
          context,
          "Review issues may reference only artifacts included in the presentation.",
          ["reviews", reviewIndex, "issues", issueIndex, "artifactId"],
        );
      }
      if (issue.slideId !== undefined && !slideIds.has(issue.slideId)) {
        addContractIssue(
          context,
          "Review issues may reference only slides included in the presentation.",
          ["reviews", reviewIndex, "issues", issueIndex, "slideId"],
        );
      }
      expectKnownIds(
        context,
        issue.factIds,
        factIds,
        ["reviews", reviewIndex, "issues", issueIndex, "factIds"],
        "Review issues may reference only facts from the included fact bank.",
      );
    });
  });

  requiredReviews.forEach((targetArtifactIds, targetStage) => {
    const matchingReview = presentation.reviews.some(
      (review) =>
        review.targetStage === targetStage &&
        review.approved &&
        sameIdSet(review.targetArtifactIds, targetArtifactIds),
    );
    if (!matchingReview) {
      addContractIssue(
        context,
        `Publishable presentations require an approved ${targetStage} for its exact artifact set.`,
        ["reviews"],
      );
    }
  });
};

export const PublishablePresentationSchema =
  PublishablePresentationObjectSchema.superRefine((presentation, context) => {
    const contentArtifactIds = validateArtifactChain(presentation, context);
    const { factIds, sourceIds } = validateResearchLineage(
      presentation,
      context,
    );
    const slideIds = validateSlideLineage(
      presentation,
      context,
      factIds,
      sourceIds,
    );
    validatePublicationReviews(
      presentation,
      context,
      contentArtifactIds,
      factIds,
      slideIds,
    );
  });

export type PublishablePresentation = z.infer<
  typeof PublishablePresentationSchema
>;
