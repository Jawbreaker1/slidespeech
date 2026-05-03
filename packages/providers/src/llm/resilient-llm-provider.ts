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
    return this.withFallback((provider) => provider.planResearch(input));
  }

  async classifyGrounding(
    input: ClassifyGroundingInput,
  ): Promise<GroundingClassificationResult> {
    return this.withFallback((provider) => provider.classifyGrounding(input));
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

  async validateQuestionAnswer(
    input: ValidateQuestionAnswerInput,
  ): Promise<AnswerValidationResult> {
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

    return { isValid: true };
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

  async reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
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

    return {
      approved: true,
      score: 1,
      summary: "Deck semantic review unavailable; deterministic checks remain active.",
      issues: [],
    };
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
