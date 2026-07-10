import type {
  ConversationTurnDecision,
  Deck,
  LLMProvider,
  PedagogicalProfile,
  Session,
  Slide,
  WebResearchProvider,
} from "@slidespeech/types";
import {
  computeContextQualityPenalty,
  countTokenOverlap,
  ensureSentenceEnding,
  FACTUAL_INFORMATION_PATTERN,
  FACTUAL_RESEARCH_CUE_TOKENS,
  hasRepeatedWordWindow,
  looksLikeInternalPresentationScaffold,
  looksLikeTaxonomyNoise,
  normalizeContextText,
  tokenizeContext,
  uniqueNonEmptyStrings,
} from "./question-answer-heuristics";
import { QuestionAnswerGroundingService } from "./question-answer-grounding";

type QuestionAnswerMode =
  | "summarize_current_slide"
  | "example"
  | "general_contextual"
  | "grounded_factual";

type QuestionAnswerInput = {
  deck: Deck;
  slide: Slide;
  session: Session;
  pedagogicalProfile: PedagogicalProfile;
  question: string;
  turnDecision: ConversationTurnDecision;
};

type QuestionScopeClassification =
  | "presentation_relevant"
  | "presentation_relevant_needs_more_context";

const SOURCE_NAVIGATION_ANSWER_NOISE_PATTERN =
  /\b(?:home|knowledge hub|press release|article|blog|career|careers|open positions|contact|privacy|newsletter|search|read more|learn more|view all news|follow us|sign up)\b/gi;

const looksLikeSourceNavigationAnswerNoise = (value: string): boolean => {
  const matches = value.match(SOURCE_NAVIGATION_ANSWER_NOISE_PATTERN) ?? [];
  return matches.length >= 3;
};

export class QuestionAnswerService {
  private readonly groundingService: QuestionAnswerGroundingService;

  constructor(
    private readonly llmProvider: LLMProvider,
    webResearchProvider?: WebResearchProvider,
  ) {
    this.groundingService = new QuestionAnswerGroundingService(webResearchProvider);
  }

  async answer(input: QuestionAnswerInput): Promise<string> {
    const answerMode = this.resolveAnswerMode(input.turnDecision);
    const scope = this.classifyQuestionScope({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
    });

    const questionContext = await this.buildQuestionContext({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
      scope,
    });

    try {
      const answer = await this.llmProvider.answerQuestion({
        deck: input.deck,
        slide: input.slide,
        session: input.session,
        pedagogicalProfile: input.pedagogicalProfile,
        question: input.question,
        answerMode,
        ...(questionContext.broaderDeckContext
          ? { broaderDeckContext: questionContext.broaderDeckContext }
          : {}),
        ...(questionContext.sourceGroundingContext
          ? { sourceGroundingContext: questionContext.sourceGroundingContext }
          : {}),
      });
      const normalizedAnswer = this.postProcessModelAnswer({
        answerMode,
        rawText: answer.text,
      });

      if (normalizedAnswer) {
        if (
          await this.shouldAcceptAnswerCandidate({
            deck: input.deck,
            slide: input.slide,
            question: input.question,
            answerMode,
            proposedAnswer: normalizedAnswer,
            ...questionContext,
          })
        ) {
          return normalizedAnswer;
        }
      }
    } catch (error) {
      console.warn(
        `[slidespeech] question answering model path failed for slide ${input.slide.id}: ${(error as Error).message}`,
      );
    }

    return this.buildUnavailableAnswer(answerMode);
  }

  private resolveAnswerMode(
    turnDecision: ConversationTurnDecision,
  ): QuestionAnswerMode {
    if (turnDecision.inferredNeeds.includes("example")) {
      return "example";
    }

    switch (turnDecision.responseMode) {
      case "summarize_current_slide":
        return "summarize_current_slide";
      case "example":
        return "example";
      case "grounded_factual":
        return "grounded_factual";
      case "general_contextual":
      case "question":
      default:
        return "general_contextual";
    }
  }

  private buildBroaderDeckContext(
    question: string,
    deck: Deck,
    activeSlide: Slide,
  ): string | undefined {
    const relatedSlides = deck.slides
      .filter((slide) => slide.id !== activeSlide.id)
      .map((slide) => {
        const snippet = normalizeContextText(
          `${slide.title}: ${slide.beginnerExplanation || slide.keyPoints.slice(0, 2).join(" ")} ${slide.keyPoints.slice(0, 2).join(" ")} ${slide.examples[0] ?? ""}`,
        );
        const score =
          countTokenOverlap(snippet, question) * 6 +
          countTokenOverlap(snippet, activeSlide.title) * 2 +
          countTokenOverlap(snippet, activeSlide.learningGoal) * 2 +
          countTokenOverlap(slide.title, question) * 4 -
          computeContextQualityPenalty(snippet);

        return { snippet, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(
        (candidate) => candidate.snippet,
      );

    const context = uniqueNonEmptyStrings(relatedSlides).join(" | ");

    return context || undefined;
  }

  private async buildQuestionContext(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
    scope: QuestionScopeClassification;
  }): Promise<{
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }> {
    const broaderDeckContext =
      input.answerMode === "summarize_current_slide"
        ? undefined
        : this.buildBroaderDeckContext(
            input.question,
            input.deck,
            input.slide,
          );
    let sourceGroundingContext =
      input.answerMode === "grounded_factual" ||
      (input.answerMode === "general_contextual" &&
        input.deck.source.sourceIds.length > 0)
        ? await this.groundingService.buildSourceGroundingContext(
            input.deck,
            input.slide,
            input.question,
          )
        : undefined;

    if (
      this.shouldAttemptFollowUpResearch({
        answerMode: input.answerMode,
        deck: input.deck,
        question: input.question,
        scope: input.scope,
        ...(sourceGroundingContext ? { sourceGroundingContext } : {}),
      })
    ) {
      sourceGroundingContext = await this.groundingService.buildFollowUpSourceGroundingContext({
        deck: input.deck,
        slide: input.slide,
        question: input.question,
        ...(sourceGroundingContext
          ? { existingSourceGroundingContext: sourceGroundingContext }
          : {}),
      });
    }

    return {
      ...(broaderDeckContext ? { broaderDeckContext } : {}),
      ...(sourceGroundingContext ? { sourceGroundingContext } : {}),
    };
  }

  private classifyQuestionScope(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
  }): QuestionScopeClassification {
    const looksFactual = FACTUAL_INFORMATION_PATTERN.test(input.question);

    if (input.answerMode === "grounded_factual") {
      return "presentation_relevant_needs_more_context";
    }

    if (looksFactual && input.deck.source.sourceIds.length > 0) {
      return "presentation_relevant_needs_more_context";
    }

    return "presentation_relevant";
  }

  private shouldAttemptFollowUpResearch(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    question: string;
    sourceGroundingContext?: string;
    scope: QuestionScopeClassification;
  }): boolean {
    if (
      !this.groundingService.hasProvider() ||
      input.deck.source.sourceIds.length === 0
    ) {
      return false;
    }

    if (
      input.answerMode !== "grounded_factual" &&
      input.scope !== "presentation_relevant_needs_more_context"
    ) {
      return false;
    }

    if (!input.sourceGroundingContext) {
      return true;
    }

    const sourceCandidates = uniqueNonEmptyStrings(
      input.sourceGroundingContext.split("|"),
    );
    const sourceCandidateText = sourceCandidates.join(" ");
    const strongestOverlap = sourceCandidates.reduce(
      (best, snippet) => Math.max(best, countTokenOverlap(snippet, input.question)),
      0,
    );
    const questionCueTokens = tokenizeContext(input.question).filter((token) =>
      FACTUAL_RESEARCH_CUE_TOKENS.has(token),
    );
    const sourceCueCoverage = questionCueTokens.some((token) =>
      tokenizeContext(sourceCandidateText).includes(token),
    );

    if (questionCueTokens.length > 0 && !sourceCueCoverage) {
      return true;
    }

    return strongestOverlap < 2;
  }

  private async shouldAcceptAnswerCandidate(input: {
    deck: Deck;
    slide: Slide;
    question: string;
    answerMode: QuestionAnswerMode;
    proposedAnswer: string;
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }): Promise<boolean> {
    const normalizedAnswer = normalizeContextText(input.proposedAnswer);
    if (!normalizedAnswer) {
      return false;
    }

    if (
      normalizedAnswer ===
      "I do not have a reliable answer to that from the current slide or the available source material."
    ) {
      return true;
    }

    if (this.shouldRejectAnswerCandidateHeuristically(input, normalizedAnswer)) {
      return false;
    }

    if (typeof this.llmProvider.validateQuestionAnswer !== "function") {
      console.warn(
        `[slidespeech] rejected candidate answer for slide ${input.slide.id}: answer validation is not supported by the configured LLM provider.`,
      );
      return false;
    }

    try {
      const validation = await this.llmProvider.validateQuestionAnswer({
        deck: input.deck,
        slide: input.slide,
        pedagogicalProfile: input.deck.pedagogicalProfile,
        question: input.question,
        proposedAnswer: normalizedAnswer,
        answerMode: input.answerMode,
        ...(input.broaderDeckContext
          ? { broaderDeckContext: input.broaderDeckContext }
          : {}),
        ...(input.sourceGroundingContext
          ? { sourceGroundingContext: input.sourceGroundingContext }
          : {}),
      });

      if (!validation.isValid) {
        console.warn(
          `[slidespeech] rejected candidate answer for slide ${input.slide.id}: ${validation.reason}`,
        );
      }

      return validation.isValid;
      } catch (error) {
        console.warn(
          `[slidespeech] answer validation unavailable for slide ${input.slide.id}; rejecting candidate: ${(error as Error).message}`,
        );
        return false;
      }
  }

  private shouldRejectAnswerCandidateHeuristically(
    input: {
      deck: Deck;
      slide: Slide;
      question: string;
      answerMode: QuestionAnswerMode;
      proposedAnswer: string;
      broaderDeckContext?: string;
      sourceGroundingContext?: string;
    },
    normalizedAnswer: string,
  ): boolean {
    if (
      hasRepeatedWordWindow(normalizedAnswer) ||
      looksLikeInternalPresentationScaffold(normalizedAnswer)
    ) {
      return true;
    }

    if (
      input.answerMode !== "grounded_factual" &&
      looksLikeTaxonomyNoise(normalizedAnswer)
    ) {
      return true;
    }

    if (input.answerMode !== "grounded_factual") {
      return false;
    }

    if (looksLikeSourceNavigationAnswerNoise(normalizedAnswer)) {
      return true;
    }

    if (/provided grounding context does not contain information/i.test(normalizedAnswer)) {
      return true;
    }

    return false;
  }

  private postProcessModelAnswer(input: {
    answerMode: QuestionAnswerMode;
    rawText: string;
  }): string | null {
    const normalized = normalizeContextText(input.rawText);
    if (!normalized) {
      return null;
    }

    if (input.answerMode === "grounded_factual") {
      const wordCount = normalized.split(/\s+/).filter(Boolean).length;
      if (!/[.!?]$/.test(normalized) && wordCount >= 8) {
        return null;
      }

      return ensureSentenceEnding(normalized);
    }

    return normalized;
  }

  private buildUnavailableAnswer(answerMode: QuestionAnswerMode): string {
    if (answerMode === "grounded_factual") {
      return "I do not have a reliable answer to that from the current slide or the available source material.";
    }

    return "I do not have a reliable answer to that from the current slide or the broader presentation context.";
  }

}
