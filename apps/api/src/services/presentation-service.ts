import { resolve } from "node:path";

import {
  NarrationProgressResponseSchema,
  SelectSlideResponseSchema,
  SessionSnapshotResponseSchema,
  SessionInteractionResponseSchema,
  SlideIllustrationResponseSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";
import type { PedagogicalProfile } from "@slidespeech/types";

import { GeneratePresentationResponseSchema } from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  extractExplicitSourceUrls,
  shouldUseWebResearchForTopic,
  stripExplicitSourceUrls,
  topicRequiresGroundedFacts,
} from "./research-policy";
import {
  buildExplicitSourceFallbackQuery,
  collectFetchedFindingUrls,
  fetchAndSummarizeExplicitSources,
  searchAndSummarizeWebResearch,
} from "./web-research-service";

export const createPresentation = async (input: {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
  useWebResearch?: boolean | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
}) => {
  const explicitSourceUrls = extractExplicitSourceUrls(input.topic);
  const normalizedTopic = stripExplicitSourceUrls(input.topic) || input.topic.trim();
  const shouldUseWebResearch = shouldUseWebResearchForTopic({
    topic: normalizedTopic,
    requestedUseWebResearch: input.useWebResearch,
  });
  const requiresGroundedFacts =
    explicitSourceUrls.length > 0 || topicRequiresGroundedFacts(normalizedTopic);

  if (
    requiresGroundedFacts &&
    appContext.webResearchProvider.name === "mock-web-research"
  ) {
    throw new Error(
      explicitSourceUrls.length > 0
        ? "This prompt includes explicit source URLs. Set WEB_RESEARCH_PROVIDER=hosted so the backend can fetch and ground the deck on those sources."
        : "This topic needs grounded research. Set WEB_RESEARCH_PROVIDER=hosted or disable research explicitly only if you accept an ungrounded deck.",
    );
  }

  const explicitSourceResearch =
    explicitSourceUrls.length > 0
      ? await fetchAndSummarizeExplicitSources({
          query: normalizedTopic,
          urls: explicitSourceUrls,
        })
      : null;
  const successfulExplicitSourceUrls =
    explicitSourceResearch
      ? collectFetchedFindingUrls(explicitSourceResearch.findings)
      : [];

  const explicitSourceFallbackResearch =
    explicitSourceUrls.length > 0 && successfulExplicitSourceUrls.length === 0
      ? await searchAndSummarizeWebResearch({
          query: buildExplicitSourceFallbackQuery({
            topic: normalizedTopic,
            urls: explicitSourceUrls,
          }),
          maxResults: 3,
        })
      : null;
  const successfulExplicitFallbackUrls =
    explicitSourceFallbackResearch
      ? collectFetchedFindingUrls(explicitSourceFallbackResearch.findings)
      : [];

  const research =
    shouldUseWebResearch
      ? await searchAndSummarizeWebResearch({
          query: normalizedTopic,
          maxResults: 3,
        })
      : null;
  const successfulGroundingUrls =
    [
      ...successfulExplicitSourceUrls,
      ...successfulExplicitFallbackUrls,
      ...(
        research ? collectFetchedFindingUrls(research.findings) : []
      ),
    ].filter((value, index, values) => values.indexOf(value) === index);

  if (requiresGroundedFacts && successfulGroundingUrls.length === 0) {
    throw new Error(
      `No trustworthy web sources could be fetched for "${normalizedTopic}". Refusing to generate an ungrounded deck.`,
    );
  }
  const groundingSummary = [
    explicitSourceResearch
      ? `Explicit source grounding: ${explicitSourceResearch.summary}`
      : null,
    explicitSourceFallbackResearch
      ? `Fallback web search after explicit source fetch failure: ${explicitSourceFallbackResearch.summary}`
      : null,
    research ? `Additional web research: ${research.summary}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

  const result = await appContext.sessionService.createSession(
    {
      topic: normalizedTopic,
      ...(input.pedagogicalProfile
        ? { pedagogicalProfile: input.pedagogicalProfile }
        : {}),
      ...(groundingSummary
        ? {
            groundingSummary,
            groundingSourceIds: successfulGroundingUrls,
            groundingSourceType: "mixed" as const,
          }
        : {}),
      ...(input.targetDurationMinutes
        ? { targetDurationMinutes: input.targetDurationMinutes }
        : {}),
      ...(input.targetSlideCount ? { targetSlideCount: input.targetSlideCount } : {}),
    },
  );

  const deck = await appContext.deckRepository.getById(result.session.deckId);

  if (!deck) {
    throw new Error("Deck was not found after generation.");
  }

  return GeneratePresentationResponseSchema.parse({
    deck,
    session: result.session,
    narrations: result.narrations,
    provider: appContext.llmProvider.name,
  });
};

export const getSlideNarration = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const narration = await appContext.sessionService.getOrGenerateNarration(
    input.sessionId,
    input.slideId,
  );

  return SlideNarrationSchema.parse(narration);
};

export const getSlideIllustration = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const snapshot = await appContext.sessionService.getSessionSnapshot(input.sessionId);
  const slide = snapshot.deck.slides.find((candidate) => candidate.id === input.slideId);

  if (!slide) {
    throw new Error(`Slide ${input.slideId} was not found in session ${input.sessionId}.`);
  }

  const asset = await appContext.illustrationProvider.renderSlideIllustration({
    deck: snapshot.deck,
    slide,
  });

  return SlideIllustrationResponseSchema.parse({
    asset,
    provider: appContext.illustrationProvider.name,
  });
};

export const interactWithSession = async (input: {
  sessionId: string;
  text: string;
}) => {
  const result = await appContext.sessionService.interact(
    input.sessionId,
    input.text,
  );

  return SessionInteractionResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    interruption: result.interruption,
    turnDecision: result.turnDecision,
    resumePlan: result.resumePlan,
    assistantMessage: result.assistantMessage,
    narration: result.narration,
    provider: appContext.llmProvider.name,
  });
};

export const selectSlide = async (input: {
  sessionId: string;
  slideId: string;
}) => {
  const result = await appContext.sessionService.selectSlide(
    input.sessionId,
    input.slideId,
  );

  return SelectSlideResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    provider: appContext.llmProvider.name,
  });
};

export const updateNarrationProgress = async (input: {
  sessionId: string;
  slideId?: string | undefined;
  narrationIndex: number;
}) => {
  const result = await appContext.sessionService.updateNarrationProgress(
    input.sessionId,
    input.slideId,
    input.narrationIndex,
  );

  return NarrationProgressResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    provider: appContext.llmProvider.name,
  });
};

export const getSessionSnapshot = async (sessionId: string) => {
  const result = await appContext.sessionService.getSessionSnapshot(sessionId);

  return SessionSnapshotResponseSchema.parse({
    deck: result.deck,
    session: result.session,
    narration: result.narration,
    transcripts: result.transcripts,
    provider: appContext.llmProvider.name,
  });
};

export const exportPresentationPptx = async (sessionId: string) => {
  const snapshot = await appContext.sessionService.getSessionSnapshot(sessionId);
  const fileName = `${snapshot.deck.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || sessionId}.pptx`;
  const outputPath = resolve(appContext.exportRoot, `${sessionId}.pptx`);

  const filePath = await appContext.deckExporter.exportToPptx(
    snapshot.deck,
    outputPath,
  );

  return {
    filePath,
    fileName,
    deck: snapshot.deck,
  };
};
