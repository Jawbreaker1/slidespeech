import type {
  Deck,
  Slide,
  WebFetchResult,
  WebResearchProvider,
  WebSearchResult,
} from "@slidespeech/types";

import {
  buildLeadingSourceExcerpts,
  buildWordWindows,
  countTokenOverlap,
  domainFromUrl,
  FACTUAL_RESEARCH_CUE_TOKENS,
  looksLikeTaxonomyNoise,
  normalizeContextText,
  tokenizeContext,
  tokenizeWords,
  uniqueNonEmptyStrings,
} from "./question-answer-heuristics";

export class QuestionAnswerGroundingService {
  private readonly sourceFindingCache = new Map<
    string,
    Promise<WebFetchResult | null>
  >();
  private readonly sourceSearchCache = new Map<
    string,
    Promise<WebSearchResult[]>
  >();

  constructor(private readonly webResearchProvider?: WebResearchProvider) {}

  hasProvider(): boolean {
    return Boolean(this.webResearchProvider);
  }

  async buildSourceGroundingContext(
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

  async buildFollowUpSourceGroundingContext(input: {
    deck: Deck;
    slide: Slide;
    question: string;
    existingSourceGroundingContext?: string;
  }): Promise<string | undefined> {
    const sourceHostnames = new Set(
      uniqueNonEmptyStrings(
        input.deck.source.sourceIds.map((sourceId) => domainFromUrl(sourceId)),
      ),
    );
    const searchQueries = this.buildFollowUpResearchQueries({
      deck: input.deck,
      question: input.question,
    });

    const results = uniqueNonEmptyStrings(
      (
        await Promise.all(
          searchQueries.map((query) => this.searchSourceFindings(query)),
        )
      ).flatMap((entries) => entries.map((entry) => JSON.stringify(entry))),
    )
      .map((entry) => JSON.parse(entry) as WebSearchResult)
      .sort((left, right) => {
        const leftDomain = domainFromUrl(left.url);
        const rightDomain = domainFromUrl(right.url);
        const leftSameDomain = sourceHostnames.has(leftDomain) ? 1 : 0;
        const rightSameDomain = sourceHostnames.has(rightDomain) ? 1 : 0;
        if (leftSameDomain !== rightSameDomain) {
          return rightSameDomain - leftSameDomain;
        }

        const leftScore =
          countTokenOverlap(`${left.title} ${left.snippet}`, input.question) * 3 +
          countTokenOverlap(`${left.title} ${left.snippet}`, input.deck.topic);
        const rightScore =
          countTokenOverlap(`${right.title} ${right.snippet}`, input.question) * 3 +
          countTokenOverlap(`${right.title} ${right.snippet}`, input.deck.topic);
        return rightScore - leftScore;
      })
      .slice(0, 2);

    const findings = (
      await Promise.all(results.map((result) => this.loadSourceFinding(result.url)))
    ).filter((finding): finding is WebFetchResult => Boolean(finding));

    const excerpts = uniqueNonEmptyStrings([
      ...(input.existingSourceGroundingContext?.split("|") ?? []),
      ...findings.flatMap((finding) =>
        this.extractRelevantSourceExcerpts({
          finding,
          deck: input.deck,
          slide: input.slide,
          question: input.question,
        }),
      ),
    ]).slice(0, 8);

    return excerpts.length > 0 ? excerpts.join(" | ") : undefined;
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

  private async searchSourceFindings(query: string): Promise<WebSearchResult[]> {
    if (!this.webResearchProvider) {
      return [];
    }

    const cached = this.sourceSearchCache.get(query);
    if (cached) {
      return cached;
    }

    const pending = this.webResearchProvider.search(query).catch((error) => {
      console.warn(
        `[slidespeech] question grounding search failed for "${query}": ${(error as Error).message}`,
      );
      return [];
    });

    this.sourceSearchCache.set(query, pending);
    return pending;
  }

  private extractRelevantSourceExcerpts(input: {
    finding: WebFetchResult;
    deck: Deck;
    slide: Slide;
    question: string;
  }): string[] {
    const questionCueTokens = tokenizeContext(input.question).filter((token) =>
      FACTUAL_RESEARCH_CUE_TOKENS.has(token),
    );
    const wantsLocationList = questionCueTokens.some((token) =>
      ["country", "countries", "office", "offices", "location", "locations"].includes(
        token,
      ),
    );
    const leadingExcerpts = buildLeadingSourceExcerpts(input.finding.content);
    const rawWindows = uniqueNonEmptyStrings([
      ...leadingExcerpts,
      ...buildWordWindows(input.finding.content, 12, 6),
      ...buildWordWindows(input.finding.content, 16, 8),
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
      const titleishTokenCount = tokenizeWords(excerpt).filter((token) =>
        /^\p{Lu}/u.test(token),
      ).length;
      const locationListBonus =
        wantsLocationList && titleishTokenCount >= 4
          ? Math.min(10, titleishTokenCount)
          : 0;
      const brevityBonus = Math.max(0, 18 - tokenizeContext(excerpt).length);
      const earlyBonus = Math.max(0, 4 - index);
      const noisePenalty = looksLikeTaxonomyNoise(excerpt) ? -12 : 0;
      const score =
        questionOverlap * 6 +
        slideOverlap * 2 +
        topicOverlap * 2 +
        locationListBonus +
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

  private buildFollowUpResearchQueries(input: {
    deck: Deck;
    question: string;
  }): string[] {
    const sourceHostnames = uniqueNonEmptyStrings(
      input.deck.source.sourceIds.map((sourceId) => domainFromUrl(sourceId)),
    ).slice(0, 2);
    const baseQuery = normalizeContextText(`${input.question} ${input.deck.topic}`);
    const creatorOrCompanyQuestion = /\b(company|created|developed|built|made|invented|launched|released)\b/i.test(
      input.question,
    );

    return uniqueNonEmptyStrings([
      ...sourceHostnames.flatMap((hostname) => [
        `site:${hostname} ${input.question}`,
        `site:${hostname} ${baseQuery}`,
        ...(creatorOrCompanyQuestion
          ? [
              `site:${hostname} who created ${input.deck.topic}`,
              `site:${hostname} ${input.deck.topic} company`,
            ]
          : []),
      ]),
      baseQuery,
      ...(creatorOrCompanyQuestion
        ? [`who created ${input.deck.topic}`, `${input.deck.topic} company`]
        : []),
    ]).slice(0, 4);
  }
}
