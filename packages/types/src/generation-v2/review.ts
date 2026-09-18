import { z } from "zod";

import {
  GenerationArtifactIdSchema,
  GenerationArtifactIdentitySchema,
  GenerationStageNameSchema,
} from "./common";

export const ReviewIssueSchema = z
  .object({
    code: z.string().min(1).max(120),
    severity: z.enum(["info", "warning", "error"]),
    dimension: z.enum([
      "contract", "grounding", "role-fidelity", "repetition", "language",
      "renderer", "narration", "coherence", "publication",
    ]),
    message: z.string().min(1).max(3_000),
    artifactId: GenerationArtifactIdSchema.optional(),
    slideId: GenerationArtifactIdSchema.optional(),
    factIds: z.array(GenerationArtifactIdSchema),
    retryInstruction: z.string().min(1).max(3_000).optional(),
  })
  .strict();

export const ReviewIssueDecisionSchema = z
  .object({
    code: z.string().min(1).max(120),
    severity: z.enum(["info", "warning", "error"]),
    dimension: ReviewIssueSchema.shape.dimension,
    message: z.string().min(1).max(3_000),
    targetArtifactIndex: z.number().int().nonnegative().nullable(),
    slideIndex: z.number().int().nonnegative().nullable(),
    factIndexes: z.array(z.number().int().nonnegative()).max(100),
    retryInstruction: z.string().min(1).max(3_000).nullable(),
  })
  .strict();

export const ReviewDecisionSchema = z
  .object({
    approved: z.boolean(),
    score: z.number().min(0).max(1),
    summary: z.string().min(1).max(5_000),
    issues: z.array(ReviewIssueDecisionSchema).max(500),
    retryRecommended: z.boolean(),
  })
  .strict();

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

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
