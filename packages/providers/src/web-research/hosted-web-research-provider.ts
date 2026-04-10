import type {
  SummarizeFindingsInput,
  WebFetchResult,
  WebResearchProvider,
  WebSearchResult,
} from "@slidespeech/types";

import { healthy, unhealthy } from "../shared";

interface HostedWebResearchConfig {
  timeoutMs?: number | undefined;
  userAgent?: string | undefined;
}

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (html: string): string =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

const extractTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? stripTags(match[1]) : null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

export class HostedWebResearchProvider implements WebResearchProvider {
  readonly name = "hosted-web-research";
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(config: HostedWebResearchConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.userAgent =
      config.userAgent ??
      "SlideSpeechBot/0.1 (+https://slidespeech.local; educational research)";
  }

  async healthCheck() {
    try {
      const response = await fetch(
        "https://www.bing.com/search?format=rss&setlang=en-US&cc=us&mkt=en-US&q=test",
        {
          headers: {
            "User-Agent": this.userAgent,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );

      if (!response.ok) {
        return unhealthy(
          this.name,
          `Hosted search returned status ${response.status}.`,
        );
      }

      return healthy(this.name, "Hosted web research provider is reachable.");
    } catch (error) {
      return unhealthy(
        this.name,
        `Hosted web research check failed: ${(error as Error).message}`,
      );
    }
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const response = await fetch(
      `https://www.bing.com/search?format=rss&setlang=en-US&cc=us&mkt=en-US&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": this.userAgent,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      throw new Error(
        `${this.name} search failed with status ${response.status}.`,
      );
    }

    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

    return items.slice(0, 5).flatMap((match, index) => {
      const item = match[1];
      const title = item?.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
      const link = item?.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
      const description = item?.match(/<description>([\s\S]*?)<\/description>/i)?.[1];

      if (!title || !link) {
        return [];
      }

      return [
        {
          title: stripTags(title),
          url: stripTags(link),
          snippet:
            stripTags(description ?? "") ||
            `Search result ${index + 1} for "${query}".`,
        },
      ];
    });
  }

  async fetch(url: string): Promise<WebFetchResult> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`${this.name} fetch failed with status ${response.status}.`);
    }

    const html = await response.text();
    const title = extractTitle(html) ?? new URL(url).hostname;
    const content = truncate(stripTags(html), 8000);

    return {
      url,
      title,
      content,
    };
  }

  async summarizeFindings(input: SummarizeFindingsInput): Promise<string> {
    if (input.findings.length === 0) {
      return `No external findings were fetched for "${input.query}".`;
    }

    const lines = input.findings.slice(0, 3).map((finding, index) => {
      const excerpt = truncate(finding.content, 320);
      return `${index + 1}. ${finding.title}: ${excerpt}`;
    });

    return `External research summary for "${input.query}": ${lines.join(" ")}`;
  }
}
