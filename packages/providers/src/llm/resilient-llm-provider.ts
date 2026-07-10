import type {
  AnswerQuestionInput,
  AnswerValidationResult,
  ClassifyGroundingInput,
  ConversationTurnPlan,
  GenerateDeckInput,
  GenerateNarrationInput,
  GroundingClassificationResult,
  LLMProvider,
  PedagogicalResponse,
  PlanConversationTurnInput,
  PlanPresentationInput,
  PlanResearchInput,
  PresentationPlan,
  PresentationReview,
  ProviderHealthStatus,
  ResearchPlanningSuggestion,
  ReviewPresentationInput,
  SlideNarration,
  SummarizeSectionInput,
  TransformExplanationInput,
  ValidateQuestionAnswerInput,
  Deck,
  DeckSemanticReviewResult,
  ReviewDeckSemanticsInput,
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

  async planResearch(
    input: PlanResearchInput,
  ): Promise<ResearchPlanningSuggestion> {
    if (this.usesMockFallback()) {
      return this.primary.planResearch(input);
    }

    return this.withFallback((provider) => provider.planResearch(input));
  }

  async classifyGrounding(
    input: ClassifyGroundingInput,
  ): Promise<GroundingClassificationResult> {
    if (this.usesMockFallback()) {
      return this.primary.classifyGrounding(input);
    }

    return this.withFallback((provider) => provider.classifyGrounding(input));
  }

  async planPresentation(input: PlanPresentationInput): Promise<PresentationPlan> {
    if (this.usesMockFallback()) {
      return this.primary.planPresentation(input);
    }

    return this.withFallback((provider) => provider.planPresentation(input));
  }

  async generateDeck(input: GenerateDeckInput): Promise<Deck> {
    if (this.usesMockFallback()) {
      return this.primary.generateDeck(input);
    }

    return this.withFallback((provider) => provider.generateDeck(input));
  }

  async generateNarration(
    input: GenerateNarrationInput,
  ): Promise<SlideNarration> {
    if (this.usesMockFallback()) {
      return this.primary.generateNarration(input);
    }

    return this.withFallback((provider) => provider.generateNarration(input));
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<PedagogicalResponse> {
    if (this.usesMockFallback()) {
      return this.primary.answerQuestion(input);
    }

    return this.withFallback((provider) => provider.answerQuestion(input));
  }

  async validateQuestionAnswer(
    input: ValidateQuestionAnswerInput,
  ): Promise<AnswerValidationResult> {
    if (this.usesMockFallback()) {
      if (typeof this.primary.validateQuestionAnswer !== "function") {
        throw new Error(
          "Question answer validation is not supported by the primary provider.",
        );
      }

      return this.primary.validateQuestionAnswer(input);
    }

    if (
      typeof this.primary.validateQuestionAnswer === "function" &&
      typeof this.fallback.validateQuestionAnswer === "function"
    ) {
      return this.withFallback((provider) => {
        if (typeof provider.validateQuestionAnswer !== "function") {
          throw new Error("Question answer validation is not supported by this provider.");
        }

        return provider.validateQuestionAnswer(input);
      });
    }

    if (typeof this.primary.validateQuestionAnswer === "function") {
      return this.primary.validateQuestionAnswer(input);
    }

    if (typeof this.fallback.validateQuestionAnswer === "function") {
      return this.fallback.validateQuestionAnswer(input);
    }

    throw new Error(
      "Question answer validation is not supported by either LLM provider.",
    );
  }

  async simplifyExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    if (this.usesMockFallback()) {
      return this.primary.simplifyExplanation(input);
    }

    return this.withFallback((provider) => provider.simplifyExplanation(input));
  }

  async deepenExplanation(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    if (this.usesMockFallback()) {
      return this.primary.deepenExplanation(input);
    }

    return this.withFallback((provider) => provider.deepenExplanation(input));
  }

  async generateExample(
    input: TransformExplanationInput,
  ): Promise<PedagogicalResponse> {
    if (this.usesMockFallback()) {
      return this.primary.generateExample(input);
    }

    return this.withFallback((provider) => provider.generateExample(input));
  }

  async summarizeSection(
    input: SummarizeSectionInput,
  ): Promise<PedagogicalResponse> {
    if (this.usesMockFallback()) {
      return this.primary.summarizeSection(input);
    }

    return this.withFallback((provider) => provider.summarizeSection(input));
  }

  async reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
    if (this.usesMockFallback()) {
      if (typeof this.primary.reviewDeckSemantics !== "function") {
        throw new Error("Deck semantic review is not supported by the primary LLM provider.");
      }

      return this.primary.reviewDeckSemantics(input);
    }

    if (
      typeof this.primary.reviewDeckSemantics === "function" &&
      typeof this.fallback.reviewDeckSemantics === "function"
    ) {
      return this.withFallback((provider) => {
        if (typeof provider.reviewDeckSemantics !== "function") {
          throw new Error("Deck semantic review is not supported by this provider.");
        }

        return provider.reviewDeckSemantics(input);
      });
    }

    if (typeof this.primary.reviewDeckSemantics === "function") {
      return this.primary.reviewDeckSemantics(input);
    }

    if (typeof this.fallback.reviewDeckSemantics === "function") {
      return this.fallback.reviewDeckSemantics(input);
    }

    throw new Error("Deck semantic review is not supported by either LLM provider.");
  }

  async reviewPresentation(
    input: ReviewPresentationInput,
  ): Promise<PresentationReview> {
    if (this.usesMockFallback()) {
      return this.primary.reviewPresentation(input);
    }

    return this.withFallback((provider) => provider.reviewPresentation(input));
  }

  async planConversationTurn(
    input: PlanConversationTurnInput,
  ): Promise<ConversationTurnPlan> {
    if (this.usesMockFallback()) {
      return this.primary.planConversationTurn(input);
    }

    return this.withFallback<ConversationTurnPlan>((provider) =>
      provider.planConversationTurn(input),
    );
  }

  private usesMockFallback(): boolean {
    return this.fallback.name === "mock";
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
