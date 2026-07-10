import type {
  GenerateDeckInput,
  GroundingFact,
  PresentationIntent,
} from "@slidespeech/types";

import {
  contentLanguageInstruction,
  inferContentLanguageFromInput,
} from "./content-language";
import { uniqueNonEmptyStrings } from "./deck-shape-text";

export const buildGroundingFactPlanningLines = (
  facts: GroundingFact[] | undefined,
): string[] => {
  if (!facts?.length) {
    return [];
  }

  return uniqueNonEmptyStrings(
    facts.map((fact) => {
      const evidence = fact.evidence.trim();
      return `${fact.role}: ${fact.claim}${evidence && evidence !== fact.claim ? ` Evidence: ${evidence}` : ""}`;
    }),
  ).slice(0, 12);
};

export const buildIntentPromptLines = (input: {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | GenerateDeckInput["intent"] | undefined;
}): string[] => {
  const coreSubject = input.intent?.subject || input.topic;
  const framing = input.intent?.framing || input.presentationBrief;
  const contentLanguage = inferContentLanguageFromInput({
    topic: input.topic,
    presentationBrief: input.presentationBrief,
    intent: input.intent,
    plan: undefined,
  });

  return [
    `Core subject: ${coreSubject}`,
    contentLanguageInstruction(contentLanguage),
    input.intent?.focusAnchor
      ? `Concrete focus anchor: ${input.intent.focusAnchor}`
      : null,
    framing ? `Framing context: ${framing}` : "No additional framing context was provided.",
    input.intent?.presentationFrame
      ? `Presentation frame: ${input.intent.presentationFrame}`
      : null,
    input.intent?.organization
      ? `Organization context: ${input.intent.organization}`
      : null,
    input.intent?.audienceCues?.length
      ? `Audience cues: ${input.intent.audienceCues.join("; ")}`
      : null,
    input.intent?.presentationGoal
      ? `Presentation goal: ${input.intent.presentationGoal}`
      : null,
    input.intent?.deliveryFormat
      ? `Delivery format: ${input.intent.deliveryFormat}`
      : null,
    input.intent?.activityRequirement
      ? `Required participant activity: ${input.intent.activityRequirement}`
      : null,
    input.intent?.coverageRequirements?.length
      ? `Explicit coverage requirements: ${input.intent.coverageRequirements.join("; ")}`
      : null,
  ].filter((line): line is string => Boolean(line));
};
