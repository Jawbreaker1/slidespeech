import { z } from "zod";

import { PRESENTATION_THEME_IDS } from "./presentation-themes";

export const SessionStateSchema = z.enum([
  "idle",
  "preparing_presentation",
  "presenting",
  "slide_paused",
  "interrupted",
  "answering_question",
  "branching_explanation",
  "resuming",
  "finished",
  "error",
]);

export type SessionState = z.infer<typeof SessionStateSchema>;

export const AudienceLevelSchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
  "mixed",
]);

export type AudienceLevel = z.infer<typeof AudienceLevelSchema>;

export const InterruptionTypeSchema = z.enum([
  "stop",
  "question",
  "simplify",
  "deepen",
  "example",
  "back",
  "repeat",
  "continue",
  "unknown",
]);

export type InterruptionType = z.infer<typeof InterruptionTypeSchema>;

export const ResumeActionSchema = z.enum([
  "resume_same_point",
  "restart_slide",
  "go_to_previous_slide",
  "insert_explanation_slide",
  "adapt_remaining_presentation",
]);

export type ResumeAction = z.infer<typeof ResumeActionSchema>;

export const PedagogicalProfileSchema = z.object({
  audienceLevel: AudienceLevelSchema.default("beginner"),
  tone: z.string().default("supportive and concrete"),
  pace: z.enum(["slow", "balanced", "fast"]).default("balanced"),
  preferredExampleStyle: z
    .enum(["real_world", "technical", "analogy"])
    .default("real_world"),
  wantsFrequentChecks: z.boolean().default(true),
  detailLevel: z.enum(["light", "standard", "deep"]).default("standard"),
});

export type PedagogicalProfile = z.infer<typeof PedagogicalProfileSchema>;

export const SlideLayoutTemplateSchema = z.enum([
  "hero-focus",
  "three-step-flow",
  "two-column-callouts",
  "summary-board",
]);

export type SlideLayoutTemplate = z.infer<typeof SlideLayoutTemplateSchema>;

export const SlideVisualToneSchema = z.enum([
  "accent",
  "neutral",
  "success",
  "warning",
  "info",
]);

export type SlideVisualTone = z.infer<typeof SlideVisualToneSchema>;

export const SlideVisualCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tone: SlideVisualToneSchema.default("neutral"),
});

export type SlideVisualCard = z.infer<typeof SlideVisualCardSchema>;

export const SlideCalloutSchema = z.object({
  id: z.string(),
  label: z.string(),
  text: z.string(),
  tone: SlideVisualToneSchema.default("info"),
});

export type SlideCallout = z.infer<typeof SlideCalloutSchema>;

export const SlideDiagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  tone: SlideVisualToneSchema.default("accent"),
});

export type SlideDiagramNode = z.infer<typeof SlideDiagramNodeSchema>;

export const SlideDiagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});

export type SlideDiagramEdge = z.infer<typeof SlideDiagramEdgeSchema>;

export const SlideImageStyleSchema = z.enum([
  "diagram",
  "editorial",
  "abstract",
  "screenshot-like",
]);

export type SlideImageStyle = z.infer<typeof SlideImageStyleSchema>;

export const SlideImageSlotSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  caption: z.string().optional(),
  altText: z.string().optional(),
  style: SlideImageStyleSchema.default("diagram"),
  tone: SlideVisualToneSchema.default("accent"),
});

export type SlideImageSlot = z.infer<typeof SlideImageSlotSchema>;

export const SlideVisualsSchema = z.object({
  layoutTemplate: SlideLayoutTemplateSchema.default("hero-focus"),
  accentColor: z.string().default("1C7C7D"),
  eyebrow: z.string().optional(),
  heroStatement: z.string().optional(),
  cards: z.array(SlideVisualCardSchema).default([]),
  callouts: z.array(SlideCalloutSchema).default([]),
  diagramNodes: z.array(SlideDiagramNodeSchema).default([]),
  diagramEdges: z.array(SlideDiagramEdgeSchema).default([]),
  imagePrompt: z.string().optional(),
  imageSlots: z.array(SlideImageSlotSchema).default([]),
});

export type SlideVisuals = z.infer<typeof SlideVisualsSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  learningGoal: z.string(),
  keyPoints: z.array(z.string()).min(1),
  requiredContext: z.array(z.string()).default([]),
  speakerNotes: z.array(z.string()).default([]),
  beginnerExplanation: z.string(),
  advancedExplanation: z.string(),
  examples: z.array(z.string()).default([]),
  likelyQuestions: z.array(z.string()).default([]),
  canSkip: z.boolean().default(false),
  dependenciesOnOtherSlides: z.array(z.string()).default([]),
  visualNotes: z.array(z.string()).default([]),
  visuals: SlideVisualsSchema.default({
    layoutTemplate: "hero-focus",
    accentColor: "1C7C7D",
    cards: [],
    callouts: [],
    diagramNodes: [],
    diagramEdges: [],
    imageSlots: [],
  }),
});

export type Slide = z.infer<typeof SlideSchema>;

export const DeckSourceSchema = z.object({
  type: z.enum(["topic", "document", "pptx", "mixed"]),
  topic: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
});

export type DeckSource = z.infer<typeof DeckSourceSchema>;

export const DeckEvaluationCheckSchema = z.object({
  code: z.string(),
  status: z.enum(["pass", "warning", "fail"]),
  message: z.string(),
  slideId: z.string().optional(),
});

export type DeckEvaluationCheck = z.infer<typeof DeckEvaluationCheckSchema>;

export const DeckEvaluationSchema = z.object({
  evaluatedAt: z.string(),
  overallScore: z.number().min(0).max(1),
  summary: z.string(),
  checks: z.array(DeckEvaluationCheckSchema).default([]),
});

export type DeckEvaluation = z.infer<typeof DeckEvaluationSchema>;

export const DeckGenerationStatusSchema = z.object({
  narrationReadySlides: z.number().int().nonnegative(),
  totalSlides: z.number().int().positive(),
  backgroundEnrichmentPending: z.boolean().default(false),
  lastCompletedAt: z.string().optional(),
});

export type DeckGenerationStatus = z.infer<typeof DeckGenerationStatusSchema>;

export const PresentationThemeSchema = z.enum(PRESENTATION_THEME_IDS);

export type PresentationTheme = z.infer<typeof PresentationThemeSchema>;

export const DeckSchema = z.object({
  id: z.string(),
  title: z.string(),
  topic: z.string(),
  summary: z.string(),
  pedagogicalProfile: PedagogicalProfileSchema,
  source: DeckSourceSchema,
  slides: z.array(SlideSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.object({
    estimatedDurationMinutes: z.number().positive(),
    tags: z.array(z.string()).default([]),
    language: z.string().default("sv"),
    theme: PresentationThemeSchema.optional(),
    validation: z
      .object({
        passed: z.boolean(),
        repaired: z.boolean().default(false),
        validatedAt: z.string(),
        summary: z.string().optional(),
        overallScore: z.number().min(0).max(1).optional(),
        issues: z.array(
          z.object({
            code: z.string(),
            message: z.string(),
            severity: z.enum(["info", "warning", "error"]),
            slideId: z.string().optional(),
          }),
        ).default([]),
      })
      .optional(),
    evaluation: DeckEvaluationSchema.optional(),
    generation: DeckGenerationStatusSchema.optional(),
  }),
});

export type Deck = z.infer<typeof DeckSchema>;

export const SlideNarrationSchema = z.object({
  slideId: z.string(),
  narration: z.string(),
  segments: z.array(z.string().min(1)).default([]),
  summaryLine: z.string(),
  promptsForPauses: z.array(z.string()).default([]),
  suggestedTransition: z.string(),
});

export type SlideNarration = z.infer<typeof SlideNarrationSchema>;

export const PresentationQualityIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  dimension: z.enum(["deck", "visual", "narration", "coherence", "grounding"]),
  message: z.string(),
  slideId: z.string().optional(),
});

export type PresentationQualityIssue = z.infer<
  typeof PresentationQualityIssueSchema
>;

export const PresentationReviewSchema = z.object({
  approved: z.boolean(),
  overallScore: z.number().min(0).max(1),
  summary: z.string(),
  issues: z.array(PresentationQualityIssueSchema).default([]),
  repairedNarrations: z.array(SlideNarrationSchema).default([]),
});

export type PresentationReview = z.infer<typeof PresentationReviewSchema>;

export const PresentationPlanSchema = z.object({
  title: z.string(),
  learningObjectives: z.array(z.string()).min(1),
  storyline: z.array(z.string()).min(1),
  recommendedSlideCount: z.number().int().positive(),
  audienceLevel: AudienceLevelSchema,
});

export type PresentationPlan = z.infer<typeof PresentationPlanSchema>;

export const TranscriptTurnSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["system", "assistant", "user"]),
  text: z.string(),
  createdAt: z.string(),
  relatedSlideId: z.string().optional(),
  interruptionType: InterruptionTypeSchema.optional(),
});

export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

export const ConversationNeedSchema = z.enum([
  "question",
  "confusion",
  "example",
  "deepen",
  "repeat",
  "navigation",
  "pause",
  "resume",
]);

export type ConversationNeed = z.infer<typeof ConversationNeedSchema>;

export const ConversationResponseModeSchema = z.enum([
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
]);

export type ConversationResponseMode = z.infer<
  typeof ConversationResponseModeSchema
>;

export const ConversationRuntimeEffectsSchema = z.object({
  pause: z.boolean().optional(),
  resume: z.boolean().optional(),
  goToPreviousSlide: z.boolean().optional(),
  restartCurrentSlide: z.boolean().optional(),
  adaptDetailLevel: z.enum(["light", "standard", "deep"]).optional(),
  adaptPace: z.enum(["slow", "balanced", "fast"]).optional(),
});

export type ConversationRuntimeEffects = z.infer<
  typeof ConversationRuntimeEffectsSchema
>;

export const ConversationTurnPlanSchema = z.object({
  interruptionType: InterruptionTypeSchema,
  inferredNeeds: z.array(ConversationNeedSchema),
  responseMode: ConversationResponseModeSchema,
  runtimeEffects: ConversationRuntimeEffectsSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type ConversationTurnPlan = z.infer<typeof ConversationTurnPlanSchema>;

export const UserInterruptionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.string(),
  rawText: z.string(),
  type: InterruptionTypeSchema,
  targetSlideId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type UserInterruption = z.infer<typeof UserInterruptionSchema>;

export const ResumePlanSchema = z.object({
  sessionId: z.string(),
  action: ResumeActionSchema,
  targetSlideId: z.string().optional(),
  targetNarrationIndex: z.number().int().nonnegative().optional(),
  reasoning: z.string(),
  adaptPedagogy: z.boolean().default(false),
  insertedSlide: SlideSchema.optional(),
});

export type ResumePlan = z.infer<typeof ResumePlanSchema>;

export const ProviderHealthStatusSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  checkedAt: z.string(),
});

export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  state: SessionStateSchema,
  currentSlideId: z.string().optional(),
  currentSlideIndex: z.number().int().nonnegative().default(0),
  currentNarrationIndex: z.number().int().nonnegative().default(0),
  narrationBySlideId: z.record(z.string(), SlideNarrationSchema).default({}),
  narrationProgressBySlideId: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  transcriptTurnIds: z.array(z.string()).default([]),
  pedagogicalProfile: PedagogicalProfileSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastInterruption: UserInterruptionSchema.optional(),
  errorMessage: z.string().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

export const GeneratePresentationRequestSchema = z.object({
  topic: z.string().min(3),
  pedagogicalProfile: PedagogicalProfileSchema.partial().optional(),
  useWebResearch: z.boolean().optional(),
  targetDurationMinutes: z.number().int().positive().max(60).optional(),
  targetSlideCount: z.number().int().positive().max(30).optional(),
});

export type GeneratePresentationRequest = z.infer<
  typeof GeneratePresentationRequestSchema
>;

export const GeneratePresentationResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  narrations: z.array(SlideNarrationSchema),
  provider: z.string(),
});

export type GeneratePresentationResponse = z.infer<
  typeof GeneratePresentationResponseSchema
>;

export const PresentationGenerationJobStateSchema = z.enum([
  "queued",
  "generating",
  "completed",
  "failed",
]);

export type PresentationGenerationJobState = z.infer<
  typeof PresentationGenerationJobStateSchema
>;

export const PresentationGenerationJobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: PresentationGenerationJobStateSchema,
  queuePosition: z.number().int().positive().optional(),
  jobsAhead: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  sessionId: z.string().optional(),
  deckId: z.string().optional(),
  error: z.string().optional(),
});

export type PresentationGenerationJobStatusResponse = z.infer<
  typeof PresentationGenerationJobStatusResponseSchema
>;

export const SessionInteractionRequestSchema = z.object({
  text: z.string().min(1),
});

export type SessionInteractionRequest = z.infer<
  typeof SessionInteractionRequestSchema
>;

export const SessionInteractionResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  interruption: UserInterruptionSchema,
  turnDecision: ConversationTurnPlanSchema,
  resumePlan: ResumePlanSchema,
  assistantMessage: z.string(),
  narration: SlideNarrationSchema.optional(),
  provider: z.string(),
});

export type SessionInteractionResponse = z.infer<
  typeof SessionInteractionResponseSchema
>;

export const SelectSlideRequestSchema = z.object({
  slideId: z.string().min(1),
});

export type SelectSlideRequest = z.infer<typeof SelectSlideRequestSchema>;

export const NarrationProgressRequestSchema = z.object({
  slideId: z.string().min(1).optional(),
  narrationIndex: z.number().int().nonnegative(),
});

export type NarrationProgressRequest = z.infer<
  typeof NarrationProgressRequestSchema
>;

export const SelectSlideResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  narration: SlideNarrationSchema.optional(),
  provider: z.string(),
});

export type SelectSlideResponse = z.infer<typeof SelectSlideResponseSchema>;

export const NarrationProgressResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  narration: SlideNarrationSchema.optional(),
  provider: z.string(),
});

export type NarrationProgressResponse = z.infer<
  typeof NarrationProgressResponseSchema
>;

export const SessionSnapshotResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  narration: SlideNarrationSchema.optional(),
  transcripts: z.array(TranscriptTurnSchema),
  provider: z.string(),
});

export type SessionSnapshotResponse = z.infer<
  typeof SessionSnapshotResponseSchema
>;

export const SavedPresentationSummarySchema = z.object({
  sessionId: z.string(),
  deckId: z.string(),
  title: z.string(),
  summary: z.string(),
  topic: z.string(),
  slideCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceType: z.enum(["topic", "document", "pptx", "mixed"]),
  generation: DeckGenerationStatusSchema.optional(),
  validation: DeckSchema.shape.metadata.shape.validation.optional(),
  evaluation: DeckEvaluationSchema.optional(),
  ready: z.boolean(),
});

export type SavedPresentationSummary = z.infer<
  typeof SavedPresentationSummarySchema
>;

export const ListSavedPresentationsResponseSchema = z.object({
  items: z.array(SavedPresentationSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  readyOnly: z.boolean(),
  hasMore: z.boolean(),
});

export type ListSavedPresentationsResponse = z.infer<
  typeof ListSavedPresentationsResponseSchema
>;

export const DeletePresentationResponseSchema = z.object({
  deletedSessionId: z.string(),
  deletedDeckId: z.string().optional(),
});

export type DeletePresentationResponse = z.infer<
  typeof DeletePresentationResponseSchema
>;

export const SlideIllustrationAssetSchema = z.object({
  slideId: z.string(),
  slotId: z.string(),
  mimeType: z.string().min(1),
  dataUri: z.string().min(1),
  altText: z.string().optional(),
  caption: z.string().optional(),
  sourcePageUrl: z.string().url().optional(),
  sourceImageUrl: z.string().url().optional(),
});

export type SlideIllustrationAsset = z.infer<
  typeof SlideIllustrationAssetSchema
>;

export const SlideIllustrationResponseSchema = z.object({
  asset: SlideIllustrationAssetSchema,
  provider: z.string(),
});

export type SlideIllustrationResponse = z.infer<
  typeof SlideIllustrationResponseSchema
>;

export const WebSearchRequestSchema = z.object({
  query: z.string().min(3),
  maxResults: z.number().int().min(1).max(5).default(3),
});

export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>;

export const WebFetchRequestSchema = z.object({
  url: z.string().url(),
});

export type WebFetchRequest = z.infer<typeof WebFetchRequestSchema>;

export const WebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string(),
});

export const WebFetchResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  content: z.string(),
});

export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
export type WebFetchResult = z.infer<typeof WebFetchResultSchema>;

export const WebResearchQueryResponseSchema = z.object({
  provider: z.string(),
  query: z.string(),
  results: z.array(WebSearchResultSchema),
  findings: z.array(WebFetchResultSchema),
  summary: z.string(),
});

export type WebResearchQueryResponse = z.infer<
  typeof WebResearchQueryResponseSchema
>;

export const WebFetchResponseSchema = z.object({
  provider: z.string(),
  result: WebFetchResultSchema,
});

export type WebFetchResponse = z.infer<typeof WebFetchResponseSchema>;

export const VoiceTurnRequestSchema = z.object({
  audio: z.object({
    mimeType: z.string().min(1),
    dataBase64: z.string().min(1),
  }),
});

export type VoiceTurnRequest = z.infer<typeof VoiceTurnRequestSchema>;

export const VoiceActivityEventSchema = z.object({
  hasSpeech: z.boolean(),
  confidence: z.number().min(0).max(1),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});

export type VoiceActivityEvent = z.infer<typeof VoiceActivityEventSchema>;

export const SpeechToTextResultSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  isFinal: z.boolean(),
});

export type SpeechToTextResult = z.infer<typeof SpeechToTextResultSchema>;

export const VoiceTurnResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  provider: z.string(),
  sttProvider: z.string(),
  vadProvider: z.string(),
  speechEvent: VoiceActivityEventSchema,
  transcript: SpeechToTextResultSchema.optional(),
  interactionApplied: z.boolean(),
  interruption: UserInterruptionSchema.optional(),
  turnDecision: ConversationTurnPlanSchema.optional(),
  resumePlan: ResumePlanSchema.optional(),
  assistantMessage: z.string().optional(),
  narration: SlideNarrationSchema.optional(),
});

export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponseSchema>;

export const SpeechSynthesisRequestSchema = z.object({
  text: z.string().min(1).optional(),
  slideId: z.string().min(1).optional(),
  narrationIndex: z.number().int().nonnegative().optional(),
  style: z.enum(["narration", "answer", "summary"]).default("narration"),
});

export type SpeechSynthesisRequest = z.infer<
  typeof SpeechSynthesisRequestSchema
>;

export const SpeechSynthesisSourceSchema = z.object({
  type: z.enum(["narration_segment", "text"]),
  slideId: z.string().optional(),
  narrationIndex: z.number().int().nonnegative().optional(),
});

export type SpeechSynthesisSource = z.infer<typeof SpeechSynthesisSourceSchema>;

export const SpeechSynthesisResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  provider: z.string(),
  ttsProvider: z.string(),
  source: SpeechSynthesisSourceSchema,
  text: z.string(),
  narration: SlideNarrationSchema.optional(),
  audio: z.object({
    audioBase64: z.string(),
    mimeType: z.string(),
    durationMs: z.number().int().nonnegative(),
  }),
});

export type SpeechSynthesisResponse = z.infer<
  typeof SpeechSynthesisResponseSchema
>;
