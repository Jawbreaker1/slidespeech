import type { GenerationArtifactIdentity } from "./common";
import type { PublishablePresentation } from "./presentation";
import type { ReviewDecision } from "./review";
import type { GenerationAgentCall, GenerationAgentCallOptions } from "./agent-provider";

export const PUBLICATION_ARTIFACT_KEYS = ["request", "classification", "researchPlan", "researchBundle", "evidenceSet", "factBank", "strategy", "slidePlans", "designs", "slides", "narrations"] as const;
export type PublicationAgentInput = Omit<PublishablePresentation, keyof GenerationArtifactIdentity | "publishedAt">;

export function publicationArtifactIds(input: Pick<PublishablePresentation, typeof PUBLICATION_ARTIFACT_KEYS[number]>): string[] {
  return PUBLICATION_ARTIFACT_KEYS.map((key) => input[key].artifactId);
}

export interface GenerationV2PublicationAgentProvider {
  reviewPublication(input: PublicationAgentInput, options?: GenerationAgentCallOptions): Promise<GenerationAgentCall<ReviewDecision>>;
}

/** Only actual spoken passages, in the order approved by narration review. */
export function narrationPassages(script: PublishablePresentation["narrations"]["scripts"][number]): string[] {
  return [script.openingBridge, ...script.segments, script.transitionOut, ...(script.questionInvitation ? [script.questionInvitation] : [])];
}

/** Review what playback actually speaks, without mixing in unused delivery cues. */
export function narrationPlaybackView(narrations: PublishablePresentation["narrations"]) {
  return { ...narrations, scripts: narrations.scripts.map(script => ({
    slideId: script.slideId, passages: narrationPassages(script), sourceMentions: script.sourceMentions,
  })) };
}
