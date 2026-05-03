import type { GenerateDeckInput, Slide } from "@slidespeech/types";

import {
  countAnchorOverlap,
  hasMeaningfulAnchorOverlap,
  normalizeComparableText,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import {
  deriveSlideArcPolicy,
  resolveIntentFocusAnchor,
  resolveIntentSubject,
} from "./slide-arc-policy";
import type {
  ArcPolicyInput,
  SlideContract,
} from "./slide-contract-types";
import { toStringArray } from "./structured-normalization";

export const buildSlideDraftLocalAnchors = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  slide: Record<string, unknown>,
): string[] =>
  uniqueNonEmptyStrings([
    typeof slide.title === "string" ? slide.title.trim() : "",
    typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "",
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    resolveIntentSubject(input),
  ]);

export const matchesAnySlideAnchor = (value: string, anchors: string[]): boolean =>
  anchors.some(
    (anchor) =>
      countAnchorOverlap(value, anchor) >= 2 || hasMeaningfulAnchorOverlap(value, anchor),
  );

export const buildContractRoleAnchors = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string[] => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  return uniqueNonEmptyStrings([
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    organizationArc && contract.kind === "orientation"
      ? input.intent?.presentationGoal ?? ""
      : "",
    ...(organizationArc && contract.kind === "orientation"
      ? input.intent?.audienceCues ?? []
      : []),
    contract.kind === "subject-detail" ||
    contract.kind === "subject-implication" ||
    contract.kind === "subject-takeaway"
      ? focusAnchor ?? ""
      : "",
  ]).filter((anchor) => normalizeComparableText(anchor) !== normalizeComparableText(subject));
};

export const buildSourceBackedGroundingAnchors = (
  input: Pick<
    GenerateDeckInput,
    "topic" | "intent" | "groundingHighlights" | "groundingCoverageGoals"
  >,
  contract: SlideContract,
): string[] => {
  if (deriveSlideArcPolicy(input) !== "source-backed-subject") {
    return [];
  }

  return uniqueNonEmptyStrings([
    contract.evidence ?? "",
    resolveIntentFocusAnchor(input) ?? "",
    ...(input.groundingCoverageGoals ?? []),
    ...(input.groundingHighlights ?? []).slice(0, 5),
  ]).filter(
    (anchor) =>
      normalizeComparableText(anchor) !== normalizeComparableText(resolveIntentSubject(input)),
  );
};

export const countSalientAnchorOverlap = (value: string, anchor: string): number => {
  const left = [...new Set(tokenizeDeckShapeText(value))].filter(
    (token) => token.length >= 4 || /\p{N}/u.test(token),
  );
  const right = new Set(
    tokenizeDeckShapeText(anchor).filter(
      (token) => token.length >= 4 || /\p{N}/u.test(token),
    ),
  );

  if (left.length === 0 || right.size === 0) {
    return 0;
  }

  return left.filter((token) => right.has(token)).length;
};

export const matchesStrictGroundedAnchor = (value: string, anchors: string[]): boolean =>
  anchors.some((anchor) => countSalientAnchorOverlap(value, anchor) >= 2);

const slideDraftDistinctnessText = (slide: Record<string, unknown> | Slide): string =>
  [
    typeof slide.title === "string" ? slide.title : "",
    typeof slide.learningGoal === "string" ? slide.learningGoal : "",
    ...toStringArray(slide.keyPoints),
    typeof slide.beginnerExplanation === "string" ? slide.beginnerExplanation : "",
    typeof slide.advancedExplanation === "string" ? slide.advancedExplanation : "",
    ...toStringArray(slide.examples),
  ].join(" ");

export const slideDistinctnessOverlapRatio = (
  leftSlide: Record<string, unknown> | Slide,
  rightSlide: Record<string, unknown> | Slide,
): number => {
  const leftTokens = [...new Set(tokenizeDeckShapeText(slideDraftDistinctnessText(leftSlide)))];
  const rightTokens = [...new Set(tokenizeDeckShapeText(slideDraftDistinctnessText(rightSlide)))];

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
};
