import type { ProviderHealthStatus } from "../domain";
import type { GenerationDiagnostic, GenerationStageTelemetry } from "./common";
import type { ReviewResult } from "./review";
import type { ResearchReviewDecision } from "./research-review";
import type {
  EvidenceSegmentCandidate,
  EvidenceSelectionDecision,
} from "./evidence-selection";
import type {
  EvidenceSet,
  FactBank,
  FactBankDecision,
  PresentationRequestArtifact,
  PromptClassification,
  PromptClassificationDecision,
  ResearchPlan,
  ResearchBundleManifest,
  ResearchPlanDecision,
  ResearchSourceTarget,
} from "./research";
import type {
  ResearchSourceCandidate,
  ResearchSourceSelectionDecision,
} from "./research-selection";

export interface GenerationAgentCall<TValue> {
  value: TValue;
  telemetry: GenerationStageTelemetry;
}

export interface GenerationAgentCallOptions {
  signal?: AbortSignal | undefined;
}

export interface FactCurationAgentInput {
  classification: PromptClassification;
  researchPlan: ResearchPlan;
  evidence: EvidenceSet;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

export interface EvidenceSelectionAgentInput {
  subject: string;
  researchQuestions: Array<{ question: string }>;
  evidenceRequirements: Array<{
    id: string;
    description: string;
    required: boolean;
  }>;
  page: {
    title: string;
    url: string;
  };
  segments: EvidenceSegmentCandidate[];
  maximumSelections: number;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

export interface ResearchSourceSelectionAgentInput {
  researchPlan: ResearchPlan;
  target: ResearchSourceTarget;
  candidates: ResearchSourceCandidate[];
  maximumSelections: number;
  reviewFeedback?: ReviewResult | undefined;
}

export interface ResearchPlanningAgentInput {
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  reviewFeedback?: ReviewResult | undefined;
  stageFeedback?: GenerationDiagnostic[] | undefined;
}

export interface ResearchReviewAgentInput {
  request: PresentationRequestArtifact;
  classification: PromptClassification;
  targetArtifacts: [ResearchPlan, ResearchBundleManifest, EvidenceSet, FactBank];
}

export interface GenerationV2AgentProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  classifyPrompt(
    request: PresentationRequestArtifact,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<PromptClassificationDecision>>;
  planResearch(
    input: ResearchPlanningAgentInput,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<ResearchPlanDecision>>;
  selectResearchSources(
    input: ResearchSourceSelectionAgentInput,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<ResearchSourceSelectionDecision>>;
  selectEvidence(
    input: EvidenceSelectionAgentInput,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<EvidenceSelectionDecision>>;
  curateFacts(
    input: FactCurationAgentInput,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<FactBankDecision>>;
  reviewResearch(
    input: ResearchReviewAgentInput,
    options?: GenerationAgentCallOptions,
  ): Promise<GenerationAgentCall<ResearchReviewDecision>>;
}
