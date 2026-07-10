import type {
  GroundingClassificationResult,
  GroundingFact,
  GroundingFactRole,
  GroundingFinding,
} from "@slidespeech/types";

import { deriveGroundingHighlights } from "./presentation-context";
import {
  claimHasGroundingFocusSupport,
  deriveGroundingExcerpts,
  keepGroundingCoverageGoal,
  looksLikeAtomicGroundingClaim,
  looksLikeUsefulGroundingStatement,
  normalizeGroundingText,
  normalizeSourceUrl,
  selectGroundingFindings,
  textHasSourceSupport,
  uniqueNonEmptyStrings,
  uniqueSourceUrls,
} from "./grounding-source-analysis";

export { deriveGroundingExcerpts } from "./grounding-source-analysis";

const groundingRoleCoverageGoal = (
  role: GroundingClassificationResult["sourceAssessments"][number]["role"],
  subject: string,
): string | null => {
  switch (role) {
    case "identity":
      return `Identity or definition details for ${subject}.`;
    case "background":
      return `Background context that explains ${subject}.`;
    case "footprint":
      return `Where ${subject} operates, appears, or applies.`;
    case "operations":
      return `How ${subject} works in practice.`;
    case "capabilities":
      return `What ${subject} offers, enables, or is responsible for.`;
    case "example":
      return `One concrete example or observable outcome tied to ${subject}.`;
    case "timeline":
      return `A key time anchor or sequence that grounds ${subject}.`;
    case "practice":
      return `One practical activity, workflow, or exercise tied to ${subject}.`;
    case "reference":
    case "junk":
    default:
      return null;
  }
};

const normalizeFactConfidence = (value: string): GroundingFact["confidence"] => {
  switch (value) {
    case "high":
    case "medium":
    case "low":
      return value;
    default:
      return "medium";
  }
};

const normalizeFactRole = (value: string): GroundingFactRole => {
  switch (value) {
    case "identity":
    case "background":
    case "footprint":
    case "operations":
    case "capabilities":
    case "example":
    case "timeline":
    case "practice":
    case "reference":
    case "value":
      return value;
    default:
      return "reference";
  }
};

const classificationHasGroundingContent = (
  classification: GroundingClassificationResult | null | undefined,
): boolean =>
  Boolean(
    (classification?.facts?.length ?? 0) > 0 ||
      (classification?.highlights?.length ?? 0) > 0 ||
      (classification?.excerpts?.length ?? 0) > 0 ||
      (classification?.sourceAssessments?.length ?? 0) > 0 ||
      (classification?.relevantSourceUrls?.length ?? 0) > 0,
  );

const normalizeClassifiedSourceIds = (input: {
  sourceIds: string[];
  availableSourceUrls: Map<string, string>;
  fallbackSourceIds: string[];
}): string[] => {
  const explicitSourceIds = uniqueSourceUrls(
    input.sourceIds
      .map(
        (sourceId) =>
          input.availableSourceUrls.get(normalizeSourceUrl(sourceId)) ?? sourceId,
      )
      .filter((sourceId) =>
        input.availableSourceUrls.has(normalizeSourceUrl(sourceId)),
      ),
  );

  return explicitSourceIds.length > 0
    ? explicitSourceIds
    : input.fallbackSourceIds.slice(0, 3);
};

const buildGroundingFacts = (input: {
  subject: string;
  coverageGoals: string[];
  findings: GroundingFinding[];
  classification?: GroundingClassificationResult | null;
  groundingSourceIds: string[];
}): GroundingFact[] => {
  if (!input.classification?.facts?.length) {
    return [];
  }

  const availableSourceUrls = new Map(
    input.findings.map((finding) => [normalizeSourceUrl(finding.url), finding.url]),
  );
  const fallbackSourceIds =
    input.groundingSourceIds.length > 0
      ? input.groundingSourceIds
      : uniqueSourceUrls(input.findings.map((finding) => finding.url));
  const seen = new Set<string>();
  const result: GroundingFact[] = [];

  for (const [index, fact] of input.classification.facts.entries()) {
    const claim = normalizeGroundingText(fact.claim);
    const evidence = normalizeGroundingText(fact.evidence || fact.claim);

    if (
      !claim ||
      !evidence ||
      !looksLikeAtomicGroundingClaim(claim) ||
      !looksLikeUsefulGroundingStatement(claim)
    ) {
      continue;
    }

    const sourceIds = normalizeClassifiedSourceIds({
      sourceIds: fact.sourceIds,
      availableSourceUrls,
      fallbackSourceIds,
    });

    if (
      sourceIds.length === 0 ||
      (
        !textHasSourceSupport(evidence, input.findings, sourceIds) &&
        !textHasSourceSupport(claim, input.findings, sourceIds)
      )
    ) {
      continue;
    }

    if (
      !claimHasGroundingFocusSupport({
        subject: input.subject,
        coverageGoals: input.coverageGoals,
        claim,
        evidence,
        findings: input.findings,
        sourceIds,
      })
    ) {
      continue;
    }

    const key = claim.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      id: fact.id || `fact_${index + 1}`,
      role: normalizeFactRole(fact.role),
      claim,
      evidence,
      sourceIds: uniqueSourceUrls(sourceIds).slice(0, 4),
      confidence: normalizeFactConfidence(fact.confidence),
    });
  }

  return result.slice(0, 12);
};

export const buildGroundingBundle = (input: {
  subject: string;
  coverageGoals: string[];
  findings: GroundingFinding[];
  classification?: GroundingClassificationResult | null;
}): {
  groundingHighlights: string[];
  groundingExcerpts: string[];
  groundingCoverageGoals: string[];
  groundingSourceIds: string[];
  groundingFacts: GroundingFact[];
} => {
  const subjectFindings = selectGroundingFindings(input);
  const sourceDerivedHighlights = deriveGroundingHighlights({
    subject: input.subject,
    coverageGoals: input.coverageGoals,
    findings: subjectFindings,
  }).filter(looksLikeUsefulGroundingStatement);
  const sourceDerivedExcerpts = deriveGroundingExcerpts({
    subject: input.subject,
    coverageGoals: input.coverageGoals,
    findings: subjectFindings,
  }).filter(looksLikeUsefulGroundingStatement);

  const classifiedHighlights = uniqueNonEmptyStrings(
    input.classification?.highlights ?? [],
  )
    .filter(looksLikeAtomicGroundingClaim)
    .filter(looksLikeUsefulGroundingStatement)
    .filter((value) => textHasSourceSupport(value, subjectFindings))
    .slice(0, 6);
  const classifiedExcerpts = uniqueNonEmptyStrings(
    input.classification?.excerpts ?? [],
  )
    .filter(looksLikeAtomicGroundingClaim)
    .filter(looksLikeUsefulGroundingStatement)
    .filter((value) => textHasSourceSupport(value, subjectFindings))
    .slice(0, 8);
  const hasClassifiedGrounding = classificationHasGroundingContent(input.classification);
  const allowSourceSupportedSnippets =
    input.classification === undefined || hasClassifiedGrounding;
  const groundingCoverageGoals = uniqueNonEmptyStrings([
    ...(
      hasClassifiedGrounding
        ? input.coverageGoals.filter((goal) =>
            keepGroundingCoverageGoal(goal, input.subject, subjectFindings),
          )
        : input.coverageGoals
    ),
    ...(
      input.classification?.sourceAssessments
        ?.filter(
          (assessment) =>
            assessment.role !== "junk" && assessment.relevance !== "junk",
        )
        .map((assessment) =>
          groundingRoleCoverageGoal(assessment.role, input.subject),
        ) ?? []
    ),
  ]).slice(0, 6);

  const availableSourceUrls = new Map(
    subjectFindings.map((finding) => [normalizeSourceUrl(finding.url), finding.url]),
  );
  const classifiedSourceUrls = uniqueSourceUrls([
    ...(input.classification?.relevantSourceUrls ?? []),
    ...(
      input.classification?.sourceAssessments
        ?.filter(
          (assessment) =>
            assessment.role !== "junk" && assessment.relevance !== "junk",
        )
        .map((assessment) => assessment.url) ?? []
    ),
  ])
    .map((url) => availableSourceUrls.get(normalizeSourceUrl(url)) ?? url)
    .filter((url) => availableSourceUrls.has(normalizeSourceUrl(url)));

  const groundingHighlights = allowSourceSupportedSnippets
    ? uniqueNonEmptyStrings([
        ...classifiedHighlights,
        ...sourceDerivedHighlights,
      ]).slice(0, 6)
    : classifiedHighlights;
  const groundingExcerpts = allowSourceSupportedSnippets
    ? uniqueNonEmptyStrings([
        ...classifiedExcerpts,
        ...sourceDerivedExcerpts,
      ]).slice(0, 10)
    : classifiedExcerpts;
  const groundingSourceIds =
    classifiedSourceUrls.length > 0
      ? classifiedSourceUrls
      : uniqueSourceUrls(subjectFindings.map((finding) => finding.url));

  return {
    groundingHighlights,
    groundingExcerpts,
    groundingCoverageGoals,
    groundingSourceIds,
    groundingFacts: buildGroundingFacts({
      subject: input.subject,
      coverageGoals: input.coverageGoals,
      findings: subjectFindings,
      ...(input.classification !== undefined
        ? { classification: input.classification }
        : {}),
      groundingSourceIds,
    }),
  };
};
