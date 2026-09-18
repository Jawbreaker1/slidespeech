import { z } from "zod";

import { GenerationArtifactIdSchema } from "./common";
import {
  ReviewDecisionSchema,
  ReviewResultSchema,
} from "./review";

const SupportedRequirementReviewSchema = z
  .object({
    status: z.literal("supported"),
    rationale: z.string().min(1).max(3_000),
  })
  .strict();

const UnsupportedRequirementReviewSchema = z
  .object({
    status: z.literal("unsupported"),
    rationale: z.string().min(1).max(3_000),
    targetArtifactIndex: z.number().int().min(0).max(3),
    factIndexes: z.array(z.number().int().nonnegative()).max(100),
    retryInstruction: z.string().min(1).max(3_000),
  })
  .strict();

export const ResearchRequirementReviewDecisionSchema = z.discriminatedUnion(
  "status",
  [SupportedRequirementReviewSchema, UnsupportedRequirementReviewSchema],
);

const ResearchReviewDecisionObjectSchema = ReviewDecisionSchema.extend({
  requirementAssessments: z.record(
    GenerationArtifactIdSchema,
    ResearchRequirementReviewDecisionSchema,
  ),
}).strict();

export const ResearchReviewDecisionSchema =
  ResearchReviewDecisionObjectSchema;

export const createResearchReviewDecisionSchema = (
  evidenceRequirementIds: string[],
) =>
  ReviewDecisionSchema.extend({
    requirementAssessments: z
      .object(
        Object.fromEntries(
          evidenceRequirementIds.map((id) => [
            id,
            ResearchRequirementReviewDecisionSchema,
          ]),
        ),
      )
      .strict(),
  }).strict();

export type ResearchReviewDecision = z.infer<
  typeof ResearchReviewDecisionSchema
>;

export const ResearchRequirementReviewAssessmentSchema = z.discriminatedUnion(
  "status",
  [
    SupportedRequirementReviewSchema.extend({
      evidenceRequirementId: GenerationArtifactIdSchema,
    }).strict(),
    UnsupportedRequirementReviewSchema.omit({
      targetArtifactIndex: true,
      factIndexes: true,
    })
      .extend({
        evidenceRequirementId: GenerationArtifactIdSchema,
        artifactId: GenerationArtifactIdSchema,
        factIds: z.array(GenerationArtifactIdSchema).max(100),
      })
      .strict(),
  ],
);

export const ResearchReviewResultSchema = ReviewResultSchema.extend({
  targetStage: z.literal("research-review"),
  requirementAssessments: z
    .array(ResearchRequirementReviewAssessmentSchema)
    .max(500),
}).strict();

export type ResearchReviewResult = z.infer<
  typeof ResearchReviewResultSchema
>;
