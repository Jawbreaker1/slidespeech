import { z } from "zod";
import { ResearchImageDiscoverySchema } from "./research-images";

import { GeneratePresentationRequestSchema } from "../domain";
import {
  DeckModeSchema,
  GenerationArtifactIdSchema,
  GenerationArtifactIdentitySchema,
} from "./common";

export const GroundingModeSchema = z.enum([
  "explicit-sources",
  "web-research",
  "model-knowledge",
  "mixed",
]);

export type GroundingMode = z.infer<typeof GroundingModeSchema>;

export const PresentationRequestArtifactSchema =
  GenerationArtifactIdentitySchema.extend({
    request: GeneratePresentationRequestSchema,
    explicitUrls: z.array(z.string().url()).max(30),
    sourceCandidates: z.array(z.object({ text: z.string().min(1), url: z.string().url() }).strict()).max(30).optional(),
  }).strict();

export type PresentationRequestArtifact = z.infer<
  typeof PresentationRequestArtifactSchema
>;

export const RequestedSourceSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    url: z.string().url(),
    purpose: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const RequestedCoverageDecisionSchema = z
  .object({
    description: z.string().min(1).max(1_000),
    required: z.boolean(),
  })
  .strict();

export const RequestedCoverageRequirementSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    description: z.string().min(1).max(1_000),
    required: z.boolean(),
  })
  .strict();

const PromptClassificationDecisionObjectSchema = z
  .object({
    subject: z.string().min(1).max(500),
    language: z.string().min(2).max(40),
    audience: z.string().min(1).max(500),
    presentationGoal: z.string().min(1).max(1_000),
    deckMode: DeckModeSchema,
    groundingMode: GroundingModeSchema,
    sourceCandidateIndexes: z.array(z.number().int().nonnegative()).max(30).optional(),
    requestedCoverage: z.array(RequestedCoverageDecisionSchema).max(50),
    presentationDirections: z.array(z.string().min(1).max(2_000)).max(50),
    requestedSlideCount: z.number().int().positive().max(100).nullable(),
    requestedDurationMinutes: z.number().positive().max(480).nullable(),
    visualPreference: z.string().min(1).max(1_000).nullable(),
    voicePreference: z.string().min(1).max(1_000).nullable(),
    openQuestions: z.array(z.string().min(1).max(1_000)).max(30),
    requiresUserClarification: z.boolean(),
    clarificationReason: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

const validateClarificationDecision = (
  classification: z.infer<typeof PromptClassificationDecisionObjectSchema>,
  context: z.RefinementCtx,
): void => {
  if (
    classification.requiresUserClarification &&
    classification.clarificationReason === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A classification requiring clarification must explain why.",
      path: ["clarificationReason"],
    });
  }
};

export const PromptClassificationDecisionSchema =
  PromptClassificationDecisionObjectSchema.superRefine(
    validateClarificationDecision,
  );

export const createPromptClassificationDecisionSchema = (candidateCount: number, sourcePolicy?: {
  explicitSourceCount: number;
  useWebResearch?: boolean | undefined;
}) =>
  PromptClassificationDecisionObjectSchema.extend({
    sourceCandidateIndexes: z.array(z.number().int().min(0).max(Math.max(0, candidateCount - 1))).max(candidateCount),
  }).superRefine((decision, context) => {
    validateClarificationDecision(decision, context);
    if (!sourcePolicy || decision.requiresUserClarification) return;
    const hasSources = sourcePolicy.explicitSourceCount + decision.sourceCandidateIndexes.length > 0;
    const mode = decision.groundingMode;
    if ((hasSources && mode !== "explicit-sources" && mode !== "mixed") ||
        (!hasSources && mode === "explicit-sources") ||
        (sourcePolicy.useWebResearch === true && mode !== "web-research" && mode !== "mixed") ||
        (sourcePolicy.useWebResearch === false && (mode === "web-research" || mode === "mixed"))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["groundingMode"],
        message: `Grounding mode must account for ${sourcePolicy.explicitSourceCount} explicit URLs, ${decision.sourceCandidateIndexes.length} selected source candidates, and useWebResearch=${sourcePolicy.useWebResearch ?? "unspecified"}. Selected candidates count as requested sources; use explicit-sources or mixed when sources are present, respecting the web-research control.` });
    }
  });

export type PromptClassificationDecision = z.infer<
  typeof PromptClassificationDecisionSchema
>;

const PromptClassificationContentObjectSchema = z
  .object({
    originalPrompt: z.string().min(1).max(20_000),
    subject: z.string().min(1).max(500),
    language: z.string().min(2).max(40),
    audience: z.string().min(1).max(500),
    presentationGoal: z.string().min(1).max(1_000),
    deckMode: DeckModeSchema,
    groundingMode: GroundingModeSchema,
    requestedSources: z.array(RequestedSourceSchema).max(30),
    requestedCoverage: z
      .array(RequestedCoverageRequirementSchema)
      .max(50),
    presentationDirections: z.array(z.string().min(1).max(2_000)).max(50),
    requestedSlideCount: z.number().int().positive().max(100).optional(),
    requestedDurationMinutes: z.number().positive().max(480).optional(),
    visualPreference: z.string().min(1).max(1_000).optional(),
    voicePreference: z.string().min(1).max(1_000).optional(),
    openQuestions: z.array(z.string().min(1).max(1_000)).max(30),
    requiresUserClarification: z.boolean(),
    clarificationReason: z.string().min(1).max(2_000).nullable(),
  })
  .strict();

const validatePromptClassificationContent = (
  classification: z.infer<typeof PromptClassificationContentObjectSchema>,
  context: z.RefinementCtx,
): void => {
  const ids = [
    ...classification.requestedSources.map((source) => source.id),
    ...classification.requestedCoverage.map((coverage) => coverage.id),
  ];
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Requested source and coverage ids must be unique.",
      path: ["requestedCoverage"],
    });
  }
  if (
    classification.requiresUserClarification &&
    classification.clarificationReason === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A classification requiring clarification must explain why.",
      path: ["clarificationReason"],
    });
  }
};

export const PromptClassificationContentSchema =
  PromptClassificationContentObjectSchema.superRefine(
    validatePromptClassificationContent,
  );

export const PromptClassificationSchema = GenerationArtifactIdentitySchema.extend(
  {
    requestArtifactId: GenerationArtifactIdSchema,
    ...PromptClassificationContentObjectSchema.shape,
  },
)
  .strict()
  .superRefine(validatePromptClassificationContent);

export type PromptClassification = z.infer<typeof PromptClassificationSchema>;
export type PromptClassificationContent = z.infer<
  typeof PromptClassificationContentSchema
>;

const ResearchEvidenceRequirementDecisionSchema = z
  .object({
    description: z.string().min(1).max(2_000),
    required: z.boolean(),
  })
  .strict();

export const ResearchQuestionDecisionSchema = z
  .object({
    question: z.string().min(1).max(2_000),
    coverageRequirementIndexes: z.array(z.number().int().nonnegative()),
    evidenceRequirements: z
      .array(ResearchEvidenceRequirementDecisionSchema)
      .max(50),
  })
  .strict();

export const ResearchQuestionSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    question: z.string().min(1).max(2_000),
    coverageRequirementIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

export const EvidenceRequirementSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    description: z.string().min(1).max(2_000),
    required: z.boolean(),
    coverageRequirementIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

const SourceTargetDecisionBaseSchema = z
  .object({
    purpose: z.string().min(1).max(2_000),
    priority: z.number().int().nonnegative(),
  })
  .strict();

export const ResearchSourceTargetDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    SourceTargetDecisionBaseSchema.extend({
      kind: z.literal("explicit-url"),
      requestedSourceIndex: z.number().int().nonnegative(),
    }).strict(),
    SourceTargetDecisionBaseSchema.extend({
      kind: z.literal("same-domain-search"),
      domain: z.string().min(1).max(255),
      query: z.string().min(1).max(1_000),
    }).strict(),
    SourceTargetDecisionBaseSchema.extend({
      kind: z.literal("web-search"),
      query: z.string().min(1).max(1_000),
    }).strict(),
    SourceTargetDecisionBaseSchema.extend({
      kind: z.literal("model-knowledge"),
      scope: z.string().min(1).max(2_000),
    }).strict(),
  ],
);

const SourceTargetBaseSchema = SourceTargetDecisionBaseSchema.extend({
  id: GenerationArtifactIdSchema,
}).strict();

export const ResearchSourceTargetSchema = z.discriminatedUnion("kind", [
  SourceTargetBaseSchema.extend({
    kind: z.literal("explicit-url"),
    requestedSourceId: GenerationArtifactIdSchema,
    url: z.string().url(),
  }).strict(),
  SourceTargetBaseSchema.extend({
    kind: z.literal("same-domain-search"),
    domain: z.string().min(1).max(255),
    query: z.string().min(1).max(1_000),
  }).strict(),
  SourceTargetBaseSchema.extend({
    kind: z.literal("web-search"),
    query: z.string().min(1).max(1_000),
  }).strict(),
  SourceTargetBaseSchema.extend({
    kind: z.literal("model-knowledge"),
    scope: z.string().min(1).max(2_000),
  }).strict(),
]);

export type ResearchSourceTarget = z.infer<
  typeof ResearchSourceTargetSchema
>;

export const ResearchStopCriteriaSchema = z
  .object({
    maximumSources: z.number().int().positive().max(100),
    maximumPagesPerDomain: z.number().int().positive().max(20),
  })
  .strict();

const ResearchPlanDecisionObjectSchema = z
  .object({
    canExecute: z.boolean(),
    blockingReason: z.string().min(1).max(2_000).nullable(),
    requiresExternalResearch: z.boolean(),
    researchQuestions: z.array(ResearchQuestionDecisionSchema).max(100),
    sourceTargets: z.array(ResearchSourceTargetDecisionSchema).max(100),
    knownRiskAreas: z.array(z.string().min(1).max(2_000)).max(100),
  })
  .strict();

const validateExecutableResearchPlan = (
  plan: { canExecute: boolean; blockingReason: string | null },
  context: z.RefinementCtx,
): void => {
  if (!plan.canExecute && plan.blockingReason === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A non-executable research plan must explain why.",
      path: ["blockingReason"],
    });
  }
};

export const ResearchPlanDecisionSchema =
  ResearchPlanDecisionObjectSchema.superRefine(validateExecutableResearchPlan);

export type ResearchPlanDecision = z.infer<typeof ResearchPlanDecisionSchema>;

const ResearchPlanContentObjectSchema = z
  .object({
    canExecute: z.boolean(),
    blockingReason: z.string().min(1).max(2_000).nullable(),
    requiresExternalResearch: z.boolean(),
    researchQuestions: z.array(ResearchQuestionSchema).max(100),
    evidenceRequirements: z.array(EvidenceRequirementSchema).max(200),
    sourceTargets: z.array(ResearchSourceTargetSchema).max(100),
    stopCriteria: ResearchStopCriteriaSchema,
    knownRiskAreas: z.array(z.string().min(1).max(2_000)).max(100),
  })
  .strict();

const validateResearchPlanContent = (
  plan: z.infer<typeof ResearchPlanContentObjectSchema>,
  context: z.RefinementCtx,
): void => {
  validateExecutableResearchPlan(plan, context);
  const ids = [
    ...plan.researchQuestions.map((item) => item.id),
    ...plan.evidenceRequirements.map((item) => item.id),
    ...plan.sourceTargets.map((item) => item.id),
  ];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Research plan entity ids must be unique.",
      path: [],
    });
  }
};

export const ResearchPlanContentSchema =
  ResearchPlanContentObjectSchema.superRefine(validateResearchPlanContent);

export const ResearchPlanSchema = GenerationArtifactIdentitySchema.extend({
  requestArtifactId: GenerationArtifactIdSchema,
  classificationArtifactId: GenerationArtifactIdSchema,
  ...ResearchPlanContentObjectSchema.shape,
})
  .strict()
  .superRefine(validateResearchPlanContent);

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchPlanContent = z.infer<typeof ResearchPlanContentSchema>;

export const ResearchSourceSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    targetId: GenerationArtifactIdSchema,
    origin: z.enum(["explicit-url", "same-domain-search", "web-search"]),
    url: z.string().url(),
    title: z.string().min(1).max(2_000),
    fetchedAt: z.string().datetime(),
    status: z.enum(["fetched", "partial", "failed"]),
    retrievedBy: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255).optional(),
    publishedAt: z.string().datetime().optional(),
    author: z.string().min(1).max(500).optional(),
  })
  .strict();

export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ResearchPageSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    sourceId: GenerationArtifactIdSchema,
    url: z.string().url(),
    title: z.string().min(1).max(2_000),
    content: z.string().min(1).max(500_000),
    contentFormat: z.enum(["rendered-layout", "html-blocks", "text"]).optional(),
    imageDiscovery: ResearchImageDiscoverySchema.optional(),
    language: z.string().min(2).max(40).optional(),
  })
  .strict();

export const ResearchFetchErrorSchema = z
  .object({
    targetId: GenerationArtifactIdSchema,
    sourceId: GenerationArtifactIdSchema.optional(),
    url: z.string().url().optional(),
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();

export type ResearchFetchError = z.infer<typeof ResearchFetchErrorSchema>;

export const ResearchTargetAcquisitionSchema = z.object({
  targetId: GenerationArtifactIdSchema,
  attemptedUrls: z.array(z.string().url()).max(200),
  detail: z.string().min(1).max(2_000).optional(),
  stopReason: z.enum([
    "not-started", "not-required", "explicit-attempted", "already-attempted",
    "global-budget", "domain-budget", "round-limit", "no-candidates",
    "agent-rejected", "invalid-selection",
  ]),
}).strict();

const ResearchBundleContentObjectSchema = z
  .object({
    sources: z.array(ResearchSourceSchema).max(200),
    pages: z.array(ResearchPageSchema).max(500),
    fetchErrors: z.array(ResearchFetchErrorSchema).max(500),
    targetOutcomes: z.array(ResearchTargetAcquisitionSchema).max(100),
  })
  .strict();

const validateResearchBundleContent = (
  bundle: {
    sources: ResearchSource[];
    pages: Array<{ id: string; sourceId: string }>;
    targetOutcomes: Array<z.infer<typeof ResearchTargetAcquisitionSchema>>;
  },
  context: z.RefinementCtx,
): void => {
    const sourceIds = new Set(bundle.sources.map((source) => source.id));
    const pageIds = new Set(bundle.pages.map((page) => page.id));
    const targetIds = new Set(bundle.targetOutcomes.map((outcome) => outcome.targetId));
    if (targetIds.size !== bundle.targetOutcomes.length) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        message: "Acquisition outcomes must have unique target ids.", path: ["targetOutcomes"] });
    }
    bundle.sources.forEach((source, index) => {
      if (!targetIds.has(source.targetId)) {
        context.addIssue({ code: z.ZodIssueCode.custom,
          message: "Acquired sources must reference a recorded target outcome.",
          path: ["sources", index, "targetId"] });
      }
    });

    if (sourceIds.size !== bundle.sources.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Research source ids must be unique.",
        path: ["sources"],
      });
    }
    if (pageIds.size !== bundle.pages.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Research page ids must be unique.",
        path: ["pages"],
      });
    }

    bundle.pages.forEach((page, pageIndex) => {
      if (!sourceIds.has(page.sourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Research pages must reference a source in the same bundle.",
          path: ["pages", pageIndex, "sourceId"],
        });
      }
    });

  };

export const ResearchBundleContentSchema =
  ResearchBundleContentObjectSchema.superRefine(validateResearchBundleContent);

export const ResearchBundleSchema = GenerationArtifactIdentitySchema.extend({
  researchPlanArtifactId: GenerationArtifactIdSchema,
  ...ResearchBundleContentObjectSchema.shape,
})
  .strict()
  .superRefine(validateResearchBundleContent);

export type ResearchBundle = z.infer<typeof ResearchBundleSchema>;
export type ResearchBundleContent = z.infer<typeof ResearchBundleContentSchema>;

// A structural view of the same bundle identity, not a generated source summary.
export const ResearchBundleManifestSchema = GenerationArtifactIdentitySchema.extend({
  researchPlanArtifactId: GenerationArtifactIdSchema,
  ...ResearchBundleContentObjectSchema.shape,
  pages: z.array(ResearchPageSchema.omit({ content: true, imageDiscovery: true }).extend({
    contentCharacters: z.number().int().positive(),
  })).max(500),
}).strict().superRefine(validateResearchBundleContent);

export type ResearchBundleManifest = z.infer<typeof ResearchBundleManifestSchema>;

export const EvidenceSourceSchema = ResearchSourceSchema.pick({
  id: true,
  url: true,
  title: true,
  fetchedAt: true,
  retrievedBy: true,
  contentType: true,
  publishedAt: true,
  author: true,
}).strict();

export const EvidenceSnippetSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    sourceId: GenerationArtifactIdSchema,
    pageId: GenerationArtifactIdSchema,
    pageUrl: z.string().url(),
    pageTitle: z.string().min(1).max(2_000),
    text: z.string().min(1).max(20_000),
    contentFormat: z.enum(["rendered-layout", "html-blocks", "text"]).optional(),
    location: z.string().min(1).max(1_000).optional(),
  })
  .strict();

export type EvidenceSnippet = z.infer<typeof EvidenceSnippetSchema>;

export const EvidenceSelectionCoverageSchema = z
  .object({
    evidenceRequirementId: GenerationArtifactIdSchema,
    snippetIds: z.array(GenerationArtifactIdSchema).max(200),
  })
  .strict();

const EvidenceSetContentObjectSchema = z
  .object({
    sources: z.array(EvidenceSourceSchema).max(200),
    snippets: z.array(EvidenceSnippetSchema).max(2_000),
    // Historical publications retain this field; new selection does not author it.
    selectionCoverage: z.array(EvidenceSelectionCoverageSchema).max(200).optional(),
  })
  .strict();

const validateEvidenceSetContent = (
  evidenceSet: z.infer<typeof EvidenceSetContentObjectSchema>,
  context: z.RefinementCtx,
): void => {
  const sourceIds = new Set(evidenceSet.sources.map((source) => source.id));
  const snippetIds = new Set(evidenceSet.snippets.map((snippet) => snippet.id));

  if (sourceIds.size !== evidenceSet.sources.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence source ids must be unique.",
      path: ["sources"],
    });
  }
  if (snippetIds.size !== evidenceSet.snippets.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence snippet ids must be unique.",
      path: ["snippets"],
    });
  }

  evidenceSet.snippets.forEach((snippet, snippetIndex) => {
    if (!sourceIds.has(snippet.sourceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence snippets must reference a source in the same set.",
        path: ["snippets", snippetIndex, "sourceId"],
      });
    }
  });

  const coveredRequirementIds = new Set<string>();
  evidenceSet.selectionCoverage?.forEach((coverage, coverageIndex) => {
    if (coveredRequirementIds.has(coverage.evidenceRequirementId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence requirements may appear only once in selection coverage.",
        path: ["selectionCoverage", coverageIndex, "evidenceRequirementId"],
      });
    }
    coveredRequirementIds.add(coverage.evidenceRequirementId);
    coverage.snippetIds.forEach((snippetId, snippetIndex) => {
      if (!snippetIds.has(snippetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selection coverage may reference only snippets in the same evidence set.",
          path: ["selectionCoverage", coverageIndex, "snippetIds", snippetIndex],
        });
      }
    });
  });
};

export const EvidenceSetContentSchema =
  EvidenceSetContentObjectSchema.superRefine(validateEvidenceSetContent);

export const EvidenceSetSchema = GenerationArtifactIdentitySchema.extend({
  researchPlanArtifactId: GenerationArtifactIdSchema,
  researchBundleArtifactId: GenerationArtifactIdSchema,
  ...EvidenceSetContentObjectSchema.shape,
})
  .strict()
  .superRefine(validateEvidenceSetContent);

export type EvidenceSet = z.infer<typeof EvidenceSetSchema>;
export type EvidenceSetContent = z.infer<typeof EvidenceSetContentSchema>;

export const FactRoleSchema = z.enum([
  "identity",
  "timeline",
  "background",
  "mechanism",
  "capability",
  "operation",
  "example",
  "value",
  "risk",
  "comparison",
  "quote",
  "other",
]);

export const FactAllowedUseSchema = z.enum([
  "visible-slide",
  "narration-only",
  "qa-only",
  "context-only",
]);

const SemanticFactBaseSchema = z
  .object({
    claim: z.string().min(1).max(5_000),
    role: FactRoleSchema,
    language: z.string().min(2).max(40),
  })
  .strict();

const factReferenceIds = (minimum: number, availableIds?: string[]) =>
  z.array(
    availableIds?.length
      ? z.enum(availableIds as [string, ...string[]])
      : GenerationArtifactIdSchema,
  )
    .min(minimum)
    .max(Math.min(20, availableIds?.length ?? 20))
    .superRefine((ids, context) => {
      const seen = new Set<string>();
      ids.forEach((id, index) => {
        if (seen.has(id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Fact references must be unique.",
            path: [index],
          });
        }
        seen.add(id);
      });
    });

const AgentSemanticFactBaseSchema = SemanticFactBaseSchema.extend({
  evidenceRequirementIds: factReferenceIds(0),
}).strict();

export const AgentCuratedFactSchema = z.discriminatedUnion("origin", [
  AgentSemanticFactBaseSchema.extend({
    origin: z.literal("source"),
    evidenceSnippetIds: factReferenceIds(1),
  }).strict(),
  AgentSemanticFactBaseSchema.extend({
    origin: z.literal("model-knowledge"),
    knowledgeBasis: z.string().min(1).max(2_000),
  }).strict(),
]);

export type AgentCuratedFact = z.infer<typeof AgentCuratedFactSchema>;

const CuratedFactBaseSchema = SemanticFactBaseSchema.extend({
  id: GenerationArtifactIdSchema,
  // Read compatibility for immutable older artifacts, not a new authoring decision.
  allowedUse: FactAllowedUseSchema.optional(),
}).strict();

export const CuratedFactSchema = z.discriminatedUnion("origin", [
  CuratedFactBaseSchema.extend({
    origin: z.literal("source"),
    sourceIds: z.array(GenerationArtifactIdSchema).min(1).max(20),
    evidenceSnippetIds: z.array(GenerationArtifactIdSchema).min(1).max(20),
    evidenceRequirementIds: z.array(GenerationArtifactIdSchema).max(20),
  }).strict(),
  CuratedFactBaseSchema.extend({
    origin: z.literal("model-knowledge"),
    knowledgeBasis: z.string().min(1).max(2_000),
    evidenceRequirementIds: z.array(GenerationArtifactIdSchema).max(20),
  }).strict(),
]);

export const SourceSummarySchema = z
  .object({
    sourceId: GenerationArtifactIdSchema,
    summary: z.string().min(1).max(10_000),
  })
  .strict();

export const SourceQualitySchema = z
  .object({
    sourceId: GenerationArtifactIdSchema,
    quality: z.enum(["high", "medium", "low", "unusable"]),
    rationale: z.string().min(1).max(2_000),
  })
  .strict();

export const MissingFactSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    evidenceRequirementId: GenerationArtifactIdSchema.nullable(),
    description: z.string().min(1).max(2_000),
    impact: z.enum(["blocking", "limiting", "minor"]),
  })
  .strict();

export const FactContradictionSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    factIds: z.array(GenerationArtifactIdSchema).min(2),
    description: z.string().min(1).max(5_000),
    material: z.boolean(),
  })
  .strict();

// Read-only contract for immutable publications created before ownership changed.
const LegacyFactBankContentObjectSchema = z
  .object({
    facts: z.array(CuratedFactSchema).max(1_000),
    sourceSummaries: z.array(SourceSummarySchema).max(500),
    sourceQuality: z.array(SourceQualitySchema).max(500),
    missingFacts: z.array(MissingFactSchema).max(500),
    contradictions: z.array(FactContradictionSchema).max(500),
    modelKnowledgeAllowed: z.boolean(),
    sufficientForDeck: z.boolean(),
    blockingReasons: z.array(z.string().min(1).max(2_000)).max(50),
  })
  .strict();

const FactBankDecisionObjectSchema = z
  .object({
    facts: z.array(AgentCuratedFactSchema).max(1_000),
    uncertainties: z.array(z.object({
      description: z.string().min(1).max(2_000),
      evidenceSnippetIds: factReferenceIds(0),
      evidenceRequirementIds: factReferenceIds(0),
    }).strict()).max(500),
  })
  .strict();

export const FactBankDecisionSchema = FactBankDecisionObjectSchema;

export const createFactBankDecisionSchema = (bounds: {
  evidenceSnippetIds: string[];
  evidenceRequirementIds: string[];
}) => {
  const agentFactBaseSchema = SemanticFactBaseSchema.extend({
    evidenceRequirementIds: factReferenceIds(0, bounds.evidenceRequirementIds),
  }).strict();
  const modelKnowledgeFactSchema = agentFactBaseSchema.extend({
    origin: z.literal("model-knowledge"),
    knowledgeBasis: z.string().min(1).max(2_000),
  }).strict();
  const factSchema = bounds.evidenceSnippetIds.length === 0
    ? modelKnowledgeFactSchema
    : z.discriminatedUnion("origin", [
        agentFactBaseSchema.extend({
          origin: z.literal("source"),
          evidenceSnippetIds: factReferenceIds(1, bounds.evidenceSnippetIds),
        }).strict(),
        modelKnowledgeFactSchema,
      ]);
  return FactBankDecisionObjectSchema.extend({
    facts: z.array(factSchema).max(1_000),
    uncertainties: z.array(FactBankDecisionObjectSchema.shape.uncertainties.element.extend({
      evidenceSnippetIds: factReferenceIds(0, bounds.evidenceSnippetIds),
      evidenceRequirementIds: factReferenceIds(0, bounds.evidenceRequirementIds),
    }).strict()).max(500),
  }).strict();
};

export type FactBankDecision = z.infer<typeof FactBankDecisionSchema>;

const FactBankContentObjectSchema = z.object({
  facts: z.array(CuratedFactSchema).max(1_000),
  uncertainties: FactBankDecisionObjectSchema.shape.uncertainties,
  modelKnowledgeAllowed: z.boolean(),
}).strict();

const validateFactBankContent = (
  factBank: z.infer<typeof FactBankContentObjectSchema> | z.infer<typeof LegacyFactBankContentObjectSchema>,
  context: z.RefinementCtx,
): void => {
  if ("sufficientForDeck" in factBank) {
    if (!factBank.sufficientForDeck && factBank.blockingReasons.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An insufficient fact bank must include blocking reasons.",
        path: ["blockingReasons"],
      });
    }
    if (factBank.sufficientForDeck && factBank.blockingReasons.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A sufficient fact bank cannot include blocking reasons.",
        path: ["blockingReasons"],
      });
    }
  }
  const factIds = new Set(factBank.facts.map((fact) => fact.id));
  if (factIds.size !== factBank.facts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Curated fact ids must be unique.",
      path: ["facts"],
    });
  }
  if (
    !factBank.modelKnowledgeAllowed &&
    factBank.facts.some((fact) => fact.origin === "model-knowledge")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fact bank contains model knowledge when it is not allowed.",
      path: ["facts"],
    });
  }
  if ("contradictions" in factBank) factBank.contradictions.forEach((contradiction, contradictionIndex) => {
    contradiction.factIds.forEach((factId, factIndex) => {
      if (!factIds.has(factId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Contradictions may reference only facts in the same bank.",
          path: [
            "contradictions",
            contradictionIndex,
            "factIds",
            factIndex,
          ],
        });
      }
    });
  });
};

export const FactBankContentSchema = z.union([
  FactBankContentObjectSchema,
  LegacyFactBankContentObjectSchema,
]).superRefine(validateFactBankContent);

const factBankIdentity = GenerationArtifactIdentitySchema.extend({
  classificationArtifactId: GenerationArtifactIdSchema,
  evidenceSetArtifactId: GenerationArtifactIdSchema,
});

export const CurrentFactBankSchema = factBankIdentity.extend(FactBankContentObjectSchema.shape)
  .strict().superRefine(validateFactBankContent);
export const FactBankSchema = z.union([
  CurrentFactBankSchema,
  factBankIdentity.extend(LegacyFactBankContentObjectSchema.shape)
    .strict().superRefine(validateFactBankContent),
]);

export type FactBank = z.infer<typeof FactBankSchema>;
export type FactBankContent = z.infer<typeof FactBankContentSchema>;
