import { ResearchBundleSchema } from "@slidespeech/types";
import type {
  GenerationDiagnostic,
  GenerationStageTelemetry,
  GenerationV2AgentProvider,
  GenerationResearchDocument,
  GenerationResearchSearchResult,
  GenerationV2ResearchProvider,
  ResearchBundle,
  ResearchPlan,
  ResearchSourceCandidate,
  ResearchSourceTarget,
  ReviewResult,
} from "@slidespeech/types";

import {
  createGenerationArtifactIdentity,
  defaultGenerationArtifactFactory,
} from "./artifact-factory";
import type { GenerationArtifactFactory } from "./artifact-factory";
import type { GenerationStageDefinition } from "./stage-runner";

export interface ResearchBundleLimits {
  maximumCandidatesPerSelectionCall: number;
  maximumSelectionsPerTarget: number;
}

export interface ResearchExecutionStageInput {
  researchPlan: ResearchPlan;
  reviewFeedback?: ReviewResult | undefined;
}

export const DEFAULT_RESEARCH_BUNDLE_LIMITS: ResearchBundleLimits = {
  maximumCandidatesPerSelectionCall: 40,
  maximumSelectionsPerTarget: 4,
};

const sourceDiagnostic = (
  code: string,
  message: string,
  retryable: boolean,
  sourceIds: string[] = [],
): GenerationDiagnostic => ({
  code,
  message,
  category: "source",
  retryable,
  artifactPath: [],
  sourceIds,
});

const selectionContractDiagnostic = (
  code: string,
  message: string,
  artifactPath: Array<string | number>,
): GenerationDiagnostic => ({
  code,
  message,
  category: "contract",
  retryable: true,
  artifactPath,
  sourceIds: [],
});

const canonicalUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
};

const domainMatches = (url: string, domain: string): boolean => {
  const hostname = new URL(url).hostname.toLowerCase();
  const expected = domain.toLowerCase();
  return hostname === expected || hostname.endsWith(`.${expected}`);
};

const orderTargets = (
  targets: ResearchSourceTarget[],
): ResearchSourceTarget[] =>
  [...targets].sort((left, right) => {
    const leftExplicit = left.kind === "explicit-url" ? 0 : 1;
    const rightExplicit = right.kind === "explicit-url" ? 0 : 1;
    return (
      leftExplicit - rightExplicit ||
      left.priority - right.priority ||
      left.id.localeCompare(right.id)
    );
  });

type FetchCandidate = {
  target: Exclude<ResearchSourceTarget, { kind: "model-knowledge" }>;
  url: string;
  searchResult?: GenerationResearchSearchResult | undefined;
};

type FetchedCandidate = FetchCandidate & {
  document: GenerationResearchDocument;
};

type CandidateRecord = {
  candidate: ResearchSourceCandidate;
  fetchCandidate: FetchCandidate;
};

type DiscoveredLink = {
  url: string;
  text: string;
  discoveredFromUrl: string;
};

const aggregateTelemetry = (
  telemetry: GenerationStageTelemetry[],
): GenerationStageTelemetry | undefined => {
  const first = telemetry[0];
  if (!first) {
    return undefined;
  }
  const sum = (field: keyof GenerationStageTelemetry): number | undefined => {
    const values = telemetry
      .map((item) => item[field])
      .filter((value): value is number => typeof value === "number");
    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : undefined;
  };
  return {
    provider: first.provider,
    model: first.model,
    ...(sum("promptTokens") !== undefined
      ? { promptTokens: sum("promptTokens") }
      : {}),
    ...(sum("completionTokens") !== undefined
      ? { completionTokens: sum("completionTokens") }
      : {}),
    ...(sum("reasoningTokens") !== undefined
      ? { reasoningTokens: sum("reasoningTokens") }
      : {}),
    ...(sum("totalTokens") !== undefined
      ? { totalTokens: sum("totalTokens") }
      : {}),
  };
};

const selectCandidateBatch = async (input: {
  agent: Pick<GenerationV2AgentProvider, "selectResearchSources">;
  plan: ResearchPlan;
  target: Exclude<ResearchSourceTarget, { kind: "model-knowledge" }>;
  candidates: CandidateRecord[];
  maximumSelections: number;
  signal: AbortSignal;
  reviewFeedback?: ReviewResult | undefined;
}): Promise<{
  selected: CandidateRecord[];
  blockingReason: string | null;
  diagnostics: GenerationDiagnostic[];
  telemetry: GenerationStageTelemetry;
}> => {
  const selectionCall = await input.agent.selectResearchSources(
    {
      researchPlan: input.plan,
      target: input.target,
      candidates: input.candidates.map((record) => record.candidate),
      maximumSelections: input.maximumSelections,
      ...(input.reviewFeedback ? { reviewFeedback: input.reviewFeedback } : {}),
    },
    { signal: input.signal },
  );
  if (!selectionCall.value.canUseCandidates) {
    return {
      selected: [],
      blockingReason: selectionCall.value.blockingReason,
      diagnostics: [],
      telemetry: selectionCall.telemetry,
    };
  }

  const diagnostics: GenerationDiagnostic[] = [];
  const selectedIndexes = new Set<number>();
  if (
    selectionCall.value.selectedCandidates.length > input.maximumSelections
  ) {
    diagnostics.push(
      selectionContractDiagnostic(
        "research_selection_limit_exceeded",
        `Source selection returned more than ${input.maximumSelections} candidates.`,
        ["selectedCandidates"],
      ),
    );
  }
  selectionCall.value.selectedCandidates.forEach((selected, index) => {
    if (selectedIndexes.has(selected.candidateIndex)) {
      diagnostics.push(
        selectionContractDiagnostic(
          "research_selection_duplicate_candidate",
          `Source candidate position ${selected.candidateIndex} was selected more than once.`,
          ["selectedCandidates", index, "candidateIndex"],
        ),
      );
    }
    selectedIndexes.add(selected.candidateIndex);
    if (selected.candidateIndex >= input.candidates.length) {
      diagnostics.push(
        selectionContractDiagnostic(
          "research_selection_unknown_candidate",
          `Source selection referenced unavailable candidate position ${selected.candidateIndex}.`,
          ["selectedCandidates", index, "candidateIndex"],
        ),
      );
    }
  });

  return {
    selected:
      diagnostics.length > 0
        ? []
        : [...selectionCall.value.selectedCandidates]
            .sort(
              (left, right) =>
                left.priority - right.priority ||
                left.candidateIndex - right.candidateIndex,
            )
            .map((selected) => input.candidates[selected.candidateIndex]!),
    blockingReason: null,
    diagnostics,
    telemetry: selectionCall.telemetry,
  };
};

const selectCandidateRecords = async (input: {
  agent: Pick<GenerationV2AgentProvider, "selectResearchSources">;
  plan: ResearchPlan;
  target: Exclude<ResearchSourceTarget, { kind: "model-knowledge" }>;
  candidates: CandidateRecord[];
  maximumCandidatesPerCall: number;
  maximumSelections: number;
  signal: AbortSignal;
  reviewFeedback?: ReviewResult | undefined;
}): Promise<{
  selected: CandidateRecord[];
  blockingReason: string | null;
  diagnostics: GenerationDiagnostic[];
  telemetry: GenerationStageTelemetry[];
}> => {
  let currentRound = input.candidates;
  const telemetry: GenerationStageTelemetry[] = [];
  const blockingReasons: string[] = [];

  while (currentRound.length > input.maximumCandidatesPerCall) {
    const nextRound: CandidateRecord[] = [];
    for (
      let offset = 0;
      offset < currentRound.length;
      offset += input.maximumCandidatesPerCall
    ) {
      const batch = currentRound.slice(
        offset,
        offset + input.maximumCandidatesPerCall,
      );
      const result = await selectCandidateBatch({
        agent: input.agent,
        plan: input.plan,
        target: input.target,
        candidates: batch,
        maximumSelections: Math.min(input.maximumSelections, batch.length),
        signal: input.signal,
        reviewFeedback: input.reviewFeedback,
      });
      telemetry.push(result.telemetry);
      if (result.diagnostics.length > 0) {
        return {
          selected: [],
          blockingReason: null,
          diagnostics: result.diagnostics,
          telemetry,
        };
      }
      nextRound.push(...result.selected);
      if (result.blockingReason) {
        blockingReasons.push(result.blockingReason);
      }
    }
    if (nextRound.length === 0) {
      return {
        selected: [],
        blockingReason: blockingReasons[0] ?? null,
        diagnostics: [],
        telemetry,
      };
    }
    currentRound = nextRound;
  }

  const finalResult = await selectCandidateBatch({
    agent: input.agent,
    plan: input.plan,
    target: input.target,
    candidates: currentRound,
    maximumSelections: Math.min(input.maximumSelections, currentRound.length),
    signal: input.signal,
    reviewFeedback: input.reviewFeedback,
  });
  telemetry.push(finalResult.telemetry);
  return {
    selected: finalResult.selected,
    blockingReason:
      finalResult.blockingReason ?? blockingReasons[0] ?? null,
    diagnostics: finalResult.diagnostics,
    telemetry,
  };
};

const appendFetchedDocument = (input: {
  bundle: ResearchBundle;
  candidate: FetchCandidate;
  document: GenerationResearchDocument;
  providerName: string;
  artifactFactory: GenerationArtifactFactory;
}): void => {
  const sourceId = input.artifactFactory.createId("source");
  const pageId = input.artifactFactory.createId("page");
  const title =
    input.document.title ||
    input.candidate.searchResult?.title ||
    new URL(input.document.url).hostname;
  input.bundle.sources.push({
    id: sourceId,
    targetId: input.candidate.target.id,
    origin: input.candidate.target.kind,
    url: input.document.url,
    title,
    fetchedAt: input.artifactFactory.now(),
    status: input.document.truncated ? "partial" : "fetched",
    retrievedBy: input.providerName,
    ...(input.document.contentType
      ? { contentType: input.document.contentType }
      : {}),
    ...(input.document.publishedAt
      ? { publishedAt: input.document.publishedAt }
      : {}),
    ...(input.document.author ? { author: input.document.author } : {}),
  });
  input.bundle.pages.push({
    id: pageId,
    sourceId,
    url: input.document.url,
    title,
    content: input.document.content,
    ...(input.document.contentFormat ? { contentFormat: input.document.contentFormat } : {}),
    ...(input.document.imageDiscovery ? { imageDiscovery: {
      ...input.document.imageDiscovery,
      candidates: input.document.imageDiscovery.candidates.map((candidate) => ({
        ...candidate, id: input.artifactFactory.createId("image_candidate"),
      })),
    } } : {}),
  });
};

export const createResearchExecutionStage = (input: {
  provider: GenerationV2ResearchProvider;
  agent: Pick<GenerationV2AgentProvider, "selectResearchSources">;
  artifactFactory?: GenerationArtifactFactory | undefined;
  limits?: Partial<ResearchBundleLimits> | undefined;
}): GenerationStageDefinition<ResearchExecutionStageInput, ResearchBundle> => {
  const artifactFactory =
    input.artifactFactory ?? defaultGenerationArtifactFactory;
  const limits = { ...DEFAULT_RESEARCH_BUNDLE_LIMITS, ...input.limits };
  if (
    !Number.isInteger(limits.maximumCandidatesPerSelectionCall) ||
    limits.maximumCandidatesPerSelectionCall < 2 ||
    !Number.isInteger(limits.maximumSelectionsPerTarget) ||
    limits.maximumSelectionsPerTarget < 1
  ) {
    throw new Error("Research bundle limits must be positive integers, with a candidate batch size of at least two.");
  }

  return {
    name: "research-execution",
    parseArtifact: (value) => ResearchBundleSchema.parse(value),
    execute: async ({ researchPlan: plan, reviewFeedback }, context) => {
      const bundle = ResearchBundleSchema.parse({
        ...createGenerationArtifactIdentity("research_bundle", artifactFactory),
        researchPlanArtifactId: plan.artifactId,
        sources: [],
        pages: [],
        fetchErrors: [],
        targetOutcomes: plan.sourceTargets.map((target) => ({
          targetId: target.id,
          attemptedUrls: [],
          stopReason: target.kind === "model-knowledge" ? "not-required" : "not-started",
        })),
      });
      const outcomes = new Map(bundle.targetOutcomes.map((outcome) => [outcome.targetId, outcome]));
      const externalTargets = plan.sourceTargets.filter(
        (target) => target.kind !== "model-knowledge",
      );
      if (plan.requiresExternalResearch && externalTargets.length === 0) {
        return {
          status: "rejected",
          artifact: bundle,
          errors: [
            sourceDiagnostic(
              "external_research_has_no_targets",
              "The plan requires external research but provides no external source target.",
              true,
            ),
          ],
        };
      }
      if (!plan.requiresExternalResearch && externalTargets.length > 0) {
        return {
          status: "rejected",
          artifact: bundle,
          errors: [
            sourceDiagnostic(
              "external_targets_without_research_requirement",
              "The plan contains external targets while declaring that no external research is required.",
              true,
            ),
          ],
        };
      }
      if (!plan.requiresExternalResearch) {
        return { status: "succeeded", artifact: bundle };
      }

      const fetchedCandidates: FetchedCandidate[] = [];
      const discoveredLinks: DiscoveredLink[] = [];
      const reservedUrls = new Set<string>();
      const reservedCountByDomain = new Map<string, number>();
      const selectionTelemetry: GenerationStageTelemetry[] = [];

      const urlIsEligible = (value: string): boolean => {
        const normalized = canonicalUrl(value);
        if (reservedUrls.has(normalized)) {
          return false;
        }
        const domain = new URL(normalized).hostname.toLowerCase();
        return (
          reservedUrls.size < plan.stopCriteria.maximumSources &&
          (reservedCountByDomain.get(domain) ?? 0) <
            plan.stopCriteria.maximumPagesPerDomain
        );
      };

      const reserveUrl = (value: string): string | null => {
        const normalized = canonicalUrl(value);
        if (!urlIsEligible(normalized)) {
          return null;
        }
        const domain = new URL(normalized).hostname.toLowerCase();
        reservedUrls.add(normalized);
        reservedCountByDomain.set(
          domain,
          (reservedCountByDomain.get(domain) ?? 0) + 1,
        );
        return normalized;
      };

      const fetchCandidate = async (candidate: FetchCandidate): Promise<void> => {
        const outcome = outcomes.get(candidate.target.id)!;
        const reservedUrl = reserveUrl(candidate.url);
        if (!reservedUrl) {
          outcome.stopReason = reservedUrls.has(canonicalUrl(candidate.url))
            ? "already-attempted"
            : reservedUrls.size >= plan.stopCriteria.maximumSources ? "global-budget" : "domain-budget";
          return;
        }
        outcome.attemptedUrls.push(reservedUrl);
        outcome.stopReason = candidate.target.kind === "explicit-url" ? "explicit-attempted" : "round-limit";
        try {
          const document = await input.provider.fetch(reservedUrl, {
            signal: context.signal,
          });
          fetchedCandidates.push({
            ...candidate,
            url: reservedUrl,
            document,
          });
          document.links.forEach((link) => {
            discoveredLinks.push({
              url: canonicalUrl(link.url),
              text: link.text,
              discoveredFromUrl: document.url,
            });
          });
        } catch (error) {
          bundle.fetchErrors.push({
            targetId: candidate.target.id,
            url: reservedUrl,
            message: (error as Error).message,
            retryable: true,
          });
        }
      };

      const selectionErrors: GenerationDiagnostic[] = [];
      const orderedTargets = orderTargets(plan.sourceTargets);
      for (const target of orderedTargets) {
        if (target.kind === "explicit-url") {
          await fetchCandidate({ target, url: target.url });
        }
      }

      const targetStates = orderedTargets
        .filter((target) =>
          target.kind === "same-domain-search" || target.kind === "web-search",
        )
        .map((target) => ({
          target,
          searchResults: undefined as GenerationResearchSearchResult[] | undefined,
          blockingReason: null as string | null,
          rejectedCandidateUrls: new Set<string>(),
        }));

      // Share bounded fetch attempts across targets before deepening any one.
      acquisitionRounds: for (
        let round = 0;
        round < limits.maximumSelectionsPerTarget;
        round += 1
      ) {
        const reservedAtRoundStart = reservedUrls.size;
        for (const state of targetStates) {
          if (reservedUrls.size >= plan.stopCriteria.maximumSources) {
            break acquisitionRounds;
          }
          const { target } = state;
          context.reportProgress({
            completedUnits: reservedUrls.size,
            totalUnits: plan.stopCriteria.maximumSources,
          });
          if (state.searchResults === undefined) {
            const query = target.kind === "same-domain-search"
              ? `site:${target.domain} ${target.query}`
              : target.query;
            state.searchResults = [];
            try {
              state.searchResults = await input.provider.search(query, {
                signal: context.signal,
              });
            } catch (error) {
              bundle.fetchErrors.push({
                targetId: target.id,
                message: (error as Error).message,
                retryable: true,
              });
            }
          }
          const candidateRecords: CandidateRecord[] = [];
          const candidateUrls = new Set<string>();
          let domainBudgetBlockedCandidate = false;
          const appendSelectionCandidate = (candidateInput: {
            url: string;
            title: string;
            context: string;
            origin: ResearchSourceCandidate["origin"];
            discoveredFromUrl: string | null;
            searchResult?: GenerationResearchSearchResult | undefined;
          }): void => {
            const normalized = canonicalUrl(candidateInput.url);
            if (
              candidateUrls.has(normalized) ||
              state.rejectedCandidateUrls.has(normalized) ||
              (target.kind === "same-domain-search" &&
                !domainMatches(normalized, target.domain))
            ) {
              return;
            }
            if (!urlIsEligible(normalized)) {
              if (!reservedUrls.has(normalized)) {
                domainBudgetBlockedCandidate = true;
              }
              return;
            }
            candidateUrls.add(normalized);
            candidateRecords.push({
              candidate: {
                url: normalized,
                title: candidateInput.title,
                context: candidateInput.context,
                origin: candidateInput.origin,
                discoveredFromUrl: candidateInput.discoveredFromUrl,
              },
              fetchCandidate: {
                target,
                url: normalized,
                ...(candidateInput.searchResult
                  ? { searchResult: candidateInput.searchResult }
                  : {}),
              },
            });
          };

          if (target.kind === "same-domain-search") {
            discoveredLinks.forEach((link) => {
              appendSelectionCandidate({
                url: link.url,
                title: link.text,
                context: `Discovered in ${link.discoveredFromUrl}`,
                origin: "discovered-link",
                discoveredFromUrl: link.discoveredFromUrl,
              });
            });
          }
          state.searchResults.forEach((result) => {
            appendSelectionCandidate({
              url: result.url,
              title: result.title,
              context: result.snippet || result.title,
              origin: "search-result",
              discoveredFromUrl: null,
              searchResult: result,
            });
          });

          if (candidateRecords.length === 0) {
            outcomes.get(target.id)!.stopReason = domainBudgetBlockedCandidate
              ? "domain-budget" : state.rejectedCandidateUrls.size > 0 ? "agent-rejected" : "no-candidates";
            state.blockingReason ??= domainBudgetBlockedCandidate
              ? "Eligible source candidates remain, but their domain fetch budget is exhausted."
              : "Research target returned no eligible source candidates.";
            continue;
          }

          const selectionResult = await selectCandidateRecords({
            agent: input.agent,
            plan,
            target,
            candidates: candidateRecords,
            maximumCandidatesPerCall:
              limits.maximumCandidatesPerSelectionCall,
            maximumSelections: 1,
            signal: context.signal,
            reviewFeedback,
          });
          selectionTelemetry.push(...selectionResult.telemetry);
          if (selectionResult.diagnostics.length > 0) {
            outcomes.get(target.id)!.stopReason = "invalid-selection";
            selectionErrors.push(...selectionResult.diagnostics);
            break acquisitionRounds;
          }
          if (selectionResult.selected.length === 0) {
            outcomes.get(target.id)!.stopReason = "agent-rejected";
            state.blockingReason = selectionResult.blockingReason ??
              "Source-selection agent rejected every candidate.";
            candidateRecords.forEach((record) => {
              state.rejectedCandidateUrls.add(record.candidate.url);
            });
            continue;
          }
          state.blockingReason = null;
          await fetchCandidate(selectionResult.selected[0]!.fetchCandidate);
        }
        if (reservedUrls.size === reservedAtRoundStart) {
          break;
        }
      }

      for (const state of targetStates) {
        const outcome = outcomes.get(state.target.id)!;
        if (reservedUrls.size >= plan.stopCriteria.maximumSources &&
            (outcome.stopReason === "not-started" || outcome.stopReason === "round-limit")) {
          outcome.stopReason = "global-budget";
        }
        if (state.blockingReason) {
          outcome.detail = state.blockingReason;
        }
      }

      fetchedCandidates.forEach((candidate) => {
        appendFetchedDocument({
          bundle,
          candidate,
          document: candidate.document,
          providerName: input.provider.name,
          artifactFactory,
        });
      });
      const telemetry = aggregateTelemetry(selectionTelemetry);

      if (selectionErrors.length > 0) {
        return {
          status: "rejected",
          artifact: bundle,
          errors: selectionErrors as [
            GenerationDiagnostic,
            ...GenerationDiagnostic[],
          ],
          ...(telemetry ? { telemetry } : {}),
        };
      }

      if (bundle.sources.length === 0) {
        return {
          status: "rejected",
          artifact: bundle,
          errors: [
            sourceDiagnostic(
              "external_research_returned_no_sources",
              "External research completed without a fetchable source.",
              true,
            ),
            ...bundle.fetchErrors.map((error, index) => ({
              ...sourceDiagnostic("research_fetch_failed", error.message, error.retryable, error.sourceId ? [error.sourceId] : []),
              artifactPath: ["fetchErrors", index],
            })),
            ...bundle.targetOutcomes.flatMap((outcome, index) => outcome.detail ? [{
              ...sourceDiagnostic("research_target_unavailable", outcome.detail, true),
              artifactPath: ["targetOutcomes", index],
            }] : []),
          ],
          ...(telemetry ? { telemetry } : {}),
        };
      }

      const warnings = bundle.fetchErrors.map((error) =>
        sourceDiagnostic(
          "research_fetch_failed",
          error.message,
          error.retryable,
          error.sourceId ? [error.sourceId] : [],
        ),
      );
      return {
        status: "succeeded",
        artifact: bundle,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(telemetry ? { telemetry } : {}),
      };
    },
  };
};
