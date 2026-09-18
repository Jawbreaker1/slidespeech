import { z } from "zod";

import {
  GenerationArtifactIdSchema,
  GenerationArtifactIdentitySchema,
} from "./common";

export const GroundedAnswerSchema = GenerationArtifactIdentitySchema.extend({
  question: z.string().min(1).max(5_000),
  answer: z.string().min(1).max(20_000),
  groundingKind: z.enum([
    "current-slide",
    "presentation",
    "fact-bank",
    "follow-up-research",
    "model-knowledge",
    "unsupported",
  ]),
  factIds: z.array(GenerationArtifactIdSchema),
  sourceIds: z.array(GenerationArtifactIdSchema),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string().min(1).max(2_000)).max(30),
}).strict();

export type GroundedAnswer = z.infer<typeof GroundedAnswerSchema>;

// Playback owns navigation. Return to the start of the interrupted approved passage.
export const PresentationResumePlanV2Schema = z.object({
  slideIndex: z.number().int().nonnegative(),
  passageIndex: z.number().int().nonnegative(),
  playbackSeconds: z.literal(0),
  bridgeText: z.string().min(1).max(2_000),
}).strict();

export type PresentationResumePlanV2 = z.infer<
  typeof PresentationResumePlanV2Schema
>;
