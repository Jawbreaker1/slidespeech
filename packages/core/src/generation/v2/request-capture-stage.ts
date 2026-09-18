import {
  PresentationRequestArtifactSchema,
  type GeneratePresentationRequest,
  type PresentationRequestArtifact,
} from "@slidespeech/types";

import {
  createPresentationRequestArtifact,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export const createRequestCaptureStage = (input: {
  artifactFactory?: GenerationArtifactFactory | undefined;
} = {}): GenerationStageDefinition<
  GeneratePresentationRequest,
  PresentationRequestArtifact
> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;

  return {
    name: "request-capture",
    parseArtifact: (value) => PresentationRequestArtifactSchema.parse(value),
    execute: async (request) => ({
      status: "succeeded",
      artifact: createPresentationRequestArtifact(request, artifactFactory),
    }),
  };
};
