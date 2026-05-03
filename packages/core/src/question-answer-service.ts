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
  countRelevanceOverlap,
  countTokenOverlap,
  domainFromUrl,
  ensureSentenceEnding,
  FACTUAL_INFORMATION_PATTERN,
  FACTUAL_RESEARCH_CUE_TOKENS,
  formatGroundedSourceAnswer,
  hasRepeatedWordWindow,
  isResponsiveGroundedAnswer,
  looksLikeInternalPresentationScaffold,
  looksLikeTaxonomyNoise,
  normalizeContextText,
  normalizeExampleLeadIn,
  PRESENTATION_REFERENTIAL_PATTERN,
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

type ContextAnswerCandidate = {
  snippet: string;
  score: number;
  kind: "current_slide" | "deck" | "source";
};

type QuestionScopeClassification =
  | "presentation_relevant"
  | "presentation_relevant_needs_more_context"
  | "off_topic";

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

    if (scope === "off_topic") {
      return "That question does not seem to be about the current presentation. Ask about the current slide, the deck topic, or the attached source material.";
    }

    const questionContext = await this.buildQuestionContext({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
      scope,
    });
    const localAnswer = this.buildLocalAnswer(
      answerMode,
      input.slide,
      input.turnDecision,
    );

    if (localAnswer) {
      return localAnswer;
    }

    const deterministicAnswer = this.buildDeterministicContextAnswer({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
      ...(questionContext.broaderDeckContext
        ? { broaderDeckContext: questionContext.broaderDeckContext }
        : {}),
      ...(questionContext.sourceGroundingContext
        ? { sourceGroundingContext: questionContext.sourceGroundingContext }
        : {}),
    });

    if (
      deterministicAnswer &&
      (await this.shouldAcceptAnswerCandidate({
        deck: input.deck,
        slide: input.slide,
        question: input.question,
        answerMode,
        proposedAnswer: deterministicAnswer,
        ...questionContext,
      }))
    ) {
      return deterministicAnswer;
    }

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
        `[slidespeech] question answering fallback for slide ${input.slide.id}: ${(error as Error).message}`,
      );
    }

    const fallbackAnswer = this.buildFallbackAnswer({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
      turnDecision: input.turnDecision,
      ...questionContext,
    });

    if (
      await this.shouldAcceptAnswerCandidate({
        deck: input.deck,
        slide: input.slide,
        question: input.question,
        answerMode,
        proposedAnswer: fallbackAnswer,
        ...questionContext,
      })
    ) {
      return fallbackAnswer;
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

  private buildLocalAnswer(
    answerMode: QuestionAnswerMode,
    slide: Slide,
    turnDecision: ConversationTurnDecision,
  ): string | null {
    const beginnerExplanation = slide.beginnerExplanation.trim();
    const primaryPoint = (slide.keyPoints[0] ?? slide.learningGoal).trim();

    if (answerMode === "summarize_current_slide") {
      return beginnerExplanation || ensureSentenceEnding(primaryPoint);
    }

    if (answerMode === "example") {
      const exampleSeed = this.selectExampleSeed(slide);
      return exampleSeed
        ? `One concrete example is ${ensureSentenceEnding(
            normalizeExampleLeadIn(exampleSeed),
          )}`
        : null;
    }

    if (turnDecision.inferredNeeds.includes("confusion")) {
      return beginnerExplanation || ensureSentenceEnding(primaryPoint);
    }

    return null;
  }

  private selectExampleSeed(slide: Slide): string | null {
    const slideExample = slide.examples[0]?.trim();
    if (slideExample) {
      return slideExample;
    }

    return null;
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
    if (
      input.answerMode === "summarize_current_slide" ||
      input.answerMode === "example"
    ) {
      return "presentation_relevant";
    }

    if (PRESENTATION_REFERENTIAL_PATTERN.test(input.question)) {
      return "presentation_relevant";
    }

    const sourceHostnames = uniqueNonEmptyStrings(
      input.deck.source.sourceIds.map((sourceId) => domainFromUrl(sourceId)),
    );
    const sourceDomainPhrase = sourceHostnames.join(" ");
    const anchorCorpus = uniqueNonEmptyStrings([
      input.deck.topic,
      input.deck.title,
      input.deck.summary,
      input.slide.title,
      input.slide.learningGoal,
      ...input.slide.keyPoints.slice(0, 3),
      sourceDomainPhrase,
    ]).join(" ");

    const topicSignal =
      countRelevanceOverlap(input.question, input.deck.topic) +
      countRelevanceOverlap(input.question, input.slide.title) +
      countRelevanceOverlap(input.question, input.slide.learningGoal);
    const anchorSignal = countRelevanceOverlap(input.question, anchorCorpus);
    const sourceSignal = sourceDomainPhrase
      ? countRelevanceOverlap(input.question, sourceDomainPhrase)
      : 0;
    const looksFactual = FACTUAL_INFORMATION_PATTERN.test(input.question);

    if (topicSignal >= 2 || anchorSignal >= 3 || sourceSignal >= 1) {
      return looksFactual
        ? "presentation_relevant_needs_more_context"
        : "presentation_relevant";
    }

    if (looksFactual && (topicSignal >= 1 || anchorSignal >= 2)) {
      return "presentation_relevant_needs_more_context";
    }

    if (
      looksFactual &&
      input.deck.source.sourceIds.length > 0 &&
      countRelevanceOverlap(input.question, input.deck.topic) >= 1
    ) {
      return "presentation_relevant_needs_more_context";
    }

    return "off_topic";
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

    if (input.scope === "off_topic") {
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

  private buildDeterministicContextAnswer(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }): string | null {
    const rankedCandidates = this.rankContextCandidates(input);
    const bestCandidate = rankedCandidates[0];
    const secondBestScore = rankedCandidates[1]?.score ?? 0;

    if (!bestCandidate) {
      return null;
    }

    if (
      bestCandidate.kind === "source" &&
      bestCandidate.score >= 8 &&
      bestCandidate.score >= secondBestScore + 2
    ) {
      const formatted = formatGroundedSourceAnswer(
        bestCandidate.snippet,
        input.question,
      );
      if (!isResponsiveGroundedAnswer(formatted, input.question)) {
        return null;
      }

      return ensureSentenceEnding(
        formatted,
      );
    }

    return null;
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
      return true;
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
        `[slidespeech] answer validation fallback for slide ${input.slide.id}: ${(error as Error).message}`,
      );
      return true;
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

    if (
      /system verification - home|knowledge hub|press release|our qa solutions|quality assurance integrated|faster code|hidden risks/i.test(
        normalizedAnswer,
      )
    ) {
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

  private buildFallbackAnswer(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
    turnDecision: ConversationTurnDecision;
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }): string {
    const localAnswer = this.buildLocalAnswer(
      input.answerMode,
      input.slide,
      input.turnDecision,
    );
    if (localAnswer) {
      return localAnswer;
    }

    const questionTopicSignal =
      countTokenOverlap(input.question, input.deck.topic) +
      countTokenOverlap(input.question, input.slide.title);
    const rankedCandidates = this.rankContextCandidates(input);
    if (
      input.answerMode === "grounded_factual" &&
      input.deck.source.sourceIds.length > 0 &&
      questionTopicSignal >= 2
    ) {
      const bestGroundedCandidate = rankedCandidates.find(
        (candidate) => candidate.kind === "source",
      );
      const formattedGroundedAnswer =
        bestGroundedCandidate && bestGroundedCandidate.kind === "source"
          ? formatGroundedSourceAnswer(bestGroundedCandidate.snippet, input.question)
          : "";
      if (
        bestGroundedCandidate &&
        bestGroundedCandidate.kind === "source" &&
        isResponsiveGroundedAnswer(formattedGroundedAnswer, input.question)
      ) {
        return ensureSentenceEnding(formattedGroundedAnswer);
      }
    }

    const fallbackCandidate = rankedCandidates[0];
    const currentSlideCandidate = rankedCandidates.find(
      (candidate) => candidate.kind === "current_slide",
    );
    if (input.answerMode === "grounded_factual") {
      const formattedDeckFact = fallbackCandidate
        ? formatGroundedSourceAnswer(fallbackCandidate.snippet, input.question)
        : "";
      if (isResponsiveGroundedAnswer(formattedDeckFact, input.question)) {
        return ensureSentenceEnding(formattedDeckFact);
      }

      const formattedCurrentSlideFact = currentSlideCandidate
        ? formatGroundedSourceAnswer(currentSlideCandidate.snippet, input.question)
        : "";
      if (isResponsiveGroundedAnswer(formattedCurrentSlideFact, input.question)) {
        return ensureSentenceEnding(formattedCurrentSlideFact);
      }
    }

    const deckFallbackOutranksCurrentSlideClearly =
      fallbackCandidate?.kind === "deck" &&
      currentSlideCandidate !== undefined &&
      fallbackCandidate.score >= currentSlideCandidate.score + 4 &&
      countTokenOverlap(fallbackCandidate.snippet, input.question) >=
        countTokenOverlap(currentSlideCandidate.snippet, input.question) + 1;
    const preferCurrentSlideFallback =
      fallbackCandidate &&
      fallbackCandidate.kind !== "current_slide" &&
      currentSlideCandidate &&
      (!deckFallbackOutranksCurrentSlideClearly ||
        currentSlideCandidate.score >= fallbackCandidate.score - 2);

    if (preferCurrentSlideFallback && currentSlideCandidate) {
      return ensureSentenceEnding(normalizeContextText(currentSlideCandidate.snippet));
    }

    if (fallbackCandidate && input.answerMode !== "example") {
      return ensureSentenceEnding(normalizeContextText(fallbackCandidate.snippet));
    }

    return "I do not have a reliable answer to that from the current slide or the available source material.";
  }

  private buildUnavailableAnswer(answerMode: QuestionAnswerMode): string {
    if (answerMode === "grounded_factual") {
      return "I do not have a reliable answer to that from the current slide or the available source material.";
    }

    return "I do not have a reliable answer to that from the current slide or the broader presentation context.";
  }

  private rankContextCandidates(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }): ContextAnswerCandidate[] {
    const currentSlideSummary =
      input.slide.beginnerExplanation ||
      input.slide.keyPoints[0] ||
      input.slide.learningGoal;
    const currentSlideCandidate = normalizeContextText(
      currentSlideSummary,
    );
    const broaderDeckCandidates =
      input.answerMode === "grounded_factual" && input.sourceGroundingContext
        ? []
        : uniqueNonEmptyStrings(input.broaderDeckContext?.split("|") ?? []);
    const sourceCandidates = uniqueNonEmptyStrings(
      input.sourceGroundingContext?.split("|") ?? [],
    );
    const questionTopicSignal =
      countTokenOverlap(input.question, input.deck.topic) +
      countTokenOverlap(input.question, input.slide.title);
    const sourceBiasActive =
      sourceCandidates.length > 0 && questionTopicSignal >= 2;
    const includeCurrentSlideCandidate = !(
      input.answerMode === "grounded_factual" && sourceCandidates.length > 0
    );
    return [
      ...(includeCurrentSlideCandidate && currentSlideCandidate
        ? [
            {
              kind: "current_slide" as const,
              snippet: currentSlideCandidate,
              score:
                countTokenOverlap(currentSlideCandidate, input.question) * 4 +
                countTokenOverlap(currentSlideCandidate, input.slide.title) * 2 +
                countTokenOverlap(currentSlideCandidate, input.slide.learningGoal) * 2 +
                (input.answerMode === "grounded_factual"
                  ? 0
                  : sourceBiasActive
                    ? 1
                    : 4) -
                computeContextQualityPenalty(currentSlideCandidate),
            },
          ]
        : []),
      ...broaderDeckCandidates.map((snippet) => ({
        kind: "deck" as const,
        snippet,
        score:
          countTokenOverlap(snippet, input.question) * 5 +
          countTokenOverlap(snippet, input.slide.title) * 2 +
          countTokenOverlap(snippet, input.slide.learningGoal) * 2 +
          countTokenOverlap(snippet, input.deck.topic) -
          computeContextQualityPenalty(snippet),
      })),
      ...sourceCandidates.map((snippet) => ({
        kind: "source" as const,
        snippet,
        score:
          countTokenOverlap(snippet, input.question) * 6 +
          countTokenOverlap(snippet, input.slide.title) +
          countTokenOverlap(snippet, input.slide.learningGoal) +
          countTokenOverlap(snippet, input.deck.topic) * 2 +
          (input.answerMode === "grounded_factual" ? 4 : 0) +
          (sourceBiasActive ? 6 : 0) -
          computeContextQualityPenalty(snippet),
      })),
    ].sort((left, right) => right.score - left.score);
  }
}
