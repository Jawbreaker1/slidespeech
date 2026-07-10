import { z } from "zod";

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

export const PromptClassificationSchema = GenerationArtifactIdentitySchema.extend({
  originalPrompt: z.string().min(1).max(20_000),
  subject: z.string().min(1).max(500),
  language: z.string().min(2).max(40),
  audience: z.string().min(1).max(500),
  presentationGoal: z.string().min(1).max(1_000),
  deckMode: DeckModeSchema,
  groundingMode: GroundingModeSchema,
  requestedSources: z.array(z.string().min(1).max(2_000)).max(30),
  requestedCoverage: z.array(z.string().min(1).max(1_000)).max(50),
  requestedSlideCount: z.number().int().positive().max(100).optional(),
  requestedDurationMinutes: z.number().positive().max(480).optional(),
  visualPreference: z.string().min(1).max(1_000).optional(),
  voicePreference: z.string().min(1).max(1_000).optional(),
  confidence: z.number().min(0).max(1),
  openQuestions: z.array(z.string().min(1).max(1_000)).max(30),
}).strict();

export type PromptClassification = z.infer<typeof PromptClassificationSchema>;

export const ResearchQuestionSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    question: z.string().min(1).max(2_000),
    coverageRequirementIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

export const RequiredFactSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    description: z.string().min(1).max(2_000),
    required: z.boolean(),
    researchQuestionIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

const SourceTargetBaseSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    purpose: z.string().min(1).max(2_000),
    priority: z.number().int().nonnegative(),
    researchQuestionIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

export const ResearchSourceTargetSchema = z.discriminatedUnion("kind", [
  SourceTargetBaseSchema.extend({
    kind: z.literal("explicit-url"),
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

export const ResearchStopCriteriaSchema = z
  .object({
    maximumSources: z.number().int().positive().max(100),
    maximumPagesPerDomain: z.number().int().nonnegative().max(20),
    minimumSupportedFacts: z.number().int().nonnegative().max(500),
    requiredFactIds: z.array(GenerationArtifactIdSchema),
    stopWhenRequiredFactsCovered: z.boolean(),
  })
  .strict();

export const ResearchPlanSchema = GenerationArtifactIdentitySchema.extend({
  classificationArtifactId: GenerationArtifactIdSchema,
  requiresResearch: z.boolean(),
  researchQuestions: z.array(ResearchQuestionSchema).max(100),
  requiredFacts: z.array(RequiredFactSchema).max(200),
  sourceTargets: z.array(ResearchSourceTargetSchema).max(100),
  sameDomainDepth: z.number().int().nonnegative().max(10),
  searchQueries: z.array(z.string().min(1).max(1_000)).max(100),
  sourcePriority: z.array(GenerationArtifactIdSchema).max(100),
  stopCriteria: ResearchStopCriteriaSchema,
  knownRiskAreas: z.array(z.string().min(1).max(2_000)).max(100),
}).strict();

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export const ResearchSourceSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    origin: z.enum(["explicit-url", "same-domain-search", "web-search"]),
    url: z.string().url(),
    title: z.string().min(1).max(2_000),
    fetchedAt: z.string().datetime(),
    status: z.enum(["fetched", "partial", "failed"]),
  })
  .strict();

export const ResearchPageSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    sourceId: GenerationArtifactIdSchema,
    url: z.string().url(),
    title: z.string().min(1).max(2_000),
    content: z.string().max(500_000),
    language: z.string().min(2).max(40).optional(),
  })
  .strict();

export const ResearchSnippetSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    sourceId: GenerationArtifactIdSchema,
    pageId: GenerationArtifactIdSchema.optional(),
    text: z.string().min(1).max(20_000),
    location: z.string().min(1).max(1_000).optional(),
  })
  .strict();

export const ResearchFetchErrorSchema = z
  .object({
    targetId: GenerationArtifactIdSchema,
    url: z.string().url().optional(),
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();

export const ResearchSourceMetadataSchema = z
  .object({
    sourceId: GenerationArtifactIdSchema,
    contentType: z.string().min(1).max(255).optional(),
    publishedAt: z.string().datetime().optional(),
    author: z.string().min(1).max(500).optional(),
    retrievedBy: z.string().min(1).max(255),
  })
  .strict();

export const RawTextSampleSchema = z
  .object({
    sourceId: GenerationArtifactIdSchema,
    text: z.string().min(1).max(50_000),
  })
  .strict();

export const ResearchBundleSchema = GenerationArtifactIdentitySchema.extend({
  researchPlanArtifactId: GenerationArtifactIdSchema,
  sources: z.array(ResearchSourceSchema).max(200),
  pages: z.array(ResearchPageSchema).max(500),
  snippets: z.array(ResearchSnippetSchema).max(2_000),
  fetchErrors: z.array(ResearchFetchErrorSchema).max(500),
  sourceMetadata: z.array(ResearchSourceMetadataSchema).max(500),
  rawTextSamples: z.array(RawTextSampleSchema).max(500),
}).strict();

export type ResearchBundle = z.infer<typeof ResearchBundleSchema>;

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

export const CuratedFactSchema = z
  .object({
    id: GenerationArtifactIdSchema,
    claim: z.string().min(1).max(5_000),
    origin: z.enum(["source", "model-knowledge"]),
    sourceIds: z.array(GenerationArtifactIdSchema).max(20),
    evidenceExcerpt: z.string().min(1).max(20_000),
    role: FactRoleSchema,
    confidence: z.number().min(0).max(1),
    language: z.string().min(2).max(40),
    allowedUse: FactAllowedUseSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.origin === "source" && fact.sourceIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source-grounded facts require at least one source id.",
        path: ["sourceIds"],
      });
    }
    if (fact.origin === "model-knowledge" && fact.sourceIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model-knowledge facts must not claim source provenance.",
        path: ["sourceIds"],
      });
    }
  });

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
    requiredFactId: GenerationArtifactIdSchema.optional(),
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

export const FactBankSchema = GenerationArtifactIdentitySchema.extend({
  classificationArtifactId: GenerationArtifactIdSchema,
  researchBundleArtifactId: GenerationArtifactIdSchema.optional(),
  facts: z.array(CuratedFactSchema).max(1_000),
  sourceSummaries: z.array(SourceSummarySchema).max(500),
  sourceQuality: z.array(SourceQualitySchema).max(500),
  missingFacts: z.array(MissingFactSchema).max(500),
  contradictions: z.array(FactContradictionSchema).max(500),
  modelKnowledgeAllowed: z.boolean(),
})
  .strict()
  .superRefine((factBank, context) => {
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
  });

export type FactBank = z.infer<typeof FactBankSchema>;
