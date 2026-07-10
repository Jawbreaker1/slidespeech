import type { PresentationIntent } from "@slidespeech/types";

import type { ResearchPlan } from "./research-policy";
import {
  subjectIsGenericEntityReference,
  topicRequiresGroundedFacts,
} from "./research-policy";
import {
  directSourceGroundingLooksSufficient,
  unsupportedSpecificCoverageGoals,
} from "./research-source-coverage";
import {
  normalizeEntityKey,
  resolvePresentationSubject,
} from "./research-subject-resolution";
import {
  buildExplicitSourceSupplementalQuery,
  collectFetchedFindingUrls,
  fetchAndSummarizeExplicitSources,
  searchAndSummarizeWebResearch,
} from "./web-research-service";
import { replaceLiteralCaseInsensitive } from "./research-text-utils";

export { resolvePresentationSubject } from "./research-subject-resolution";

export type GroundingFindingSource = { title: string; url: string; content: string };

export type ResearchSourceStage = {
  allGroundingFindings: GroundingFindingSource[];
  effectiveIntent: PresentationIntent;
  presentationSubject: string;
  researchSummary: string;
  successfulGroundingUrls: string[];
};

export const presentationRequestRequiresGroundedFacts = (input: {
  normalizedTopic: string;
  explicitSourceUrls: string[];
  useWebResearch?: boolean | undefined;
}): boolean =>
  input.explicitSourceUrls.length > 0 ||
  input.useWebResearch === true ||
  (input.useWebResearch !== false && topicRequiresGroundedFacts(input.normalizedTopic));

const findingLooksUsableForGrounding = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:");

const normalizeGroundingFinding = <
  T extends { title: string; url: string; content: string },
>(finding: T): T => ({
  ...finding,
  content: finding.content
    .replace(/^Search result snippet:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim(),
});

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const LOW_VALUE_GROUNDING_URL_PATTERN =
  /\b(?:dictionary\.cambridge|wiktionary\.org|usdictionary\.com|dictionary\.com)\b/i;

const replaceQuerySubject = (query: string, fromSubject: string, toSubject: string): string => {
  return replaceLiteralCaseInsensitive(query, fromSubject, toSubject);
};

export const collectResearchSources = async (input: {
  prompt: string;
  presentationIntent: PresentationIntent;
  researchPlan: ResearchPlan;
  shouldUseWebResearch: boolean;
}): Promise<ResearchSourceStage> => {
  const directSourceResearch =
    input.researchPlan.directUrls.length > 0
      ? await fetchAndSummarizeExplicitSources({
          query:
            input.presentationIntent.organization ?? input.researchPlan.subject,
          urls: input.researchPlan.directUrls,
        })
      : null;
  const successfulDirectSourceUrls =
    directSourceResearch
      ? collectFetchedFindingUrls(directSourceResearch.findings)
      : [];
  const combinedExplicitFindings = directSourceResearch?.findings ?? [];
  const explicitSourceGroundingSufficient =
    combinedExplicitFindings.length > 0 &&
    directSourceGroundingLooksSufficient({
      subject: input.researchPlan.subject,
      coverageGoals: input.researchPlan.coverageGoals,
      findings: combinedExplicitFindings,
    });
  const unsupportedExplicitCoverageGoals = unsupportedSpecificCoverageGoals({
    subject: input.researchPlan.subject,
    coverageGoals: input.researchPlan.coverageGoals,
    findings: combinedExplicitFindings,
  });
  const shouldRunSupplementalCoverageSearch =
    input.researchPlan.explicitSourceUrls.length > 0 &&
    unsupportedExplicitCoverageGoals.length > 0;
  const shouldRunSupportingExplicitSourceSearch =
    input.researchPlan.explicitSourceUrls.length > 0 &&
    (
      successfulDirectSourceUrls.length === 0 ||
      !explicitSourceGroundingSufficient
    );
  const explicitSourceSupplementalResearch =
    shouldRunSupportingExplicitSourceSearch
      ? await searchAndSummarizeWebResearch({
          query: buildExplicitSourceSupplementalQuery({
            topic: input.researchPlan.subject,
            urls: input.researchPlan.explicitSourceUrls,
            presentationFrame: input.presentationIntent.presentationFrame,
            deliveryFormat: input.presentationIntent.deliveryFormat,
            ...(input.presentationIntent.organization
              ? { organization: input.presentationIntent.organization }
              : {}),
          }),
          maxResults: 3,
          allowedHostnames: input.researchPlan.explicitSourceUrls,
        })
      : null;
  const successfulExplicitSupplementalUrls =
    explicitSourceSupplementalResearch
      ? collectFetchedFindingUrls(explicitSourceSupplementalResearch.findings)
      : [];
  const resolvedSubjectFromFetchedSources = resolvePresentationSubject({
    prompt: input.prompt,
    researchSubject: input.researchPlan.subject,
    directFindings: combinedExplicitFindings,
    supplementalFindings: explicitSourceSupplementalResearch?.findings ?? [],
    searchFindings: [],
  });
  const resolvedSubjectDiffersFromResearchSubject =
    normalizeEntityKey(resolvedSubjectFromFetchedSources) !==
    normalizeEntityKey(input.researchPlan.subject);
  const hasDirectGroundingSuccess =
    successfulDirectSourceUrls.length > 0 ||
    successfulExplicitSupplementalUrls.length > 0;
  const hasUserProvidedExplicitGroundingSuccess =
    input.researchPlan.explicitSourceUrls.length > 0 && hasDirectGroundingSuccess;
  const supplementalCoverageQueries = unsupportedExplicitCoverageGoals.map((goal) =>
    `${input.researchPlan.subject} ${goal}`.replace(/\s+/g, " ").trim(),
  );
  const searchQueries = hasUserProvidedExplicitGroundingSuccess
    ? shouldRunSupplementalCoverageSearch
      ? uniqueNonEmptyStrings([
          ...supplementalCoverageQueries,
          ...input.researchPlan.searchQueries,
        ])
      : []
    : subjectIsGenericEntityReference(input.researchPlan.subject) &&
        !subjectIsGenericEntityReference(resolvedSubjectFromFetchedSources)
      ? input.researchPlan.searchQueries.map((query) =>
          replaceQuerySubject(
            query,
            input.researchPlan.subject,
            resolvedSubjectFromFetchedSources,
          ),
        )
      : resolvedSubjectDiffersFromResearchSubject &&
          !subjectIsGenericEntityReference(resolvedSubjectFromFetchedSources)
        ? input.researchPlan.searchQueries.map((query) =>
            replaceQuerySubject(
              query,
              input.researchPlan.subject,
              resolvedSubjectFromFetchedSources,
            ),
          )
        : input.researchPlan.searchQueries;
  const effectiveIntent =
    (
      subjectIsGenericEntityReference(input.presentationIntent.subject) ||
      resolvedSubjectDiffersFromResearchSubject
    ) &&
    !subjectIsGenericEntityReference(resolvedSubjectFromFetchedSources)
      ? {
          ...input.presentationIntent,
          subject: resolvedSubjectFromFetchedSources,
        }
      : input.presentationIntent;

  const searchResearches = [];
  if (input.shouldUseWebResearch || shouldRunSupplementalCoverageSearch) {
    const maxSearchQueryCount = input.researchPlan.requiresGroundedFacts ? 3 : 2;
    for (const query of searchQueries.slice(0, maxSearchQueryCount)) {
      const research = await searchAndSummarizeWebResearch({
        query,
        maxResults: input.researchPlan.maxResults,
      });
      searchResearches.push(research);

      const successfulSearchUrls = collectFetchedFindingUrls(research.findings);
      if (
        successfulSearchUrls.length >= Math.max(2, input.researchPlan.maxResults - 1)
      ) {
        break;
      }
    }
  }

  const allGroundingFindings = [
    ...combinedExplicitFindings,
    ...(explicitSourceSupplementalResearch?.findings ?? []),
    ...searchResearches.flatMap((research) => research.findings),
  ]
    .filter((finding) => findingLooksUsableForGrounding(finding.content))
    .map(normalizeGroundingFinding);
  const successfulGroundingUrls =
    [
      ...successfulDirectSourceUrls,
      ...successfulExplicitSupplementalUrls,
      ...searchResearches.flatMap((research) =>
        collectFetchedFindingUrls(research.findings),
      ),
      ...allGroundingFindings.map((finding) => finding.url),
    ]
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => !LOW_VALUE_GROUNDING_URL_PATTERN.test(value));
  const researchSummary = [
    directSourceResearch
      ? `Direct source grounding: ${directSourceResearch.summary}`
      : null,
    explicitSourceSupplementalResearch
      ? `Supplemental explicit-source search: ${explicitSourceSupplementalResearch.summary}`
      : null,
    ...searchResearches.map((research, index) =>
      `Search research ${index + 1}: ${research.summary}`,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const presentationSubject = resolvePresentationSubject({
    prompt: input.prompt,
    researchSubject: input.researchPlan.subject,
    directFindings: combinedExplicitFindings,
    supplementalFindings: explicitSourceSupplementalResearch?.findings ?? [],
    searchFindings: searchResearches.flatMap((research) => research.findings),
  });

  return {
    allGroundingFindings,
    effectiveIntent,
    presentationSubject,
    researchSummary,
    successfulGroundingUrls,
  };
};
