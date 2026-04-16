import type {
  ConversationNeed as DomainConversationNeed,
  ConversationResponseMode as DomainConversationResponseMode,
  ConversationRuntimeEffects as DomainConversationRuntimeEffects,
  ConversationTurnPlan as DomainConversationTurnPlan,
  Deck,
  InterruptionType,
  PedagogicalProfile,
  PresentationPlan,
  PresentationReview,
  ProviderHealthStatus,
  ResumePlan,
  Session,
  Slide,
  SlideIllustrationAsset as DomainSlideIllustrationAsset,
  SlideNarration,
  SpeechToTextResult as DomainSpeechToTextResult,
  TranscriptTurn,
  UserInterruption,
  VoiceActivityEvent as DomainVoiceActivityEvent,
  WebFetchResult as DomainWebFetchResult,
  WebSearchResult as DomainWebSearchResult,
} from "./domain";

export interface PresentationIntent {
  subject: string;
  framing: string;
  explicitSourceUrls: string[];
  coverageRequirements: string[];
  audienceCues: string[];
  deliveryFormat: "presentation" | "workshop";
  activityRequirement?: string;
}

export interface PlanPresentationInput {
  topic: string;
  presentationBrief?: string;
  intent?: PresentationIntent;
  groundingHighlights?: string[];
  pedagogicalProfile: PedagogicalProfile;
  groundingSummary?: string;
  targetDurationMinutes?: number;
  targetSlideCount?: number;
}

export interface PlanResearchInput {
  topic: string;
  presentationBrief?: string;
  intent?: PresentationIntent;
  explicitSourceUrls: string[];
  heuristicSubject: string;
  heuristicQueries: string[];
  freshnessSensitive: boolean;
  requiresGroundedFacts: boolean;
}

export interface ResearchPlanningSuggestion {
  subject?: string;
  searchQueries: string[];
  coverageGoals: string[];
  rationale: string[];
}

export interface GenerateDeckInput {
  topic: string;
  presentationBrief?: string;
  intent?: PresentationIntent;
  revisionGuidance?: string;
  plan?: PresentationPlan;
  pedagogicalProfile: PedagogicalProfile;
  groundingSummary?: string;
  groundingHighlights?: string[];
  groundingCoverageGoals?: string[];
  groundingSourceIds?: string[];
  groundingSourceType?: "topic" | "document" | "pptx" | "mixed";
  targetDurationMinutes?: number;
  targetSlideCount?: number;
}

export interface GenerateNarrationInput {
  deck: Deck;
  slide: Slide;
  pedagogicalProfile: PedagogicalProfile;
}

export interface PedagogicalContext {
  deck: Deck;
  slide: Slide;
  session?: Session;
  pedagogicalProfile: PedagogicalProfile;
}

export interface AnswerQuestionInput extends PedagogicalContext {
  question: string;
}

export interface TransformExplanationInput extends PedagogicalContext {
  reason?: string;
}

export interface SummarizeSectionInput {
  deck: Deck;
  slides: Slide[];
  pedagogicalProfile: PedagogicalProfile;
}

export interface PlanConversationTurnInput {
  session: Session;
  deck: Deck;
  slide: Slide;
  text: string;
  transcript: TranscriptTurn[];
}

export interface ReviewPresentationInput {
  deck: Deck;
  narrations: SlideNarration[];
  pedagogicalProfile: PedagogicalProfile;
}

export interface PedagogicalResponse {
  text: string;
  followUpPrompt?: string;
  suggestedResumePlan?: ResumePlan;
}

export interface LLMProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  planResearch(input: PlanResearchInput): Promise<ResearchPlanningSuggestion>;
  planPresentation(input: PlanPresentationInput): Promise<PresentationPlan>;
  generateDeck(input: GenerateDeckInput): Promise<Deck>;
  generateNarration(input: GenerateNarrationInput): Promise<SlideNarration>;
  answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse>;
  simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse>;
  deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse>;
  generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse>;
  summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse>;
  reviewPresentation(input: ReviewPresentationInput): Promise<PresentationReview>;
  planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<DomainConversationTurnPlan>;
}

export interface AnalyzeSlideImageInput {
  slideId: string;
  imageUrl?: string;
  imageBase64?: string;
}

export interface AnalyzeDeckImagesInput {
  deckId: string;
  slides: AnalyzeSlideImageInput[];
}

export interface VisionInsight {
  summary: string;
  visualIssues: string[];
  pedagogicalHints: string[];
}

export interface VisionProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  analyzeSlideImage(input: AnalyzeSlideImageInput): Promise<VisionInsight>;
  analyzeDeckImages(input: AnalyzeDeckImagesInput): Promise<VisionInsight[]>;
  describeVisualIssues(input: AnalyzeDeckImagesInput): Promise<string[]>;
  extractPedagogicalVisualHints(
    input: AnalyzeDeckImagesInput,
  ): Promise<string[]>;
}

export interface RenderSlideIllustrationInput {
  deck: Deck;
  slide: Slide;
  slotId?: string;
}

export interface SlideIllustrationProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  renderSlideIllustration(
    input: RenderSlideIllustrationInput,
  ): Promise<DomainSlideIllustrationAsset>;
}

export interface AudioChunk {
  chunkId: string;
  mimeType: string;
  dataBase64: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  transcribe(audioChunk: AudioChunk): Promise<DomainSpeechToTextResult>;
  transcribeStream?(streamId: string): AsyncIterable<DomainSpeechToTextResult>;
}

export interface TextToSpeechOptions {
  voice?: string;
  speakingRate?: number;
  style?: "narration" | "answer" | "summary";
}

export interface TextToSpeechResult {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
}

export interface TextToSpeechProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  synthesize(
    text: string,
    options?: TextToSpeechOptions,
  ): Promise<TextToSpeechResult>;
  synthesizeStream?(
    text: string,
    options?: TextToSpeechOptions,
  ): AsyncIterable<TextToSpeechResult>;
}

export interface VoiceActivityProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  detectSpeech(audioChunk: AudioChunk): Promise<DomainVoiceActivityEvent>;
  detectSegments(streamId: string): AsyncIterable<DomainVoiceActivityEvent>;
}

export interface SummarizeFindingsInput {
  query: string;
  findings: DomainWebFetchResult[];
}

export interface WebResearchProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  search(query: string): Promise<DomainWebSearchResult[]>;
  fetch(url: string): Promise<DomainWebFetchResult>;
  summarizeFindings(input: SummarizeFindingsInput): Promise<string>;
}

export interface DeckExporter {
  readonly name: string;
  exportToPptx(deck: Deck, outputPath: string): Promise<string>;
  exportToJson(deck: Deck, outputPath: string): Promise<string>;
  renderToHtml?(deck: Deck): Promise<string>;
}

export interface DeckIngestionInput {
  topic: string;
  pedagogicalProfile: PedagogicalProfile;
}

export interface StructuredDeckData {
  title: string;
  summary: string;
  bulletClusters: string[][];
}

export interface DeckIngestionProvider {
  readonly name: string;
  ingestTopic(input: DeckIngestionInput): Promise<StructuredDeckData>;
  ingestDocument(filePath: string): Promise<StructuredDeckData>;
  ingestPptx(filePath: string): Promise<StructuredDeckData>;
  extractStructuredDeckData(filePath: string): Promise<StructuredDeckData>;
  renderSlidesToImages?(filePath: string): Promise<string[]>;
}

export interface DeckRepository {
  save(deck: Deck): Promise<void>;
  getById(id: string): Promise<Deck | null>;
  list(): Promise<Deck[]>;
}

export interface SessionRepository {
  save(session: Session): Promise<void>;
  getById(id: string): Promise<Session | null>;
  list(): Promise<Session[]>;
}

export interface TranscriptRepository {
  append(turn: TranscriptTurn): Promise<void>;
  listBySessionId(sessionId: string): Promise<TranscriptTurn[]>;
}

export interface UserPreferences {
  userId: string;
  pedagogicalProfile: PedagogicalProfile;
}

export interface UserPreferencesRepository {
  save(preferences: UserPreferences): Promise<void>;
  getByUserId(userId: string): Promise<UserPreferences | null>;
}

export interface InterruptClassifier {
  classify(input: {
    session: Session;
    text: string;
  }): Promise<UserInterruption>;
}

export interface ResumePlanner {
  createPlan(input: {
    session: Session;
    interruption: UserInterruption;
    turnDecision?: ConversationTurnDecision;
    deck: Deck;
  }): Promise<ResumePlan>;
}

export interface ConversationTurnDecision {
  interruption: UserInterruption;
  inferredNeeds: DomainConversationNeed[];
  responseMode: DomainConversationResponseMode;
  runtimeEffects: DomainConversationRuntimeEffects;
  interruptionType: InterruptionType;
  confidence: number;
  rationale: string;
}

export interface ConversationTurnEngine {
  planTurn(input: {
    session: Session;
    deck: Deck;
    slide: Slide;
    text: string;
    transcript: TranscriptTurn[];
  }): Promise<ConversationTurnDecision>;
}
