import type {
  AnswerQuestionInput,
  ConversationTurnPlan,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PlanPresentationInput,
  PresentationPlan,
  PresentationReview,
  ProviderHealthStatus,
  ReviewPresentationInput,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
  Deck,
} from "@slidespeech/types";

export class ResilientLLMProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
  ) {
    this.name = primary.name;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return this.primary.healthCheck();
  }

  async planPresentation(input: PlanPresentationInput): Promise<PresentationPlan> {
    return this.withFallback((provider) => provider.planPresentation(input));
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    return this.withFallback((provider) => provider.generateDeck(input));
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    return this.withFallback((provider) => provider.generateNarration(input));
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    return this.withFallback((provider) => provider.answerQuestion(input));
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return this.withFallback((provider) => provider.simplifyExplanation(input));
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return this.withFallback((provider) => provider.deepenExplanation(input));
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    return this.withFallback((provider) => provider.generateExample(input));
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    return this.withFallback((provider) => provider.summarizeSection(input));
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    return this.withFallback((provider) => provider.reviewPresentation(input));
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    return this.withFallback<ConversationTurnPlan>((provider) =>
      provider.planConversationTurn(input),
    );
  }

  private async withFallback<T>(
    operation: (provider: LLMProvider) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(this.primary);
    } catch (error) {
      console.warn(
        `[slidespeech] primary LLM provider "${this.primary.name}" failed, falling back to "${this.fallback.name}":`,
        error,
      );
      return operation(this.fallback);
    }
  }
}
