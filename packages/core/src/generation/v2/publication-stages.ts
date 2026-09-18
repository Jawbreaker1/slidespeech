import { PublishablePresentationSchema, ReviewedNarrationSchema, ReviewResultSchema, createOutlineReviewDecisionSchema, publicationArtifactIds } from "@slidespeech/types";
import type { PublicationAgentInput, PublishablePresentation, ReviewResult, GenerationV2PublicationAgentProvider } from "@slidespeech/types";
import type { GenerationArtifactFactory } from "./artifact-factory";
import { createGenerationArtifactIdentity, defaultGenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export function createPublicationStages(agent: GenerationV2PublicationAgentProvider, factory: GenerationArtifactFactory = defaultGenerationArtifactFactory) {
  const review: GenerationStageDefinition<PublicationAgentInput, ReviewResult> = {
    name: "publication-review", parseArtifact: (value) => ReviewResultSchema.parse(value),
    execute: async (input, context) => {
      ReviewedNarrationSchema.parse({ narrations: input.narrations, review: input.reviews.find((review) => review.targetStage === "narration-review") });
      if (input.reviews.some((review) => !review.approved || review.retryRecommended || review.issues.some((issue) => issue.severity === "error"))) {
        throw new Error("Publication cannot override rejected upstream reviews.");
      }
      const targets = publicationArtifactIds(input);
      const call = await agent.reviewPublication(input, { signal: context.signal });
      const decision = createOutlineReviewDecisionSchema(input.slides.slides.length, input.factBank.facts.length, targets.length).parse(call.value);
      const artifact = ReviewResultSchema.parse({ ...createGenerationArtifactIdentity("publication_review", factory), ...decision,
        targetStage: "publication-review", targetArtifactIds: targets,
        issues: decision.issues.map(({ targetArtifactIndex, slideIndex, factIndexes, retryInstruction, ...issue }) => ({ ...issue,
          ...(targetArtifactIndex !== null ? { artifactId: targets[targetArtifactIndex] } : {}),
          ...(slideIndex !== null ? { slideId: input.slides.slides[slideIndex]!.slideId } : {}),
          factIds: factIndexes.map((index) => input.factBank.facts[index]!.id), ...(retryInstruction !== null ? { retryInstruction } : {}),
        })),
      });
      return artifact.approved ? { status: "succeeded", artifact, telemetry: call.telemetry } : {
        status: "rejected", artifact, telemetry: call.telemetry, errors: [{ code: "publication_rejected", category: "semantic",
          message: artifact.summary, retryable: false, artifactPath: [], sourceIds: [] }],
      };
    },
  };
  const publication: GenerationStageDefinition<{ candidate: PublicationAgentInput; review: ReviewResult }, PublishablePresentation> = {
    name: "publication", parseArtifact: (value) => PublishablePresentationSchema.parse(value),
    execute: async ({ candidate, review }) => ({ status: "succeeded", artifact: {
      ...createGenerationArtifactIdentity("presentation", factory), ...candidate,
      reviews: [...candidate.reviews, review], publishedAt: factory.now(),
    } }),
  };
  return { review, publication };
}
