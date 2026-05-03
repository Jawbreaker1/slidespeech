import type { GenerateDeckInput } from "@slidespeech/types";

import {
  DECK_SHAPE_INSTRUCTIONAL_PATTERNS,
  DECK_SHAPE_META_PATTERNS,
  contractTextSimilarity,
  looksAbstractForIntro,
} from "./deck-shape-text";
import { normalizeAudienceLevel } from "./pedagogical-profile-normalization";
import { sanitizePromptShapingText } from "./prompt-shaping";
import {
  deriveSlideArcPolicy,
  isWorkshopPresentation,
} from "./slide-arc-policy";
import type { ArcPolicyInput } from "./slide-contract-types";
import { toStringArray } from "./structured-normalization";
import {
  looksLikeWorkshopBriefEcho,
  subjectToActionPhrase,
  subjectToWorkshopNounPhrase,
} from "./workshop-text";

const uniqueCleanStoryline = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const buildDefaultStoryline = (input: {
  subject: string;
  arcInput: ArcPolicyInput;
  workshop: boolean;
  workshopNounPhrase: string;
  focusAnchor?: string | undefined;
}): string[] => {
  const { subject, arcInput, workshop, workshopNounPhrase, focusAnchor } = input;

  switch (deriveSlideArcPolicy(arcInput)) {
    case "procedural":
      return [
        `What ${subject} depends on`,
        `How ${subject} comes together`,
        `What changes the final quality`,
        `Common failure modes in ${subject}`,
        `How to recognize the finished result`,
        `A practical check before using ${subject}`,
        `Questions and next steps for ${subject}`,
      ];
    case "organization-overview":
      if (workshop) {
        return [
          `${workshopNounPhrase} starts as reviewable drafts`,
          `Role-based daily use cases`,
          `Safe boundaries before sharing`,
          `Practical exercise: ${subjectToActionPhrase(subject)}`,
          `Review checks before using the output`,
          `Shared debrief on what changed`,
          `Questions and next steps for ${subject}`,
        ];
      }
      return [
        `Who ${subject} is`,
        `Where ${subject} operates`,
        `How ${subject} works`,
        `What ${subject} offers`,
        `How the capabilities fit delivery`,
        `One practical outcome from ${subject}`,
        `What to remember and ask about`,
      ];
    case "source-backed-subject":
      return [
        `What ${subject} is`,
        focusAnchor || `One concrete detail or event`,
        workshop ? `Practical exercise: apply the case` : `Why the detail matters`,
        workshop ? `Applied takeaway` : `What it teaches`,
        `Context around ${focusAnchor || subject}`,
        workshop ? `Review the applied decision` : `What changes because of the detail`,
        `Questions and next steps for ${subject}`,
      ];
    default:
      return [
        `What ${subject} is`,
        `One concrete detail`,
        workshop ? `Practical exercise` : `Why it matters`,
        workshop ? `Review the applied decision` : `How the idea works in practice`,
        `A concrete example from ${subject}`,
        workshop ? `Applied takeaway` : `Key takeaway`,
        `Questions and next steps for ${subject}`,
      ];
  }
};

const fitStorylineToTarget = (
  storyline: string[],
  fallbackStoryline: string[],
  targetCount: number,
): string[] => {
  const fitted = uniqueCleanStoryline([
    ...storyline,
    ...fallbackStoryline,
  ]).slice(0, targetCount);

  while (fitted.length < targetCount) {
    const fallback = fallbackStoryline[fitted.length % fallbackStoryline.length];
    fitted.push(fallback ? `${fallback}` : `Questions and next steps`);
  }

  return fitted;
};

export const normalizePresentationPlan = (
  value: unknown,
  overrides?: {
    targetSlideCount?: number | undefined;
    topic?: string | undefined;
    subject?: string | undefined;
    intent?: ArcPolicyInput["intent"];
    groundingHighlights?: string[] | undefined;
    groundingCoverageGoals?: string[] | undefined;
    groundingSourceIds?: string[] | undefined;
  },
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const topic = overrides?.topic ?? "the topic";
  const subject = overrides?.subject ?? topic;
  const recommendedSlideCount =
    overrides?.targetSlideCount ??
    (typeof candidate.recommendedSlideCount === "number"
      ? candidate.recommendedSlideCount
      : 4);
  const targetStorylineCount = Math.max(1, Math.round(recommendedSlideCount));
  const arcInput: ArcPolicyInput = {
    intent: overrides?.intent,
    groundingHighlights: overrides?.groundingHighlights,
    groundingCoverageGoals: overrides?.groundingCoverageGoals,
    groundingSourceIds: overrides?.groundingSourceIds,
  };
  const workshop = isWorkshopPresentation(arcInput as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = arcInput.intent?.focusAnchor?.trim();
  const workshopNounPhrase = subjectToWorkshopNounPhrase(subject);
  const defaultStorylineForArc = buildDefaultStoryline({
    subject,
    arcInput,
    workshop,
    workshopNounPhrase,
    focusAnchor,
  }).slice(0, targetStorylineCount);
  const normalizedStoryline = toStringArray(candidate.storyline).map((step) =>
    sanitizePromptShapingText(step, topic),
  );
  const storyline = normalizedStoryline.length > 0
    ? normalizedStoryline.map((step, index) => {
        const previousAccepted = normalizedStoryline.slice(0, index);
        const tooMeta =
          DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(step)) ||
          DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(step));
        const tooAbstract = looksAbstractForIntro(step) && index > 0;
        const tooSimilar = previousAccepted.some(
          (previousStep) =>
            contractTextSimilarity(step, previousStep) >= 0.72,
        );
        return tooMeta || tooAbstract || tooSimilar
          ? defaultStorylineForArc[index] ?? step
          : step;
      })
    : defaultStorylineForArc;
  const normalizedTitle =
    typeof candidate.title === "string"
      ? sanitizePromptShapingText(candidate.title, topic)
      : "";
  const title =
    normalizedTitle &&
    !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(normalizedTitle)) &&
    !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(normalizedTitle))
      ? normalizedTitle
      : `${subject}: presentation outline`;

  return {
    ...candidate,
    title,
    learningObjectives: (() => {
      const defaultObjectives = workshop
        ? [
            `Identify one reviewable output from ${workshopNounPhrase}.`,
            `Apply source, data, policy, and human-review checks before sharing work.`,
            `Complete one practice task with a real work artifact.`,
          ]
        : [
            "Understand the main idea.",
            "See how the idea is structured.",
            "Connect the idea to one concrete example.",
          ];
      const objectives = toStringArray(candidate.learningObjectives)
        .map((objective) => sanitizePromptShapingText(objective, topic))
        .filter(
          (objective) =>
            objective.length > 0 &&
            !(workshop && looksLikeWorkshopBriefEcho(objective)) &&
            !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(objective)) &&
            !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(objective)),
        );
      return objectives.length > 0
        ? objectives
        : defaultObjectives;
    })(),
    storyline: fitStorylineToTarget(
      storyline.length > 0 ? storyline : defaultStorylineForArc,
      defaultStorylineForArc,
      targetStorylineCount,
    ),
    recommendedSlideCount,
    audienceLevel: normalizeAudienceLevel(candidate.audienceLevel),
  };
};
