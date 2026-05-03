import { resolve } from "node:path";

import {
  DeletePresentationResponseSchema,
  ListSavedPresentationsResponseSchema,
  NarrationProgressResponseSchema,
  SelectSlideResponseSchema,
  SessionSnapshotResponseSchema,
  SessionInteractionResponseSchema,
  SlideIllustrationResponseSchema,
  SlideNarrationSchema,
} from "@slidespeech/types";
import type { Deck, PedagogicalProfile, PresentationTheme } from "@slidespeech/types";

import { GeneratePresentationResponseSchema } from "@slidespeech/types";

import { appContext } from "../lib/context";
import {
  compactPresentationBrief,
} from "./presentation-context";
import { buildGroundingBundle } from "./grounding-selection";
import {
  buildResearchPlan,
  derivePresentationIntent,
  extractPresentationBrief,
  extractPresentationSubject,
  extractExplicitSourceUrls,
  mergeResearchPlanWithSuggestion,
  subjectIsGenericEntityReference,
  shouldUseWebResearchForTopic,
  stripExplicitSourceUrls,
  topicRequiresGroundedFacts,
} from "./research-policy";
import {
  buildExplicitSourceFallbackQuery,
  buildSupportingExplicitSourceUrls,
  collectFetchedFindingUrls,
  fetchAndSummarizeExplicitSources,
  searchAndSummarizeWebResearch,
} from "./web-research-service";

const fetchedFindingLooksUsable = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:") &&
  !content.startsWith("Search snippet fallback:");

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const deckIsReadyForReuse = (deck: Deck): boolean => {
  const generation = deck.metadata.generation;

  if (!generation) {
    return false;
  }

  return (
    !generation.backgroundEnrichmentPending &&
    generation.narrationReadySlides >= generation.totalSlides
  );
};

const inferEntityNameFromTitle = (title: string): string | null => {
  const segments = title
    .split(/\s+[|•·\-–—]\s+|[|•·]| - | – | — /)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((segment) => segment.length >= 2 && segment.length <= 60)
    .filter(
      (segment) =>
        !/^(home|official site|welcome|careers|about|contact)$/i.test(segment),
    );

  return segments[0] ?? null;
};

const inferEntityNameFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0] ?? "";
    if (!root || root.length < 3) {
      return null;
    }

    return root
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (value) => value.toUpperCase());
  } catch {
    return null;
  }
};

const resolvePresentationSubject = (input: {
  prompt: string;
  researchSubject: string;
  directFindings: Array<{ title: string; url: string; content: string }>;
  fallbackFindings: Array<{ title: string; url: string; content: string }>;
  searchFindings: Array<{ title: string; url: string; content: string }>;
}): string => {
  const promptSubject = extractPresentationSubject(input.prompt) || input.researchSubject;
  if (!subjectIsGenericEntityReference(promptSubject)) {
    return promptSubject;
  }

  const fetchedFindings = [
    ...input.directFindings,
    ...input.fallbackFindings,
    ...input.searchFindings,
  ].filter((finding) => fetchedFindingLooksUsable(finding.content));

  for (const finding of fetchedFindings) {
    const fromTitle = inferEntityNameFromTitle(finding.title);
    if (fromTitle && !subjectIsGenericEntityReference(fromTitle)) {
      return fromTitle;
    }

    const fromUrl = inferEntityNameFromUrl(finding.url);
    if (fromUrl && !subjectIsGenericEntityReference(fromUrl)) {
      return fromUrl;
    }
  }

  return input.researchSubject || promptSubject;
};

const LOW_VALUE_GROUNDING_URL_PATTERN =
  /\b(?:dictionary\.cambridge|wiktionary\.org|usdictionary\.com|dictionary\.com)\b/i;

const replaceQuerySubject = (query: string, fromSubject: string, toSubject: string): string => {
  if (!fromSubject.trim() || !toSubject.trim()) {
    return query;
  }

  const escaped = fromSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return query.replace(new RegExp(escaped, "ig"), toSubject);
};

const tokenizeForGrounding = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const directSourceGroundingLooksSufficient = (input: {
  subject: string;
  coverageGoals: string[];
  findings: Array<{ title: string; url: string; content: string }>;
}): boolean => {
  const anchors = [
    input.subject,
    ...input.coverageGoals,
  ]
    .flatMap((value) => tokenizeForGrounding(value))
    .filter((token) => token.length >= 3);

  if (anchors.length === 0) {
    return input.findings.length > 0;
  }

  return input.findings.some((finding) => {
    const haystack = `${finding.title} ${finding.content}`.toLowerCase();
    const overlap = anchors.filter((token) => haystack.includes(token)).length;
    return overlap >= 2;
  });
};

export const createPresentation = async (input: {
  topic: string;
  pedagogicalProfile?: Partial<PedagogicalProfile> | undefined;
  useWebResearch?: boolean | undefined;
  targetDurationMinutes?: number | undefined;
  targetSlideCount?: number | undefined;
  theme?: PresentationTheme | undefined;
}) => {
  const llmHealth = await appContext.llmProvider.healthCheck();
  if (!llmHealth.ok) {
    throw new Error(`LLM provider is not ready: ${llmHealth.detail}`);
  }

  const presentationIntent = derivePresentationIntent(input.topic);
  const explicitSourceUrls = presentationIntent.explicitSourceUrls;
  const normalizedTopic = stripExplicitSourceUrls(input.topic) || input.topic.trim();
  const extractedBrief = presentationIntent.framing || extractPresentationBrief(input.topic) || normalizedTopic;
  let researchPlan = buildResearchPlan({
    topic: input.topic,
    requestedUseWebResearch: input.useWebResearch,
    intent: presentationIntent,
  });
  const shouldUseWebResearch = shouldUseWebResearchForTopic({
    topic: normalizedTopic,
    requestedUseWebResearch: input.useWebResearch,
  });
  const requiresGroundedFacts =
    explicitSourceUrls.length > 0 ||
    (input.useWebResearch !== false && topicRequiresGroundedFacts(normalizedTopic));

  if (shouldUseWebResearch || researchPlan.requiresGroundedFacts) {
    try {
      const suggestion = await appContext.llmProvider.planResearch({
        topic: input.topic,
        ...(extractedBrief ? { presentationBrief: extractedBrief } : {}),
        intent: presentationIntent,
        explicitSourceUrls,
        heuristicSubject: researchPlan.subject,
        heuristicQueries: researchPlan.searchQueries,
        freshnessSensitive: researchPlan.freshnessSensitive,
        requiresGroundedFacts: researchPlan.requiresGroundedFacts,
      });
      researchPlan = mergeResearchPlanWithSuggestion({
        basePlan: researchPlan,
        topic: normalizedTopic,
        suggestion,
      });
    } catch (error) {
      console.warn(
        `[slidespeech] research planning fallback for "${normalizedTopic}": ${(error as Error).message}`,
      );
    }
  }

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

  const directSourceResearch =
    researchPlan.directUrls.length > 0
      ? await fetchAndSummarizeExplicitSources({
          query: presentationIntent.organization ?? researchPlan.subject,
          urls: researchPlan.directUrls,
        })
      : null;
  const successfulDirectSourceUrls =
    directSourceResearch
      ? collectFetchedFindingUrls(directSourceResearch.findings)
      : [];
  const supportingExplicitSourceUrls = buildSupportingExplicitSourceUrls({
    urls: researchPlan.explicitSourceUrls,
    presentationFrame: presentationIntent.presentationFrame,
    deliveryFormat: presentationIntent.deliveryFormat,
  }).filter((url) => !researchPlan.directUrls.includes(url));
  const supportingExplicitSourceResearch =
    supportingExplicitSourceUrls.length > 0
      ? await fetchAndSummarizeExplicitSources({
          query: presentationIntent.organization ?? researchPlan.subject,
          urls: supportingExplicitSourceUrls,
        })
      : null;
  const successfulSupportingExplicitSourceUrls =
    supportingExplicitSourceResearch
      ? collectFetchedFindingUrls(supportingExplicitSourceResearch.findings)
      : [];
  const combinedExplicitFindings = [
    ...(directSourceResearch?.findings ?? []),
    ...(supportingExplicitSourceResearch?.findings ?? []),
  ];
  const explicitSourceGroundingSufficient =
    combinedExplicitFindings.length > 0 &&
    directSourceGroundingLooksSufficient({
      subject: researchPlan.subject,
      coverageGoals: researchPlan.coverageGoals,
      findings: combinedExplicitFindings,
    });

  const shouldRunSupportingExplicitSourceSearch =
    researchPlan.explicitSourceUrls.length > 0 &&
    (
      successfulDirectSourceUrls.length + successfulSupportingExplicitSourceUrls.length === 0 ||
      !explicitSourceGroundingSufficient
    );
  const explicitSourceFallbackResearch =
    shouldRunSupportingExplicitSourceSearch
        ? await searchAndSummarizeWebResearch({
            query: buildExplicitSourceFallbackQuery({
              topic: researchPlan.subject,
              urls: researchPlan.explicitSourceUrls,
              presentationFrame: presentationIntent.presentationFrame,
              deliveryFormat: presentationIntent.deliveryFormat,
              ...(presentationIntent.organization
                ? { organization: presentationIntent.organization }
                : {}),
            }),
            maxResults: 3,
            allowedHostnames: researchPlan.explicitSourceUrls,
          })
      : null;
  const successfulExplicitFallbackUrls =
    explicitSourceFallbackResearch
      ? collectFetchedFindingUrls(explicitSourceFallbackResearch.findings)
      : [];
  const resolvedSubjectFromFetchedSources = resolvePresentationSubject({
    prompt: input.topic,
    researchSubject: researchPlan.subject,
    directFindings: combinedExplicitFindings,
    fallbackFindings: explicitSourceFallbackResearch?.findings ?? [],
    searchFindings: [],
  });

  const hasExplicitGroundingSuccess =
    successfulDirectSourceUrls.length > 0 ||
    successfulSupportingExplicitSourceUrls.length > 0 ||
    successfulExplicitFallbackUrls.length > 0;
  const searchQueries = hasExplicitGroundingSuccess
    ? []
    : subjectIsGenericEntityReference(researchPlan.subject) &&
        !subjectIsGenericEntityReference(resolvedSubjectFromFetchedSources)
      ? researchPlan.searchQueries.map((query) =>
          replaceQuerySubject(query, researchPlan.subject, resolvedSubjectFromFetchedSources),
        )
      : researchPlan.searchQueries;
  const effectiveIntent =
    subjectIsGenericEntityReference(presentationIntent.subject) &&
    !subjectIsGenericEntityReference(resolvedSubjectFromFetchedSources)
      ? {
          ...presentationIntent,
          subject: resolvedSubjectFromFetchedSources,
        }
      : presentationIntent;

  const searchResearches = [];
  if (shouldUseWebResearch) {
    for (const query of searchQueries.slice(0, 2)) {
      const research = await searchAndSummarizeWebResearch({
        query,
        maxResults: researchPlan.maxResults,
      });
      searchResearches.push(research);

      const successfulSearchUrls = collectFetchedFindingUrls(research.findings);
      if (successfulSearchUrls.length >= Math.max(2, researchPlan.maxResults - 1)) {
        break;
      }
    }
  }
  const successfulGroundingUrls =
    [
      ...successfulDirectSourceUrls,
      ...successfulSupportingExplicitSourceUrls,
      ...successfulExplicitFallbackUrls,
      ...searchResearches.flatMap((research) =>
        collectFetchedFindingUrls(research.findings),
      ),
    ]
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => !LOW_VALUE_GROUNDING_URL_PATTERN.test(value));

  if (researchPlan.requiresGroundedFacts && successfulGroundingUrls.length === 0) {
    throw new Error(
      `No trustworthy web sources could be fetched for "${normalizedTopic}". Refusing to generate an ungrounded deck.`,
    );
  }
  const researchSummary = [
    directSourceResearch
      ? `Direct source grounding: ${directSourceResearch.summary}`
      : null,
    supportingExplicitSourceResearch
      ? `Supporting same-domain source grounding: ${supportingExplicitSourceResearch.summary}`
      : null,
    explicitSourceFallbackResearch
      ? `Fallback web search after explicit source fetch failure: ${explicitSourceFallbackResearch.summary}`
      : null,
    ...searchResearches.map((research, index) =>
      `Search research ${index + 1}: ${research.summary}`,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const presentationSubject = resolvePresentationSubject({
    prompt: input.topic,
    researchSubject: researchPlan.subject,
    directFindings: combinedExplicitFindings,
    fallbackFindings: explicitSourceFallbackResearch?.findings ?? [],
    searchFindings: searchResearches.flatMap((research) => research.findings),
  });
  const presentationBrief =
    compactPresentationBrief(extractedBrief, presentationSubject) ?? undefined;
  const allGroundingFindings = [
    ...combinedExplicitFindings,
    ...(explicitSourceFallbackResearch?.findings ?? []),
    ...searchResearches.flatMap((research) => research.findings),
  ].filter((finding) => fetchedFindingLooksUsable(finding.content));
  let groundingClassification = null;

  if (allGroundingFindings.length > 0) {
    try {
      groundingClassification = await appContext.llmProvider.classifyGrounding({
        topic: presentationSubject,
        ...(presentationBrief ? { presentationBrief } : {}),
        intent: {
          ...effectiveIntent,
          subject: presentationSubject,
          framing: presentationBrief ?? effectiveIntent.framing,
        },
        coverageGoals: researchPlan.coverageGoals,
        findings: allGroundingFindings,
      });
    } catch (error) {
      console.warn(
        `[slidespeech] grounding classification fallback for "${presentationSubject}": ${(error as Error).message}`,
      );
    }
  }

  const {
    groundingHighlights,
    groundingExcerpts,
    groundingCoverageGoals,
    groundingSourceIds,
    groundingFacts,
  } = buildGroundingBundle({
    subject: presentationSubject,
    coverageGoals: researchPlan.coverageGoals,
    findings: allGroundingFindings,
    classification: groundingClassification,
  });
  const groundingSummary =
    groundingClassification?.highlights.length
      ? uniqueNonEmptyStrings([
          ...groundingHighlights,
          ...groundingExcerpts.slice(0, 4),
        ]).join("\n")
      : researchSummary;

  const result = await appContext.sessionService.createSession(
    {
      topic: presentationSubject,
      ...(presentationBrief ? { presentationBrief } : {}),
      intent: {
        ...effectiveIntent,
        subject: presentationSubject,
        framing: presentationBrief ?? effectiveIntent.framing,
      },
      ...(input.pedagogicalProfile
        ? { pedagogicalProfile: input.pedagogicalProfile }
        : {}),
      ...(groundingSummary
        ? {
            groundingSummary,
            ...(groundingHighlights.length > 0 ? { groundingHighlights } : {}),
            ...(groundingExcerpts.length > 0 ? { groundingExcerpts } : {}),
            ...(groundingCoverageGoals.length > 0
              ? { groundingCoverageGoals }
              : {}),
            ...(groundingFacts.length > 0 ? { groundingFacts } : {}),
            groundingSourceIds:
              groundingSourceIds.length > 0
                ? groundingSourceIds
                : successfulGroundingUrls,
            groundingSourceType: "mixed" as const,
          }
        : {}),
      ...(input.targetDurationMinutes
        ? { targetDurationMinutes: input.targetDurationMinutes }
        : {}),
      ...(input.targetSlideCount ? { targetSlideCount: input.targetSlideCount } : {}),
      ...(input.theme ? { theme: input.theme } : {}),
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

export const listSavedPresentations = async (input?: {
  limit?: number;
  offset?: number;
  readyOnly?: boolean;
}) => {
  const normalizedLimit =
    input?.limit !== undefined && Number.isFinite(input.limit) ? input.limit : 12;
  const normalizedOffset =
    input?.offset !== undefined && Number.isFinite(input.offset) ? input.offset : 0;
  const limit = Math.max(1, Math.min(normalizedLimit, 50));
  const offset = Math.max(0, normalizedOffset);
  const readyOnly = input?.readyOnly ?? true;
  const [sessions, decks] = await Promise.all([
    appContext.sessionRepository.list(),
    appContext.deckRepository.list(),
  ]);
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));

  const items = sessions
    .map((session) => {
      const deck = deckById.get(session.deckId);

      if (!deck) {
        return null;
      }

      const ready = deckIsReadyForReuse(deck);

      if (readyOnly && !ready) {
        return null;
      }

      return {
        sessionId: session.id,
        deckId: deck.id,
        title: deck.title,
        summary: deck.summary,
        topic: deck.topic,
        slideCount: deck.slides.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sourceType: deck.source.type,
        generation: deck.metadata.generation,
        validation: deck.metadata.validation,
        evaluation: deck.metadata.evaluation,
        ready,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return ListSavedPresentationsResponseSchema.parse({
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    readyOnly,
    hasMore: offset + limit < items.length,
  });
};

export const deleteSavedPresentation = async (sessionId: string) => {
  const session = await appContext.sessionRepository.getById(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  const deck = await appContext.deckRepository.getById(session.deckId);

  if (!deck) {
    throw new Error(`Deck ${session.deckId} was not found.`);
  }

  if (!deckIsReadyForReuse(deck)) {
    throw new Error(
      "Only fully prepared presentations can be deleted from the library.",
    );
  }

  const allSessions = await appContext.sessionRepository.list();
  const deckStillReferencedByOtherSessions = allSessions.some(
    (candidate) => candidate.id !== sessionId && candidate.deckId === session.deckId,
  );

  await appContext.transcriptRepository.deleteBySessionId(sessionId);
  await appContext.sessionRepository.delete(sessionId);

  if (!deckStillReferencedByOtherSessions) {
    await appContext.deckRepository.delete(session.deckId);
  }

  return DeletePresentationResponseSchema.parse({
    deletedSessionId: sessionId,
    ...(deckStillReferencedByOtherSessions ? {} : { deletedDeckId: session.deckId }),
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
