import type { Deck, GenerateDeckInput } from "@slidespeech/types";

import {
  DECK_SHAPE_META_PATTERNS,
  DECK_SHAPE_SUMMARY_PATTERNS,
  getActiveInstructionalPatterns,
  looksFragmentarySlidePoint,
  looksOverlyPromotionalSourceCopy,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
  usesDirectOrganizationPersona,
} from "./deck-shape-text";
import {
  countOrganizationRoleAlignedValues,
  hasGroundedOrganizationValueCaseEvidence,
  isOrganizationRoleKind,
  looksUnsupportedOrganizationOperationsToolStory,
  looksUnsupportedOrganizationValueCase,
  looksUnsupportedOrganizationValueToolDetail,
  organizationRoleSignalsAnotherRole,
  organizationSpecificTechStackLooksUnsupported,
} from "./organization-role-contracts";
import {
  deriveSlideArcPolicy,
  isWorkshopPresentation,
} from "./slide-arc-policy";
import {
  buildContractLearningGoal,
  buildContractTitle,
} from "./slide-contract-copy";
import {
  canUseAsSlideExample,
  looksDanglingSlidePhrase,
  looksMalformedCandidatePoint,
} from "./slide-contract-text";
import type {
  ArcPolicyInput,
  SlideContract,
  SlideDraftAssessment,
} from "./slide-contract-types";
import {
  buildContractRoleAnchors,
  buildSlideDraftLocalAnchors,
  buildSourceBackedGroundingAnchors,
  countSalientAnchorOverlap,
  matchesAnySlideAnchor,
  matchesStrictGroundedAnchor,
  slideDistinctnessOverlapRatio,
} from "./slide-draft-anchors";
import { toStringArray } from "./structured-normalization";

export const assessGeneratedSlideDraft = (
  input: Pick<
    GenerateDeckInput,
    "topic" | "intent" | "groundingHighlights" | "groundingCoverageGoals"
  >,
  deck: Deck,
  contract: SlideContract,
  slide: Record<string, unknown>,
): SlideDraftAssessment => {
  const title = typeof slide.title === "string" ? slide.title.trim() : "";
  const learningGoal =
    typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
  const expectedTitle = buildContractTitle(input, contract);
  const expectedLearningGoal = buildContractLearningGoal(input, contract);
  const keyPoints = toStringArray(slide.keyPoints);
  const explanations = [
    typeof slide.beginnerExplanation === "string"
      ? slide.beginnerExplanation.trim()
      : "",
    typeof slide.advancedExplanation === "string"
      ? slide.advancedExplanation.trim()
      : "",
  ].filter(Boolean);
  const allText = [title, learningGoal, ...keyPoints, ...explanations].join(" ");
  const localAnchors = buildSlideDraftLocalAnchors(input, contract, slide);
  const roleAnchors = buildContractRoleAnchors(input, contract);
  const sourceBackedGroundingAnchors = buildSourceBackedGroundingAnchors(input, contract);
  const activeInstructionalPatterns = getActiveInstructionalPatterns(input);
  const instructionalKeyPoints = keyPoints.filter((point) =>
    activeInstructionalPatterns.some((pattern) => pattern.test(point)),
  );
  const fragmentaryKeyPoints = keyPoints.filter((point) =>
    looksFragmentarySlidePoint(point),
  );
  const malformedExplanations = explanations.filter(
    (value) =>
      looksMalformedCandidatePoint(value) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(value)),
  );
  const weaklyAnchoredKeyPoints = keyPoints.filter(
    (point) => !matchesAnySlideAnchor(point, localAnchors),
  );
  const earlierSlides = deck.slides.slice(0, contract.index);
  const repetitiveEarlierSlides = earlierSlides.filter(
    (previousSlide) => slideDistinctnessOverlapRatio(slide, previousSlide) >= 0.72,
  );
  const roleAlignedKeyPointCount = keyPoints.filter((point) =>
    matchesAnySlideAnchor(point, roleAnchors),
  ).length;
  const examples = toStringArray(slide.examples);
  const malformedExamples = examples.filter(
    (example) =>
      !canUseAsSlideExample(input, example) ||
      looksOverlyPromotionalSourceCopy(example),
  );
  const roleAlignedExampleCount = examples.filter((example) =>
    matchesAnySlideAnchor(example, roleAnchors),
  ).length;
  const relaxConceptRoleAnchors =
    sourceBackedGroundingAnchors.length === 0 &&
    (contract.kind === "subject-implication" ||
      contract.kind === "subject-takeaway");
  const enforceOrientationRoleAlignment =
    contract.kind === "orientation" &&
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const workshopOrientationAudienceAnchors =
    enforceOrientationRoleAlignment &&
    isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
      ? uniqueNonEmptyStrings(input.intent?.audienceCues ?? [])
      : [];
  const matchesAudienceAnchor = (value: string): boolean =>
    workshopOrientationAudienceAnchors.some((anchor) => {
      const anchorTokenCount = new Set(
        tokenizeDeckShapeText(anchor).filter(
          (token) => token.length >= 4 || /\p{N}/u.test(token),
        ),
      ).size;
      if (anchorTokenCount === 0) {
        return false;
      }

      return countSalientAnchorOverlap(value, anchor) >= Math.min(2, anchorTokenCount);
    });
  const audienceAlignedKeyPointCount = workshopOrientationAudienceAnchors.length
    ? keyPoints.filter((point) =>
        matchesAudienceAnchor(point),
      ).length
    : 0;
  const audienceAlignedExampleCount = workshopOrientationAudienceAnchors.length
    ? examples.filter((example) =>
        matchesAudienceAnchor(example),
      ).length
    : 0;
  const titleOrGoalMatchesRole =
    matchesAnySlideAnchor(title, roleAnchors) ||
    matchesAnySlideAnchor(learningGoal, roleAnchors);
  const evidenceAnchorMatched =
    !contract.evidence ||
    matchesAnySlideAnchor(title, [contract.evidence]) ||
    matchesAnySlideAnchor(learningGoal, [contract.evidence]) ||
    keyPoints.some((point) => matchesAnySlideAnchor(point, [contract.evidence!])) ||
    examples.some((example) =>
      matchesAnySlideAnchor(example, [contract.evidence!]),
    );
  const evidenceAlignedExampleCount = contract.evidence
    ? examples.filter((example) => matchesAnySlideAnchor(example, [contract.evidence!])).length
    : 0;
  const evidenceAlignedKeyPointCount = contract.evidence
    ? keyPoints.filter((point) => matchesAnySlideAnchor(point, [contract.evidence!])).length
    : 0;
  const sourceGroundedKeyPointCount = keyPoints.filter((point) =>
    matchesStrictGroundedAnchor(point, sourceBackedGroundingAnchors),
  ).length;
  const sourceGroundedExampleCount = examples.filter((example) =>
    matchesStrictGroundedAnchor(example, sourceBackedGroundingAnchors),
  ).length;
  const valueHasCustomerCaseEvidence = hasGroundedOrganizationValueCaseEvidence(contract);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const enforceStrictOrganizationRoleChecks =
    isOrganizationRoleKind(contract.kind) && !workshop;
  const unsupportedOrganizationCaseValues =
    enforceStrictOrganizationRoleChecks
      ? [
          title,
          learningGoal,
          ...keyPoints,
          ...explanations,
          ...examples,
        ].filter((value) => looksUnsupportedOrganizationValueCase(contract, value))
      : [];
  const unsupportedOrganizationValueToolValues =
    enforceStrictOrganizationRoleChecks && contract.kind === "entity-value"
      ? [
          title,
          learningGoal,
          ...keyPoints,
          ...explanations,
          ...examples,
        ].filter((value) => looksUnsupportedOrganizationValueToolDetail(contract, value))
      : [];
  const unsupportedOrganizationOperationsToolValues =
    enforceStrictOrganizationRoleChecks && contract.kind === "entity-operations"
      ? [
          title,
          learningGoal,
          ...keyPoints,
          ...explanations,
          ...examples,
        ].filter((value) => looksUnsupportedOrganizationOperationsToolStory(contract, value))
      : [];
  const unsupportedOrganizationTechStackValues =
    enforceStrictOrganizationRoleChecks
      ? [
          title,
          learningGoal,
          ...keyPoints,
          ...explanations,
          ...examples,
        ].filter((value) =>
          organizationSpecificTechStackLooksUnsupported(input, contract, value),
        )
      : [];
  const avoidDirectOrganizationPersona =
    isOrganizationRoleKind(contract.kind) &&
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview" &&
    !isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const directOrganizationPersonaValues = avoidDirectOrganizationPersona
    ? [
        title,
        learningGoal,
        ...keyPoints,
        ...explanations,
        ...examples,
      ].filter((value) => usesDirectOrganizationPersona(value))
    : [];
  const titleOrGoalMatchesGrounding =
    matchesStrictGroundedAnchor(title, sourceBackedGroundingAnchors) ||
    matchesStrictGroundedAnchor(learningGoal, sourceBackedGroundingAnchors);
  const reasons: string[] = [];

  if (looksOverlyPromotionalSourceCopy(allText)) {
    reasons.push(
      "Remove promotional or navigation copy from the slide. Keep only subject content.",
    );
  }

  if (directOrganizationPersonaValues.length > 0) {
    reasons.push(
      "Use third-person organization language instead of we/our/you/your phrasing in onboarding slides.",
    );
  }

  if (
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(allText)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(allText))
  ) {
    reasons.push(
      "Remove slide-making advice and presenter instructions. Teach the subject itself instead.",
    );
  }

  if (
    !learningGoal ||
    looksDanglingSlidePhrase(learningGoal) ||
    looksMalformedCandidatePoint(learningGoal) ||
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(learningGoal)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(learningGoal))
  ) {
    reasons.push(
      "Rewrite the learning goal so it names a concrete part of the subject without awkward role-of phrasing.",
    );
  }

  if (
    !title ||
    looksDanglingSlidePhrase(title) ||
    looksMalformedCandidatePoint(title) ||
    DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(title)) ||
    activeInstructionalPatterns.some((pattern) => pattern.test(title)) ||
    looksOverlyPromotionalSourceCopy(title) ||
    (!matchesAnySlideAnchor(title, localAnchors.filter((anchor) => anchor !== title)) &&
      title.toLowerCase() !== expectedTitle.toLowerCase())
  ) {
    reasons.push(
      "Rewrite the title so it clearly names the concrete subject area of this slide.",
    );
  }

  if (
    learningGoal &&
    learningGoal.toLowerCase() === expectedLearningGoal.toLowerCase()
  ) {
    const awkwardLearningGoalReasonIndex = reasons.findIndex((reason) =>
      reason.includes("Rewrite the learning goal"),
    );
    if (awkwardLearningGoalReasonIndex >= 0) {
      reasons.splice(awkwardLearningGoalReasonIndex, 1);
    }
  }

  if (
    keyPoints.length < 3 ||
    keyPoints.some(
      (point) =>
        looksOverlyPromotionalSourceCopy(point) ||
        looksMalformedCandidatePoint(point) ||
        (avoidDirectOrganizationPersona && usesDirectOrganizationPersona(point)) ||
        DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) ||
        DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)),
    ) ||
    keyPoints.filter((point) => matchesAnySlideAnchor(point, localAnchors)).length < 1
  ) {
    reasons.push(
      "Rewrite the key points as three complete, concrete claims tightly tied to this slide's subject.",
    );
  }

  if (instructionalKeyPoints.length > 0 && contract.kind !== "workshop-practice") {
    reasons.push(
      "One or more key points still read like commands. Rewrite them as observations, mechanisms, or cues rather than actions for the audience to take.",
    );
  }

  if (fragmentaryKeyPoints.length > 0) {
    reasons.push(
      "At least one key point is still fragmentary. Rewrite every key point as a full explanatory sentence.",
    );
  }

  if (malformedExplanations.length > 0) {
    reasons.push(
      "Rewrite the explanations so they are complete subject-facing sentences, not repair-template fragments.",
    );
  }

  if (malformedExamples.length > 0) {
    reasons.push(
      "Rewrite or remove malformed examples. Example slots need complete, concrete prompts or evidence, not fragments.",
    );
  }

  if (weaklyAnchoredKeyPoints.length >= 2) {
    reasons.push(
      "The key points are not specific enough to this slide. Tie them more directly to the slide title, focus, and learning goal.",
    );
  }

  if (
    !relaxConceptRoleAnchors &&
    (contract.kind !== "orientation" || enforceOrientationRoleAlignment) &&
    roleAnchors.length > 0 &&
    !titleOrGoalMatchesRole
  ) {
    reasons.push(
      "The title and learning goal drift away from the slide's assigned role. Keep them anchored to the contract focus and objective for this slide.",
    );
  }

  if (
    !relaxConceptRoleAnchors &&
    (contract.kind !== "orientation" || enforceOrientationRoleAlignment) &&
    roleAnchors.length > 0 &&
    roleAlignedKeyPointCount < Math.min(2, keyPoints.length)
  ) {
    reasons.push(
      "The key points do not stay close enough to the slide's assigned role. Keep at least two of them anchored to this slide's focus, objective, or evidence.",
    );
  }

  if (
    enforceStrictOrganizationRoleChecks &&
    (organizationRoleSignalsAnotherRole(contract.kind, title) ||
      organizationRoleSignalsAnotherRole(contract.kind, learningGoal))
  ) {
    reasons.push(
      "The slide heading signals the wrong organization role. Keep capabilities, operations, and customer value clearly separated instead of letting one slide drift into another.",
    );
  }

  if (
    enforceStrictOrganizationRoleChecks &&
    countOrganizationRoleAlignedValues(contract.kind, keyPoints) < Math.min(2, keyPoints.length)
  ) {
    reasons.push(
      "The slide body signals the wrong organization role. Rebuild the points so they clearly stay with this slide's assigned role instead of mixing capabilities, operations, and value language.",
    );
  }

  if (unsupportedOrganizationCaseValues.length > 0) {
    reasons.push(
      "The organization slide invents a customer, client, industry, provider, case study, metric, or deployment story that is not present in the evidence. Keep it to source-backed organization facts only.",
    );
  }

  if (unsupportedOrganizationValueToolValues.length > 0) {
    reasons.push(
      "The value slide turns tools, frameworks, or CI/CD pipeline detail into the value story without a source-backed customer case. Keep it centered on the assigned practical consequence.",
    );
  }

  if (unsupportedOrganizationOperationsToolValues.length > 0) {
    reasons.push(
      "The operations slide turns service, tool, AI, or pipeline detail into the operating model. Keep operations centered on footprint, delivery structure, teams, and day-to-day workflow.",
    );
  }

  if (unsupportedOrganizationTechStackValues.length > 0) {
    reasons.push(
      "The organization slide introduces named tools, frameworks, or CI/CD details that are not present in the grounding. Remove unsupported implementation details.",
    );
  }

  if (
    workshopOrientationAudienceAnchors.length > 0 &&
    audienceAlignedKeyPointCount + audienceAlignedExampleCount === 0
  ) {
    reasons.push(
      "The workshop opening needs at least one role-based example or audience-specific task so the audience can recognize where the topic fits into their daily work.",
    );
  }

  if (!evidenceAnchorMatched) {
    reasons.push(
      "The slide lost the concrete evidence anchor that should make this role specific. Rebuild it around the assigned evidence rather than broad restatement.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    contract.evidence &&
    evidenceAlignedKeyPointCount + evidenceAlignedExampleCount < 2
  ) {
    reasons.push(
      valueHasCustomerCaseEvidence
        ? "A value slide must stay centered on one concrete example or outcome. Tie at least two visible elements to the assigned evidence anchor."
        : "A value slide must stay centered on one evidence-backed practical consequence. Tie at least two visible elements to the assigned evidence anchor.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    contract.evidence &&
    !matchesAnySlideAnchor(title, [contract.evidence, contract.objective ?? "", contract.focus]) &&
    !matchesAnySlideAnchor(learningGoal, [contract.evidence, contract.objective ?? "", contract.focus])
  ) {
    reasons.push(
      valueHasCustomerCaseEvidence
        ? "The value slide heading drifts away from the concrete example. Keep the title or learning goal anchored to the example or outcome, not a general value claim."
        : "The value slide heading drifts away from the practical consequence. Keep the title or learning goal anchored to the evidence, not a general value claim.",
    );
  }

  if (
    contract.kind === "entity-operations" &&
    contract.evidence &&
    evidenceAlignedKeyPointCount + evidenceAlignedExampleCount === 0
  ) {
    reasons.push(
      "The operations slide lost its concrete operating anchor. Tie at least one visible point or example to the assigned delivery, footprint, or operating-model evidence.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    valueHasCustomerCaseEvidence &&
    roleAlignedExampleCount === 0
  ) {
    reasons.push(
      "A value slide needs a concrete example in the example slot, not only general value language in the body text.",
    );
  }

  if (
    contract.kind === "entity-value" &&
    !valueHasCustomerCaseEvidence &&
    examples.length === 0
  ) {
    reasons.push(
      "A value slide needs an evidence-backed practical consequence in the example slot, not an invented customer case.",
    );
  }

  if (contract.kind === "workshop-practice" && roleAlignedExampleCount === 0) {
    reasons.push(
      "A workshop practice slide needs one concrete exercise prompt, scenario, or sample artifact in the example slot so the audience can actually perform the task.",
    );
  }

  if (
    contract.kind === "workshop-practice" &&
    contract.evidence &&
    evidenceAlignedKeyPointCount + evidenceAlignedExampleCount === 0
  ) {
    reasons.push(
      "The workshop practice slide lost its practical scenario anchor. Rebuild it around the assigned evidence so it feels like an exercise, not another summary slide.",
    );
  }

  if (
    sourceBackedGroundingAnchors.length > 0 &&
    (contract.kind === "orientation" || contract.kind === "subject-detail") &&
    (!titleOrGoalMatchesGrounding ||
      sourceGroundedKeyPointCount + sourceGroundedExampleCount < 1)
  ) {
    reasons.push(
      "Keep the setup anchored to supported source details. The title, goal, and visible points should establish the concrete grounded case instead of broad subject generalities.",
    );
  }

  if (
    sourceBackedGroundingAnchors.length > 0 &&
    (contract.kind === "subject-implication" || contract.kind === "subject-takeaway") &&
    (!titleOrGoalMatchesGrounding ||
      sourceGroundedKeyPointCount + sourceGroundedExampleCount < 2)
  ) {
    reasons.push(
      "This slide drifts beyond the grounded case. Keep the implication or takeaway anchored to supported source details instead of expanding into broader unsupported claims.",
    );
  }

  if (repetitiveEarlierSlides.length > 0) {
    reasons.push(
      "This slide repeats earlier slides too closely. Advance the story with a distinct mechanism, example, responsibility, or consequence.",
    );
  }

  return {
    retryable: reasons.length > 0,
    reasons: uniqueNonEmptyStrings(reasons),
  };
};
