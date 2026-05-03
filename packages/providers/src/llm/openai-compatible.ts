import type {
  AnswerQuestionInput,
  AnswerValidationResult,
  ClassifyGroundingInput,
  ConversationTurnPlan,
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  GroundingClassificationResult,
  GroundingFact,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PlanResearchInput,
  PresentationIntent,
  PresentationPlan,
  PresentationReview,
  ReviewDeckSemanticsInput,
  ResearchPlanningSuggestion,
  ReviewPresentationInput,
  Slide,
  SlideBrief,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
  ValidateQuestionAnswerInput,
  DeckSemanticIssue,
  DeckSemanticReviewResult,
} from "@slidespeech/types";

import {
  ConversationTurnPlanSchema,
  DeckSchema,
  PresentationReviewSchema,
  PresentationPlanSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";

import {
  extractJsonFromText,
  healthy,
  unhealthy,
} from "../shared";
import { normalizeConversationPlan } from "./conversation-plan-normalization";
import { buildSlideBriefs } from "./deck-blueprint";
import {
  applyPlanDrivenDeckShape,
  buildOutlineDeckSummary,
  buildOutlineScaffoldDeck,
  normalizeDeck,
} from "./deck-normalization";
import {
  toAudienceFacingSentence,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import {
  compactGroundingFindingContent,
  normalizeGroundingFactRole,
  normalizeGroundingRelevance,
  normalizeGroundingSourceRole,
} from "./grounding-normalization";
import {
  getChatChoiceTextCandidates,
  parseLmStudioReasoningText,
  parseLmStudioTaggedToolCall,
} from "./lmstudio-structured-output";
import {
  buildCompactDeckReviewSummary,
  buildCompactNarrationRepairSummary,
  buildFallbackNarrationForSlide,
  buildNarrationFromPlainText,
  narrationNeedsDetailedReview,
  normalizeDeckReviewResult,
  normalizeNarrationForSlide,
  normalizeNarrationRepairResult,
  normalizePresentationReview,
} from "./narration-review-normalization";
import { buildSlideFromPlainText } from "./plain-text-slide-parser";
import { normalizePresentationPlan } from "./presentation-plan-normalization";
import {
  compactGroundingSummary,
  sanitizePromptShapingText,
} from "./prompt-shaping";
import {
  parseResearchPlanningText,
  summarizeRevisionGuidance,
} from "./research-planning";
import { assessGeneratedSlideDraft } from "./slide-draft-assessment";
import { buildSlideEnrichmentPromptLines } from "./slide-enrichment-prompt";
import {
  canUseAsSlideExample,
  resolveSourceBackedCaseAnchor,
} from "./slide-contract-text";
import {
  buildArcPolicyPromptLines,
  deriveSlideArcPolicy,
} from "./slide-arc-policy";
import {
  buildSlideContractPromptLines,
  buildSlideContracts,
} from "./slide-contract-builder";
import {
  buildContractAnchoredKeyPoints,
} from "./slide-contract-points";
import {
  buildContractLearningGoal,
  buildContractTitle,
} from "./slide-contract-copy";
import {
  buildGroundedSlideRecoveryFromContext,
  buildOrientationSlideFromContext,
  buildProceduralSlideFromContext,
  buildProceduralOrientationKeyPoints,
  buildRoleSpecificSlideRecoveryFromContext,
  buildSubjectOverviewSlideFromContext,
  shouldUseDeterministicHowWorksSlide,
  shouldUseDeterministicProceduralSlide,
  shouldUseDeterministicSubjectOverviewSlide,
} from "./slide-recovery-builders";
import type {
  SlideContract,
  SlideDraftAssessment,
} from "./slide-contract-types";
import {
  toRecordArray,
  toStringArray,
} from "./structured-normalization";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SURFACE_SLIDE_DRAFT_REPAIR_REASONS = new Set([
  "Rewrite the explanations so they are complete subject-facing sentences, not repair-template fragments.",
  "Rewrite or remove malformed examples. Example slots need complete, concrete prompts or evidence, not fragments.",
]);

const looksLikeStructuredReasoningPayload = (value: string): boolean =>
  /^\s*[{[]/.test(value);

const looksLikeReasoningTrace = (value: string): boolean =>
  /\b(the user wants|i should|we need|need to answer|do not use json|follow the requested section labels)\b/i.test(
    value,
  );

const DECK_SEMANTIC_ISSUE_CODES = new Set<DeckSemanticIssue["code"]>([
  "prompt_leakage",
  "wrong_language",
  "mixed_language",
  "role_drift",
  "template_language",
  "unsupported_claim",
  "fragmentary_copy",
  "source_noise",
  "repetitive_copy",
  "weak_opening",
  "weak_closing",
  "other",
]);

const DECK_SEMANTIC_SEVERITIES = new Set<DeckSemanticIssue["severity"]>([
  "info",
  "warning",
  "error",
]);

const normalizeDeckSemanticReviewResult = (
  value: unknown,
): DeckSemanticReviewResult => {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const rawIssues = Array.isArray(record.issues) ? record.issues : [];
  const issues = rawIssues.flatMap((issue): DeckSemanticIssue[] => {
    if (typeof issue !== "object" || issue === null) {
      return [];
    }

    const issueRecord = issue as Record<string, unknown>;
    const code =
      typeof issueRecord.code === "string" &&
      DECK_SEMANTIC_ISSUE_CODES.has(issueRecord.code as DeckSemanticIssue["code"])
        ? (issueRecord.code as DeckSemanticIssue["code"])
        : "other";
    const severity =
      typeof issueRecord.severity === "string" &&
      DECK_SEMANTIC_SEVERITIES.has(issueRecord.severity as DeckSemanticIssue["severity"])
        ? (issueRecord.severity as DeckSemanticIssue["severity"])
        : "warning";
    const message =
      typeof issueRecord.message === "string" && issueRecord.message.trim()
        ? issueRecord.message.trim()
        : "The deck has a semantic quality issue.";
    const revisionInstruction =
      typeof issueRecord.revisionInstruction === "string" &&
      issueRecord.revisionInstruction.trim()
        ? issueRecord.revisionInstruction.trim()
        : message;
    const slideId =
      typeof issueRecord.slideId === "string" && issueRecord.slideId.trim()
        ? issueRecord.slideId.trim()
        : undefined;

    return [
      {
        code,
        severity,
        ...(slideId ? { slideId } : {}),
        message,
        revisionInstruction,
      },
    ];
  });
  const score =
    typeof record.score === "number" && Number.isFinite(record.score)
      ? Math.max(0, Math.min(1, record.score))
      : typeof record.overallScore === "number" && Number.isFinite(record.overallScore)
        ? Math.max(0, Math.min(1, record.overallScore))
        : issues.some((issue) => issue.severity === "error")
          ? 0.55
          : issues.some((issue) => issue.severity === "warning")
            ? 0.75
            : 0.92;

  return {
    approved:
      typeof record.approved === "boolean"
        ? record.approved
        : !issues.some((issue) => issue.severity === "error") && score >= 0.78,
    score,
    summary:
      typeof record.summary === "string" && record.summary.trim()
        ? record.summary.trim()
        : "Semantic deck review completed.",
    issues,
  };
};

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

interface ModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

export interface OpenAICompatibleConfig {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

const buildIntentPromptLines = (input: {
  topic: string;
  presentationBrief?: string | undefined;
  intent?: PresentationIntent | undefined;
}): string[] => {
  const coreSubject = input.intent?.subject || input.topic;
  const framing = input.intent?.framing || input.presentationBrief;

  return [
    `Core subject: ${coreSubject}`,
    input.intent?.focusAnchor
      ? `Concrete focus anchor: ${input.intent.focusAnchor}`
      : null,
    framing ? `Framing context: ${framing}` : "No additional framing context was provided.",
    input.intent?.presentationFrame
      ? `Presentation frame: ${input.intent.presentationFrame}`
      : null,
    ...buildArcPolicyPromptLines(input),
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

const tryRepairSurfaceSlideDraft = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
  draft: Record<string, unknown>,
  assessment: SlideDraftAssessment,
): Record<string, unknown> | null => {
  if (
    !assessment.retryable ||
    assessment.reasons.length === 0 ||
    assessment.reasons.some(
      (reason) => !SURFACE_SLIDE_DRAFT_REPAIR_REASONS.has(reason),
    )
  ) {
    return null;
  }

  const title = typeof draft.title === "string" ? draft.title.trim() : "";
  const learningGoal =
    typeof draft.learningGoal === "string" ? draft.learningGoal.trim() : "";
  const keyPoints = uniqueNonEmptyStrings(toStringArray(draft.keyPoints)).slice(0, 3);

  if (!title || !learningGoal || keyPoints.length !== 3) {
    return null;
  }

  const examples = uniqueNonEmptyStrings([
    ...toStringArray(draft.examples),
    contract.evidence ?? "",
  ])
    .filter((example) => canUseAsSlideExample(input, example))
    .slice(0, 2);

  const repairedDraft: Record<string, unknown> = {
    ...(slide as unknown as Record<string, unknown>),
    ...draft,
    title,
    learningGoal,
    keyPoints,
    speakerNotes: toStringArray(draft.speakerNotes),
    examples,
    likelyQuestions: toStringArray(draft.likelyQuestions).slice(0, 3),
    beginnerExplanation: toAudienceFacingSentence(
      `${keyPoints[0]} ${keyPoints[1]}`,
    ),
    advancedExplanation: toAudienceFacingSentence(keyPoints[2] ?? learningGoal),
    id: slide.id,
    order: slide.order,
  };

  const repairedAssessment = assessGeneratedSlideDraft(
    input,
    deck,
    contract,
    repairedDraft,
  );

  return repairedAssessment.retryable ? null : repairedDraft;
};

export const __testables = {
  assessGeneratedSlideDraft,
  applyPlanDrivenDeckShape,
  buildSlideFromPlainText,
  buildSlideContracts,
  resolveSourceBackedCaseAnchor,
  buildContractAnchoredKeyPoints,
  buildContractLearningGoal,
  buildContractTitle,
  buildOutlineDeckSummary,
  buildOrientationSlideFromContext,
  buildProceduralSlideFromContext,
  buildProceduralOrientationKeyPoints,
  buildRoleSpecificSlideRecoveryFromContext,
  normalizeDeck,
  normalizePresentationPlan,
  shouldUseDeterministicHowWorksSlide,
  shouldUseDeterministicProceduralSlide,
  shouldUseDeterministicSubjectOverviewSlide,
  toStringArray,
};

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;
  protected readonly baseUrl: string;
  protected readonly model: string;
  protected readonly apiKey: string | undefined;
  protected readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerName;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 45000;
  }

  private isLmStudioProvider(): boolean {
    return this.name === "lmstudio";
  }

  private raiseInitialTokenBudget(maxTokens: number): number {
    if (!this.isLmStudioProvider()) {
      return maxTokens;
    }

    if (maxTokens <= 300) {
      return 900;
    }

    if (maxTokens <= 600) {
      return 1400;
    }

    if (maxTokens <= 1200) {
      return 2200;
    }

    if (maxTokens <= 1800) {
      return 3000;
    }

    if (maxTokens <= 2400) {
      return 3600;
    }

    if (maxTokens <= 3200) {
      return 4400;
    }

    if (maxTokens <= 4200) {
      return 5600;
    }

    if (maxTokens <= 5200) {
      return 6800;
    }

    return Math.round(maxTokens * 1.15);
  }

  private normalizeTokenAttempts(options?: {
    maxTokens?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): number[] {
    const rawAttempts =
      options?.tokenAttempts && options.tokenAttempts.length > 0
        ? options.tokenAttempts
        : [
            options?.maxTokens ?? 1600,
            Math.max(
              3200,
              Math.min(6400, Math.round((options?.maxTokens ?? 1600) * 1.5)),
            ),
            Math.max(
              4800,
              Math.min(9600, Math.round((options?.maxTokens ?? 1600) * 2.2)),
            ),
          ];

    const adjustedAttempts = this.isLmStudioProvider() && !options?.disableLmStudioBudgetLift
      ? rawAttempts.map((attempt) => this.raiseInitialTokenBudget(attempt))
      : rawAttempts;

    return [...new Set(adjustedAttempts)].sort((left, right) => left - right);
  }

  private resolveRequestTimeout(
    requestedTimeoutMs: number | undefined,
    maxTokens: number | undefined,
    disableLmStudioBudgetLift: boolean | undefined,
  ): number {
    const baseTimeout = requestedTimeoutMs ?? this.timeoutMs;
    if (!this.isLmStudioProvider() || !maxTokens || disableLmStudioBudgetLift) {
      return baseTimeout;
    }

    const raisedBudget = this.raiseInitialTokenBudget(maxTokens);
    const additionalMs = Math.max(0, raisedBudget - 1800) * 6;
    return Math.min(90000, Math.max(baseTimeout, baseTimeout + additionalMs));
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        return unhealthy(
          this.name,
          `Health check failed with status ${response.status}.`,
        );
      }

      if (this.isLmStudioProvider()) {
        const payload = (await response.json().catch(() => null)) as
          | ModelsResponse
          | null;
        const loadedModelIds = Array.isArray(payload?.data)
          ? payload.data
              .map((model) => model.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)
          : [];

        if (loadedModelIds.length === 0) {
          return unhealthy(
            this.name,
            `Connected to ${this.baseUrl}, but LM Studio has no loaded models. Load "${this.model}" before generating.`,
          );
        }

        if (!loadedModelIds.includes(this.model)) {
          return unhealthy(
            this.name,
            `Connected to ${this.baseUrl}, but configured model "${this.model}" is not loaded. Loaded models: ${loadedModelIds.join(", ")}.`,
          );
        }

        return healthy(
          this.name,
          `Connected to ${this.baseUrl} with model "${this.model}" loaded.`,
        );
      }

      return healthy(this.name, `Connected to ${this.baseUrl}.`);
    } catch (error) {
      return unhealthy(this.name, `Connection failed: ${(error as Error).message}`);
    }
  }

  async planResearch(
    input: PlanResearchInput,
  ): Promise<ResearchPlanningSuggestion> {
    const text = await this.chatText(
      [
        {
          role: "system",
          content:
            "You refine web research plans for grounded presentation generation. Do not browse. Do not invent facts or URLs. Return only the requested plain-text sections.",
        },
        {
          role: "user",
          content: [
            `Prompt: ${input.topic}`,
            ...buildIntentPromptLines(input),
            `Heuristic subject: ${input.heuristicSubject}`,
            `Heuristic search queries: ${input.heuristicQueries.join(" | ") || "none"}`,
            input.explicitSourceUrls.length > 0
              ? `Explicit source URLs: ${input.explicitSourceUrls.join(" | ")}`
              : "No explicit source URLs were provided.",
            `Freshness sensitive: ${input.freshnessSensitive ? "yes" : "no"}`,
            `Grounded facts required: ${input.requiresGroundedFacts ? "yes" : "no"}`,
            "Refine the subject wording and search queries so backend fetch/search can gather stronger evidence.",
            "Prefer authoritative, official, or primary-source terminology.",
            "Coverage goals should describe facts or angles the presentation must substantiate.",
            "Do not mention slides, decks, templates, or presentation design.",
            "Return exactly these sections:",
            "SUBJECT: one short line",
            "SEARCH QUERIES:",
            "- query 1",
            "- query 2",
            "COVERAGE GOALS:",
            "- fact or angle to substantiate",
            "- fact or angle to substantiate",
            "RATIONALE:",
            "- short reason",
          ].join("\n"),
        },
      ],
      {
        maxTokens: 1400,
        timeoutMs: 25000,
        tokenAttempts: [1400, 2400, 3600],
      },
    );

    return parseResearchPlanningText(text, input);
  }

  async classifyGrounding(
    input: ClassifyGroundingInput,
  ): Promise<GroundingClassificationResult> {
    if (input.findings.length === 0) {
      return {
        highlights: [],
        excerpts: [],
        relevantSourceUrls: [],
        sourceAssessments: [],
      };
    }

    return this.chatToolCall({
      functionName: "return_grounding_classification",
      functionDescription:
        "Select the strongest grounding evidence from fetched sources, reject junk or low-signal content, and classify each source by role and relevance.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "highlights",
          "excerpts",
          "relevantSourceUrls",
          "sourceAssessments",
          "facts",
        ],
        properties: {
          highlights: {
            type: "array",
            items: { type: "string" },
          },
          excerpts: {
            type: "array",
            items: { type: "string" },
          },
          relevantSourceUrls: {
            type: "array",
            items: { type: "string" },
          },
          facts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "claim", "evidence", "sourceIds", "confidence"],
              properties: {
                role: {
                  type: "string",
                  enum: [
                    "identity",
                    "background",
                    "footprint",
                    "operations",
                    "capabilities",
                    "example",
                    "timeline",
                    "practice",
                    "reference",
                    "value",
                  ],
                },
                claim: { type: "string" },
                evidence: { type: "string" },
                sourceIds: {
                  type: "array",
                  items: { type: "string" },
                },
                confidence: {
                  type: "string",
                  enum: ["high", "medium", "low"],
                },
              },
            },
          },
          sourceAssessments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["url", "title", "role", "relevance", "notes"],
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                role: {
                  type: "string",
                  enum: [
                    "identity",
                    "background",
                    "footprint",
                    "operations",
                    "capabilities",
                    "example",
                    "timeline",
                    "practice",
                    "reference",
                    "junk",
                  ],
                },
                relevance: {
                  type: "string",
                  enum: ["high", "medium", "low", "junk"],
                },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You classify fetched source material for presentation grounding.",
            "Your job is to keep concrete, trustworthy, teaching-useful evidence and reject junk.",
            "Prefer factual identity, background, footprint, operations, capabilities, examples, timelines, practice guidance, and concrete outcomes when they exist.",
            "Treat navigation text, slogans, broad homepage marketing, generic category copy, cookie/legal boilerplate, FAQ questions, careers blurbs, and low-information repetition as low-signal or junk.",
            "Treat unsupported superlatives and self-evaluative company claims such as leading, world-class, innovative, strategic, or trusted partner language as promotional unless the source also gives concrete evidence for them.",
            "Do not invent facts, roles, or URLs.",
            "Highlights should be short factual statements grounded in the provided sources.",
            "Excerpts should be concise high-signal snippets from the provided source text, not rewritten slide copy.",
            "Facts should be role-scoped atomic claims for later slide generation. Each fact must include the claim, supporting evidence text, source URLs, confidence, and one best role.",
            "Return the tool call only.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Topic: ${input.topic}`,
            ...buildIntentPromptLines({
              topic: input.topic,
              ...(input.presentationBrief
                ? { presentationBrief: input.presentationBrief }
                : {}),
              ...(input.intent ? { intent: input.intent } : {}),
            }),
            input.coverageGoals.length > 0
              ? `Coverage goals: ${input.coverageGoals.join("; ")}`
              : "No explicit coverage goals were provided.",
            "Fetched source candidates:",
            ...input.findings.flatMap((finding, index) => [
              `SOURCE ${index + 1}`,
              `URL: ${finding.url}`,
              `Title: ${finding.title}`,
              `Content: ${compactGroundingFindingContent(finding.content) || "No usable content."}`,
            ]),
            "Select only the material that would actually improve grounded presentation generation.",
            "If a source is mostly promotional or irrelevant, keep it but classify it as low or junk rather than fabricating useful content from it.",
            "Use role=reference when the source is useful but does not clearly fit a narrower role.",
          ].join("\n"),
        },
      ],
      maxTokens: 1800,
      timeoutMs: 25000,
      tokenAttempts: [1800, 2600, 3600],
      parse: (value) => {
        if (typeof value !== "object" || value === null) {
          throw new Error("Grounding classification tool returned an invalid payload.");
        }

        const record = value as Record<string, unknown>;
        const highlights = uniqueNonEmptyStrings(toStringArray(record.highlights)).slice(0, 6);
        const excerpts = uniqueNonEmptyStrings(toStringArray(record.excerpts)).slice(0, 8);
        const relevantSourceUrls = uniqueNonEmptyStrings(
          toStringArray(record.relevantSourceUrls),
        ).slice(0, 8);
        const facts = toRecordArray(record.facts)
          .map((item, index) => {
            const claim =
              typeof item.claim === "string" ? item.claim.trim() : "";
            const evidence =
              typeof item.evidence === "string" ? item.evidence.trim() : "";
            const sourceIds = uniqueNonEmptyStrings(
              toStringArray(item.sourceIds),
            ).slice(0, 4);
            const confidence: GroundingFact["confidence"] =
              item.confidence === "high" ||
              item.confidence === "medium" ||
              item.confidence === "low"
                ? item.confidence
                : "medium";

            return {
              id: `fact_${index + 1}`,
              role: normalizeGroundingFactRole(item.role),
              claim,
              evidence: evidence || claim,
              sourceIds,
              confidence,
            };
          })
          .filter((fact) => fact.claim.length > 0 && fact.evidence.length > 0)
          .slice(0, 12);
        const sourceAssessments = toRecordArray(record.sourceAssessments)
          .map((item) => ({
            url: typeof item.url === "string" ? item.url.trim() : "",
            title: typeof item.title === "string" ? item.title.trim() : "",
            role: normalizeGroundingSourceRole(item.role),
            relevance: normalizeGroundingRelevance(item.relevance),
            notes: typeof item.notes === "string" ? item.notes.trim() : "",
          }))
          .filter((item) => item.url.length > 0 && item.title.length > 0)
          .slice(0, input.findings.length);

        return {
          highlights,
          excerpts,
          relevantSourceUrls,
          sourceAssessments,
          facts,
        };
      },
    });
  }

  async planPresentation(input: {
    topic: string;
    presentationBrief?: string;
    intent?: GenerateDeckInput["intent"];
    groundingHighlights?: string[];
    groundingExcerpts?: string[];
    groundingCoverageGoals?: string[];
    pedagogicalProfile: { audienceLevel: string };
    groundingSummary?: string;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
  }): Promise<PresentationPlan> {
    const system =
      "You design concise teaching plans. Call the provided tool and do not answer in plain text.";
    const user = [
      ...buildIntentPromptLines(input),
      input.groundingHighlights?.length
        ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
        : "No grounding highlights were provided.",
      input.groundingExcerpts?.length
        ? `Grounded source excerpts:\n${input.groundingExcerpts
            .slice(0, 6)
            .map((value) => `- ${value}`)
            .join("\n")}`
        : "No grounded source excerpts were provided.",
      input.groundingCoverageGoals?.length
        ? `Coverage goals for the outline:\n${input.groundingCoverageGoals
            .slice(0, 8)
            .map((value) => `- ${value}`)
            .join("\n")}`
        : "No explicit outline coverage goals were provided.",
      `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
      input.groundingSummary
        ? `External grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
        : "No external grounding summary was provided.",
      input.targetDurationMinutes
        ? `Target duration: about ${input.targetDurationMinutes} minutes.`
        : "No explicit target duration was provided.",
      input.targetSlideCount
        ? `Target slide count: about ${input.targetSlideCount} slides.`
        : "No explicit target slide count was provided.",
      "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
      "This is the outline stage. The storyline must contain one clean audience-facing beat for each final slide.",
      "Storyline beats are slide intentions, not source notes. Never copy labels such as Research coverage goals, Curated grounding highlights, External grounding summary, Grounded source excerpts, or other internal planning text into the storyline.",
      "Use the core subject as the thing the audience is learning about. The presentation brief and intent fields only describe the intended angle, audience, or delivery context.",
      ...buildArcPolicyPromptLines(input),
      deriveSlideArcPolicy(input) === "organization-overview" &&
      (input.intent?.framing || input.presentationBrief)
        ? "Treat the framing context as binding scope for the organization plan. If it implies onboarding, orientation, introduction, or overview, keep the title and storyline focused on helping a newcomer understand the organization itself."
        : null,
      "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
      "For beginner audiences, prefer a storyline like: motivation, mental model, structure, concrete example, recap.",
      input.targetSlideCount
        ? `Return exactly ${input.targetSlideCount} storyline beats.`
        : "Keep the plan close to the requested duration and slide count when they are provided.",
      "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
    ].join("\n");

    try {
      return await this.chatToolCall({
        functionName: "return_presentation_plan",
        functionDescription:
          "Return the structured teaching plan for the requested presentation.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "learningObjectives",
            "storyline",
            "recommendedSlideCount",
            "audienceLevel",
          ],
          properties: {
            title: {
              type: "string",
            },
            learningObjectives: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            storyline: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            recommendedSlideCount: {
              type: "integer",
              minimum: 1,
            },
            audienceLevel: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced", "mixed"],
            },
          },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 900,
        timeoutMs: 6000,
        tokenAttempts: [900, 1400],
        parse: (value) =>
          PresentationPlanSchema.parse(
            normalizePresentationPlan(value, {
              targetSlideCount: input.targetSlideCount,
              topic: input.topic,
              subject: input.intent?.subject ?? input.topic,
              intent: input.intent,
              groundingHighlights: input.groundingHighlights,
              groundingCoverageGoals: input.groundingCoverageGoals,
            }),
          ),
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call presentation plan path failed: ${(error as Error).message}`,
      );
    }

    return this.chatJson({
      schemaName: "PresentationPlan",
      system:
        "You design concise teaching plans. Return valid JSON only and no markdown.",
      user: [
        ...buildIntentPromptLines(input),
        input.groundingHighlights?.length
          ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
          : "No grounding highlights were provided.",
        input.groundingExcerpts?.length
          ? `Grounded source excerpts:\n${input.groundingExcerpts
              .slice(0, 6)
              .map((value) => `- ${value}`)
              .join("\n")}`
          : "No grounded source excerpts were provided.",
        input.groundingCoverageGoals?.length
          ? `Coverage goals for the outline:\n${input.groundingCoverageGoals
              .slice(0, 8)
              .map((value) => `- ${value}`)
              .join("\n")}`
          : "No explicit outline coverage goals were provided.",
        `Audience level: ${input.pedagogicalProfile.audienceLevel}`,
        input.groundingSummary
          ? `External grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
          : "No external grounding summary was provided.",
        input.targetDurationMinutes
          ? `Target duration: about ${input.targetDurationMinutes} minutes.`
          : "No explicit target duration was provided.",
        input.targetSlideCount
          ? `Target slide count: about ${input.targetSlideCount} slides.`
          : "No explicit target slide count was provided.",
        "The plan should form one coherent teaching arc, not a list of disconnected subtopics.",
        "This is the outline stage. Return one clean audience-facing storyline beat per final slide.",
        "Never copy internal labels such as Research coverage goals, Curated grounding highlights, External grounding summary, or Grounded source excerpts into the plan.",
        "Use the core subject as the thing the audience is learning about. The presentation brief and intent fields only describe the intended angle, audience, or delivery context.",
        ...buildArcPolicyPromptLines(input),
        deriveSlideArcPolicy(input) === "organization-overview" &&
        (input.intent?.framing || input.presentationBrief)
          ? "Treat the framing context as binding scope for the organization plan. If it implies onboarding, orientation, introduction, or overview, keep the title and storyline focused on helping a newcomer understand the organization itself."
          : null,
        "Do not repeat instruction fragments like 'create a presentation' or 'more information is available at' in the plan title or storyline.",
        "For beginner audiences, prefer a storyline like: motivation, mental model, structure, concrete example, recap.",
        input.targetSlideCount
          ? `Return exactly ${input.targetSlideCount} storyline beats.`
          : "Keep the plan close to the requested duration and slide count when they are provided.",
        "Return fields: title, learningObjectives, storyline, recommendedSlideCount, audienceLevel.",
      ].join("\n"),
      maxTokens: 2200,
      parse: (value) =>
        PresentationPlanSchema.parse(
          normalizePresentationPlan(value, {
            targetSlideCount: input.targetSlideCount,
            topic: input.topic,
            subject: input.intent?.subject ?? input.topic,
            intent: input.intent,
            groundingHighlights: input.groundingHighlights,
            groundingCoverageGoals: input.groundingCoverageGoals,
          }),
        ),
    });
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    const slideCount =
      input.targetSlideCount ??
      input.plan?.recommendedSlideCount ??
      Math.max(4, (input.plan?.storyline?.length ?? 0) + 1);
    const initialContracts = buildSlideContracts(input, slideCount);
    const initialSlideBriefs = buildSlideBriefs(input, initialContracts);
    const generationInput =
      input.slideBriefs?.length === initialSlideBriefs.length
        ? input
        : {
            ...input,
            slideBriefs: initialSlideBriefs,
          };
    const attempts = [
      {
        label: "outline-enriched",
        run: async () => this.generateDeckFromOutline(generationInput),
      },
      {
        label: "compact-structured",
        run: async () =>
          this.chatJson({
            schemaName: "Deck",
            system:
              "You create coherent teaching decks as concise JSON. Return valid JSON only and no markdown.",
            user: this.buildCompactDeckPrompt(generationInput, "compact"),
            maxTokens: 5200,
            parse: (value) => DeckSchema.parse(normalizeDeck(value, generationInput)),
          }),
      },
      {
        label: "minimal-outline",
        run: async () =>
          this.chatJson({
            schemaName: "Deck",
            system:
              "Return only JSON and keep it compact. Focus on slide coherence and grounded facts.",
            user: this.buildCompactDeckPrompt(generationInput, "minimal"),
            maxTokens: 3600,
            parse: (value) => DeckSchema.parse(normalizeDeck(value, generationInput)),
          }),
      },
    ] as const;

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        return await attempt.run();
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} deck attempt "${attempt.label}" failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error(`${this.name} deck generation failed.`);
  }

  private async generateDeckFromOutline(input: GenerateDeckInput): Promise<Deck> {
    const outlineDeck = buildOutlineScaffoldDeck(input);
    const contracts = buildSlideContracts(input, outlineDeck.slides.length);
    const slideBriefs = buildSlideBriefs(input, contracts);
    const generationInput =
      input.slideBriefs?.length === slideBriefs.length
        ? input
        : {
            ...input,
            slideBriefs,
          };
    const workingSlides = [...outlineDeck.slides];
    const generationOrder = [
      ...outlineDeck.slides
        .map((_, index) => index)
        .filter((index) => index !== 0),
      0,
    ];

    for (const index of generationOrder) {
      const slide = outlineDeck.slides[index];
      if (!slide) {
        throw new Error(`Missing outline slide ${index + 1}.`);
      }

      const contract = contracts[index];
      if (!contract) {
        throw new Error(`Missing slide contract for outline slide ${index + 1}.`);
      }

      const currentDeck = DeckSchema.parse({
        ...outlineDeck,
        slides: workingSlides,
      });
      const enrichedSlide = await this.generateSlideFromOutline(
        generationInput,
        currentDeck,
        currentDeck.slides[index] ?? slide,
        contract,
        slideBriefs[index],
      );
      workingSlides[index] = {
        ...(currentDeck.slides[index] ?? slide),
        ...(enrichedSlide as Record<string, unknown>),
        id: slide.id,
        order: slide.order,
      } as Slide;
    }

    return DeckSchema.parse(
      normalizeDeck(
        {
          ...outlineDeck,
          slides: workingSlides,
        },
        generationInput,
      ),
    );
  }

  private async generateStructuredSlideFromOutline(
    input: GenerateDeckInput,
    deck: Deck,
    slide: Slide,
    contract: SlideContract,
    slideBrief: SlideBrief | undefined,
    priorAssessment: SlideDraftAssessment | null,
  ): Promise<Record<string, unknown>> {
    const slideBriefLines = buildSlideEnrichmentPromptLines({
      deck,
      slide,
      contract,
      generationInput: input,
      ...(slideBrief ? { slideBrief } : {}),
      priorAssessment,
    });

    return await this.chatToolCall({
      functionName: "return_presentation_slide",
      functionDescription:
        "Return one structured presentation slide that teaches the subject itself in audience-facing language.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "learningGoal",
          "keyPoints",
          "beginnerExplanation",
          "advancedExplanation",
          "examples",
          "likelyQuestions",
          "speakerNotes",
        ],
        properties: {
          title: { type: "string" },
          learningGoal: { type: "string" },
          keyPoints: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
          },
          speakerNotes: {
            type: "array",
            items: { type: "string" },
          },
          examples: {
            type: "array",
            items: { type: "string" },
          },
          likelyQuestions: {
            type: "array",
            items: { type: "string" },
          },
          beginnerExplanation: { type: "string" },
          advancedExplanation: { type: "string" },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Write one structured presentation slide. Call the provided tool and do not answer in plain text. Teach the subject itself in audience-facing language. Do not mention the deck, session, slide design, or presenter instructions.",
        },
        {
          role: "user",
          content: [
            ...slideBriefLines,
            "Return fields: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
            "Use exactly 3 key points and make each one a complete audience-facing sentence.",
            "Keep the slide concrete and topic-specific. Prefer mechanisms, roles, examples, consequences, or factual subareas.",
            "Keep one consistent content language. Match the language already implied by the prompt and grounding instead of switching languages mid-deck.",
            "Avoid facilitator, presenter, or session-management language.",
            "Do not tell the presenter what to do. Do not describe how the slide should be delivered.",
            "If the framing lens implies onboarding, orientation, introduction, or overview, keep the language beginner-friendly and organization-facing. It may orient a newcomer to the organization, but it must not turn into facilitator talk or direct second-person instructions.",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        },
      ],
      maxTokens: slide.order === 0 ? 3200 : 2800,
      timeoutMs: 24000,
      tokenAttempts:
        slide.order === 0 ? [3200, 4800, 6400] : [2800, 4200, 5600],
      parse: (value) => {
        if (!value || typeof value !== "object") {
          throw new Error("Structured slide enrichment returned no object.");
        }

        return {
          ...(slide as unknown as Record<string, unknown>),
          ...(value as Record<string, unknown>),
          id: slide.id,
          order: slide.order,
        };
      },
    });
  }

  private async generateSlideFromOutline(
    input: GenerateDeckInput,
    deck: Deck,
    slide: Slide,
    contract: SlideContract,
    slideBrief?: SlideBrief,
  ): Promise<Record<string, unknown>> {
    let lastError: Error | null = null;
    let priorAssessment: SlideDraftAssessment | null = null;

    if (slide.order === 0 && contract.kind === "orientation") {
      return buildOrientationSlideFromContext(input, deck, slide, contract);
    }

    if (shouldUseDeterministicSubjectOverviewSlide(input, slide, contract)) {
      return buildSubjectOverviewSlideFromContext(input, deck, slide, contract);
    }

    if (shouldUseDeterministicProceduralSlide(input, contract)) {
      return buildProceduralSlideFromContext(input, slide, contract);
    }

    if (shouldUseDeterministicHowWorksSlide(input, contract)) {
      const deterministicHowWorksSlide = buildRoleSpecificSlideRecoveryFromContext(
        input,
        deck,
        slide,
        contract,
      );
      if (deterministicHowWorksSlide) {
        return deterministicHowWorksSlide;
      }
    }

    if (contract.kind === "workshop-practice") {
      const workshopPracticeSlide = buildRoleSpecificSlideRecoveryFromContext(
        input,
        deck,
        slide,
        contract,
      );
      if (workshopPracticeSlide) {
        console.warn(
          `[slidespeech] ${this.name} generated workshop practice slide "${slide.title}" from the slide contract before LLM enrichment.`,
        );
        return workshopPracticeSlide;
      }
    }

    const organizationRoleWithScopedBrief =
      deriveSlideArcPolicy(input) === "organization-overview" &&
      Boolean(slideBrief) &&
      (
        contract.kind === "entity-operations" ||
        contract.kind === "entity-capabilities" ||
        contract.kind === "entity-value"
      );
    if (organizationRoleWithScopedBrief) {
      const roleFirstSlide = buildRoleSpecificSlideRecoveryFromContext(
        input,
        deck,
        slide,
        contract,
      );
      if (roleFirstSlide) {
        console.warn(
          `[slidespeech] ${this.name} generated organization slide "${slide.title}" from scoped slide brief before LLM enrichment.`,
        );
        return roleFirstSlide;
      }
    }

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      try {
        const enrichedSlide = await this.generateStructuredSlideFromOutline(
          input,
          deck,
          slide,
          contract,
          slideBrief,
          priorAssessment,
        );

        const assessment = assessGeneratedSlideDraft(input, deck, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        const repairedSlide = tryRepairSurfaceSlideDraft(
          input,
          deck,
          slide,
          contract,
          enrichedSlide,
          assessment,
        );
        if (repairedSlide) {
          console.warn(
            `[slidespeech] ${this.name} locally repaired surface-only slide issues for "${slide.title}".`,
          );
          return repairedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlide.title === "string" ? enrichedSlide.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlide.learningGoal === "string" ? enrichedSlide.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlide.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} structured slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
      }
    }

    for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
      const slideBriefLines = buildSlideEnrichmentPromptLines({
        deck,
        slide,
        contract,
        generationInput: input,
        ...(slideBrief ? { slideBrief } : {}),
        priorAssessment,
      });

      try {
        const plainTextSlide = await this.chatText(
          [
            {
              role: "system",
              content:
                "Write one presentation slide in plain text. Teach the subject itself in audience-facing language. Do not use JSON or markdown tables. Follow the requested section labels exactly.",
            },
            {
              role: "user",
              content: [
                ...slideBriefLines,
                "Return plain text with exactly these labels:",
                "TITLE:",
                "GOAL:",
                "POINTS:",
                "- point one",
                "- point two",
                "- point three",
                "BEGINNER:",
                "ADVANCED:",
                "EXAMPLE:",
                "QUESTION:",
                "Write the three key points as exactly three separate bullet lines under POINTS, each starting with '- '.",
                "Do not join multiple key points in one sentence. Do not use semicolons instead of bullet lines.",
                "Keep all three key points as complete audience-facing sentences.",
                "Do not mention the deck, the presentation process, or what the presenter should do.",
              ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
            },
          ],
          {
            maxTokens: slide.order === 0 ? 3000 : 2400,
            timeoutMs: 35000,
            tokenAttempts: slide.order === 0 ? [3000, 4200] : [2400, 3400],
          },
        );

        const enrichedSlide = buildSlideFromPlainText(plainTextSlide, slide);
        if (!enrichedSlide) {
          throw new Error("Plain-text slide enrichment could not be parsed into a full slide.");
        }

        const assessment = assessGeneratedSlideDraft(input, deck, contract, enrichedSlide);
        if (!assessment.retryable) {
          return enrichedSlide;
        }

        const repairedSlide = tryRepairSurfaceSlideDraft(
          input,
          deck,
          slide,
          contract,
          enrichedSlide,
          assessment,
        );
        if (repairedSlide) {
          console.warn(
            `[slidespeech] ${this.name} locally repaired surface-only plain-text slide issues for "${slide.title}".`,
          );
          return repairedSlide;
        }

        priorAssessment = assessment;
        lastError = new Error(assessment.reasons.join(" "));
        const enrichedSlideRecord = enrichedSlide as Record<string, unknown>;
        console.warn(
          `[slidespeech] ${this.name} plain-text slide enrichment attempt ${attemptIndex + 1} for "${slide.title}" still needs cleanup: ${assessment.reasons.join(" | ")} | parsed title=${JSON.stringify(typeof enrichedSlideRecord.title === "string" ? enrichedSlideRecord.title : "")} | parsed goal=${JSON.stringify(typeof enrichedSlideRecord.learningGoal === "string" ? enrichedSlideRecord.learningGoal : "")} | parsed keyPoints=${JSON.stringify(toStringArray(enrichedSlideRecord.keyPoints))}`,
        );
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[slidespeech] ${this.name} plain-text slide enrichment attempt ${attemptIndex + 1} failed for "${slide.title}": ${lastError.message}`,
        );
        if (/reasoning (?:metadata|content)|only reasoning/i.test(lastError.message)) {
          break;
        }
      }
    }

    const roleSpecificRecovery = buildRoleSpecificSlideRecoveryFromContext(
      input,
      deck,
      slide,
      contract,
    );
    if (roleSpecificRecovery) {
      console.warn(
        `[slidespeech] ${this.name} recovered slide "${slide.title}" from role-specific context after enrichment failures.`,
      );
      return roleSpecificRecovery;
    }

    const groundedRecovery = buildGroundedSlideRecoveryFromContext(
      input,
      deck,
      slide,
      contract,
    );
    if (groundedRecovery) {
      console.warn(
        `[slidespeech] ${this.name} recovered slide "${slide.title}" from grounded context after enrichment failures.`,
      );
      return groundedRecovery;
    }

    throw lastError ?? new Error(`Slide enrichment failed for "${slide.title}".`);
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    const previousSlide = input.deck.slides[input.slide.order - 1];
    const nextSlide = input.deck.slides[input.slide.order + 1];
    const tryPlainTextNarration = async (
      maxTokens: number,
      timeoutMs?: number,
      tokenAttempts?: number[],
    ): Promise<SlideNarration> => {
      const narrationText = await this.chatText(
        [
          {
            role: "system",
            content:
              "Write spoken narration for a presentation slide. Do not use JSON or markdown. Speak directly to an audience, stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Deck language: ${input.deck.metadata.language}`,
              `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
              `Slide title: ${input.slide.title}`,
              `Learning goal: ${input.slide.learningGoal}`,
              `Key points: ${input.slide.keyPoints.join("; ")}`,
              `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
              `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
              `Visible diagram nodes: ${input.slide.visuals.diagramNodes.map((node) => node.label).join("; ") || "None"}`,
              `Speaker notes: ${input.slide.speakerNotes.join("; ") || "None"}`,
              previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
              nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
              input.slide.order === 0
                ? `Write exactly 4 short spoken paragraphs for the opening in ${input.deck.metadata.language}. Separate them with blank lines. The first paragraph must be a clear presenter intro, for example "Welcome everyone..." in English or "Välkomna..." in Swedish, before moving into the first substantive point.`
                : `Write exactly 3 short spoken paragraphs for this slide in ${input.deck.metadata.language}. Separate them with blank lines. Each paragraph must clearly relate to the visible slide content and present the idea directly.`,
            ].join("\n"),
          },
        ],
        {
          maxTokens,
          ...(timeoutMs ? { timeoutMs } : {}),
          ...(tokenAttempts ? { tokenAttempts } : {}),
        },
      );

      const narration = buildNarrationFromPlainText(
        narrationText,
        input.slide,
        input.deck,
      );

      if (!narration) {
        throw new Error(
          "Plain-text narration did not pass local grounding and quality checks.",
        );
      }

      return narration;
    };

    let lastError: Error | null = null;
    const narrationStrategies: Array<{
      label: string;
      run: () => Promise<SlideNarration>;
    }> =
      input.slide.order === 0
        ? [
            {
              label: "plain-text primary",
              run: () => tryPlainTextNarration(3000, 40000, [3000, 4200, 5600]),
            },
            {
              label: "plain-text retry",
              run: () => tryPlainTextNarration(3600, 50000, [3600, 5200, 6800]),
            },
          ]
        : [
            {
              label: "plain-text primary",
              run: () => tryPlainTextNarration(2200, 30000, [2200, 3200, 4400]),
            },
          ];

    for (const strategy of narrationStrategies) {
      try {
        return await strategy.run();
      } catch (plainTextError) {
        lastError = plainTextError as Error;
        console.warn(
          `[slidespeech] ${this.name} narration ${strategy.label} path failed for "${input.slide.title}": ${lastError.message}`,
        );
      }
    }

    try {
      const compactNarrationText = await this.chatText(
        [
          {
            role: "system",
            content:
              "Write concise spoken narration for one teaching slide. Do not use JSON. Stay tightly grounded in the visible slide, avoid presentation-making advice, do not talk about the slide itself or its title, and stay in the deck language.",
          },
          {
            role: "user",
            content: [
              `Topic: ${input.deck.topic}`,
              `Deck language: ${input.deck.metadata.language}`,
              `Slide title: ${input.slide.title}`,
              `Learning goal: ${input.slide.learningGoal}`,
              `Key points: ${input.slide.keyPoints.join("; ")}`,
              `Visible cards: ${input.slide.visuals.cards.map((card) => `${card.title}: ${card.body}`).join(" | ") || "None"}`,
              `Visible callouts: ${input.slide.visuals.callouts.map((callout) => `${callout.label}: ${callout.text}`).join(" | ") || "None"}`,
              previousSlide ? `Previous slide: ${previousSlide.title}` : "Previous slide: none",
              nextSlide ? `Next slide: ${nextSlide.title}` : "Next slide: none",
              input.slide.order === 0
                ? `Write exactly 4 short spoken lines in ${input.deck.metadata.language}, one per line, for the opening. The first line must be a clear presenter intro before the first content claim.`
                : `Write exactly 3 short spoken lines in ${input.deck.metadata.language}, one per line, for this slide.`,
            ].join("\n"),
          },
        ],
        {
          maxTokens: input.slide.order === 0 ? 1800 : 1400,
          timeoutMs: 25000,
          tokenAttempts: input.slide.order === 0 ? [1800, 2600] : [1400, 2200],
        },
      );

      const compactNarration = buildNarrationFromPlainText(
        compactNarrationText,
        input.slide,
        input.deck,
      );

      if (!compactNarration) {
        throw new Error(
          "Compact plain-text narration did not pass local grounding and quality checks.",
        );
      }

      return compactNarration;
    } catch (compactPlainTextError) {
      lastError = compactPlainTextError as Error;
      console.warn(
        `[slidespeech] ${this.name} narration compact plain-text path failed for "${input.slide.title}": ${lastError.message}`,
      );
    }

    try {
      return SlideNarrationSchema.parse(
        normalizeNarrationForSlide({}, input.slide, input.deck),
      );
    } catch (fallbackError) {
      lastError = fallbackError as Error;
      console.warn(
        `[slidespeech] ${this.name} narration deterministic fallback failed for "${input.slide.title}": ${lastError.message}`,
      );
    }

    try {
      return buildFallbackNarrationForSlide(input.slide, input.deck);
    } catch (finalFallbackError) {
      lastError = finalFallbackError as Error;
    }

    throw lastError ?? new Error(`${this.name} narration generation failed.`);
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    const visibleCards = input.slide.visuals.cards
      .slice(0, 2)
      .map((card) => `${card.title}: ${card.body}`)
      .join(" | ");
    const visibleCallouts = input.slide.visuals.callouts
      .slice(0, 2)
      .map((callout) => `${callout.label}: ${callout.text}`)
      .join(" | ");
    const slideExample = input.slide.examples[0]?.trim() || "None";
    const normalizeShortAnswer = (value: string): string => {
      const trimmed = value.replace(/\s+/g, " ").trim();
      if (!trimmed) {
        return trimmed;
      }

      return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    };

    if (input.answerMode === "grounded_factual" && input.sourceGroundingContext) {
      try {
        const groundedAnswer = await this.chatToolCall({
          functionName: "return_grounded_factual_answer",
          functionDescription:
            "Return whether the grounded source context directly supports a short factual answer.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["answerable", "answer"],
            properties: {
              answerable: {
                type: "boolean",
              },
              answer: {
                type: "string",
              },
            },
          },
          messages: [
            {
              role: "system",
              content: [
                "You answer short factual questions for an AI presentation runtime.",
                "Use only the provided grounded source context.",
                "Do not use slide text, broader deck context, or outside knowledge.",
                "If the grounded source context does not directly support the answer, set answerable=false and leave answer empty.",
                "Call the provided tool and do not answer in plain text.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Deck topic: ${input.deck.topic}`,
                `Question: ${input.question}`,
                `Grounded source context: ${input.sourceGroundingContext}`,
                "If a short list or contact-style excerpt directly contains the fact, you may extract it.",
                "Keep the answer short and direct.",
              ].join("\n"),
            },
          ],
          maxTokens: 500,
          timeoutMs: 7000,
          tokenAttempts: [500, 800, 1200],
          parse: (value) => {
            if (
              typeof value !== "object" ||
              value === null ||
              typeof (value as { answerable?: unknown }).answerable !== "boolean" ||
              typeof (value as { answer?: unknown }).answer !== "string"
            ) {
              throw new Error("Grounded factual answer tool returned an invalid payload.");
            }

            return {
              answerable: (value as { answerable: boolean }).answerable,
              answer: (value as { answer: string }).answer,
            };
          },
        });

        if (!groundedAnswer.answerable || !groundedAnswer.answer.trim()) {
          return {
            text: "I do not have a reliable answer to that from the current slide or the available source material.",
          };
        }

        return {
          text: normalizeShortAnswer(groundedAnswer.answer),
        };
      } catch (error) {
        console.warn(
          `[slidespeech] ${this.name} grounded factual tool-call path failed: ${(error as Error).message}`,
        );
      }
    }

    const answerInstruction =
      input.answerMode === "example"
        ? "Give one concrete example. Do not just restate the slide."
        : input.answerMode === "grounded_factual"
          ? "Answer only if the available grounded context supports it. If a short list, navigation excerpt, or contact-style excerpt directly carries the fact, you may extract the fact from it. If the context still does not support the fact, say that briefly."
          : input.answerMode === "summarize_current_slide"
            ? "State the main point of the current slide in direct language."
            : "Answer the user's question directly. Prefer concrete wording over abstract framing. If the question asks for a concrete fact that the context does not actually provide, say that briefly instead of replying with a generic summary.";
    const preferredAnswerLanguage = input.deck.metadata.language || "en";
    const text = await this.chatText([
      {
        role: "system",
        content:
          input.answerMode === "grounded_factual"
            ? `You are a fast AI presentation assistant. Answer using at most 3 short sentences. Answer in the same language as the user's question when that is clear; otherwise use the deck language (${preferredAnswerLanguage}). Use only the provided grounded source context. Do not use the slide text, the broader deck context, or outside knowledge. If the grounded source context does not support the answer, say that briefly instead of bluffing.`
            : `You are a fast AI presentation assistant. Answer using at most 4 short sentences. Answer in the same language as the user's question when that is clear; otherwise use the deck language (${preferredAnswerLanguage}). Prefer the current slide, but use broader deck context or source grounding when they clearly answer the question better. If the available context still does not support the answer, say that briefly instead of bluffing. Do not replace a missing concrete fact with a generic description of the company, topic, or slide.`,
      },
      {
        role: "user",
        content:
          input.answerMode === "grounded_factual"
            ? [
                `Deck topic: ${input.deck.topic}`,
                `Question: ${input.question}`,
                input.sourceGroundingContext
                  ? `Source grounding context: ${input.sourceGroundingContext}`
                  : "Source grounding context: None",
                answerInstruction,
              ].join("\n")
            : [
                `Topic: ${input.deck.topic}`,
                `Slide title: ${input.slide.title}`,
                `Slide learning goal: ${input.slide.learningGoal}`,
                `Visible key points: ${input.slide.keyPoints.join("; ")}`,
                `Visible cards: ${visibleCards || "None"}`,
                `Visible callouts: ${visibleCallouts || "None"}`,
                `Example on this slide: ${slideExample}`,
                `Question: ${input.question}`,
                `Beginner explanation: ${input.slide.beginnerExplanation}`,
                input.broaderDeckContext
                  ? `Broader deck context: ${input.broaderDeckContext}`
                  : null,
                input.sourceGroundingContext
                  ? `Source grounding context: ${input.sourceGroundingContext}`
                  : null,
                answerInstruction,
                "Do not mention the presentation, deck, or slide unless the user asks about them.",
              ].join("\n"),
      },
    ], {
      maxTokens: input.answerMode === "grounded_factual" ? 700 : 1200,
      timeoutMs: input.answerMode === "grounded_factual" ? 9000 : 18000,
      tokenAttempts:
        input.answerMode === "grounded_factual" ? [700, 1000] : [1200, 1600],
      disableLmStudioBudgetLift: true,
    });

    return { text: normalizeShortAnswer(text) };
  }

  async validateQuestionAnswer(
    input: ValidateQuestionAnswerInput,
  ): Promise<AnswerValidationResult> {
    return this.chatToolCall({
      functionName: "return_answer_validation",
      functionDescription:
        "Decide whether the proposed answer directly and honestly answers the user's question.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["isValid", "reason"],
        properties: {
          isValid: {
            type: "boolean",
          },
          reason: {
            type: "string",
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You validate answers in an AI presentation runtime.",
            "Approve only when the proposed answer directly addresses the user's question.",
            "Reject answers that dodge the question, drift into generic company or topic summaries, paste navigation or homepage sludge, or claim a grounded fact that is not actually supported.",
            "For grounded factual questions, require that the answer contain the concrete fact requested or explicitly and honestly state that the fact is not available.",
            "Call the provided tool and do not answer in plain text.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Deck topic: ${input.deck.topic}`,
            `Slide title: ${input.slide.title}`,
            `Question: ${input.question}`,
            `Answer mode: ${input.answerMode ?? "general_contextual"}`,
            `Proposed answer: ${input.proposedAnswer}`,
            input.broaderDeckContext
              ? `Broader deck context: ${input.broaderDeckContext}`
              : null,
            input.sourceGroundingContext
              ? `Source grounding context: ${input.sourceGroundingContext}`
              : null,
          ]
            .filter((value): value is string => Boolean(value))
            .join("\n"),
        },
      ],
      maxTokens: 300,
      timeoutMs: 7000,
      tokenAttempts: [300, 500],
      parse: (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          typeof (value as { isValid?: unknown }).isValid !== "boolean" ||
          typeof (value as { reason?: unknown }).reason !== "string"
        ) {
          throw new Error("Answer validation tool returned an invalid payload.");
        }

        return {
          isValid: (value as { isValid: boolean }).isValid,
          reason: (value as { reason: string }).reason,
        };
      },
    });
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Rewrite explanations in simpler English with short sentences and one analogy.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Current explanation: ${input.slide.beginnerExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Expand explanations for an advanced learner in English. Mention tradeoffs if relevant.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Advanced explanation seed: ${input.slide.advancedExplanation}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1800,
      timeoutMs: 18000,
      tokenAttempts: [1800, 3000],
    });

    return { text };
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content:
          "Generate one concrete example in English for a teaching presentation.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slide title: ${input.slide.title}`,
          `Example seeds: ${input.slide.examples.join("; ")}`,
        ].join("\n"),
      },
    ], {
      maxTokens: 1600,
      timeoutMs: 15000,
      tokenAttempts: [1600, 2600],
    });

    return { text };
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    const text = await this.chatText([
      {
        role: "system",
        content: "Summarize teaching material in English using three short paragraphs.",
      },
      {
        role: "user",
        content: [
          `Topic: ${input.deck.topic}`,
          `Slides: ${input.slides.map((slide) => `${slide.title}: ${slide.learningGoal}`).join(" | ")}`,
        ].join("\n"),
      },
    ], { maxTokens: 1400, timeoutMs: 30000 });

    return { text };
  }

  async reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
    const system = [
      "You are a strict semantic QA reviewer for generated teaching decks.",
      "Judge meaning, language consistency, slide-role fidelity, source grounding, prompt leakage, and whether the copy is audience-facing.",
      "Do not rewrite the deck. Return issue labels and concrete revision instructions only.",
      "Do not penalize the deck merely for being concise. Penalize generic filler, unsupported claims, wrong-language or mixed-language output, repeated slide roles, and template repair language.",
      "Prompt leakage means exposed instructions, schema/tool text, source-role labels, URLs, brief wording, or mentions of slides/decks/templates/presentation generation. Do not call ordinary subject-mechanism descriptions prompt leakage.",
      "Do not call ordinary value propositions, role-specific examples, review checks, or safety constraints prompt leakage merely because they summarize why the topic matters.",
      "For workshop decks, concrete participant tasks, role examples, review steps, and action-oriented exercise wording are valid audience-facing content when they are specific and complete.",
      "Native organization names, acronyms, and source-language proper nouns do not by themselves make a deck mixed-language.",
      "Learning goals may describe what a system, mechanism, process, or organization does when that statement would help the audience understand the subject.",
      "For how-it-works decks, a scenario such as a learner interrupting a lesson is subject content, not prompt leakage, if the points explain the mechanism.",
      "The deck outline uses reviewer labels such as Slide, Visible subtitle, and Visible points. These labels are not part of the generated deck and must not be cited as prompt leakage.",
      "Do not fail a deck solely because a final title is concise, as long as the final slide contains concrete audience-facing content.",
      "Do not penalize a concise final-slide invitation for audience questions when it appears only as part of the closing slide.",
      "For procedural/how-to decks, concrete action-oriented guidance is acceptable and often preferred when it is specific, safe, and audience-facing.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");
    const user = [
      `Requested topic: ${input.generationInput.topic}`,
      input.generationInput.presentationBrief
        ? `Presentation brief: ${input.generationInput.presentationBrief}`
        : null,
      input.generationInput.intent
        ? `Intent: ${JSON.stringify(input.generationInput.intent)}`
        : null,
      input.generationInput.groundingSummary
        ? `Grounding summary: ${input.generationInput.groundingSummary}`
        : "Grounding summary: none",
      input.generationInput.groundingHighlights?.length
        ? `Grounding highlights: ${input.generationInput.groundingHighlights.join(" | ")}`
        : null,
      input.generationInput.revisionGuidance
        ? `Previous revision guidance: ${input.generationInput.revisionGuidance}`
        : null,
      `Generated deck title: ${input.deck.title}`,
      `Generated deck language: ${input.deck.metadata.language}`,
      `Generated deck summary: ${input.deck.summary}`,
      `Audience: ${input.pedagogicalProfile.audienceLevel}`,
      `Deck outline:\n${input.deck.slides
        .map((slide) => buildCompactDeckReviewSummary(slide))
        .join("\n\n")}`,
      "Return fields: approved, score, summary, issues.",
      "Issue code must be one of: prompt_leakage, wrong_language, mixed_language, role_drift, template_language, unsupported_claim, fragmentary_copy, source_noise, repetitive_copy, weak_opening, weak_closing, other.",
      "Issue severity must be info, warning, or error.",
      "Each issue must include message and revisionInstruction. Include slideId when the issue is slide-specific.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    return this.chatToolCall({
      functionName: "return_deck_semantic_review",
      functionDescription:
        "Return the semantic QA review for a generated teaching deck before it is accepted.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["approved", "score", "summary", "issues"],
        properties: {
          approved: { type: "boolean" },
          score: { type: "number", minimum: 0, maximum: 1 },
          summary: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "severity", "message", "revisionInstruction"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "prompt_leakage",
                    "wrong_language",
                    "mixed_language",
                    "role_drift",
                    "template_language",
                    "unsupported_claim",
                    "fragmentary_copy",
                    "source_noise",
                    "repetitive_copy",
                    "weak_opening",
                    "weak_closing",
                    "other",
                  ],
                },
                severity: {
                  type: "string",
                  enum: ["info", "warning", "error"],
                },
                slideId: { type: "string" },
                message: { type: "string" },
                revisionInstruction: { type: "string" },
              },
            },
          },
        },
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 1800,
      timeoutMs: 12000,
      tokenAttempts: [1800, 2600],
      disableLmStudioBudgetLift: true,
      parse: normalizeDeckSemanticReviewResult,
    });
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    const narrationBySlideId = new Map(
      input.narrations.map((narration) => [narration.slideId, narration]),
    );
    const detailedSlides = input.deck.slides.filter((slide) =>
      narrationNeedsDetailedReview(
        input.deck,
        slide,
        narrationBySlideId.get(slide.id),
      ),
    );
    const slidesForDetailedReview = (
      detailedSlides.length > 0 ? detailedSlides : input.deck.slides.slice(0, 2)
    ).slice(0, 2);

    const deckReviewSystem = [
      "You are a strict presentation QA reviewer for an interactive AI teacher.",
      "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether the slides form a strong teaching sequence.",
      "Judge the deck itself in this step. Do not rewrite narration here.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");

    const deckReviewUser = [
      `Deck title: ${input.deck.title}`,
      `Deck topic: ${input.deck.topic}`,
      `Deck summary: ${input.deck.summary}`,
      `Audience: ${input.pedagogicalProfile.audienceLevel}`,
      `Deck outline:\n${input.deck.slides
        .map((slide) => buildCompactDeckReviewSummary(slide))
        .join("\n\n")}`,
      "Return fields: approved, overallScore, summary, issues.",
      "Issue fields: code, severity, dimension, message, optional slideId.",
      "Valid dimensions: deck, visual, coherence, grounding.",
    ].join("\n");

    try {
      const deckReview = await this.chatToolCall({
        functionName: "return_presentation_deck_review",
        functionDescription:
          "Return the structured QA review for the deck itself, excluding narration rewrites.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["approved", "overallScore", "summary", "issues"],
          properties: {
            approved: {
              type: "boolean",
            },
            overallScore: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            summary: {
              type: "string",
            },
            issues: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "severity", "dimension", "message"],
                properties: {
                  code: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["info", "warning", "error"],
                  },
                  dimension: {
                    type: "string",
                    enum: ["deck", "visual", "coherence", "grounding"],
                  },
                  message: { type: "string" },
                  slideId: { type: "string" },
                },
              },
            },
          },
        },
        messages: [
          { role: "system", content: deckReviewSystem },
          { role: "user", content: deckReviewUser },
        ],
        maxTokens: 2600,
        timeoutMs: 18000,
        tokenAttempts: [2600, 3600, 5200],
        parse: (value) => normalizeDeckReviewResult(value),
      });

      let repairedNarrations: SlideNarration[] = [];

      if (slidesForDetailedReview.length > 0) {
        const narrationRepairSystem = [
          "You repair slide narration for an interactive AI teacher.",
          "Only rewrite narration for the provided target slides.",
          "Keep each repair tightly tied to the slide's visible content without reading the slide verbatim.",
          "Do not talk about the slide itself, its title, or the presentation process.",
          "Call the provided tool and do not answer in plain text.",
        ].join(" ");

        const narrationRepairUser = [
          `Deck topic: ${input.deck.topic}`,
          `Deck language: ${input.deck.metadata.language}`,
          `Narration repair targets:\n${slidesForDetailedReview
            .map((slide) =>
              buildCompactNarrationRepairSummary(
                slide,
                narrationBySlideId.get(slide.id),
              ),
            )
            .join("\n\n")}`,
          `Any repaired narration must stay tightly tied to that slide's visible content, stay in the deck language (${input.deck.metadata.language}), and keep 4 to 6 segments for slide 1 and 3 to 5 segments for other slides.`,
          "Return fields: repairedNarrations.",
          "Only include repairedNarrations for slides whose narration should be replaced.",
        ].join("\n");

        try {
          repairedNarrations = await this.chatToolCall({
            functionName: "return_narration_repairs",
            functionDescription:
              "Return only the narration repairs needed for the provided target slides.",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["repairedNarrations"],
              properties: {
                repairedNarrations: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "slideId",
                      "narration",
                      "segments",
                      "summaryLine",
                      "promptsForPauses",
                      "suggestedTransition",
                    ],
                    properties: {
                      slideId: { type: "string" },
                      narration: { type: "string" },
                      segments: {
                        type: "array",
                        items: { type: "string" },
                      },
                      summaryLine: { type: "string" },
                      promptsForPauses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      suggestedTransition: { type: "string" },
                    },
                  },
                },
              },
            },
            messages: [
              { role: "system", content: narrationRepairSystem },
              { role: "user", content: narrationRepairUser },
            ],
            maxTokens: 2400,
            timeoutMs: 18000,
            tokenAttempts: [2400, 3600, 5200],
            parse: (value) => normalizeNarrationRepairResult(value, input),
          });
        } catch (error) {
          console.warn(
            `[slidespeech] ${this.name} narration repair path failed: ${(error as Error).message}`,
          );
        }
      }

      return PresentationReviewSchema.parse({
        ...deckReview,
        repairedNarrations,
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call review path failed: ${(error as Error).message}`,
      );
    }

    return this.chatJson({
      schemaName: "PresentationReview",
      system: [
        "You are a strict presentation QA reviewer for an interactive AI teacher.",
        "Evaluate whether the deck is coherent, whether the visuals fit the topic, and whether each slide narration is clearly about the visible slide without reading it verbatim.",
        "If a narration is weak or drifts away from the slide, rewrite only that slide narration.",
        "Do not rewrite the whole deck. Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        deckReviewUser,
        `Detailed review targets:\n${slidesForDetailedReview
          .map((slide) =>
            buildCompactNarrationRepairSummary(
              slide,
              narrationBySlideId.get(slide.id),
            ),
          )
          .join("\n\n")}`,
        "Return fields: approved, overallScore, summary, issues, repairedNarrations.",
        "Valid dimensions: deck, visual, narration, coherence, grounding.",
      ].join("\n"),
      parse: (value) =>
        PresentationReviewSchema.parse(normalizePresentationReview(value, input)),
    });
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    const transcriptWindow = input.transcript
      .slice(-6)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n");

    const system = [
      "You are a conversation planner for an AI teacher runtime.",
      "Treat the learner's turn as freeform conversation first, not as a command parser.",
      "Infer both pedagogical needs and runtime side effects.",
      "Call the provided tool and do not answer in plain text.",
    ].join(" ");
    const user = [
      `Topic: ${input.deck.topic}`,
      `Current slide title: ${input.slide.title}`,
      `Current slide learning goal: ${input.slide.learningGoal}`,
      `Current session state: ${input.session.state}`,
      `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
      `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
      `User turn: ${input.text}`,
      "Return a structured conversation plan through the tool.",
      "Use interruptionType=question by default for freeform learner input.",
      "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
      "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
      "Concrete factual questions about locations, countries, offices, dates, counts, certifications, customers, or legal/organizational facts should normally use grounded_factual when sources are available.",
      "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
      "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
    ].join("\n");

    try {
      return await this.chatToolCall({
        functionName: "return_turn_plan",
        functionDescription:
          "Return the structured learner-turn classification for the teaching runtime.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: [
            "interruptionType",
            "inferredNeeds",
            "responseMode",
            "runtimeEffects",
            "confidence",
            "rationale",
          ],
          properties: {
            interruptionType: {
              type: "string",
              enum: [
                "stop",
                "question",
                "simplify",
                "deepen",
                "example",
                "back",
                "repeat",
                "continue",
                "unknown",
              ],
            },
            inferredNeeds: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "question",
                  "confusion",
                  "example",
                  "deepen",
                  "repeat",
                  "navigation",
                  "pause",
                  "resume",
                ],
              },
            },
            responseMode: {
              type: "string",
              enum: [
                "ack_pause",
                "ack_resume",
                "ack_back",
                "question",
                "summarize_current_slide",
                "general_contextual",
                "grounded_factual",
                "simplify",
                "deepen",
                "example",
                "repeat",
              ],
            },
            runtimeEffects: {
              type: "object",
              additionalProperties: false,
              properties: {
                pause: { type: "boolean" },
                resume: { type: "boolean" },
                goToPreviousSlide: { type: "boolean" },
                restartCurrentSlide: { type: "boolean" },
                adaptDetailLevel: {
                  type: "string",
                  enum: ["light", "standard", "deep"],
                },
                adaptPace: {
                  type: "string",
                  enum: ["slow", "balanced", "fast"],
                },
              },
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            rationale: {
              type: "string",
            },
          },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxTokens: 600,
        timeoutMs: 5000,
        parse: (value) =>
          ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
      });
    } catch (error) {
      console.warn(
        `[slidespeech] ${this.name} tool-call planner path failed: ${(error as Error).message}`,
      );
    }

    return this.chatJson<ConversationTurnPlan>({
      schemaName: "ConversationTurnPlan",
      system: [
        "You are a conversation planner for an AI teacher runtime.",
        "Treat the learner's turn as freeform conversation first, not as a command parser.",
        "Infer both pedagogical needs and runtime side effects.",
        "Return valid JSON only and no markdown.",
      ].join(" "),
      user: [
        `Topic: ${input.deck.topic}`,
        `Current slide title: ${input.slide.title}`,
        `Current slide learning goal: ${input.slide.learningGoal}`,
        `Current session state: ${input.session.state}`,
        `Pedagogical profile: audience=${input.session.pedagogicalProfile.audienceLevel}, detail=${input.session.pedagogicalProfile.detailLevel}, pace=${input.session.pedagogicalProfile.pace}`,
        `Recent transcript:\n${transcriptWindow || "No prior transcript."}`,
        `User turn: ${input.text}`,
        "Return fields: interruptionType, inferredNeeds, responseMode, runtimeEffects, confidence, rationale.",
        "Valid interruptionType values: stop, question, simplify, deepen, example, back, repeat, continue, unknown.",
        "Valid responseMode values: ack_pause, ack_resume, ack_back, question, summarize_current_slide, general_contextual, grounded_factual, simplify, deepen, example, repeat.",
        "Valid inferredNeeds values: question, confusion, example, deepen, repeat, navigation, pause, resume.",
        "Use interruptionType=question by default for freeform learner input.",
        "Use responseMode=summarize_current_slide when the learner asks for the main point, key takeaway, or a short summary of the current slide.",
        "Use responseMode=grounded_factual when the learner asks for specific factual information that likely depends on grounded source material or external facts rather than just the current slide wording.",
        "Concrete factual questions about locations, countries, offices, dates, counts, certifications, customers, or legal/organizational facts should normally use grounded_factual when sources are available.",
        "Use responseMode=general_contextual for ordinary conceptual questions that should be answered from the current slide plus the broader deck context.",
        "Use responseMode=question only when you are unsure whether general_contextual or grounded_factual is the better route.",
      ].join("\n"),
      maxTokens: 220,
      timeoutMs: 4000,
      tokenAttempts: [220],
      disableLmStudioBudgetLift: true,
      parse: (value) =>
        ConversationTurnPlanSchema.parse(normalizeConversationPlan(value)),
    });
  }

  protected buildHeaders(): HeadersInit {
    return this.apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        }
      : {
          "Content-Type": "application/json",
        };
  }

  protected async chatText(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tokenAttempts?: number[] | undefined;
      disableLmStudioBudgetLift?: boolean | undefined;
    },
  ): Promise<string> {
    const attempts = this.normalizeTokenAttempts(options);

    let lastEmptyReasoning = false;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          options?.timeoutMs,
          maxTokens,
          options?.disableLmStudioBudgetLift,
        ),
      });

      const choice = json.choices?.[0];
      const content = choice?.message?.content?.trim();
      if (content) {
        return content;
      }

      const reasoningContent = choice?.message?.reasoning_content?.trim();
      lastEmptyReasoning = Boolean(reasoningContent);

      if (
        reasoningContent &&
        choice?.finish_reason === "length" &&
        attemptIndex < attempts.length - 1
      ) {
        console.warn(
          `[slidespeech] ${this.name} returned only reasoning content at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      if (reasoningContent && this.isLmStudioProvider()) {
        const extractedReasoningText = parseLmStudioReasoningText(reasoningContent);
        if (extractedReasoningText) {
          console.warn(
            `[slidespeech] ${this.name} returned final text inside structured reasoning_content; extracted text field as a local LM Studio fallback.`,
          );
          return extractedReasoningText;
        }

        if (
          (looksLikeStructuredReasoningPayload(reasoningContent) ||
            looksLikeReasoningTrace(reasoningContent)) &&
          attemptIndex < attempts.length - 1
        ) {
          console.warn(
            `[slidespeech] ${this.name} returned reasoning metadata without a usable final text at max_tokens=${maxTokens}; retrying with a larger token budget.`,
          );
          continue;
        }

        if (
          looksLikeStructuredReasoningPayload(reasoningContent) ||
          looksLikeReasoningTrace(reasoningContent)
        ) {
          break;
        }

        console.warn(
          `[slidespeech] ${this.name} returned final text in reasoning_content; using it as a local LM Studio fallback.`,
        );
        return reasoningContent;
      }

      break;
    }

    throw new Error(
      lastEmptyReasoning
        ? `${this.name} returned only reasoning content without a final answer.`
        : `${this.name} returned an empty response.`,
    );
  }

  protected async chatJson<T>(input: {
    schemaName: string;
    system: string;
    user: string;
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const attempts = this.normalizeTokenAttempts(input);
    let lastError: Error | null = null;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion([
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ], {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          input.timeoutMs,
          maxTokens,
          input.disableLmStudioBudgetLift,
        ),
      });
      const choice = json.choices?.[0];

      for (const candidateText of getChatChoiceTextCandidates(choice)) {
        try {
          const jsonText = extractJsonFromText(candidateText);
          const parsed = JSON.parse(jsonText) as unknown;
          return input.parse(parsed);
        } catch (error) {
          lastError = error as Error;
        }
      }

      if (
        attemptIndex < attempts.length - 1 &&
        (choice?.finish_reason === "length" ||
          Boolean(choice?.message?.reasoning_content?.trim()))
      ) {
        console.warn(
          `[slidespeech] ${this.name} returned unparsable JSON for ${input.schemaName} at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      break;
    }

    throw lastError ?? new Error(`${this.name} returned no JSON for ${input.schemaName}.`);
  }

  protected async chatToolCall<T>(input: {
    functionName: string;
    functionDescription: string;
    parameters: Record<string, unknown>;
    messages: ChatMessage[];
    parse: (value: unknown) => T;
    maxTokens?: number | undefined;
    timeoutMs?: number | undefined;
    tokenAttempts?: number[] | undefined;
    disableLmStudioBudgetLift?: boolean | undefined;
  }): Promise<T> {
    const attempts =
      input.tokenAttempts && input.tokenAttempts.length > 0
        ? [...new Set(input.tokenAttempts.filter((value) => Number.isFinite(value) && value > 0))]
        : [input.maxTokens ?? 800];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const maxTokens = attempts[attemptIndex]!;
      const json = await this.requestChatCompletion(input.messages, {
        maxTokens,
        timeoutMs: this.resolveRequestTimeout(
          input.timeoutMs,
          maxTokens,
          input.disableLmStudioBudgetLift,
        ),
        tools: [
          {
            type: "function",
            function: {
              name: input.functionName,
              description: input.functionDescription,
              parameters: input.parameters,
            },
          },
        ],
        toolChoice: "required",
        extraBody: this.isLmStudioProvider()
          ? {
              chat_template_kwargs: {
                enable_thinking: false,
              },
            }
          : undefined,
      });

      const choice = json.choices?.[0];
      const toolArguments =
        choice?.message?.tool_calls?.[0]?.function?.arguments?.trim();

      if (toolArguments) {
        return input.parse(JSON.parse(toolArguments));
      }

      for (const candidateText of getChatChoiceTextCandidates(choice)) {
        try {
          const jsonText = extractJsonFromText(candidateText);
          return input.parse(JSON.parse(jsonText) as unknown);
        } catch {
          // Some LM Studio structured-output modes emit XML-like tool markup
          // inside reasoning_content instead of OpenAI-compatible tool_calls.
        }

        const taggedToolCall = parseLmStudioTaggedToolCall(
          candidateText,
          input.functionName,
        );
        if (taggedToolCall) {
          return input.parse(taggedToolCall);
        }
      }

      const shouldRetry =
        attemptIndex < attempts.length - 1 &&
        (choice?.finish_reason === "length" ||
          Boolean(choice?.message?.reasoning_content?.trim()) ||
          Boolean(choice?.message?.content?.trim()));

      if (shouldRetry) {
        console.warn(
          `[slidespeech] ${this.name} returned no tool arguments for ${input.functionName} at max_tokens=${maxTokens}; retrying with a larger token budget.`,
        );
        continue;
      }

      const finishReason = choice?.finish_reason
        ? ` finish_reason=${choice.finish_reason}.`
        : "";
      throw new Error(
        `${this.name} returned no tool arguments for ${input.functionName}.${finishReason}`,
      );
    }

    throw new Error(
      `${this.name} returned no tool arguments for ${input.functionName} after exhausting token attempts.`,
    );
  }

  private async requestChatCompletion(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number | undefined;
      timeoutMs?: number | undefined;
      tools?: unknown;
      toolChoice?: string | undefined;
      extraBody?: Record<string, unknown> | undefined;
    },
  ): Promise<ChatCompletionResponse> {
    let response: Response;
    const lmStudioNoThinkingBody = this.isLmStudioProvider()
      ? {
          chat_template_kwargs: {
            enable_thinking: false,
          },
        }
      : {};

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages,
          ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options?.tools ? { tools: options.tools } : {}),
          ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          ...lmStudioNoThinkingBody,
          ...(options?.extraBody ?? {}),
        }),
        signal: AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") {
        throw new Error(
          `${this.name} request timed out after ${options?.timeoutMs ?? this.timeoutMs}ms`,
        );
      }

      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.name} request failed with status ${response.status}${
          detail ? `: ${detail.slice(0, 400)}` : ""
        }`,
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  private buildCompactDeckPrompt(
    input: GenerateDeckInput,
    mode: "compact" | "minimal",
  ): string {
    const header = [
      ...buildIntentPromptLines(input),
      input.groundingHighlights?.length
        ? `Grounding highlights: ${input.groundingHighlights.join("; ")}`
        : "No grounding highlights were provided.",
      input.groundingCoverageGoals?.length
        ? `Outline coverage goals: ${input.groundingCoverageGoals.join("; ")}`
        : "No explicit outline coverage goals were provided.",
      `Audience: ${input.pedagogicalProfile.audienceLevel}`,
      `Title direction: ${input.plan?.title ?? input.topic}`,
      `Learning objectives: ${(input.plan?.learningObjectives ?? []).join("; ") || "Keep the audience oriented and concrete."}`,
      `Storyline: ${(input.plan?.storyline ?? []).join(" -> ") || "orientation -> structure -> example -> recap"}`,
      input.targetDurationMinutes
        ? `Target duration: about ${input.targetDurationMinutes} minutes.`
        : null,
      input.targetSlideCount
        ? `Target slide count: about ${input.targetSlideCount} slides.`
        : null,
      input.groundingSummary
        ? `Grounding summary: ${compactGroundingSummary(input.groundingSummary)}`
        : "No external grounding summary was provided.",
      input.groundingExcerpts?.length
        ? `Grounded source excerpts:\n${input.groundingExcerpts
            .slice(0, 8)
            .map((value) => `- ${value}`)
            .join("\n")}`
        : "No grounded source excerpts were provided.",
      input.groundingFacts?.length
        ? `Role-scoped grounding facts:\n${input.groundingFacts
            .slice(0, 12)
            .map(
              (fact) =>
                `- [${fact.role}/${fact.confidence}] ${fact.claim} (${fact.sourceIds.join(", ") || "source unspecified"})`,
            )
            .join("\n")}`
        : null,
      input.slideBriefs?.length
        ? `Slide briefs:\n${input.slideBriefs
            .map(
              (brief) =>
                `- Slide ${brief.index + 1}: ${brief.role}. Claims: ${brief.requiredClaims.join(" | ") || "use contract"}`,
            )
            .join("\n")}`
        : null,
      input.revisionGuidance
        ? `Revision guidance from the previous weak draft: ${summarizeRevisionGuidance(input.revisionGuidance)}`
        : null,
      input.groundingSummary
        ? "Use the grounding summary as the factual source of truth. If details are sparse, stay generic rather than hallucinating."
        : "Avoid pretending to know current facts that were not provided.",
      input.groundingExcerpts?.length
        ? "Prefer concrete facts, named offerings, locations, examples, or operating details from the grounded source excerpts over broad marketing or value language."
        : null,
      input.revisionGuidance
        ? "You are revising a weak prior draft. Fix the cited quality problems directly instead of rephrasing them."
        : null,
      "The core subject is what the audience is learning about. The presentation brief only defines framing or context.",
      "Use the framing context as a lens, not as a canned presentation template.",
      deriveSlideArcPolicy(input) === "organization-overview"
        ? "This prompt is about an organization/entity, not about the generic abstract concept behind its name."
        : null,
      deriveSlideArcPolicy(input) === "organization-overview"
        ? "Teach who the organization is, what it does, how it works, and where it creates value."
        : null,
      deriveSlideArcPolicy(input) === "organization-overview"
        ? "Deck title must be a plain organization title such as '<Organization> overview' or '<Organization> onboarding'. Do not use 'your guide', 'ultimate', 'excellence', 'journey', or other marketing-title phrasing."
        : null,
      deriveSlideArcPolicy(input) === "organization-overview" &&
      (input.intent?.framing || input.presentationBrief)
        ? "If the framing implies onboarding, orientation, introduction, or overview, keep that scope visible. Orient a newcomer to the organization itself without switching into facilitator talk or second-person audience management."
        : null,
      "Do not use facilitator talk or audience-management language. Explain the subject itself.",
      "Do not leak instruction fragments or internal labels like 'create a presentation', 'more information is available at', 'use google', 'outline coverage goals', 'grounding highlights', or 'grounding summary' into slide titles, learning goals, or key points.",
      "This is not a talk about slide design or how to present. Never give advice about slides, screenshots, clutter, decks, key points, or presentation technique unless the core subject itself is presentation design.",
      "Avoid facilitator framing that talks about running the session instead of teaching the subject, unless the subject itself is session facilitation.",
      "Keep every slide on the same main topic and make the sequence feel like one coherent talk.",
      "Each slide must teach something about the subject itself, not about how the presentation should be delivered.",
      "Prefer concrete facts, mechanisms, responsibilities, examples, or outcomes over generic slogans.",
      "Avoid imperative bullet points like 'walk through', 'emphasize', 'map out', 'review', 'validate that', or 'direct new hires'.",
      "Avoid unfinished fragments. Every key point must be a complete audience-facing sentence.",
      "Follow the slide contract below closely. It is a subject-facing teaching scaffold, not a rigid visual template.",
      ...buildSlideContractPromptLines(input),
    ].filter((line): line is string => Boolean(line));

    if (mode === "compact") {
      return [
        ...header,
        "Return JSON with: title, summary, slides.",
        "Each slide should include: title, learningGoal, keyPoints, speakerNotes, examples, likelyQuestions, beginnerExplanation, advancedExplanation.",
        "Use 3 to 4 key points per slide.",
        "Slide 1 must name the subject directly and explain why the topic matters without using welcome/session language.",
        "Final slide must visibly close the teaching arc with one concrete subject insight or implication and make clear that audience questions are welcome.",
        "Use one consistent language across the whole deck. Match the language implied by the topic, title direction, brief, and grounding.",
        "Each slide should contain at least two concrete, subject-facing claims. Avoid filler phrasing.",
        "Each slide must advance the story with a distinct explanatory center. Do not restate the same explanation on multiple slides.",
      ].join("\n");
    }

    return [
      ...header,
      "Return JSON with: title, summary, slides.",
      "Each slide should include only: title, learningGoal, keyPoints.",
      "Use 3 bullet-like key points per slide.",
      "Do not include markdown.",
      "Use one consistent language that matches the request.",
      "Final slide must visibly close the teaching arc and make clear that audience questions are welcome.",
      "Make each slide distinct from the others. Do not reuse the same explanation across slides.",
    ].join("\n");
  }
}
