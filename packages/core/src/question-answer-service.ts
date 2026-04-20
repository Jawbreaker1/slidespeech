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

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

const tokenizeWords = (value: string): string[] =>
  Array.from(normalizeContextText(value).normalize("NFKC").matchAll(WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);

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

const buildLeadingSourceExcerpts = (
  content: string,
  wordCounts = [32, 48, 64],
): string[] => {
  const words = normalizeContextText(content).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  return uniqueNonEmptyStrings(
    wordCounts
      .map((wordCount) => words.slice(0, wordCount).join(" ").trim())
      .filter(Boolean),
  );
};

const ensureSentenceEnding = (value: string): string =>
  /[.!?]$/.test(value) ? value : `${value}.`;

const normalizeExampleLeadIn = (value: string): string =>
  value.replace(/^(for example|example:|a concrete example is:?)/i, "").trim();

const hasRepeatedWordWindow = (value: string, minWindowSize = 5): boolean => {
  const tokens = tokenizeWords(value)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2);

  if (tokens.length < minWindowSize * 2) {
    return false;
  }

  const maxWindowSize = Math.min(10, Math.floor(tokens.length / 2));

  for (let windowSize = maxWindowSize; windowSize >= minWindowSize; windowSize -= 1) {
    for (let start = 0; start + windowSize * 2 <= tokens.length; start += 1) {
      let matches = true;
      for (let index = 0; index < windowSize; index += 1) {
        if (tokens[start + index] !== tokens[start + windowSize + index]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return true;
      }
    }
  }

  return false;
};

const looksLikeTaxonomyNoise = (value: string): boolean => {
  const tokens = tokenizeWords(value).filter((token) => /\p{L}/u.test(token));

  if (tokens.length < 8) {
    return false;
  }

  const isTitleishToken = (token: string): boolean => /^\p{Lu}/u.test(token);
  const titleishCount = tokens.filter(isTitleishToken).length;
  const lowercaseCount = tokens.filter((token) => /^\p{Ll}/u.test(token)).length;
  const titleRatio = titleishCount / tokens.length;

  let longestTitleishRun = 0;
  let currentRun = 0;
  for (const token of tokens) {
    if (isTitleishToken(token)) {
      currentRun += 1;
      if (currentRun > longestTitleishRun) {
        longestTitleishRun = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  return (
    (hasRepeatedWordWindow(value) || longestTitleishRun >= 7 || titleRatio >= 0.7) &&
    lowercaseCount <= Math.max(3, Math.floor(tokens.length * 0.3))
  );
};

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
      const normalizedAnswer = this.postProcessModelAnswer({
        answerMode,
        rawText: answer.text,
      });

      if (normalizedAnswer) {
        return normalizedAnswer;
      }

      if (answerMode === "grounded_factual") {
        return "I do not have a reliable answer to that from the current slide or the available source material.";
      }

      return this.buildFallbackAnswer({
        answerMode,
        deck: input.deck,
        slide: input.slide,
        question: input.question,
        turnDecision: input.turnDecision,
        ...questionContext,
      });
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
          `${slide.title}: ${slide.learningGoal}. ${slide.keyPoints.slice(0, 2).join(" ")} ${slide.examples[0] ?? ""}`,
        );
        const score =
          countTokenOverlap(snippet, question) * 6 +
          countTokenOverlap(snippet, activeSlide.title) * 2 +
          countTokenOverlap(snippet, activeSlide.learningGoal) * 2 +
          countTokenOverlap(slide.title, question) * 4;

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
  }): Promise<{
    broaderDeckContext?: string;
    sourceGroundingContext?: string;
  }> {
    const broaderDeckContext =
      input.answerMode !== "general_contextual" &&
      input.answerMode !== "example"
        ? undefined
        : this.buildBroaderDeckContext(
            input.question,
            input.deck,
            input.slide,
          );
    const sourceGroundingContext =
      input.answerMode === "grounded_factual" ||
      (input.answerMode === "general_contextual" &&
        input.deck.source.sourceIds.length > 0)
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
    const leadingExcerpts = buildLeadingSourceExcerpts(input.finding.content);
    const rawWindows = uniqueNonEmptyStrings([
      ...leadingExcerpts,
      ...buildWordWindows(input.finding.content, 24, 12),
      ...buildWordWindows(input.finding.content, 40, 20),
    ]);
    const windows = rawWindows.filter((excerpt) => !looksLikeTaxonomyNoise(excerpt));

    const candidates = windows.map((excerpt, index) => {
      const questionOverlap = countTokenOverlap(excerpt, input.question);
      const topicOverlap = countTokenOverlap(excerpt, input.deck.topic);
      const slideOverlap =
        countTokenOverlap(excerpt, input.slide.title) +
        countTokenOverlap(excerpt, input.slide.learningGoal);
      const brevityBonus = Math.max(0, 18 - tokenizeContext(excerpt).length);
      const earlyBonus = Math.max(0, 4 - index);
      const noisePenalty = looksLikeTaxonomyNoise(excerpt) ? -12 : 0;
      const score =
        questionOverlap * 6 +
        slideOverlap * 2 +
        topicOverlap * 2 +
        brevityBonus +
        earlyBonus +
        noisePenalty;

      return { excerpt, score };
    });

    return uniqueNonEmptyStrings([
      ...leadingExcerpts.filter((excerpt) => !looksLikeTaxonomyNoise(excerpt)).slice(-2),
      ...[...candidates]
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((candidate) => candidate.excerpt),
    ])
      .filter((excerpt) => excerpt.length >= 24)
      .slice(0, 4)
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
    ).slice(0, 6);

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

    return null;
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
    const currentSlideCandidate = rankedCandidates.find(
      (candidate) => candidate.kind === "current_slide",
    );
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
                    ? 1
                    : 4),
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
