import { z } from "zod";
import { GenerationArtifactIdSchema } from "./common";
import { GroundedAnswerSchema, PresentationResumePlanV2Schema } from "./runtime";
import { ReviewResultSchema } from "./review";
import type { PublishablePresentation } from "./presentation";
import type { GenerationAgentCall, GenerationAgentCallOptions } from "./agent-provider";

export const PresentationQuestionSchema = z.object({
  text: z.string().trim().min(1).max(5_000),
  slideIndex: z.number().int().nonnegative(),
  passageIndex: z.number().int().nonnegative(),
  playbackSeconds: z.number().finite().nonnegative(),
}).strict();
export type PresentationQuestion = z.infer<typeof PresentationQuestionSchema>;

export const QuestionClassificationSchema = z.object({
  relevance: z.enum(["relevant", "off-topic", "needs-clarification"]),
  evidence: z.enum(["sufficient", "needs-research"]),
  rationale: z.string().min(1).max(2_000),
  missingInformation: z.array(z.string().min(1).max(1_000)).max(20),
}).strict();
export type QuestionClassificationV2 = z.infer<typeof QuestionClassificationSchema>;

export const QuestionAnswerDecisionSchema = z.object({
  kind: z.enum(["answered", "off-topic", "needs-clarification", "insufficient-evidence"]),
  answer: z.string().min(1).max(10_000),
  groundingKind: GroundedAnswerSchema.shape.groundingKind,
  factIndexes: z.array(z.number().int().nonnegative()).max(100),
  sourceIndexes: z.array(z.number().int().nonnegative()).max(100),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(1).max(2_000)).max(30),
  bridgeText: z.string().min(1).max(2_000),
}).strict();
export type QuestionAnswerDecision = z.infer<typeof QuestionAnswerDecisionSchema>;

export type QuestionMaterial = Pick<PublishablePresentation, "request" | "classification" | "factBank" | "evidenceSet" | "slides" | "narrations">;
export type QuestionAgentInput = {
  question: PresentationQuestion;
  material: QuestionMaterial;
  followUpResearchAvailable: false;
};
export type QuestionAnswerInput = QuestionAgentInput & { classification: QuestionClassificationV2 };
export type QuestionReviewInput = QuestionAnswerInput & { candidate: QuestionAnswerDecision };

export const QuestionReviewDecisionSchema = z.object({
  approved: z.boolean(),
  score: z.number().min(0).max(1),
  summary: z.string().min(1).max(3_000),
  issues: z.array(z.object({ severity: z.enum(["info", "warning", "error"]), message: z.string().min(1).max(2_000) }).strict()).max(30),
}).strict();
export type QuestionReviewDecision = z.infer<typeof QuestionReviewDecisionSchema>;

export interface GenerationV2QuestionAgentProvider {
  classifyQuestion(input: QuestionAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<QuestionClassificationV2>>;
  answerQuestion(input: QuestionAnswerInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<QuestionAnswerDecision>>;
  reviewAnswer(input: QuestionReviewInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<QuestionReviewDecision>>;
}

export const PresentationQuestionResponseSchema = z.object({
  presentationId: GenerationArtifactIdSchema,
  kind: QuestionAnswerDecisionSchema.shape.kind,
  answer: GroundedAnswerSchema,
  review: ReviewResultSchema,
  resume: PresentationResumePlanV2Schema,
  sources: z.array(z.object({ id: GenerationArtifactIdSchema, title: z.string(), url: z.string().url() }).strict()),
}).strict().superRefine((value, context) => {
  if (!value.review.approved || value.review.retryRecommended || value.review.issues.some((issue) => issue.severity === "error") || value.review.targetStage !== "qa-review" || value.review.targetArtifactIds.length !== 1 || value.review.targetArtifactIds[0] !== value.answer.artifactId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A question response requires explicit approval of this exact answer." });
  }
});
export type PresentationQuestionResponse = z.infer<typeof PresentationQuestionResponseSchema>;

export const QuestionProgressSchema = z.object({
  stage: z.enum(["waiting", "qa-classification", "qa-answer", "qa-review"]),
  status: z.enum(["started", "succeeded"]),
  occurredAt: z.string().datetime(),
}).strict();
export type QuestionProgress = z.infer<typeof QuestionProgressSchema>;

export const QuestionStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), progress: QuestionProgressSchema }).strict(),
  z.object({ type: z.literal("result"), result: PresentationQuestionResponseSchema }).strict(),
  z.object({ type: z.literal("error"), error: z.string().min(1) }).strict(),
]);
export type QuestionStreamEvent = z.infer<typeof QuestionStreamEventSchema>;
