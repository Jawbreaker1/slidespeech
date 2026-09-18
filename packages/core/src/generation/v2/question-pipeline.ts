import { z } from "zod";
import { narrationPassages, PresentationQuestionSchema, QuestionClassificationSchema, QuestionAnswerDecisionSchema, QuestionReviewDecisionSchema, GroundedAnswerSchema, ReviewResultSchema, PresentationQuestionResponseSchema } from "@slidespeech/types";
import type { GenerationV2QuestionAgentProvider, QuestionMaterial, PresentationQuestion, QuestionAgentInput, GenerationTraceRecorder, GenerationStageName, GenerationStageProgressListener, GenerationAgentCall } from "@slidespeech/types";
import { createGenerationArtifactIdentity } from "./artifact-factory";
import { executeGenerationStage } from "./stage-runner";

export class PresentationQuestionPipeline {
  constructor(private readonly agent: GenerationV2QuestionAgentProvider, private readonly recorder: GenerationTraceRecorder) {}

  async answer(presentation: QuestionMaterial & { artifactId: string }, rawQuestion: PresentationQuestion, options: { signal?: AbortSignal; onProgress?: GenerationStageProgressListener } = {}) {
    const question = PresentationQuestionSchema.parse(rawQuestion);
    if (question.slideIndex >= presentation.slides.slides.length) throw new RangeError("Question refers to an unavailable slide.");
    const script = presentation.narrations.scripts[question.slideIndex];
    if (!script || !narrationPassages(script)[question.passageIndex]) throw new RangeError("Question refers to an unavailable narration passage.");
    const identity = createGenerationArtifactIdentity("question_answer");
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    const run = async <T>(name: GenerationStageName, schema: z.ZodType<T>, execute: (signal: AbortSignal) => Promise<GenerationAgentCall<T>>): Promise<T> => {
      const result = await executeGenerationStage({
        definition: { name, parseArtifact: (value) => schema.parse(value), execute: async (_, context) => {
          const call = await execute(context.signal);
          return { status: "succeeded", artifact: call.value, telemetry: call.telemetry };
        } }, input: null, context: { runId: identity.artifactId, attempt: 1, inputArtifactIds: [presentation.artifactId], sourceIds: presentation.evidenceSet.sources.map((source) => source.id) },
        recorder: this.recorder, signal, deadlineMs: 60_000, ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      });
      signal.throwIfAborted();
      if (result.status !== "succeeded") throw new Error(result.errors[0]?.message ?? "Question processing failed.");
      return result.artifact;
    };
    const { request, classification, factBank, evidenceSet, slides, narrations } = presentation;
    const input: QuestionAgentInput = { question, material: { request, classification, factBank, evidenceSet, slides, narrations }, followUpResearchAvailable: false };
    const scope = await run("qa-classification", QuestionClassificationSchema, (signal) => this.agent.classifyQuestion(input, { signal }));
    // Context is the unchanged published material, not heuristic snippet ranking.
    const context = { ...input, classification: scope };
    const candidateSchema = QuestionAnswerDecisionSchema.superRefine((value, ctx) => {
      if (value.factIndexes.some((index) => index >= factBank.facts.length) || value.sourceIndexes.some((index) => index >= evidenceSet.sources.length)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Answer references unavailable evidence." });
      }
      if (value.groundingKind === "follow-up-research" || (value.groundingKind === "model-knowledge" && !factBank.modelKnowledgeAllowed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Answer uses an unavailable grounding capability." });
      }
      if ((scope.evidence === "needs-research" && scope.relevance === "relevant" && value.kind !== "insufficient-evidence") || (scope.relevance !== "relevant" && value.kind !== scope.relevance)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Answer disposition contradicts the question classification." });
      }
    });
    const candidate = await run("qa-answer", candidateSchema, (signal) => this.agent.answerQuestion(context, { signal }));
    const decision = await run("qa-review", QuestionReviewDecisionSchema, async (signal) => {
      const call = await this.agent.reviewAnswer({ ...context, candidate }, { signal });
      const review = QuestionReviewDecisionSchema.parse(call.value);
      if (!review.approved || review.issues.some((issue) => issue.severity === "error")) throw new Error(`Answer was not approved: ${review.summary}`);
      return call;
    });
    const sourceIds = [...new Set(candidate.sourceIndexes.map((index) => evidenceSet.sources[index]!.id))];
    const answer = GroundedAnswerSchema.parse({ ...identity, question: question.text, answer: candidate.answer, groundingKind: candidate.groundingKind,
      factIds: [...new Set(candidate.factIndexes.map((index) => factBank.facts[index]!.id))], sourceIds, confidence: candidate.confidence, limitations: candidate.limitations });
    const review = ReviewResultSchema.parse({ ...createGenerationArtifactIdentity("answer_review"), targetStage: "qa-review", targetArtifactIds: [answer.artifactId], approved: decision.approved, score: decision.score, summary: decision.summary, retryRecommended: false,
      issues: decision.issues.map((issue) => ({ ...issue, code: "answer_review", dimension: "grounding", factIds: [] })) });
    return PresentationQuestionResponseSchema.parse({ presentationId: presentation.artifactId, kind: candidate.kind, answer, review,
      resume: { slideIndex: question.slideIndex, passageIndex: question.passageIndex, playbackSeconds: 0, bridgeText: candidate.bridgeText },
      sources: evidenceSet.sources.filter((source) => sourceIds.includes(source.id)).map((source) => ({ id: source.id, title: source.title, url: source.url })),
    });
  }
}
