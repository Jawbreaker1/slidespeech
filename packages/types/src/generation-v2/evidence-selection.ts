import { z } from "zod";

export const EvidenceSegmentCandidateSchema = z
  .object({
    key: z.string().min(1).max(100),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    text: z.string().min(1).max(10_000),
  })
  .strict();

export type EvidenceSegmentCandidate = z.infer<
  typeof EvidenceSegmentCandidateSchema
>;

const EvidenceSegmentAssessmentSchema = z.object({
  status: z.enum(["selected", "discarded"]),
  rationale: z.string().min(1).max(2_000),
}).strict();

export const EvidenceSelectionDecisionSchema = z
  .object({
    segmentAssessments: z.record(
      z.string().min(1),
      EvidenceSegmentAssessmentSchema,
    ),
    observations: z.array(z.string().min(1).max(2_000)).max(50),
  })
  .strict();

export type EvidenceSelectionDecision = z.infer<
  typeof EvidenceSelectionDecisionSchema
>;

export const createEvidenceSelectionDecisionSchema = (bounds: {
  segmentKeys: string[];
}) => {
  return z
    .object({
      segmentAssessments: z
        .object(
          Object.fromEntries(
            bounds.segmentKeys.map((key) => [key, EvidenceSegmentAssessmentSchema]),
          ),
        )
        .strict(),
      observations: z.array(z.string().min(1).max(2_000)).max(50),
    })
    .strict();
};
