import { fetchPublicResearch } from "./public-research-transport";
import type { GenerationResearchDocument, GenerationResearchSearchResult, GenerationV2ResearchProvider } from "@slidespeech/types";
import { decodeHtmlEntities, healthy, unhealthy } from "../shared";
import { collapseResearchWhitespace, parseGenerationDocument, parseGenerationSearchRss, readBoundedResearchText } from "./generation-document-parser";
import { renderResearchDocument } from "./rendered-research-document";

export interface HostedGenerationResearchProviderConfig {
  timeoutMs?: number | undefined;
  maximumDocumentCharacters?: number | undefined;
  maximumDocumentLinks?: number | undefined;
  maximumSearchResults?: number | undefined;
  maximumDocumentImages?: number | undefined;
  maximumResponseBytes?: number | undefined;
  userAgent?: string | undefined;
}

export class HostedGenerationResearchProvider implements GenerationV2ResearchProvider {
  readonly name = "hosted-generation-research";
  private readonly timeoutMs: number;
  private readonly maximumDocumentCharacters: number;
  private readonly maximumDocumentLinks: number;
  private readonly maximumSearchResults: number;
  private readonly maximumDocumentImages: number;
  private readonly maximumResponseBytes: number;
  private readonly userAgent: string;

  constructor(config: HostedGenerationResearchProviderConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maximumDocumentCharacters = config.maximumDocumentCharacters ?? 20_000;
    this.maximumDocumentLinks = config.maximumDocumentLinks ?? 100;
    this.maximumSearchResults = config.maximumSearchResults ?? 8;
    this.maximumDocumentImages = config.maximumDocumentImages ?? 100;
    this.maximumResponseBytes = config.maximumResponseBytes ?? 4 * 1024 * 1024;
    if (!Number.isInteger(this.maximumDocumentImages) || this.maximumDocumentImages < 1 || this.maximumDocumentImages > 100 ||
        !Number.isSafeInteger(this.maximumResponseBytes) || this.maximumResponseBytes < 1) throw new Error("Invalid research image/response resource limits.");
    this.userAgent = config.userAgent ?? "SlideSpeechBot/0.2 (+https://slidespeech.local; grounded presentation research)";
  }

  async healthCheck() {
    try {
      const results = await this.search("structured presentation research");
      return results.length > 0 ? healthy(this.name, "Exact-query web research is reachable.") : unhealthy(this.name, "Exact-query web research returned no results.");
    } catch (error) {
      return unhealthy(this.name, `Exact-query web research failed: ${(error as Error).message}`);
    }
  }

  async search(query: string, options?: { signal?: AbortSignal | undefined }): Promise<GenerationResearchSearchResult[]> {
    const searchUrl = new URL("https://www.bing.com/search");
    searchUrl.searchParams.set("format", "rss");
    searchUrl.searchParams.set("q", query);
    const response = await this.fetchResponse(searchUrl.toString(), options?.signal);
    if (!response.ok) throw new Error(`Research search failed with status ${response.status}.`);
    return parseGenerationSearchRss(await readBoundedResearchText(response, this.maximumResponseBytes)).slice(0, this.maximumSearchResults);
  }

  async fetch(url: string, options?: { signal?: AbortSignal | undefined }): Promise<GenerationResearchDocument> {
    const response = await this.fetchResponse(url, options?.signal);
    if (!response.ok) throw new Error(`Research fetch failed with status ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? undefined;
    if (contentType && !contentType.includes("text/") && !contentType.includes("json") && !contentType.includes("xml")) {
      throw new Error(`Unsupported research content type: ${contentType}.`);
    }
    const body = await readBoundedResearchText(response, this.maximumResponseBytes);
    const isMarkup = contentType?.includes("html") || contentType?.includes("xml") || false;
    const parsed = isMarkup ? parseGenerationDocument(body, response.url, this.maximumDocumentImages) : undefined;
    const rendered = contentType?.includes("html") ? await renderResearchDocument({ html: body, url: response.url, maximumCharacters: this.maximumDocumentCharacters, signal: options?.signal }) : undefined;
    const extracted = rendered?.content ?? (parsed ? parsed.content : collapseResearchWhitespace(decodeHtmlEntities(body)));
    if (!extracted) throw new Error("Research fetch returned no extractable text.");
    const content = extracted.slice(0, this.maximumDocumentCharacters);
    return {
      url: response.url,
      title: parsed?.title || new URL(response.url).hostname,
      content,
      contentFormat: rendered ? "rendered-layout" : parsed ? "html-blocks" : "text",
      links: parsed?.links.slice(0, this.maximumDocumentLinks) ?? [],
      ...(parsed && contentType?.includes("html") ? { imageDiscovery: parsed.imageDiscovery } : {}),
      ...(contentType ? { contentType } : {}),
      truncated: rendered?.truncated ?? content.length < extracted.length,
    };
  }

  private async fetchResponse(initialUrl: string, signal?: AbortSignal): Promise<Response> {
    return fetchPublicResearch(initialUrl, { signal, timeoutMs: this.timeoutMs, userAgent: this.userAgent });
  }
}
