import type {
  RenderSlideIllustrationInput,
  SlideIllustrationProvider,
  SlideIllustrationAsset,
  VisionProvider,
  WebResearchProvider,
  WebSearchResult,
} from "@slidespeech/types";
import { createSlideIllustrationDataUri } from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";
import { sanitizeResearchQuery } from "../web-research/hosted-web-research-provider";

const IMAGE_META_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
];

const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;
const HTML_ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])(.*?)\2/g;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
]);

const LOW_QUALITY_IMAGE_SOURCE_PATTERNS = [
  /(^|\.)zhihu\.com$/i,
  /(^|\.)zhimg\.com$/i,
  /(^|\.)quora\.com$/i,
  /(^|\.)pinterest\./i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)redd\.it$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
];

interface HostedIllustrationProviderConfig {
  webResearchProvider: WebResearchProvider;
  visionProvider?: VisionProvider | undefined;
  timeoutMs?: number;
  userAgent?: string;
}

const normalizeUrl = (value: string, baseUrl: string): string | null => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

const stripHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const looksUsefulImageUrl = (url: string) => {
  const normalized = url.toLowerCase();

  if (/sprite|icon|logo|avatar|favicon/i.test(normalized)) {
    return false;
  }

  if (/\.(html?|php|aspx?|jsp)(\?|$)/i.test(normalized)) {
    return false;
  }

  return (
    /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(normalized) ||
    /\/(images?|media|assets|uploads|hubfs)\//i.test(normalized)
  );
};

const domainFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

interface ExtractedImageCandidate {
  url: string;
  altText?: string;
  title?: string;
  ariaLabel?: string;
}

const hostKeywords = (value: string): string[] =>
  domainFromUrl(value)
    .replace(/^www\./, "")
    .split(".")
    .flatMap((segment) => segment.split(/[-_]/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 3);

const scoreImageCandidateUrl = (url: string, preferredHosts: string[]): number => {
  const normalized = url.toLowerCase();
  let score = 0;

  if (/hero|cover|banner|header|og-image|sharing|featured/i.test(normalized)) {
    score += 8;
  }

  if (/team|office|solution|quality|software|case|career|about/i.test(normalized)) {
    score += 4;
  }

  if (/logo|icon|sprite|avatar|favicon/i.test(normalized)) {
    score -= 12;
  }

  if (preferredHosts.some((host) => normalized.includes(host))) {
    score += 6;
  }

  if (/\.svg(\?|$)/i.test(normalized)) {
    score -= 2;
  }

  return score;
};

const parseHtmlAttributes = (tag: string) => {
  const attributes = new Map<string, string>();

  for (const match of tag.matchAll(HTML_ATTRIBUTE_PATTERN)) {
    const name = match[1]?.toLowerCase();
    const value = match[3]?.trim();

    if (!name || !value) {
      continue;
    }

    attributes.set(name, stripHtmlEntities(value));
  }

  return attributes;
};

const buildIllustrationSemanticTokens = (
  input: RenderSlideIllustrationInput,
): string[] => {
  const slot = input.slide.visuals.imageSlots[0];

  return [
    ...new Set([
      ...tokenize(sanitizeResearchQuery(input.deck.topic) || input.deck.topic),
      ...tokenize(input.slide.title),
      ...tokenize(input.slide.learningGoal),
      ...tokenize(input.slide.visuals.imagePrompt ?? ""),
      ...tokenize(slot?.prompt ?? ""),
      ...tokenize(slot?.caption ?? ""),
      ...tokenize(slot?.altText ?? ""),
    ]),
  ];
};

const scoreImageCandidateSemanticMatch = (
  candidate: ExtractedImageCandidate,
  desiredTokens: string[],
): number => {
  const metadataTokens = new Set([
    ...tokenize(candidate.url),
    ...tokenize(candidate.altText ?? ""),
    ...tokenize(candidate.title ?? ""),
    ...tokenize(candidate.ariaLabel ?? ""),
  ]);

  const matches = desiredTokens.filter((token) => metadataTokens.has(token)).length;

  if (matches === 0) {
    return -10;
  }

  return matches * 5;
};

const minimumAcceptedImageCandidateScore = (input: {
  resultUrl: string;
  preferredHosts: string[];
}): number => {
  const resultDomain = domainFromUrl(input.resultUrl);
  const trustedSourcePage = input.preferredHosts.some(
    (host) => host && resultDomain.includes(host),
  );

  return trustedSourcePage ? -10 : 8;
};

export const scoreExtractedImageCandidate = (
  candidate: ExtractedImageCandidate,
  preferredHosts: string[],
  desiredTokens: string[],
) =>
  scoreImageCandidateUrl(candidate.url, preferredHosts) +
  scoreImageCandidateSemanticMatch(candidate, desiredTokens);

export const scoreSearchResultForIllustration = (
  input: RenderSlideIllustrationInput,
  result: WebSearchResult,
): number => {
  const domain = domainFromUrl(result.url);
  const normalizedTopic = sanitizeResearchQuery(input.deck.topic) || input.deck.topic;
  const queryTokens = [
    ...tokenize(normalizedTopic),
    ...tokenize(input.slide.title),
    ...tokenize(input.slide.visuals.imagePrompt ?? ""),
    ...tokenize(input.slide.visuals.imageSlots[0]?.prompt ?? ""),
  ];
  const uniqueTokens = [...new Set(queryTokens)];
  const titleTokens = tokenize(result.title);
  const snippetTokens = tokenize(result.snippet);
  const domainTokens = tokenize(domain.replace(/\./g, " "));
  const preferredHosts = preferredSourcePages(input).map((value) =>
    domainFromUrl(value),
  );
  const titleMatches = uniqueTokens.filter((token) => titleTokens.includes(token)).length;
  const snippetMatches = uniqueTokens.filter((token) => snippetTokens.includes(token)).length;
  const domainMatches = uniqueTokens.filter((token) => domainTokens.includes(token)).length;

  let score = titleMatches * 4 + snippetMatches * 2 + domainMatches * 6;

  if (preferredHosts.some((host) => host && domain.includes(host))) {
    score += 10;
  }

  if (/official|about|our story|company|brand|cars|vehicle|automotive|character/i.test(result.title)) {
    score += 4;
  }

  if (LOW_QUALITY_IMAGE_SOURCE_PATTERNS.some((pattern) => pattern.test(domain))) {
    score -= 20;
  }

  return score;
};

export const buildIllustrationSearchQuery = (input: RenderSlideIllustrationInput) => {
  const slot = input.slide.visuals.imageSlots[0];
  const base = slot?.prompt?.trim() || input.slide.title;
  const normalizedTopic = sanitizeResearchQuery(input.deck.topic) || input.deck.topic;
  const sourceHints = input.deck.source.sourceIds
    .flatMap((sourceId) => hostKeywords(sourceId))
    .slice(0, 3)
    .join(" ");
  return `${normalizedTopic} ${input.slide.title} illustration ${base} ${sourceHints}`.trim();
};

export const extractImageCandidateUrls = (
  html: string,
  pageUrl: string,
): string[] => {
  const candidates = extractImageCandidates(html, pageUrl);

  return candidates.map((candidate) => candidate.url);
};

export const extractImageCandidates = (
  html: string,
  pageUrl: string,
): ExtractedImageCandidate[] => {
  const candidates: ExtractedImageCandidate[] = [];

  for (const pattern of IMAGE_META_PATTERNS) {
    const match = html.match(pattern);
    const raw = match?.[1] ? stripHtmlEntities(match[1].trim()) : "";
    if (!raw) {
      continue;
    }

    const absolute = normalizeUrl(raw, pageUrl);
    if (absolute) {
      candidates.push({ url: absolute });
    }
  }

  for (const tagMatch of html.matchAll(IMG_TAG_PATTERN)) {
    const tag = tagMatch[0];
    if (!tag) {
      continue;
    }

    const attributes = parseHtmlAttributes(tag);
    const raw = attributes.get("src")?.trim() ?? "";
    if (!raw) {
      continue;
    }

    const absolute = normalizeUrl(raw, pageUrl);
    if (absolute) {
      const altText = attributes.get("alt");
      const title = attributes.get("title");
      const ariaLabel = attributes.get("aria-label");

      candidates.push({
        url: absolute,
        ...(altText ? { altText } : {}),
        ...(title ? { title } : {}),
        ...(ariaLabel ? { ariaLabel } : {}),
      });
    }
  }

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => looksUsefulImageUrl(candidate.url))
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }

      seen.add(candidate.url);
      return true;
    })
    .slice(0, 8);
};

const preferredSourcePages = (input: RenderSlideIllustrationInput): string[] => {
  const sourceIds = input.deck.source.sourceIds.filter((value) =>
    /^https?:\/\//i.test(value),
  );

  return [...new Set(sourceIds)].slice(0, 4);
};

const guessedOfficialSourcePages = (
  input: RenderSlideIllustrationInput,
): string[] => {
  const normalizedTopic = sanitizeResearchQuery(input.deck.topic);
  const slug = normalizedTopic.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (slug.length < 3 || slug.length > 24) {
    return [];
  }

  const candidates = [
    `https://www.${slug}.com/`,
    `https://${slug}.com/`,
  ];

  if (
    /\b(car|cars|vehicle|vehicles|automotive|truck|trucks)\b/i.test(input.deck.topic)
  ) {
    candidates.push(`https://www.${slug}cars.com/`);
  }

  return [...new Set(candidates)];
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) =>
  Buffer.from(buffer).toString("base64");

export class HostedIllustrationProvider implements SlideIllustrationProvider {
  readonly name = "hosted-illustration";

  private readonly webResearchProvider: WebResearchProvider;
  private readonly visionProvider?: VisionProvider | undefined;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly illustrationCache = new Map<string, SlideIllustrationAsset>();
  private readonly inFlightRequests = new Map<string, Promise<SlideIllustrationAsset>>();
  private readonly usedSourceImagesByDeck = new Map<string, Set<string>>();

  constructor(config: HostedIllustrationProviderConfig) {
    this.webResearchProvider = config.webResearchProvider;
    this.visionProvider = config.visionProvider;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.userAgent =
      config.userAgent ??
      "SlideSpeechBot/0.1 (+https://slidespeech.local; educational illustration)";
  }

  async healthCheck() {
    const researchHealth = await this.webResearchProvider.healthCheck();

    if (!researchHealth.ok) {
      return unhealthy(
        this.name,
        `Underlying web research provider is unavailable: ${researchHealth.detail}`,
      );
    }

    return healthy(
      this.name,
      "Hosted illustration provider is ready to resolve external images.",
    );
  }

  private async fetchHtml(pageUrl: string) {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": this.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Page fetch failed with status ${response.status}.`);
    }

    return response.text();
  }

  private async fetchImageData(imageUrl: string) {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": this.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Image fetch failed with status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Fetched asset is not an image: ${contentType}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);

    return {
      mimeType: contentType.split(";")[0] ?? "image/png",
      dataUri: `data:${contentType.split(";")[0] ?? "image/png"};base64,${base64}`,
    };
  }

  private buildFallback(input: RenderSlideIllustrationInput) {
    const slot = input.slide.visuals.imageSlots[0];
    const title = slot?.altText || input.slide.title;
    const prompt =
      slot?.prompt ||
      input.slide.visuals.imagePrompt ||
      `Create an educational illustration for ${input.slide.title}.`;

      return {
        slideId: input.slide.id,
        slotId: slot?.id ?? `${input.slide.id}-image-fallback`,
      mimeType: "image/svg+xml",
      dataUri: createSlideIllustrationDataUri({
        title,
        prompt,
        ...(slot?.caption ? { caption: slot.caption } : {}),
        accentColor: input.slide.visuals.accentColor,
        ...(slot?.tone ? { tone: slot.tone } : {}),
      }),
      ...(slot?.altText ? { altText: slot.altText } : { altText: title }),
      ...(slot?.caption ? { caption: slot.caption } : {}),
    };
  }

  private getUsedSourceImages(deckId: string): Set<string> {
    const existing = this.usedSourceImagesByDeck.get(deckId);

    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    this.usedSourceImagesByDeck.set(deckId, created);
    return created;
  }

  private async candidatePassesVisionCheck(input: {
    deck: RenderSlideIllustrationInput["deck"];
    slide: RenderSlideIllustrationInput["slide"];
    result: WebSearchResult;
    fetched: { dataUri: string };
    candidate: ExtractedImageCandidate;
    trustedSourcePage: boolean;
  }) {
    if (!this.visionProvider || this.visionProvider.name === "mock-vision") {
      return true;
    }

    try {
      const insight = await this.visionProvider.analyzeSlideImage({
        slideId: input.slide.id,
        topic: input.deck.topic,
        slideTitle: input.slide.title,
        learningGoal: input.slide.learningGoal,
        keyPoints: input.slide.keyPoints,
        imageDataUrl: input.fetched.dataUri,
        ...(input.candidate.altText
          ? { imageAltText: input.candidate.altText }
          : {}),
        sourcePageUrl: input.result.url,
      });

      return insight.isRelevant && insight.relevanceScore >= 0.4;
    } catch (error) {
      console.warn(
        `[slidespeech] vision validation failed for slide ${input.slide.id}: ${(error as Error).message}`,
      );
      return input.trustedSourcePage;
    }
  }

  private async trySearchResult(
    input: RenderSlideIllustrationInput,
    result: WebSearchResult,
  ) {
    const resultDomain = domainFromUrl(result.url);
    if (
      LOW_QUALITY_IMAGE_SOURCE_PATTERNS.some((pattern) => pattern.test(resultDomain))
    ) {
      return null;
    }

    const html = await this.fetchHtml(result.url);
    const preferredHosts = preferredSourcePages(input).map((value) =>
      domainFromUrl(value),
    );
    const desiredTokens = buildIllustrationSemanticTokens(input);
    const minCandidateScore = minimumAcceptedImageCandidateScore({
      resultUrl: result.url,
      preferredHosts,
    });
    const imageCandidates = extractImageCandidates(html, result.url).sort(
      (left, right) =>
        scoreExtractedImageCandidate(right, preferredHosts, desiredTokens) -
        scoreExtractedImageCandidate(left, preferredHosts, desiredTokens),
    );
    const usedSourceImages = this.getUsedSourceImages(input.deck.id);
    let duplicateFallback: SlideIllustrationAsset | null = null;

    for (const candidate of imageCandidates) {
      if (
        scoreExtractedImageCandidate(candidate, preferredHosts, desiredTokens) <
        minCandidateScore
      ) {
        continue;
      }

      const imageUrl = candidate.url;

      try {
        const fetched = await this.fetchImageData(imageUrl);
        const passesVisionCheck = await this.candidatePassesVisionCheck({
          deck: input.deck,
          slide: input.slide,
          result,
          fetched,
          candidate,
          trustedSourcePage: preferredHosts.includes(resultDomain),
        });

        if (!passesVisionCheck) {
          continue;
        }

        const slot = input.slide.visuals.imageSlots[0];
        const asset: SlideIllustrationAsset = {
          slideId: input.slide.id,
          slotId: slot?.id ?? `${input.slide.id}-image-1`,
          mimeType: fetched.mimeType,
          dataUri: fetched.dataUri,
          ...(slot?.altText
            ? { altText: slot.altText }
            : { altText: `${input.slide.title} illustration` }),
          ...(slot?.caption ? { caption: slot.caption } : {}),
          sourcePageUrl: result.url,
          sourceImageUrl: imageUrl,
        };

        if (usedSourceImages.has(imageUrl)) {
          duplicateFallback ??= asset;
          continue;
        }

        usedSourceImages.add(imageUrl);

        return asset;
      } catch {
        continue;
      }
    }

    if (duplicateFallback?.sourceImageUrl) {
      usedSourceImages.add(duplicateFallback.sourceImageUrl);
    }

    return duplicateFallback;
  }

  private cacheKey(input: RenderSlideIllustrationInput) {
    return `${input.deck.id}:${input.slide.id}:${input.slotId ?? "primary"}`;
  }

  private async resolveSlideIllustration(input: RenderSlideIllustrationInput) {
    const slot = input.slide.visuals.imageSlots[0];
    if (!slot) {
      throw new Error(`Slide ${input.slide.id} does not define an image slot.`);
    }

    try {
      for (const sourcePageUrl of preferredSourcePages(input)) {
        const asset = await this.trySearchResult(input, {
          title: input.slide.title,
          url: sourcePageUrl,
          snippet: input.deck.summary,
        });

        if (asset) {
          return asset;
        }
      }

      for (const guessedSourcePageUrl of guessedOfficialSourcePages(input)) {
        const asset = await this.trySearchResult(input, {
          title: input.slide.title,
          url: guessedSourcePageUrl,
          snippet: input.deck.summary,
        });

        if (asset) {
          return asset;
        }
      }

      const results = await this.webResearchProvider
        .search(buildIllustrationSearchQuery(input))
        .then((candidates) =>
          [...candidates].sort(
            (left, right) =>
              scoreSearchResultForIllustration(input, right) -
              scoreSearchResultForIllustration(input, left),
          ),
        );

      for (const result of results.slice(0, 4)) {
        if (scoreSearchResultForIllustration(input, result) < 6) {
          continue;
        }

        const asset = await this.trySearchResult(input, result);
        if (asset) {
          return asset;
        }
      }
    } catch {
      return this.buildFallback(input);
    }

    return this.buildFallback(input);
  }

  async renderSlideIllustration(input: RenderSlideIllustrationInput) {
    const cacheKey = this.cacheKey(input);
    const cached = this.illustrationCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.resolveSlideIllustration(input)
      .then((asset) => {
        this.illustrationCache.set(cacheKey, asset);
        return asset;
      })
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, request);
    return request;
  }
}
