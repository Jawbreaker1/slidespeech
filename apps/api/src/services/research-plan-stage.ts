import type { PresentationIntent } from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  buildResearchPlan,
  mergeResearchPlanWithSuggestion,
  type ResearchPlan,
} from "./research-policy";

export const buildResearchPlanStage = async (input: {
  prompt: string;
  normalizedTopic: string;
  extractedBrief: string;
  presentationIntent: PresentationIntent;
  explicitSourceUrls: string[];
  requestedUseWebResearch?: boolean | undefined;
  shouldUseWebResearch: boolean;
}): Promise<ResearchPlan> => {
  let researchPlan = buildResearchPlan({
    topic: input.prompt,
    requestedUseWebResearch: input.requestedUseWebResearch,
    intent: input.presentationIntent,
  });

  if (input.shouldUseWebResearch || researchPlan.requiresGroundedFacts) {
    try {
      const suggestion = await appContext.llmProvider.planResearch({
        topic: input.prompt,
        ...(input.extractedBrief
          ? { presentationBrief: input.extractedBrief }
          : {}),
        intent: input.presentationIntent,
        explicitSourceUrls: input.explicitSourceUrls,
        heuristicSubject: researchPlan.subject,
        heuristicQueries: researchPlan.searchQueries,
        freshnessSensitive: researchPlan.freshnessSensitive,
        requiresGroundedFacts: researchPlan.requiresGroundedFacts,
      });
      researchPlan = mergeResearchPlanWithSuggestion({
        basePlan: researchPlan,
        topic: input.normalizedTopic,
        suggestion,
      });
    } catch (error) {
      throw new Error(
        `Research planning failed for "${input.normalizedTopic}": ${(error as Error).message}`,
      );
    }
  }

  return researchPlan;
};
