import type {
  ConversationTurnDecision,
  Deck,
  LLMProvider,
  PedagogicalProfile,
  Session,
  Slide,
  WebFetchResult,
  WebResearchProvider,
} from "@slidespeech/types";

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

const normalizeContextText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const tokenizeContext = (value: string): string[] =>
  normalizeContextText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const uniqueNonEmptyStrings = (
  values: Array<string | null | undefined>,
): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value ? normalizeContextText(value) : "";
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
};

const countTokenOverlap = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeContext(left))];
  const rightTokens = new Set(tokenizeContext(right));
  return leftTokens.filter((token) => rightTokens.has(token)).length;
};

const buildWordWindows = (
  content: string,
  windowSize = 36,
  stride = 18,
): string[] => {
  const words = normalizeContextText(content).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const windows = [words.slice(0, windowSize).join(" ")];
  for (let index = 0; index < words.length; index += stride) {
    const window = words.slice(index, index + windowSize).join(" ");
    if (window.trim()) {
      windows.push(window);
    }
  }

  return uniqueNonEmptyStrings(windows);
};

const buildLeadingSourceExcerpt = (
  content: string,
  wordCount = 32,
): string | undefined => {
  const words = normalizeContextText(content).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return undefined;
  }

  return words.slice(0, wordCount).join(" ") || undefined;
};

const ensureSentenceEnding = (value: string): string =>
  /[.!?]$/.test(value) ? value : `${value}.`;

const normalizeExampleLeadIn = (value: string): string =>
  value.replace(/^(for example|example:|a concrete example is:?)/i, "").trim();

export class QuestionAnswerService {
  private readonly sourceFindingCache = new Map<
    string,
    Promise<WebFetchResult | null>
  >();

  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly webResearchProvider?: WebResearchProvider,
  ) {}

  async answer(input: QuestionAnswerInput): Promise<string> {
    const answerMode = this.resolveAnswerMode(input.turnDecision);
    const questionContext = await this.buildQuestionContext({
      answerMode,
      deck: input.deck,
      slide: input.slide,
      question: input.question,
    });
    const localAnswer = this.buildLocalAnswer(
      answerMode,
      input.deck,
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

    if (deterministicAnswer) {
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
      return answer.text;
    } catch (error) {
      console.warn(
        `[slidespeech] question answering fallback for slide ${input.slide.id}: ${(error as Error).message}`,
      );

      return this.buildFallbackAnswer({
        answerMode,
        deck: input.deck,
        slide: input.slide,
        question: input.question,
        turnDecision: input.turnDecision,
        ...questionContext,
      });
    }
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
    deck: Deck,
    slide: Slide,
    turnDecision: ConversationTurnDecision,
  ): string | null {
    const beginnerExplanation = slide.beginnerExplanation.trim();
    const primaryPoint = (slide.keyPoints[0] ?? slide.learningGoal).trim();

    if (answerMode === "summarize_current_slide") {
      return beginnerExplanation || ensureSentenceEnding(primaryPoint);
    }

    if (answerMode === "example") {
      const exampleSeed = this.selectExampleSeed(deck, slide);
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

  private selectExampleSeed(deck: Deck, slide: Slide): string | null {
    const slideExample = slide.examples[0]?.trim();
    if (slideExample) {
      return slideExample;
    }

    const neighboringExample = deck.slides
      .filter((candidate) => candidate.id !== slide.id)
      .flatMap((candidate) => candidate.examples)
      .map((example) => example.trim())
      .find(Boolean);
    if (neighboringExample) {
      return neighboringExample;
    }

    const keyPointExample =
      slide.keyPoints.find((point) => point.trim().length > 0)?.trim() ?? "";
    if (keyPointExample) {
      return keyPointExample;
    }

    return null;
  }

  private buildBroaderDeckContext(
    deck: Deck,
    activeSlide: Slide,
  ): string | undefined {
    const relatedSlides = deck.slides
      .filter((slide) => slide.id !== activeSlide.id)
      .slice(0, 3)
      .map(
        (slide) =>
          `${slide.title}: ${slide.learningGoal}. ${slide.keyPoints.slice(0, 2).join(" ")}`,
      );

    const context = uniqueNonEmptyStrings(relatedSlides).join(" | ");

    return context || undefined;
  }

  private async buildQuestionContext(input: {
    answerMode: QuestionAnswerMode;
    deck: Deck;
    slide: Slide;
    question: string;
  }): Promise<{
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }> {
    const topicSignal =
      countTokenOverlap(input.question, input.deck.topic) +
      countTokenOverlap(input.question, input.slide.title);
    const broaderDeckContext =
      input.answerMode !== "general_contextual" &&
      input.answerMode !== "example"
        ? undefined
        : topicSignal >= 1
          ? this.buildBroaderDeckContext(input.deck, input.slide)
          : undefined;
    const sourceGroundingContext =
      input.answerMode === "grounded_factual" || topicSignal >= 2
        ? await this.buildSourceGroundingContext(
            input.deck,
            input.slide,
            input.question,
          )
        : undefined;

    return {
      ...(broaderDeckContext ? { broaderDeckContext } : {}),
      ...(sourceGroundingContext ? { sourceGroundingContext } : {}),
    };
  }

  private async loadSourceFinding(url: string): Promise<WebFetchResult | null> {
    if (!this.webResearchProvider) {
      return null;
    }

    const cached = this.sourceFindingCache.get(url);
    if (cached) {
      return cached;
    }

    const pending = this.webResearchProvider.fetch(url).catch((error) => {
      console.warn(
        `[slidespeech] question grounding fetch failed for ${url}: ${(error as Error).message}`,
      );
      return null;
    });

    this.sourceFindingCache.set(url, pending);
    return pending;
  }

  private extractRelevantSourceExcerpts(input: {
    finding: WebFetchResult;
    deck: Deck;
    slide: Slide;
    question: string;
  }): string[] {
    const windows = uniqueNonEmptyStrings([
      buildLeadingSourceExcerpt(input.finding.content) ?? "",
      ...buildWordWindows(input.finding.content, 16, 8),
      ...buildWordWindows(input.finding.content, 32, 16),
    ]);

    const candidates = windows.map((excerpt, index) => {
      const questionOverlap = countTokenOverlap(excerpt, input.question);
      const topicOverlap = countTokenOverlap(excerpt, input.deck.topic);
      const slideOverlap =
        countTokenOverlap(excerpt, input.slide.title) +
        countTokenOverlap(excerpt, input.slide.learningGoal);
      const brevityBonus = Math.max(0, 18 - tokenizeContext(excerpt).length);
      const earlyBonus = Math.max(0, 4 - index);
      const score =
        questionOverlap * 6 +
        slideOverlap * 2 +
        topicOverlap * 2 +
        brevityBonus +
        earlyBonus;

      return { excerpt, score };
    });

    return uniqueNonEmptyStrings(
      [...candidates]
        .sort((left, right) => right.score - left.score)
        .slice(0, 2)
        .map((candidate) => candidate.excerpt),
    )
      .filter((excerpt) => excerpt.length >= 24)
      .slice(0, 2)
      .map((excerpt) => `${input.finding.title}: ${excerpt}`);
  }

  private async buildSourceGroundingContext(
    deck: Deck,
    slide: Slide,
    question: string,
  ): Promise<string | undefined> {
    const sourceIds = uniqueNonEmptyStrings(deck.source.sourceIds).slice(0, 2);
    if (sourceIds.length === 0) {
      return undefined;
    }

    const findings = (
      await Promise.all(sourceIds.map((sourceId) => this.loadSourceFinding(sourceId)))
    ).filter((finding): finding is WebFetchResult => Boolean(finding));

    const excerpts = uniqueNonEmptyStrings(
      findings.flatMap((finding) =>
        this.extractRelevantSourceExcerpts({
          finding,
          deck,
          slide,
          question,
        }),
      ),
    ).slice(0, 4);

    return excerpts.length > 0 ? excerpts.join(" | ") : undefined;
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
    const questionTopicSignal =
      countTokenOverlap(input.question, input.deck.topic) +
      countTokenOverlap(input.question, input.slide.title);
    const groundedTopicQuestion =
      input.deck.source.sourceIds.length > 0 && questionTopicSignal >= 2;

    if (!bestCandidate) {
      return null;
    }

    if (
      bestCandidate.kind === "source" &&
      bestCandidate.score >= 8 &&
      bestCandidate.score >= secondBestScore + 2
    ) {
      return ensureSentenceEnding(normalizeContextText(bestCandidate.snippet));
    }

    if (
      bestCandidate.kind === "current_slide" &&
      input.answerMode === "general_contextual" &&
      !groundedTopicQuestion &&
      bestCandidate.score >= 10 &&
      bestCandidate.score >= secondBestScore + 4
    ) {
      return ensureSentenceEnding(normalizeContextText(bestCandidate.snippet));
    }

    return null;
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
      input.deck,
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
      input.deck.source.sourceIds.length > 0 &&
      questionTopicSignal >= 2
    ) {
      const bestGroundedCandidate = rankedCandidates[0];
      if (!bestGroundedCandidate || bestGroundedCandidate.kind !== "source") {
        return "I do not have a reliable answer to that from the current slide or the available source material.";
      }

      return ensureSentenceEnding(normalizeContextText(bestGroundedCandidate.snippet));
    }

    const fallbackCandidate = rankedCandidates[0];
    if (fallbackCandidate && input.answerMode !== "example") {
      return ensureSentenceEnding(normalizeContextText(fallbackCandidate.snippet));
    }

    return "I do not have a reliable answer to that from the current slide or the available source material.";
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
      input.answerMode === "grounded_factual"
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
                    ? 2
                    : 18),
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
          countTokenOverlap(snippet, input.deck.topic),
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
          (sourceBiasActive ? 6 : 0),
      })),
    ].sort((left, right) => right.score - left.score);
  }
}
