import type { GenerateDeckInput } from "@slidespeech/types";

export type SlideContract = {
  index: number;
  isFinal?: boolean;
  label: string;
  kind:
    | "orientation"
    | "coverage"
    | "development"
    | "synthesis"
    | "subject-detail"
    | "subject-implication"
    | "subject-takeaway"
    | "entity-capabilities"
    | "entity-operations"
    | "entity-value"
    | "workshop-practice"
    | "procedural-ingredients"
    | "procedural-steps"
    | "procedural-quality";
  focus: string;
  objective?: string;
  evidence?: string;
  distinctFrom?: string[];
};

export type SlideDraftAssessment = {
  retryable: boolean;
  reasons: string[];
};

export type ContractSeedSource =
  | "focusAnchor"
  | "presentationGoal"
  | "coverageRequirement"
  | "coverageGoal"
  | "learningObjective"
  | "storyline"
  | "groundingHighlight"
  | "activityRequirement";

export type ContractSeed = {
  id: string;
  text: string;
  source: ContractSeedSource;
  order: number;
};

export type SlideArcPolicy =
  | "procedural"
  | "organization-overview"
  | "source-backed-subject"
  | "subject-explainer";

export type ArcPolicyInput = {
  intent?: Pick<
    NonNullable<GenerateDeckInput["intent"]>,
    | "contentMode"
    | "subject"
    | "presentationFrame"
    | "organization"
    | "explicitSourceUrls"
    | "focusAnchor"
    | "deliveryFormat"
    | "activityRequirement"
  > | undefined;
  groundingHighlights?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
  topic?: GenerateDeckInput["topic"] | undefined;
};
