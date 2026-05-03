import type {
  GroundingClassificationResult,
  GroundingFact,
  GroundingFactRole,
  GroundingFinding,
} from "@slidespeech/types";
import { decodeHtmlEntities } from "@slidespeech/providers";

import { deriveGroundingHighlights } from "./presentation-context";

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value
      ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim()
      : "";
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const normalizeSourceUrl = (value: string): string => {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.hostname.replace(/^www\./i, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.replace(/\s+/g, " ").trim();
  }
};

const uniqueSourceUrls = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalizeSourceUrl(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const tokenizeForGrounding = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

export const deriveGroundingExcerpts = (input: {
  subject: string;
  coverageGoals: string[];
  findings: GroundingFinding[];
}): string[] => {
  const anchors = uniqueNonEmptyStrings([input.subject, ...input.coverageGoals]).join(" ");
  const anchorTokens = tokenizeForGrounding(anchors);

  const candidates = input.findings
    .flatMap((finding) =>
      finding.content
        .split(/(?<=[.!?])\s+/)
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length >= 40 && value.length <= 260)
        .map((value, index) => ({
          value,
          index,
          score:
            anchorTokens.filter((token) => value.toLowerCase().includes(token)).length * 2 +
            (/\b\d{2,4}\b/.test(value) ? 2 : 0) +
            (/[,:;]/.test(value) ? 1 : 0),
        })),
    )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.value);

  return uniqueNonEmptyStrings(candidates).slice(0, 8);
};

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

const confidenceFromRelevance = (
  relevance: GroundingClassificationResult["sourceAssessments"][number]["relevance"] | undefined,
): GroundingFact["confidence"] => {
  switch (relevance) {
    case "high":
      return "high";
    case "low":
      return "low";
    case "medium":
    case "junk":
    default:
      return "medium";
  }
};

const factRoleFromAssessment = (
  role: GroundingClassificationResult["sourceAssessments"][number]["role"] | undefined,
): GroundingFactRole | null => {
  if (!role || role === "junk") {
    return null;
  }

  return role;
};

const countTokenOverlap = (left: string, right: string): number => {
  const rightText = right.toLowerCase();
  return tokenizeForGrounding(left).filter((token) => rightText.includes(token)).length;
};

const bestFindingForEvidence = (
  value: string,
  findings: GroundingFinding[],
): GroundingFinding | null => {
  const [best] = findings
    .map((finding, index) => ({
      finding,
      index,
      score: countTokenOverlap(value, `${finding.title} ${finding.content}`),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return best && best.score > 0 ? best.finding : null;
};

const bestEvidenceForClaim = (claim: string, excerpts: string[]): string => {
  const [best] = excerpts
    .map((excerpt, index) => ({
      excerpt,
      index,
      score: countTokenOverlap(claim, excerpt),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return best && best.score > 0 ? best.excerpt : claim;
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

const inferFactRole = (value: string): GroundingFactRole => {
  const normalized = value.toLowerCase();

  if (
    /\b(?:founded|history|leading\s+(?:qa|quality assurance)?\s*network|who\s+.+\s+is)\b/i.test(
      normalized,
    )
  ) {
    return "identity";
  }

  if (
    /\b(?:locations?|offices?|nordics?|sweden|germany|bosnia|herzegovina|poland|denmark|regional)\b/i.test(
      normalized,
    )
  ) {
    return "footprint";
  }

  if (
    /\b(?:frameworks?|platforms?|playwright|selenium|cypress|ranorex|rest assured|postman|docker|github|test automation|quality management|qa operations?|advisory services?|workshops?)\b/i.test(
      normalized,
    )
  ) {
    return "capabilities";
  }

  if (
    /\b(?:daily operations?|delivery pipeline|ci\/cd|development lifecycle|integrated into|delivery collaboration)\b/i.test(
      normalized,
    )
  ) {
    return "operations";
  }

  if (
    /\b(?:identify risks?|validate data flows?|custom features?|workflow|exercise|practice)\b/i.test(
      normalized,
    )
  ) {
    return "practice";
  }

  if (
    /\b(?:reduce|reduces|risk|defects?|human error|consistent quality|reliable|reliability|safer|happier users|long-term business value|customer satisfaction|release)\b/i.test(
      normalized,
    )
  ) {
    return "value";
  }

  return "reference";
};

const buildGroundingFacts = (input: {
  findings: GroundingFinding[];
  classification?: GroundingClassificationResult | null;
  groundingHighlights: string[];
  groundingExcerpts: string[];
  groundingSourceIds: string[];
}): GroundingFact[] => {
  const availableSourceUrls = new Map(
    input.findings.map((finding) => [normalizeSourceUrl(finding.url), finding.url]),
  );
  const assessmentByUrl = new Map(
    (input.classification?.sourceAssessments ?? []).map((assessment) => [
      normalizeSourceUrl(assessment.url),
      assessment,
    ]),
  );
  const fallbackSourceIds =
    input.groundingSourceIds.length > 0
      ? input.groundingSourceIds
      : uniqueSourceUrls(input.findings.map((finding) => finding.url));

  const fromClassifiedFacts = uniqueNonEmptyStrings(
    (input.classification?.facts ?? []).map((fact) => fact.claim),
  ).length
    ? (input.classification?.facts ?? [])
        .map((fact, index): GroundingFact | null => {
          const claim = decodeHtmlEntities(fact.claim).replace(/\s+/g, " ").trim();
          const evidence = decodeHtmlEntities(fact.evidence || fact.claim)
            .replace(/\s+/g, " ")
            .trim();
          if (!claim || !evidence) {
            return null;
          }

          const sourceIds = uniqueSourceUrls(
            fact.sourceIds
              .map((sourceId) =>
                availableSourceUrls.get(normalizeSourceUrl(sourceId)) ?? sourceId,
              )
              .filter((sourceId) =>
                availableSourceUrls.has(normalizeSourceUrl(sourceId)),
              ),
          );

          const normalizedRole = normalizeFactRole(fact.role);

          return {
            id: fact.id || `fact_${index + 1}`,
            role:
              normalizedRole === "reference"
                ? inferFactRole(`${claim} ${evidence}`)
                : normalizedRole,
            claim,
            evidence,
            sourceIds: sourceIds.length > 0 ? sourceIds : fallbackSourceIds.slice(0, 3),
            confidence: normalizeFactConfidence(fact.confidence),
          };
        })
        .filter((fact): fact is GroundingFact => Boolean(fact))
    : [];

  const candidates: Omit<GroundingFact, "id">[] = [];
  const resolveContext = (value: string): Pick<
    GroundingFact,
    "role" | "sourceIds" | "confidence"
  > => {
    const finding = bestFindingForEvidence(value, input.findings);
    const assessment = finding
      ? assessmentByUrl.get(normalizeSourceUrl(finding.url))
      : undefined;
    const role =
      factRoleFromAssessment(assessment?.role) ??
      factRoleFromAssessment(
        input.classification?.sourceAssessments.find(
          (candidate) =>
            candidate.role !== "junk" && candidate.relevance !== "junk",
        )?.role,
      ) ??
      inferFactRole(value);
    const sourceIds = finding ? [finding.url] : fallbackSourceIds.slice(0, 3);

    return {
      role,
      sourceIds,
      confidence: confidenceFromRelevance(assessment?.relevance),
    };
  };
  const addCandidate = (claim: string, evidence: string): void => {
    const normalizedClaim = decodeHtmlEntities(claim).replace(/\s+/g, " ").trim();
    const normalizedEvidence = decodeHtmlEntities(evidence).replace(/\s+/g, " ").trim();
    if (normalizedClaim.length < 18 || normalizedEvidence.length < 18) {
      return;
    }

    const context = resolveContext(`${normalizedClaim} ${normalizedEvidence}`);
    candidates.push({
      ...context,
      claim: normalizedClaim,
      evidence: normalizedEvidence,
    });
  };

  for (const highlight of input.groundingHighlights) {
    addCandidate(highlight, bestEvidenceForClaim(highlight, input.groundingExcerpts));
  }

  for (const excerpt of input.groundingExcerpts) {
    addCandidate(excerpt, excerpt);
  }

  const merged = [...fromClassifiedFacts, ...candidates.map((candidate, index) => ({
    id: `fact_${fromClassifiedFacts.length + index + 1}`,
    ...candidate,
  }))];
  const seen = new Set<string>();
  const result: GroundingFact[] = [];

  for (const fact of merged) {
    const key = fact.claim.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      ...fact,
      sourceIds: uniqueSourceUrls(fact.sourceIds).slice(0, 4),
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
  const fallbackHighlights = deriveGroundingHighlights({
    subject: input.subject,
    coverageGoals: input.coverageGoals,
    findings: input.findings,
  });
  const fallbackExcerpts = deriveGroundingExcerpts({
    subject: input.subject,
    coverageGoals: input.coverageGoals,
    findings: input.findings,
  });

  const classifiedHighlights = uniqueNonEmptyStrings(
    input.classification?.highlights ?? [],
  ).slice(0, 6);
  const classifiedExcerpts = uniqueNonEmptyStrings(
    input.classification?.excerpts ?? [],
  ).slice(0, 8);
  const classifiedCoverageGoals = uniqueNonEmptyStrings([
    ...input.coverageGoals,
    ...(
      input.classification?.sourceAssessments
        ?.filter(
          (assessment) =>
            assessment.role !== "junk" && assessment.relevance !== "junk",
        )
        .map((assessment) => groundingRoleCoverageGoal(assessment.role, input.subject)) ?? []
    ),
  ]).slice(0, 6);

  const availableSourceUrls = new Map(
    input.findings.map((finding) => [normalizeSourceUrl(finding.url), finding.url]),
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

  const groundingHighlights =
      classifiedHighlights.length >= 3
        ? classifiedHighlights
        : uniqueNonEmptyStrings([
            ...classifiedHighlights,
            ...fallbackHighlights,
          ]).slice(0, 6);
  const groundingExcerpts =
      classifiedExcerpts.length >= 4
        ? classifiedExcerpts
        : uniqueNonEmptyStrings([
            ...classifiedExcerpts,
            ...fallbackExcerpts,
          ]).slice(0, 8);
  const groundingSourceIds =
    classifiedSourceUrls.length > 0
      ? classifiedSourceUrls
      : uniqueSourceUrls(input.findings.map((finding) => finding.url));

  return {
    groundingHighlights,
    groundingExcerpts,
    groundingCoverageGoals: classifiedCoverageGoals,
    groundingSourceIds,
    groundingFacts: buildGroundingFacts({
      findings: input.findings,
      ...(input.classification !== undefined
        ? { classification: input.classification }
        : {}),
      groundingHighlights,
      groundingExcerpts,
      groundingSourceIds,
    }),
  };
};
