import type { GenerateDeckInput } from "@slidespeech/types";

import {
  hasMeaningfulAnchorOverlap,
  shortenTitlePhrase,
  usesDirectOrganizationPersona,
} from "./deck-shape-text";
import {
  deriveSlideArcPolicy,
  framingImpliesOrientation,
  isWorkshopPresentation,
  resolveIntentSubject,
  resolveOrganizationDisplayName,
  usesOrganizationIdentity,
} from "./slide-arc-policy";
import type { ArcPolicyInput } from "./slide-contract-types";

const ORGANIZATION_DECK_TITLE_MARKETING_PATTERNS = [
  /\byour guide\b/i,
  /\bguide to\b/i,
  /\bultimate\b/i,
  /\bexcellence\b/i,
  /\bjourney\b/i,
  /\bblueprint\b/i,
  /\bmaster(?:ing|class)\b/i,
  /\bunlock(?:ing)?\b/i,
];

const organizationDeckTitleNeedsRepair = (
  input: Pick<GenerateDeckInput, "topic" | "presentationBrief" | "intent">,
  title: string,
): boolean => {
  if (deriveSlideArcPolicy(input as ArcPolicyInput) !== "organization-overview") {
    return false;
  }

  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 84) {
    return true;
  }

  if (
    usesDirectOrganizationPersona(trimmed) ||
    ORGANIZATION_DECK_TITLE_MARKETING_PATTERNS.some((pattern) => pattern.test(trimmed))
  ) {
    return true;
  }

  if (!usesOrganizationIdentity(input)) {
    return false;
  }

  const entityName = resolveOrganizationDisplayName(input);
  if (!hasMeaningfulAnchorOverlap(trimmed, entityName)) {
    return true;
  }

  if (isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)) {
    return /\b(?:onboarding|orientation|overview)\b/i.test(trimmed) ||
      !/\bworkshop\b/i.test(trimmed);
  }

  return false;
};

const buildFallbackDeckTitle = (
  input: Pick<GenerateDeckInput, "topic" | "presentationBrief" | "intent">,
): string => {
  const subject = resolveIntentSubject(input);
  if (
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview" &&
    usesOrganizationIdentity(input)
  ) {
    const entityName = resolveOrganizationDisplayName(input);
    if (isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)) {
      const subject = resolveIntentSubject(input);
      return `${entityName} workshop: ${shortenTitlePhrase(subject, 44)}`;
    }
    return framingImpliesOrientation(input)
      ? `${entityName} onboarding`
      : `${entityName} overview`;
  }

  return `${subject}: generated presentation`;
};

export const normalizeDeckTitle = (
  candidateTitle: string,
  input: Pick<
    GenerateDeckInput,
    "topic" | "presentationBrief" | "intent" | "plan"
  >,
): string => {
  const trimmedCandidate = shortenTitlePhrase(candidateTitle.trim(), 84);
  if (trimmedCandidate && !organizationDeckTitleNeedsRepair(input, trimmedCandidate)) {
    return trimmedCandidate;
  }

  const planTitle = shortenTitlePhrase(input.plan?.title?.trim() ?? "", 84);
  if (planTitle && !organizationDeckTitleNeedsRepair(input, planTitle)) {
    return planTitle;
  }

  return buildFallbackDeckTitle(input);
};
