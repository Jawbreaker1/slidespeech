import type { GenerateDeckInput } from "@slidespeech/types";

import { decodeHtmlEntities } from "../shared";
import {
  normalizeComparableText,
  tokenizeDeckShapeText,
} from "./deck-shape-text";
import type { ArcPolicyInput, SlideArcPolicy } from "./slide-contract-types";

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

export const framingImpliesOrientation = (
  input: Pick<GenerateDeckInput, "presentationBrief" | "intent">,
): boolean =>
  /\b(onboarding|orientation|introduction|overview)\b/i.test(
    `${input.intent?.framing ?? ""} ${input.presentationBrief ?? ""}`,
  );

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

const hasSourceBackedGrounding = (input: ArcPolicyInput): boolean =>
  Boolean(
    input.intent?.explicitSourceUrls?.length ||
      input.groundingSourceIds?.length,
  );

const looksLikeOrganizationName = (value: string): boolean =>
  /\b(?:ab|ag|asa|bv|cars|company|corp(?:oration)?|gmbh|group|holding|holdings|inc|limited|ltd|motors|plc)\b/i.test(
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
          ? "Use an organization-grounded workshop arc: why this matters for the audience's daily work, where it helps, which constraints shape safe use, and one practical exercise."
          : "Use an organization overview arc: who the organization is, what it offers, how it works, and one concrete outcome or customer example.",
        "Do not drift into mission, vision, or broad slogans unless that material is explicitly grounded and central to the request.",
        isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
          ? "Use a plain workshop title such as '<Organization> workshop: <topic>'. Do not call a workshop an onboarding deck."
          : "Use a plain organization title such as '<Organization> overview' or '<Organization> onboarding'; avoid 'your guide', 'ultimate', 'excellence', 'journey', and other marketing title phrasing.",
      ];
    case "source-backed-subject":
      return [
        "Use a sourced teaching arc that separates the specific event, fact, or mechanism, why it matters, and the takeaway.",
        focusAnchor
          ? `Treat ${JSON.stringify(focusAnchor)} as the specific evidence anchor for the detail slide and keep later slides building on it rather than collapsing back to the broad subject alone.`
          : null,
        "Later slides must not restate the same description; each one needs a different explanatory role.",
      ].filter((line): line is string => Boolean(line));
    case "subject-explainer":
      return [
        "Use a teaching arc that separates the concrete detail, the implication, and the takeaway.",
        "Later slides must not restate the same description; each one needs a different explanatory role.",
      ];
    default:
      return [];
  }
};
