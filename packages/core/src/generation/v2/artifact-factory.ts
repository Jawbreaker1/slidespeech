import {
  GeneratePresentationRequestSchema,
  PresentationRequestArtifactSchema,
  ResearchBundleManifestSchema,
  type ResearchBundle,
  type ResearchBundleManifest,
  type GeneratePresentationRequest,
  type GenerationArtifactIdentity,
  type PresentationRequestArtifact,
} from "@slidespeech/types";

import { createId, nowIso } from "../../utils";
import LinkifyIt from "linkify-it";

export interface GenerationArtifactFactory {
  createId(prefix: string): string;
  now(): string;
}

export const defaultGenerationArtifactFactory: GenerationArtifactFactory = {
  createId,
  now: nowIso,
};

export const createGenerationArtifactIdentity = (
  prefix: string,
  factory: GenerationArtifactFactory = defaultGenerationArtifactFactory,
): GenerationArtifactIdentity => ({
  schemaVersion: "2.0",
  artifactId: factory.createId(prefix),
  createdAt: factory.now(),
});

export const createResearchBundleManifest = (bundle: ResearchBundle): ResearchBundleManifest =>
  ResearchBundleManifestSchema.parse({
    ...bundle,
    pages: bundle.pages.map(({ content, imageDiscovery, ...page }) => ({
      ...page, contentCharacters: content.length,
    })),
  });

const requestLinks = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: true, fuzzyIP: false });

const extractRequestSources = (value: string) => {
  const urls = new Set<string>();
  const candidates = new Map<string, { text: string; url: string }>();
  for (const match of requestLinks.match(value) ?? []) {
    if (match.schema !== "http:" && match.schema !== "https:" && match.schema !== "") continue;
    try {
      const url = new URL(match.schema === "" ? `https://${match.raw}` : match.url).href;
      if (match.schema === "") candidates.set(url, { text: match.raw, url });
      else urls.add(url);
    } catch {
      // Invalid URL-like tokens are not part of the structural request contract.
    }
  }
  return { explicitUrls: [...urls], sourceCandidates: [...candidates.values()].filter(candidate => !urls.has(candidate.url)) };
};

export const extractExplicitHttpUrls = (value: string): string[] => extractRequestSources(value).explicitUrls;

export const createPresentationRequestArtifact = (
  request: GeneratePresentationRequest,
  factory: GenerationArtifactFactory = defaultGenerationArtifactFactory,
): PresentationRequestArtifact => {
  const parsedRequest = GeneratePresentationRequestSchema.parse(request);
  const { explicitUrls, sourceCandidates } = extractRequestSources(parsedRequest.topic);
  return PresentationRequestArtifactSchema.parse({
    ...createGenerationArtifactIdentity("presentation_request", factory),
    request: parsedRequest,
    explicitUrls,
    ...(sourceCandidates.length ? { sourceCandidates } : {}),
  });
};
