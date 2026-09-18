import { z } from "zod";

export const ResearchSourceCandidateSchema = z
  .object({
    url: z.string().url(),
    title: z.string().min(1).max(2_000),
    context: z.string().min(1).max(5_000),
    origin: z.enum(["search-result", "discovered-link"]),
    discoveredFromUrl: z.string().url().nullable(),
  })
  .strict();

export type ResearchSourceCandidate = z.infer<
  typeof ResearchSourceCandidateSchema
>;

const SelectedResearchSourceCandidateSchema = z
  .object({
    candidateIndex: z.number().int().nonnegative(),
    rationale: z.string().min(1).max(2_000),
    priority: z.number().int().nonnegative(),
  })
  .strict();

const ResearchSourceSelectionDecisionObjectSchema = z
  .object({
    canUseCandidates: z.boolean(),
    blockingReason: z.string().min(1).max(2_000).nullable(),
    selectedCandidates: z
      .array(SelectedResearchSourceCandidateSchema)
      .max(20),
  })
  .strict();

const validateSelectionDecision = (
  decision: z.infer<typeof ResearchSourceSelectionDecisionObjectSchema>,
  context: z.RefinementCtx,
): void => {
  if (decision.canUseCandidates && decision.selectedCandidates.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A usable candidate set must select at least one candidate.",
      path: ["selectedCandidates"],
    });
  }
  if (!decision.canUseCandidates && decision.blockingReason === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An unusable candidate set must explain why.",
      path: ["blockingReason"],
    });
  }
  if (!decision.canUseCandidates && decision.selectedCandidates.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An unusable candidate set cannot select candidates.",
      path: ["selectedCandidates"],
    });
  }
};

export const ResearchSourceSelectionDecisionSchema =
  ResearchSourceSelectionDecisionObjectSchema.superRefine(validateSelectionDecision);

export const createResearchSourceSelectionDecisionSchema = (bounds: {
  candidateCount: number;
  maximumSelections: number;
}) => {
  if (
    !Number.isInteger(bounds.candidateCount) || bounds.candidateCount < 0 ||
    !Number.isInteger(bounds.maximumSelections) || bounds.maximumSelections < 0
  ) {
    throw new Error("Source selection bounds must be nonnegative integers.");
  }
  return ResearchSourceSelectionDecisionObjectSchema.extend({
    selectedCandidates: z.array(
      SelectedResearchSourceCandidateSchema.extend({
        candidateIndex: z.number().int().min(0)
          .max(Math.max(0, bounds.candidateCount - 1)),
      }),
    ).max(Math.min(20, bounds.candidateCount, bounds.maximumSelections)),
  }).superRefine(validateSelectionDecision);
};

export type ResearchSourceSelectionDecision = z.infer<
  typeof ResearchSourceSelectionDecisionSchema
>;
