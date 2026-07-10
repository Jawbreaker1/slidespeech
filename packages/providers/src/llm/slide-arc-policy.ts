import type { GenerateDeckInput } from "@slidespeech/types";

import { decodeHtmlEntities } from "../shared";
import {
  normalizeComparableText,
  tokenizeDeckShapeText,
} from "./deck-shape-text";

export type SlideArcPolicy =
  | "procedural"
  | "organization-overview"
  | "source-backed-subject"
  | "subject-explainer";

export type ArcPolicyInput = {
  intent?: Pick<
    NonNullable<GenerateDeckInput["intent"]>,
    | "contentMode"
    | "subject"
    | "presentationFrame"
    | "organization"
    | "explicitSourceUrls"
    | "focusAnchor"
    | "deliveryFormat"
    | "activityRequirement"
  > | undefined;
  groundingHighlights?: string[] | undefined;
  groundingCoverageGoals?: string[] | undefined;
  groundingSourceIds?: string[] | undefined;
  groundingFacts?: GenerateDeckInput["groundingFacts"] | undefined;
  topic?: GenerateDeckInput["topic"] | undefined;
};

export const resolveIntentSubject = (
  input: {
    intent?: Pick<NonNullable<GenerateDeckInput["intent"]>, "subject"> | undefined;
    topic?: string | undefined;
  },
): string => decodeHtmlEntities(input.intent?.subject?.trim() || input.topic || "");

export const usesOrganizationIdentity = (
  input: Pick<GenerateDeckInput, "intent">,
): boolean =>
  Boolean(input.intent?.organization?.trim()) &&
  (input.intent?.presentationFrame === "organization" ||
    input.intent?.presentationFrame === "mixed");

export const resolveOrganizationDisplayName = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
): string => {
  const subject = resolveIntentSubject(input);
  const organization = input.intent?.organization?.trim() ?? "";

  if (!organization || !usesOrganizationIdentity(input)) {
    return subject;
  }

  if (input.intent?.presentationFrame === "mixed") {
    const leadingAcronym = organization.match(/^([A-ZÅÄÖ]{2,8})\s*,/u)?.[1];
    return leadingAcronym ?? organization;
  }

  const normalizedSubject = normalizeComparableText(subject);
  const normalizedOrganization = normalizeComparableText(organization);
  if (normalizedSubject && normalizedSubject === normalizedOrganization) {
    return subject;
  }

  const subjectTokens = tokenizeDeckShapeText(subject);
  const organizationTokens = tokenizeDeckShapeText(organization);
  if (subjectTokens.length > organizationTokens.length) {
    return subject;
  }

  if (subject.length >= organization.length + 2) {
    return subject;
  }

  return organization;
};

export const resolveIntentFocusAnchor = (
  input: {
    intent?: Pick<NonNullable<GenerateDeckInput["intent"]>, "focusAnchor"> | undefined;
  },
): string | undefined => {
  const focusAnchor = input.intent?.focusAnchor?.trim();
  return focusAnchor && focusAnchor.length > 0 ? focusAnchor : undefined;
};

const normalizeDisplaySubject = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:how to\s+)?(?:make|making|prepare|preparing|create|creating|cook|cooking|build|building|assemble|assembling)\s+(?:the\s+)?/i, "")
    .replace(/\b(?:that|which)\s+(?:was|is|were|are|has|have)\b.*$/i, "")
    .replace(/[.]+$/g, "")
    .trim();

export const resolvePresentationSubjectLabel = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
): string => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);

  if (input.intent?.contentMode === "procedural") {
    return normalizeDisplaySubject(subject) || subject;
  }

  if (usesOrganizationIdentity(input)) {
    return resolveOrganizationDisplayName(input);
  }

  if (focusAnchor && focusAnchor.length <= 90) {
    return focusAnchor;
  }

  return normalizeDisplaySubject(subject) || subject;
};

const hasSourceBackedGrounding = (input: ArcPolicyInput): boolean =>
  Boolean(
    input.intent?.explicitSourceUrls?.length ||
      input.groundingSourceIds?.length ||
      input.groundingFacts?.length,
  );

const looksLikeOrganizationName = (value: string): boolean =>
  /\b(?:ab|ag|asa|bv|company|corp(?:oration)?|gmbh|group|holding|holdings|inc|limited|ltd|plc)\b/i.test(
    value,
  );

export const deriveSlideArcPolicy = (input: ArcPolicyInput): SlideArcPolicy => {
  if (input.intent?.contentMode === "procedural") {
    return "procedural";
  }

  if (
    input.intent?.presentationFrame === "organization" ||
    (input.intent?.presentationFrame === "mixed" && Boolean(input.intent.organization))
  ) {
    return "organization-overview";
  }

  if (
    hasSourceBackedGrounding(input) &&
    !resolveIntentFocusAnchor(input) &&
    looksLikeOrganizationName(resolveIntentSubject(input))
  ) {
    return "organization-overview";
  }

  if (hasSourceBackedGrounding(input)) {
    return "source-backed-subject";
  }

  return "subject-explainer";
};

export const isWorkshopPresentation = (
  input: Pick<GenerateDeckInput, "intent">,
): boolean =>
  input.intent?.deliveryFormat === "workshop" ||
  Boolean(input.intent?.activityRequirement);

export const buildArcPolicyPromptLines = (input: ArcPolicyInput): string[] => {
  const focusAnchor = input.intent?.focusAnchor?.trim();

  switch (deriveSlideArcPolicy(input)) {
    case "organization-overview":
      return [
        isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
          ? "Let the plan choose a source-grounded workshop arc for the requested audience; include participant practice only when the request or evidence supports it."
          : "Let the plan choose the strongest organization arc from the grounded material; cover identity, capabilities, operating model, proof, or next steps only when supported.",
        "Do not drift into slogans or unsupported organization claims; if source material is thin, keep the outline narrower rather than padding.",
        isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
          ? "Use a plain title that reflects the actual delivery format and topic."
          : "Use a plain title that reflects the source-backed subject and requested framing.",
        "The first beat must orient the audience; the final beat must synthesize the deck or invite questions; middle beats must each add a distinct role.",
      ];
    case "source-backed-subject":
      return [
        "Let the plan choose a sourced explanatory arc from the available evidence instead of following a fixed template.",
        focusAnchor
          ? `Treat ${JSON.stringify(focusAnchor)} as the specific evidence anchor for the detail slide and keep later slides building on it rather than collapsing back to the broad subject alone.`
          : null,
        "The first beat must introduce the exact subject and source-backed anchor; the final beat must synthesize what the audience can conclude; middle beats must each add a distinct evidence or reasoning role.",
      ].filter((line): line is string => Boolean(line));
    case "subject-explainer":
      return [
        "Let the plan choose the explanatory arc that best fits the subject, audience, and requested framing.",
        "The first beat must introduce the subject; the final beat must synthesize the deck or invite questions; middle beats must each add a distinct explanatory role.",
      ];
    default:
      return [];
  }
};
