import type { CreatePresentationSessionInput } from "@slidespeech/core";

import { appContext } from "../lib/context";
import { buildGroundingFactStage } from "./grounding-fact-stage";
import { compactPresentationBrief } from "./presentation-context";
import {
  derivePresentationIntent,
  extractPresentationBrief,
  shouldUseWebResearchForTopic,
  stripExplicitSourceUrls,
} from "./research-policy";
import { buildResearchPlanStage } from "./research-plan-stage";
import {
  collectResearchSources,
  presentationRequestRequiresGroundedFacts,
} from "./research-source-stage";

export {
  presentationRequestRequiresGroundedFacts,
  resolvePresentationSubject,
} from "./research-source-stage";

type GenerationContextSessionInput = Pick<
  CreatePresentationSessionInput,
  | "topic"
  | "presentationBrief"
  | "intent"
  | "groundingSummary"
  | "groundingHighlights"
  | "groundingExcerpts"
  | "groundingCoverageGoals"
  | "groundingSourceIds"
  | "groundingFacts"
  | "groundingSourceType"
>;

export const buildPresentationGenerationContext = async (input: {
  topic: string;
  useWebResearch?: boolean | undefined;
}): Promise<GenerationContextSessionInput> => {
  const presentationIntent = derivePresentationIntent(input.topic);
  const explicitSourceUrls = presentationIntent.explicitSourceUrls;
  const normalizedTopic = stripExplicitSourceUrls(input.topic) || input.topic.trim();
  const extractedBrief = presentationIntent.framing || extractPresentationBrief(input.topic) || normalizedTopic;
  const shouldUseWebResearch = shouldUseWebResearchForTopic({
    topic: normalizedTopic,
    requestedUseWebResearch: input.useWebResearch,
  });
  const researchPlan = await buildResearchPlanStage({
    prompt: input.topic,
    normalizedTopic,
    extractedBrief,
    presentationIntent,
    explicitSourceUrls,
    requestedUseWebResearch: input.useWebResearch,
    shouldUseWebResearch,
  });
  const requiresGroundedFacts = presentationRequestRequiresGroundedFacts({
    normalizedTopic,
    explicitSourceUrls,
    useWebResearch: input.useWebResearch,
  });

  if (
    requiresGroundedFacts &&
    appContext.webResearchProvider.name === "mock-web-research"
  ) {
    throw new Error(
      explicitSourceUrls.length > 0
        ? "This prompt includes explicit source URLs. Set WEB_RESEARCH_PROVIDER=hosted so the backend can fetch and ground the deck on those sources."
        : "This topic needs grounded research. Set WEB_RESEARCH_PROVIDER=hosted or disable research explicitly only if you accept an ungrounded deck.",
    );
  }

  const {
    allGroundingFindings,
    effectiveIntent,
    presentationSubject,
    researchSummary,
    successfulGroundingUrls,
  } = await collectResearchSources({
    prompt: input.topic,
    presentationIntent,
    researchPlan,
    shouldUseWebResearch,
  });

  if (researchPlan.requiresGroundedFacts && successfulGroundingUrls.length === 0) {
    throw new Error(
      `No trustworthy web sources could be fetched for "${normalizedTopic}". Refusing to generate an ungrounded deck.`,
    );
  }

  const presentationBrief =
    compactPresentationBrief(extractedBrief, presentationSubject) ?? undefined;
  const groundingStage = await buildGroundingFactStage({
    allGroundingFindings,
    effectiveIntent,
    presentationBrief,
    presentationSubject,
    researchPlan,
    researchSummary,
    successfulGroundingUrls,
  });

  return {
    topic: presentationSubject,
    ...(presentationBrief ? { presentationBrief } : {}),
    intent: {
      ...effectiveIntent,
      subject: presentationSubject,
      framing: presentationBrief ?? effectiveIntent.framing,
    },
    ...groundingStage,
  };
};
