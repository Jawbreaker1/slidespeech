import type { PresentationIntent } from "@slidespeech/types";

export type TextQualityGuardHit = {
  label: string;
  value: string;
};

/*
 * Deterministic smoke detectors, not semantic repair logic.
 *
 * Keep language-agnostic checks here when they protect structure or obvious
 * leakage. Treat English/template phrase checks as legacy debt: they may block
 * a bad deck and produce LLM revision guidance, but they should not become the
 * long-term mechanism for multilingual correction.
 */
export const PRESENTATION_META_PATTERNS = [
  /\bthis slide\b/i,
  /\bslides?\b/i,
  /\bpresentation\b/i,
  /\bdeck\b/i,
  /\buse screenshots?\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\btext-heavy\b/i,
  /\bhigh-resolution\b/i,
  /\bfor every slide\b/i,
  /\bblueprint\b/i,
];

export const PROMPT_CONTAMINATION_PATTERNS = [
  /\bcreate (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/i,
  /\bmake (?:an?|the)?\s*(?:onboarding\s+)?presentation\b/i,
  /\bmore information is available at\b/i,
  /\buse google\b/i,
  /\bour company\b/i,
  /\bspecific case study or research angle requested in the prompt\b/i,
  /\bat least one practical exercise for the audience to complete\b/i,
];

export const TEMPLATE_LANGUAGE_PATTERNS = [
  /\bthis part of\b/i,
  /\bbroader goals? of\b/i,
  /\bday-to-day work\b/i,
  /\bdelivery work\b/i,
  /\bcustomer outcomes?\b/i,
  /\bin practical delivery work\b/i,
  /\bsubject or organization\b/i,
  /\bcore mechanisms, characteristics, or defining ideas\b/i,
  /\bconcrete example\s*:/i,
  /\bmental model\s*:/i,
  /\bprocess view\s*:/i,
  /^\s*structure\s*:/i,
  /\breal-world applications is one concrete way\b/i,
  /\bmatters because it changes how\b/i,
  /\bmatters because it shows what\b/i,
  /\boffers matters\b/i,
  /\bevidence-backed practical consequence\b/i,
  /\borganization this onboarding overview introduces\b/i,
  /\bwhat kind of organization it is\b/i,
  /\bbecomes easier to (?:understand|place|evaluate|recognize)\b/i,
  /\bday-to-day operating methods that can be described concretely\b/i,
  /\boperating details make\b/i,
  /\bconcrete capabilities make\b/i,
  /\bone specific consequence makes\b/i,
  /\bis explained through a source-backed arc\b/i,
  /\bin daily work in daily work\b/i,
  /\bUsing [^.]+ works in practice\b/,
  /\bshapes how Using [^.]+ works\b/,
  /\bframes the concrete case within\b/i,
  /\bpurpose, structure, and one concrete example\b/i,
  /\bconcrete workflow example shows how\b/i,
  /\ba concrete consequence, responsibility, or example\b/i,
  /\ba concrete example, consequence, or real-world application of\b/i,
  /\bone concrete detail teaches about\b/i,
  /\bclearest lesson or takeaway the audience should retain\b/i,
  /^\s*explanation of\b/i,
  /\bwhat .{2,90} is\b/i,
  /&#x?[0-9a-f]+;?/i,
];

export const SOURCE_NOISE_PATTERNS = [
  /\bsubscribe now\b/i,
  /\blearn more\b/i,
  /\b6-month subscription offer\b/i,
  /\bblaze through\b/i,
  /\bfree trial\b/i,
  /\bupgrade now\b/i,
];

export const AWKWARD_LANGUAGE_PATTERNS = [
  /\bunderstand the role of\b/i,
  /\bthe role of .+ in .+\b/i,
  /^\s*use\b/i,
  /,\s*$/i,
  /\b(?:and|or)\s+(?:test|kids)\.?$/i,
  /\bafter the kids\.?$/i,
  /^\s*(?:is|are|was|were)\.?$/i,
  /,\s*:/,
  /\bbackground in shaping\.?$/i,
  /\b(?:due to|because|connected to|related to)\s+(?:a|an|the)?$/i,
  /\b(?:as|to|from|with|after|before|for|of|in|on)$/i,
  /\binto\s+(?:daily|public|regional|digital|internal|external)\.?$/i,
];

export const IMPERATIVE_KEY_POINT_PATTERNS = [
  /^\s*(use|avoid|keep|start|add|mix|taste|review|walk through|show|tell|highlight|map out|validate|focus on|leverage)\b/i,
];

export const DECK_INSTRUCTIONAL_PATTERNS = [
  /^\s*(walk through|review|direct new hires|show the audience|tell the audience|emphasize|map out|validate that|highlight)\b/i,
  /\binternal portal\b/i,
  /\bcore messaging\b/i,
  /^\s*how do i\b/i,
  /\bslides?\b/i,
  /\bdeck\b/i,
];

const DECK_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS = new Set([
  /^\s*use\b/i.source,
]);

export const getActiveDeckInstructionalPatterns = (
  intent?: PresentationIntent,
): RegExp[] => {
  const allowsParticipantActionLanguage =
    intent?.deliveryFormat === "workshop" ||
    Boolean(intent?.activityRequirement) ||
    intent?.contentMode === "procedural";

  if (!allowsParticipantActionLanguage) {
    return DECK_INSTRUCTIONAL_PATTERNS;
  }

  return DECK_INSTRUCTIONAL_PATTERNS.filter(
    (pattern) => !DECK_WORKSHOP_ALLOWED_INSTRUCTIONAL_PATTERNS.has(pattern.source),
  );
};

export const countTextGuardMatches = (
  value: string,
  patterns: RegExp[],
): number =>
  patterns.reduce(
    (sum, pattern) => sum + (pattern.test(value) ? 1 : 0),
    0,
  );

export const compactTextQualityIssue = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, 180);

export const findTextQualityGuardHit = (
  values: Array<{ label: string; value: string }>,
  patterns: RegExp[],
): TextQualityGuardHit | null => {
  for (const candidate of values) {
    if (patterns.some((pattern) => pattern.test(candidate.value))) {
      return {
        label: candidate.label,
        value: compactTextQualityIssue(candidate.value),
      };
    }
  }

  return null;
};
