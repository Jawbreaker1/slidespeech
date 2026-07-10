import type {
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  GroundingFact,
  LLMProvider,
  PedagogicalProfile,
  PresentationIntent,
  PresentationPlan,
  PresentationReview,
  ReviewDeckSemanticsInput,
  ReviewPresentationInput,
  DeckSemanticReviewResult,
  SlideNarration,
} from "@slidespeech/types";

export class PresentationPlanner {
  constructor(private readonly llmProvider: LLMProvider) {}

  plan(
    topic: string,
    presentationBrief: string | undefined,
    intent: PresentationIntent | undefined,
    pedagogicalProfile: PedagogicalProfile,
    groundingSummary?: string,
    groundingHighlights?: string[],
    groundingExcerpts?: string[],
    groundingCoverageGoals?: string[],
    targetDurationMinutes?: number,
    targetSlideCount?: number,
    groundingFacts?: GroundingFact[],
  ): Promise<PresentationPlan> {
    return this.llmProvider.planPresentation({
      topic,
      ...(presentationBrief ? { presentationBrief } : {}),
      ...(intent ? { intent } : {}),
      pedagogicalProfile,
      ...(groundingSummary ? { groundingSummary } : {}),
      ...(groundingHighlights?.length ? { groundingHighlights } : {}),
      ...(groundingExcerpts?.length ? { groundingExcerpts } : {}),
      ...(groundingCoverageGoals?.length ? { groundingCoverageGoals } : {}),
      ...(groundingFacts?.length ? { groundingFacts } : {}),
      ...(targetDurationMinutes ? { targetDurationMinutes } : {}),
      ...(targetSlideCount ? { targetSlideCount } : {}),
    });
  }

  generateDeck(input: GenerateDeckInput): Promise<Deck> {
    return this.llmProvider.generateDeck(input);
  }
}

export class NarrationEngine {
  constructor(private readonly llmProvider: LLMProvider) {}

  generateNarration(input: GenerateNarrationInput): Promise<SlideNarration> {
    return this.llmProvider.generateNarration(input);
  }

  async generateDeckNarrations(
    deck: Deck,
    pedagogicalProfile: PedagogicalProfile,
  ): Promise<SlideNarration[]> {
    const narrations: SlideNarration[] = [];

    for (const slide of deck.slides) {
      narrations.push(
        await this.generateNarration({ deck, slide, pedagogicalProfile }),
      );
    }

    return narrations;
  }
}

export class PresentationQualityReviewer {
  constructor(private readonly llmProvider: LLMProvider) {}

  reviewDeckSemantics(
    input: ReviewDeckSemanticsInput,
  ): Promise<DeckSemanticReviewResult> {
    if (typeof this.llmProvider.reviewDeckSemantics !== "function") {
      return Promise.reject(
        new Error("Deck semantic review is not supported by the configured LLM provider."),
      );
    }

    return this.llmProvider.reviewDeckSemantics(input);
  }

  review(input: ReviewPresentationInput): Promise<PresentationReview> {
    return this.llmProvider.reviewPresentation(input);
  }
}
