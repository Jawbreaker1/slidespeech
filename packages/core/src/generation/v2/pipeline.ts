import type { DeckStrategy, SlidePlanSet, ReviewResult, GeneratePresentationRequest, GenerationV2OutlineAgentProvider } from "@slidespeech/types";
import { GenerationV2ResearchPipeline, DEFAULT_GENERATION_STAGE_DEADLINE_MS } from "./research-pipeline";
import type { GenerationV2ResearchPipelineConfig, GenerationV2ResearchPipelineStop, GenerationV2ResearchPipelineSuccess } from "./research-pipeline";
import { createOutlineStages } from "./outline-stages";
import { executeGenerationStage } from "./stage-runner";
import type { GenerationStageDefinition } from "./stage-runner";
import { createSlideStages, slideRevisionFromReview } from "./slide-stages";
import type { SlideRenderer, SlidePreview, SlideRevision } from "./slide-stages";
import type { GenerationV2SlideAgentProvider, SlideDesignSpecSet, GenerationSlideImageProvider } from "@slidespeech/types";
import { ReviewedNarrationSchema } from "@slidespeech/types";
import type { GenerationV2NarrationAgentProvider, ReviewedNarration, NarrationAgentInput } from "@slidespeech/types";
import { createNarrationStages } from "./narration-stages";
import { createPublicationStages } from "./publication-stages";
import { createResearchBundleManifest } from "./artifact-factory";
import { publicationArtifactIds, PublicationReviewSchema } from "@slidespeech/types";
import type { PublishablePresentation, GenerationV2PublicationAgentProvider, PublicationAgentInput } from "@slidespeech/types";
import { sequentialStageDeadlineMs } from "./execution-deadline";

export type GenerationV2OutlineSuccess = GenerationV2ResearchPipelineSuccess & {
  strategy: DeckStrategy; slidePlans: SlidePlanSet; outlineReview: ReviewResult;
};
export type GenerationV2OutlineResult = GenerationV2ResearchPipelineStop | GenerationV2OutlineSuccess;
export type GenerationV2PipelineSuccess = GenerationV2OutlineSuccess & SlidePreview & { designs: SlideDesignSpecSet; slideReview: ReviewResult };
export type GenerationV2PipelineResult = GenerationV2ResearchPipelineStop | GenerationV2PipelineSuccess;
export type GenerationV2NarrationSuccess = GenerationV2PipelineSuccess & { spokenPresentation: ReviewedNarration };
export type GenerationV2NarrationResult = GenerationV2ResearchPipelineStop | GenerationV2NarrationSuccess;
export type GenerationV2PublishedSuccess = GenerationV2NarrationSuccess & { publication: PublishablePresentation };
export type GenerationV2PublishedResult = GenerationV2ResearchPipelineStop | GenerationV2PublishedSuccess;
export type GenerationV2PipelineConfig = GenerationV2ResearchPipelineConfig & { agent: GenerationV2ResearchPipelineConfig["agent"] & GenerationV2OutlineAgentProvider };

// One product path, composing the existing research stage group without replaying it.
export class GenerationV2Pipeline {
  constructor(private readonly config: GenerationV2PipelineConfig) {}

  async plan(request: GeneratePresentationRequest, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2OutlineResult> {
    const research = await new GenerationV2ResearchPipeline(this.config).execute(request, options);
    if (research.status !== "succeeded") return research;
    return this.planOutline(research, options);
  }

  async execute(request: GeneratePresentationRequest, services: { agent: GenerationV2SlideAgentProvider; render: SlideRenderer; images?: GenerationSlideImageProvider }, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2PipelineResult> {
    const outline = await this.plan(request, options);
    if (outline.status !== "succeeded") return outline;
    return this.draftOutline(outline, services, options);
  }

  // Also used for controlled evaluation of recorded, approved upstream artifacts.
  async publishNarratedSlides(slides: GenerationV2NarrationSuccess, agent: GenerationV2PublicationAgentProvider, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2PublishedResult> {
    const input: PublicationAgentInput = { request: slides.request, classification: slides.classification,
      researchPlan: slides.researchPlan, researchBundle: createResearchBundleManifest(slides.researchBundle),
      evidenceSet: slides.evidenceSet, factBank: slides.factBank, strategy: slides.strategy, slidePlans: slides.slidePlans,
      designs: slides.designs, slides: slides.slides, narrations: slides.spokenPresentation.narrations,
      reviews: [slides.researchReview, slides.outlineReview, slides.slideReview, slides.spokenPresentation.review].map((review) => PublicationReviewSchema.parse(review)) };
    const stages = createPublicationStages(agent, this.config.artifactFactory);
    const run = <I, A>(definition: GenerationStageDefinition<I, A>, value: I, inputArtifactIds: string[]) => executeGenerationStage({
      definition, input: value, context: { runId: slides.runId, attempt: 1, inputArtifactIds, sourceIds: input.evidenceSet.sources.map((source) => source.id) },
      recorder: this.config.recorder, deadlineMs: this.config.stageDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS,
      signal: options.signal, onProgress: this.config.onProgress,
    });
    const ids = [...publicationArtifactIds(input), ...input.reviews.map((review) => review.artifactId)];
    const review = await run(stages.review, input, ids);
    if (review.status !== "succeeded") return { status: review.status, runId: slides.runId, stage: review.stage, diagnostics: review.errors };
    const publication = await run(stages.publication, { candidate: input, review: review.artifact }, [...ids, review.artifact.artifactId]);
    if (publication.status !== "succeeded") return { status: publication.status, runId: slides.runId, stage: publication.stage, diagnostics: publication.errors };
    return { ...slides, publication: publication.artifact };
  }

  async narrateSlides(slides: GenerationV2PipelineSuccess, agent: GenerationV2NarrationAgentProvider, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2NarrationResult> {
    const approved = (review: ReviewResult, stage: ReviewResult["targetStage"], targets: string[]) => review.approved && !review.retryRecommended
      && !review.issues.some((issue) => issue.severity === "error") && review.targetStage === stage
      && review.targetArtifactIds.length === targets.length && review.targetArtifactIds.every((id, index) => id === targets[index]);
    const orderedIds = slides.slidePlans.slides.map((slide) => slide.slideId);
    if (!approved(slides.slideReview, "slide-review", [slides.designs.artifactId, slides.slides.artifactId])
      || !approved(slides.outlineReview, "outline-review", [slides.strategy.artifactId, slides.slidePlans.artifactId])
      || !slides.researchReview.approved || slides.researchReview.retryRecommended || slides.researchReview.issues.some((issue) => issue.severity === "error")
      || slides.factBank.facts.length === 0 || ("sufficientForDeck" in slides.factBank && !slides.factBank.sufficientForDeck) || !slides.researchReview.targetArtifactIds.includes(slides.factBank.artifactId)
      || slides.strategy.factBankArtifactId !== slides.factBank.artifactId || slides.slidePlans.deckStrategyArtifactId !== slides.strategy.artifactId
      || slides.slidePlans.factBankArtifactId !== slides.factBank.artifactId || slides.slides.deckStrategyArtifactId !== slides.strategy.artifactId
      || slides.slides.slidePlanSetArtifactId !== slides.slidePlans.artifactId || slides.slides.slideDesignSpecSetArtifactId !== slides.designs.artifactId
      || slides.slides.slides.length !== orderedIds.length || slides.slides.slides.some((slide, index) => slide.slideId !== orderedIds[index])) {
      return { status: "rejected", runId: slides.runId, stage: "narration-generation", diagnostics: [{ code: "slides_not_ready", category: "contract",
        message: "Narration requires approved research, outline and these exact ordered slides.", retryable: false, artifactPath: [], sourceIds: [] }] };
    }
    const stages = createNarrationStages(agent, this.config.artifactFactory);
    const input: NarrationAgentInput = { request: slides.request, classification: slides.classification, factBank: slides.factBank,
      strategy: slides.strategy, slidePlans: slides.slidePlans, slides: slides.slides, sources: slides.evidenceSet.sources };
    const ids = [slides.request.artifactId, slides.classification.artifactId, slides.factBank.artifactId, slides.strategy.artifactId,
      slides.slidePlans.artifactId, slides.slides.artifactId, slides.slideReview.artifactId];
    let revision: NarrationAgentInput["revision"];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const run = <I, A>(definition: GenerationStageDefinition<I, A>, value: I, inputArtifactIds: string[]) => executeGenerationStage({
        definition, input: value, context: { runId: slides.runId, attempt, inputArtifactIds, sourceIds: input.sources.map((source) => source.id) },
        recorder: this.config.recorder, deadlineMs: this.config.stageDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS,
        signal: options.signal, onProgress: this.config.onProgress,
      });
      const writing = await run(stages.writing, { ...input, ...(revision ? { revision } : {}) },
        [...ids, ...(revision ? [revision.previous.artifactId, revision.feedback.artifactId] : [])]);
      if (writing.status !== "succeeded") return { status: writing.status, runId: slides.runId, stage: writing.stage, diagnostics: writing.errors };
      const review = await run(stages.review, { ...input, narrations: writing.artifact }, [...ids, writing.artifact.artifactId]);
      if (review.status === "succeeded") return { ...slides, spokenPresentation: ReviewedNarrationSchema.parse({ narrations: writing.artifact, review: review.artifact }) };
      if (review.status === "rejected" && review.artifact?.retryRecommended && attempt === 1) {
        revision = { previous: writing.artifact, feedback: review.artifact };
      } else return { status: review.status, runId: slides.runId, stage: review.stage, diagnostics: review.errors };
    }
    throw new Error("Narration revision loop exited without a result.");
  }

  async draftOutline(outline: GenerationV2OutlineSuccess, services: { agent: GenerationV2SlideAgentProvider; render: SlideRenderer; images?: GenerationSlideImageProvider }, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2PipelineResult> {
    const review = outline.outlineReview;
    const research = outline.researchReview;
    if (!review.approved || review.retryRecommended || review.issues.some((issue) => issue.severity === "error") || review.targetStage !== "outline-review"
      || review.targetArtifactIds.length !== 2 || review.targetArtifactIds[0] !== outline.strategy.artifactId || review.targetArtifactIds[1] !== outline.slidePlans.artifactId
      || !research.approved || research.retryRecommended || research.issues.some((issue) => issue.severity === "error") || outline.factBank.facts.length === 0 || ("sufficientForDeck" in outline.factBank && !outline.factBank.sufficientForDeck)
      || !research.targetArtifactIds.includes(outline.factBank.artifactId) || outline.strategy.factBankArtifactId !== outline.factBank.artifactId
      || outline.strategy.classificationArtifactId !== outline.classification.artifactId || outline.slidePlans.deckStrategyArtifactId !== outline.strategy.artifactId
      || outline.slidePlans.factBankArtifactId !== outline.factBank.artifactId) {
      return { status: "rejected", runId: outline.runId, stage: "outline-review", diagnostics: [{ code: "outline_not_ready", category: "contract", retryable: false, message: "Slide writing requires approval of these exact research and outline artifacts.", artifactPath: [], sourceIds: [] }] };
    }
    const unitDeadlineMs = this.config.stageDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS;
    const stages = createSlideStages(services.agent, services.render, this.config.artifactFactory, services.images, unitDeadlineMs);
    const input = { request: outline.request, classification: outline.classification, factBank: outline.factBank, strategy: outline.strategy, slidePlans: outline.slidePlans };
    const run = <I, A>(definition: GenerationStageDefinition<I, A>, value: I, ids: string[], deadlineMs = unitDeadlineMs, attempt = 1) => executeGenerationStage({
      definition, input: value, context: { runId: outline.runId, attempt, inputArtifactIds: ids, sourceIds: outline.evidenceSet.sources.map((source) => source.id) },
      recorder: this.config.recorder, deadlineMs, signal: options.signal, onProgress: this.config.onProgress,
    });
    const ids = [input.request.artifactId, input.classification.artifactId, input.factBank.artifactId, input.strategy.artifactId, input.slidePlans.artifactId, outline.outlineReview.artifactId];
    const design = await run(stages.design, { ...input, researchBundle: outline.researchBundle }, [...ids, outline.researchBundle.artifactId]);
    if (design.status !== "succeeded") return { status: design.status, runId: outline.runId, stage: design.stage, diagnostics: design.errors };
    const writingInput = { ...input, designs: design.artifact, sources: outline.evidenceSet.sources };
    let revision: SlideRevision | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const revisedIds = revision ? [revision.previous.slides.artifactId, revision.feedback.artifactId] : [];
      const writing = await run(stages.writing, { ...writingInput, ...(revision ? { revision } : {}) },
        [...ids, design.artifact.artifactId, ...revisedIds], sequentialStageDeadlineMs(input.slidePlans.slides.length, unitDeadlineMs), attempt);
      if (writing.status !== "succeeded") return { status: writing.status, runId: outline.runId, stage: writing.stage, diagnostics: writing.errors };
      const slideReview = await run(stages.review, { ...input, designs: design.artifact, slides: writing.artifact.slides },
        [...ids, design.artifact.artifactId, writing.artifact.slides.artifactId], unitDeadlineMs, attempt);
      if (slideReview.status === "succeeded") return { ...outline, ...writing.artifact, designs: design.artifact, slideReview: slideReview.artifact };
      revision = slideReview.status === "rejected" && slideReview.artifact && attempt === 1
        ? slideRevisionFromReview(writing.artifact, slideReview.artifact) : undefined;
      if (!revision) return { status: slideReview.status, runId: outline.runId, stage: slideReview.stage, diagnostics: slideReview.errors };
    }
    throw new Error("Slide revision loop exited without a result.");
  }

  async planOutline(research: GenerationV2ResearchPipelineSuccess, options: { signal?: AbortSignal | undefined } = {}): Promise<GenerationV2OutlineResult> {
    const stages = createOutlineStages(this.config.agent, this.config.artifactFactory);
    const run = <I, A>(definition: GenerationStageDefinition<I, A>, input: I, inputArtifactIds: string[]) => executeGenerationStage({
      definition, input, context: { runId: research.runId, attempt: 1, inputArtifactIds, sourceIds: research.evidenceSet.sources.map((source) => source.id) },
      recorder: this.config.recorder, deadlineMs: this.config.stageDeadlineMs ?? DEFAULT_GENERATION_STAGE_DEADLINE_MS,
      signal: options.signal, onProgress: this.config.onProgress,
    });
    if (!research.researchReview.approved || research.researchReview.retryRecommended || research.researchReview.issues.some((issue) => issue.severity === "error") || research.factBank.facts.length === 0 || ("sufficientForDeck" in research.factBank && !research.factBank.sufficientForDeck) || !research.researchReview.targetArtifactIds.includes(research.factBank.artifactId)) {
      return { status: "rejected", runId: research.runId, stage: "research-review", diagnostics: [{ code: "research_not_ready", message: "Outline planning requires approval of this sufficient fact bank.", category: "contract", retryable: false, artifactPath: [], sourceIds: [] }] };
    }
    const input = { request: research.request, classification: research.classification, factBank: research.factBank };
    const strategy = await run(stages.strategy, input, [input.request.artifactId, input.classification.artifactId, input.factBank.artifactId, research.researchReview.artifactId]);
    if (strategy.status !== "succeeded") return { status: strategy.status, runId: research.runId, stage: strategy.stage, diagnostics: strategy.errors };
    const allocationInput = { ...input, strategy: strategy.artifact };
    const allocation = await run(stages.allocation, allocationInput, [input.request.artifactId, input.classification.artifactId, input.factBank.artifactId, strategy.artifact.artifactId]);
    if (allocation.status !== "succeeded") return { status: allocation.status, runId: research.runId, stage: allocation.stage, diagnostics: allocation.errors };
    const review = await run(stages.review, { ...allocationInput, slidePlans: allocation.artifact }, [input.request.artifactId, input.classification.artifactId, input.factBank.artifactId, strategy.artifact.artifactId, allocation.artifact.artifactId]);
    if (review.status !== "succeeded") return { status: review.status, runId: research.runId, stage: review.stage, diagnostics: review.errors };
    return { ...research, strategy: strategy.artifact, slidePlans: allocation.artifact, outlineReview: review.artifact };
  }
}
