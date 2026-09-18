import type { ProviderHealthStatus } from "../domain";
import type { DiscoveredResearchImages } from "./research-images";

export interface GenerationResearchSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface GenerationResearchLink {
  url: string;
  text: string;
}

export interface GenerationResearchDocument {
  url: string;
  title: string;
  content: string;
  contentFormat?: "rendered-layout" | "html-blocks" | "text";
  links: GenerationResearchLink[];
  imageDiscovery?: DiscoveredResearchImages;
  contentType?: string | undefined;
  truncated: boolean;
  publishedAt?: string | undefined;
  author?: string | undefined;
}

export interface GenerationV2ResearchProvider {
  readonly name: string;
  healthCheck(): Promise<ProviderHealthStatus>;
  search(
    query: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<GenerationResearchSearchResult[]>;
  fetch(
    url: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<GenerationResearchDocument>;
}
