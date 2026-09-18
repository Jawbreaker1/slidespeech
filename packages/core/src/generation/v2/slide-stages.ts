import { createDesignDecisionSchema, createSlideWritingDecisionSchema, createOutlineReviewDecisionSchema, SlideDesignSpecSetSchema, SlideDraftSetSchema, ReviewResultSchema, SLIDE_LAYOUTS, assertSlideTextLayout } from "@slidespeech/types";
import type { GenerationV2SlideAgentProvider, SlideDesignAgentInput, SlideReviewAgentInput, SlideDesignSpecSet, SlideDraftSet, SlideDraft, SlideDesignSpec, LaidOutSlideScene, ReviewResult, EvidenceSet, GenerationStageTelemetry, SlideWritingLayout } from "@slidespeech/types";
import { createGenerationArtifactIdentity, defaultGenerationArtifactFactory } from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";
import type { GenerationSlideImageProvider, SlideImageAsset, ResearchBundle } from "@slidespeech/types";
import { SlideImagePreparationSchema } from "@slidespeech/types";
import { DEFAULT_GENERATION_STAGE_DEADLINE_MS, withExecutionDeadline } from "./execution-deadline";

export type SlideRenderer = ((draft: SlideDraft, design: SlideDesignSpec, assets?: SlideImageAsset[]) =>
  { scene: LaidOutSlideScene; feedback?: never } | { feedback: string[]; scene?: never }) & { describe(design: SlideDesignSpec): SlideWritingLayout };
export type SlidePreview = { slides: SlideDraftSet; scenes: LaidOutSlideScene[] };
export type SlideRevision = { previous: SlidePreview; feedback: ReviewResult };
type WritingInput = SlideDesignAgentInput & { designs: SlideDesignSpecSet; sources: EvidenceSet["sources"]; revision?: SlideRevision };

// Review owns meaning and scope; core only routes actionable errors to their author.
export function slideRevisionFromReview(previous: SlidePreview, feedback: ReviewResult): SlideRevision | undefined {
  const errors = feedback.issues.filter((issue) => issue.severity === "error");
  if (feedback.approved || !feedback.retryRecommended || errors.length === 0
    || errors.some((issue) => !issue.retryInstruction?.trim()
      || !previous.slides.slides.some((slide) => slide.slideId === issue.slideId)
      || (issue.artifactId !== undefined && issue.artifactId !== previous.slides.artifactId))) return undefined;
  return { previous, feedback };
}

function addTelemetry(current: GenerationStageTelemetry, prior?: GenerationStageTelemetry): GenerationStageTelemetry {
  const result: GenerationStageTelemetry = { provider: current.provider, model: current.model };
  for (const key of ["promptTokens", "completionTokens", "reasoningTokens", "totalTokens"] as const) {
    if (current[key] !== undefined || prior?.[key] !== undefined) result[key] = (prior?.[key] ?? 0) + (current[key] ?? 0);
  }
  return result;
}

export function createSlideStages(agent: GenerationV2SlideAgentProvider, render: SlideRenderer, factory: GenerationArtifactFactory = defaultGenerationArtifactFactory, images?: GenerationSlideImageProvider, unitDeadlineMs = DEFAULT_GENERATION_STAGE_DEADLINE_MS) {
  const design: GenerationStageDefinition<SlideDesignAgentInput & { researchBundle?: ResearchBundle }, SlideDesignSpecSet> = {
    name: "design-selection", parseArtifact: (value) => SlideDesignSpecSetSchema.parse(value),
    execute: async (input, context) => {
      const { researchBundle, ...designInput } = input;
      const prepared = images && researchBundle ? SlideImagePreparationSchema.parse(await images.prepare(designInput, researchBundle, context.signal)) : undefined;
      const availableImages = prepared?.assets.map(({ dataUrl, ...asset }) => asset) ?? [];
      const call = await agent.selectSlideDesigns({ ...designInput, availableImages }, { signal: context.signal });
      const decision = createDesignDecisionSchema(input.slidePlans.slides.length, availableImages, input.slidePlans.slides.map((slide) => slide.slideId), input.request.request.theme).parse(call.value);
      const telemetry = (prepared?.modelCalls ?? []).reduce((total, item) => addTelemetry(item, total), call.telemetry);
      return { status: "succeeded", telemetry, artifact: {
        ...createGenerationArtifactIdentity("slide_designs", factory), deckStrategyArtifactId: input.strategy.artifactId, slidePlanSetArtifactId: input.slidePlans.artifactId,
        ...(prepared ? { images: prepared } : {}),
        designs: decision.designs.map(({ imageAssetId, ...choice }, index) => ({ ...choice, ...(imageAssetId ? { imageAssetId } : {}), slideId: input.slidePlans.slides[index]!.slideId,
          layoutFamily: SLIDE_LAYOUTS.find((layout) => layout.id === choice.layoutId)!.family,
          themeId: decision.themeId,
          imageStrategy: imageAssetId ? "source-image" : "none", variationSeed: 0,
        })),
      } };
    },
  };
  const writing: GenerationStageDefinition<WritingInput, SlidePreview> = {
    name: "slide-generation", parseArtifact: (value) => {
      const preview = value as SlidePreview;
      const slides = SlideDraftSetSchema.parse(preview.slides);
      if (preview.scenes.length !== slides.slides.length) throw new Error("Every draft must have a measured scene.");
      preview.scenes.forEach((scene, index) => {
        assertSlideTextLayout(scene);
        if (scene.slideId !== slides.slides[index]!.slideId) throw new Error("Scene order must match its drafts.");
      });
      return { slides, scenes: preview.scenes };
    },
    execute: async (input, context) => {
      const { revision: reviewed, ...authorInput } = input;
      const slides: SlideDraft[] = [];
      const scenes: LaidOutSlideScene[] = [];
      let telemetry: GenerationStageTelemetry | undefined;
      for (let slideIndex = 0; slideIndex < input.slidePlans.slides.length; slideIndex++) {
        context.signal.throwIfAborted();
        const slideId = input.slidePlans.slides[slideIndex]!.slideId;
        const semanticFeedback = reviewed?.feedback.issues
          .filter((issue) => issue.severity === "error" && issue.slideId === slideId)
          .map((issue) => `${issue.message}\n${issue.retryInstruction}`) ?? [];
        if (reviewed && semanticFeedback.length === 0) {
          slides.push(reviewed.previous.slides.slides[slideIndex]!);
          scenes.push(reviewed.previous.scenes[slideIndex]!);
          context.reportProgress({ completedUnits: slides.length, totalUnits: input.slidePlans.slides.length });
          continue;
        }
        const outcome = await withExecutionDeadline(unitDeadlineMs, context.signal, async (signal) => {
          let revision = reviewed ? { previous: reviewed.previous.slides.slides[slideIndex]!, feedback: semanticFeedback } : undefined;
          for (let attempt = 1; attempt <= 2; attempt++) {
            signal.throwIfAborted();
            const writingInput = { ...authorInput, slideIndex, previousSlides: slides, layoutContract: render.describe(input.designs.designs[slideIndex]!), ...(revision ? { revision } : {}) };
            const call = await agent.writeSlide(writingInput, { signal });
            signal.throwIfAborted();
            telemetry = addTelemetry(call.telemetry, telemetry);
            const { sourceAttributions, ...decision } = createSlideWritingDecisionSchema(writingInput).parse(call.value);
            const draft: SlideDraft = { ...decision, slideId: input.slidePlans.slides[slideIndex]!.slideId,
              sourceAttributions: sourceAttributions.map((attribution) => {
                const source = input.sources.find((source) => source.id === attribution.sourceId)!;
                return { ...attribution, url: source.url };
              }),
            };
            const result = render(draft, input.designs.designs[slideIndex]!, input.designs.images?.assets);
            if (result.scene) return { draft, scene: result.scene };
            if (attempt === 2) return { feedback: result.feedback };
            revision = { previous: draft, feedback: [...semanticFeedback, ...result.feedback] };
          }
          throw new Error("Slide writing exited without a result.");
        }, "work-unit");
        if (!outcome.scene) return { status: "rejected", ...(telemetry ? { telemetry } : {}), errors: [{ code: "slide_does_not_fit", category: "renderer", retryable: false,
          message: outcome.feedback.join("\n").slice(0, 2000), artifactPath: ["slides", slideIndex], sourceIds: [] }] };
        slides.push(outcome.draft); scenes.push(outcome.scene);
        context.reportProgress({ completedUnits: slides.length, totalUnits: input.slidePlans.slides.length });
      }
      return { status: "succeeded", ...(telemetry ? { telemetry } : {}), artifact: {
        slides: { ...createGenerationArtifactIdentity("slide_drafts", factory), deckStrategyArtifactId: input.strategy.artifactId,
          slidePlanSetArtifactId: input.slidePlans.artifactId, slideDesignSpecSetArtifactId: input.designs.artifactId, slides }, scenes,
      } };
    },
  };
  const review: GenerationStageDefinition<SlideReviewAgentInput, ReviewResult> = {
    name: "slide-review", parseArtifact: (value) => ReviewResultSchema.parse(value),
    execute: async (input, context) => {
      const call = await agent.reviewSlides(input, { signal: context.signal });
      const decision = createOutlineReviewDecisionSchema(input.slidePlans.slides.length, input.factBank.facts.length).parse(call.value);
      const targets = [input.designs.artifactId, input.slides.artifactId];
      const artifact = ReviewResultSchema.parse({ ...createGenerationArtifactIdentity("slide_review", factory), ...decision,
        targetStage: "slide-review", targetArtifactIds: targets,
        issues: decision.issues.map(({ targetArtifactIndex, slideIndex, factIndexes, retryInstruction, ...issue }) => ({ ...issue,
          ...(targetArtifactIndex !== null ? { artifactId: targets[targetArtifactIndex] } : {}),
          ...(slideIndex !== null ? { slideId: input.slidePlans.slides[slideIndex]!.slideId } : {}),
          factIds: factIndexes.map((index) => input.factBank.facts[index]!.id), ...(retryInstruction !== null ? { retryInstruction } : {}),
        })),
      });
      return artifact.approved ? { status: "succeeded", artifact, telemetry: call.telemetry } : {
        status: "rejected", artifact, telemetry: call.telemetry,
        errors: [{ code: "slide_review_rejected", message: artifact.summary, category: "semantic", retryable: false, artifactPath: [], sourceIds: [] }],
      };
    },
  };
  return { design, writing, review };
}
