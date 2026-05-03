import type {
  GenerateDeckInput,
  GroundingFact,
  GroundingFactRole,
  SlideBrief,
} from "@slidespeech/types";

import { uniqueNonEmptyStrings } from "./deck-shape-text";
import { resolveIntentSubject } from "./slide-arc-policy";
import type { SlideContract } from "./slide-contract-types";

const rolesForContract = (contract: SlideContract): GroundingFactRole[] => {
  switch (contract.kind) {
    case "orientation":
      return ["identity", "background", "reference", "footprint"];
    case "entity-operations":
      return ["operations", "footprint", "background"];
    case "entity-capabilities":
      return ["capabilities", "practice", "reference", "background"];
    case "entity-value":
      return ["example", "value", "capabilities", "operations", "reference"];
    case "coverage":
    case "development":
      return [
        "reference",
        "background",
        "capabilities",
        "operations",
        "timeline",
        "practice",
      ];
    case "synthesis":
    case "subject-takeaway":
      return ["example", "timeline", "value", "reference", "background"];
    case "subject-detail":
      return ["background", "timeline", "reference", "capabilities"];
    case "subject-implication":
      return ["example", "value", "timeline", "reference"];
    case "workshop-practice":
      return ["practice", "capabilities", "example", "operations"];
    case "procedural-ingredients":
    case "procedural-steps":
    case "procedural-quality":
      return ["practice", "reference", "example"];
    default:
      return ["reference", "background"];
  }
};

const audienceQuestionForContract = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);

  switch (contract.kind) {
    case "orientation":
      return `What should the audience understand first about ${subject}?`;
    case "entity-operations":
      return `How does ${subject} work in practice?`;
    case "entity-capabilities":
      return `What does ${subject} do or provide?`;
    case "entity-value":
      return `Why does ${subject} matter in a concrete case or outcome?`;
    case "workshop-practice":
      return `What should participants practice or decide on this slide?`;
    case "subject-takeaway":
    case "synthesis":
      return `What should the audience remember and ask about after ${subject}?`;
    default:
      return `What distinct part of ${subject} does this slide explain?`;
  }
};

const factConfidenceRank = (confidence: GroundingFact["confidence"]): number => {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    default:
      return 1;
  }
};

const selectFactsForContract = (input: {
  facts: GroundingFact[];
  contract: SlideContract;
  usedFactIds: Set<string>;
}): GroundingFact[] => {
  const preferredRoles = rolesForContract(input.contract);
  const isSynthesis =
    input.contract.isFinal ||
    input.contract.kind === "synthesis" ||
    input.contract.kind === "subject-takeaway";
  const rankedFacts = [...input.facts].sort(
    (left, right) =>
      factConfidenceRank(right.confidence) - factConfidenceRank(left.confidence),
  );
  const unusedPreferred = rankedFacts.filter(
    (fact) =>
      !input.usedFactIds.has(fact.id) && preferredRoles.includes(fact.role),
  );
  const unusedFallback = rankedFacts.filter(
    (fact) =>
      !input.usedFactIds.has(fact.id) && !preferredRoles.includes(fact.role),
  );
  const reusableForSynthesis = isSynthesis
    ? rankedFacts.filter((fact) => preferredRoles.includes(fact.role))
    : [];
  const selected =
    unusedPreferred.length > 0
      ? [...unusedPreferred, ...reusableForSynthesis]
      : [...unusedFallback, ...reusableForSynthesis];
  const seen = new Set<string>();

  return selected.filter((fact) => {
    if (seen.has(fact.id)) {
      return false;
    }

    seen.add(fact.id);
    return true;
  }).slice(0, 3);
};

const fallbackClaimsForContract = (contract: SlideContract): string[] => {
  const values = [contract.focus];
  if (contract.evidence) {
    values.unshift(contract.evidence);
  }
  if (contract.objective) {
    values.splice(1, 0, contract.objective);
  }

  return uniqueNonEmptyStrings(values).slice(0, 3);
};

export const buildSlideBriefs = (
  input: GenerateDeckInput,
  contracts: SlideContract[],
): SlideBrief[] => {
  const existingBriefs = input.slideBriefs ?? [];
  const facts = input.groundingFacts ?? [];
  const usedFactIds = new Set<string>();
  const briefs: SlideBrief[] = [];

  return contracts.map((contract, index) => {
    const existing = existingBriefs[contract.index] ?? existingBriefs[index];
    if (existing) {
      for (const factId of existing.evidenceFactIds) {
        usedFactIds.add(factId);
      }
      briefs.push(existing);
      return existing;
    }

    const selectedFacts = selectFactsForContract({
      facts,
      contract,
      usedFactIds,
    });
    for (const fact of selectedFacts) {
      usedFactIds.add(fact.id);
    }

    const requiredClaims =
      selectedFacts.length > 0
        ? selectedFacts.map((fact) => fact.claim)
        : fallbackClaimsForContract(contract);
    const forbiddenOverlap = uniqueNonEmptyStrings([
      ...(contract.distinctFrom ?? []),
      ...briefs.flatMap((brief) => [
        brief.audienceQuestion,
        ...brief.requiredClaims,
      ]),
    ]).slice(-8);
    const brief: SlideBrief = {
      index: contract.index,
      role: `${contract.kind}: ${contract.label}`,
      audienceQuestion: audienceQuestionForContract(input, contract),
      requiredClaims,
      evidenceFactIds: selectedFacts.map((fact) => fact.id),
      forbiddenOverlap,
      ...(contract.isFinal
        ? {
            closingIntent:
              "Close the teaching arc with a concise takeaway and make clear that audience questions are welcome.",
          }
        : {}),
    };

    briefs.push(brief);
    return brief;
  });
};
