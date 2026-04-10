import { z } from "zod";

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
});

export type Slide = z.infer<typeof SlideSchema>;

export const DeckSourceSchema = z.object({
  type: z.enum(["topic", "document", "pptx", "mixed"]),
  topic: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
});

export type DeckSource = z.infer<typeof DeckSourceSchema>;

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
  }),
});

export type Deck = z.infer<typeof DeckSchema>;

export const SlideNarrationSchema = z.object({
  slideId: z.string(),
  narration: z.string(),
  summaryLine: z.string(),
  promptsForPauses: z.array(z.string()).default([]),
  suggestedTransition: z.string(),
});

export type SlideNarration = z.infer<typeof SlideNarrationSchema>;

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
  narrationBySlideId: z.record(z.string(), SlideNarrationSchema).default({}),
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

export const SelectSlideResponseSchema = z.object({
  deck: DeckSchema,
  session: SessionSchema,
  narration: SlideNarrationSchema.optional(),
  provider: z.string(),
});

export type SelectSlideResponse = z.infer<typeof SelectSlideResponseSchema>;

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
