import type {
  Deck,
  GenerateDeckInput,
  GenerateNarrationInput,
  LLMProvider,
  PedagogicalProfile,
  PresentationPlan,
  SlideNarration,
} from "@slidespeech/types";

export class PresentationPlanner {
  constructor(private readonly llmProvider: LLMProvider) {}

  plan(topic: string, pedagogicalProfile: PedagogicalProfile): Promise<PresentationPlan> {
    return this.llmProvider.planPresentation({ topic, pedagogicalProfile });
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

