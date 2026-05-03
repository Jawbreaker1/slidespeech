import type { Deck, GenerateDeckInput } from "@slidespeech/types";
import { DeckSchema } from "@slidespeech/types";

import {
  createId,
  decodeHtmlEntities,
} from "../shared";
import { buildSlideBriefs } from "./deck-blueprint";
import { normalizeDeckTitle } from "./deck-title-normalization";
import {
  DECK_SHAPE_INSTRUCTIONAL_PATTERNS,
  DECK_SHAPE_META_PATTERNS,
  DECK_SHAPE_SUMMARY_PATTERNS,
  hasMeaningfulAnchorOverlap,
  looksAbstractForIntro,
  looksOverlyPromotionalSourceCopy,
  toAudienceFacingLearningGoal,
  toAudienceFacingSentence,
  uniqueNonEmptyStrings,
  usesDirectOrganizationPersona,
} from "./deck-shape-text";
import { normalizeSourceType } from "./grounding-normalization";
import { normalizePedagogicalProfile } from "./pedagogical-profile-normalization";
import {
  buildOrganizationRoleAdvancedExplanation,
  countOrganizationRoleAlignedValues,
  isOrganizationRoleKind,
  looksUnsupportedOrganizationOperationsToolStory,
  looksUnsupportedOrganizationValueCase,
  looksUnsupportedOrganizationValueToolDetail,
  organizationRoleHeadingNeedsRepair,
  organizationRoleSignalsAnotherRole,
  organizationRoleTextSupportsContract,
  organizationSpecificTechStackLooksUnsupported,
} from "./organization-role-contracts";
import { extractCoverageRequirements } from "./prompt-shaping";
import {
  deriveVisuals,
  shouldRefreshDerivedVisuals,
} from "./slide-visual-normalization";
import {
  buildContractRoleAnchors,
  buildSourceBackedGroundingAnchors,
  matchesAnySlideAnchor,
  matchesStrictGroundedAnchor,
} from "./slide-draft-anchors";
import {
  buildSlideContracts,
} from "./slide-contract-builder";
import {
  buildContractLearningGoal,
  buildContractTitle,
} from "./slide-contract-copy";
import { buildContractAnchoredKeyPoints } from "./slide-contract-points";
import {
  canUseAsSlideExample,
  canUseAsSlidePoint,
  compactSourceBackedAnchor,
  looksDanglingSlidePhrase,
  looksMalformedCandidatePoint,
  pickContractText,
  sanitizeContractText,
} from "./slide-contract-text";
import {
  deriveSlideArcPolicy,
  isWorkshopPresentation,
  resolveIntentSubject,
  resolveOrganizationDisplayName,
  usesOrganizationIdentity,
} from "./slide-arc-policy";
import type { ArcPolicyInput } from "./slide-contract-types";
import {
  toRecordArray,
  toStringArray,
} from "./structured-normalization";
import { lowerCaseFirstCharacter } from "./workshop-text";

export const buildOutlineDeckSummary = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): string => {
  const subject = resolveIntentSubject(input);
  if (
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview" &&
    usesOrganizationIdentity(input as Pick<GenerateDeckInput, "intent">)
  ) {
    const entityName = resolveOrganizationDisplayName(
      input as Pick<GenerateDeckInput, "topic" | "intent">,
    );
    if (isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)) {
      return toAudienceFacingSentence(
        `AI tools help daily work when raw notes, requirements, risks, or defects become checked first drafts.`,
      );
    }
    return toAudienceFacingSentence(
      `${entityName} is introduced through identity, operating model, capabilities, and one practical consequence.`,
    );
  }

  const explicitCoverageRequirements = uniqueNonEmptyStrings(
    (input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? "")).map((requirement) =>
      sanitizeContractText(requirement, subject),
    ),
  );
  const bestAnchor = pickContractText(
    input,
    [
      input.intent?.presentationGoal,
      input.intent?.focusAnchor,
      explicitCoverageRequirements[0],
      input.groundingCoverageGoals?.[0],
      input.groundingHighlights?.[0],
      input.plan?.learningObjectives?.[0],
      input.plan?.storyline?.[0],
      input.presentationBrief,
      `A clear teaching presentation about ${subject}`,
    ],
    { preferConcrete: true },
  );

  if (deriveSlideArcPolicy(input as ArcPolicyInput) === "source-backed-subject") {
    const groundedAnchor = pickContractText(
      input,
      [
        input.groundingHighlights?.[0],
        input.groundingCoverageGoals?.[0],
        input.intent?.focusAnchor,
        input.plan?.learningObjectives?.[0],
        input.plan?.storyline?.[0],
      ],
      { preferConcrete: true },
    );
    const compactAnchor = groundedAnchor
      ? compactSourceBackedAnchor(groundedAnchor, subject)
      : "";

    return toAudienceFacingSentence(
      compactAnchor
        ? `${subject} is explained through ${lowerCaseFirstCharacter(compactAnchor)}, its context, and the clearest takeaway.`
        : `${subject} is explained through verified details, context, and a clear takeaway.`,
    );
  }

  return toAudienceFacingSentence(
    `${subject} is presented through ${bestAnchor.toLowerCase()} so the audience can see the clearest ideas, examples, or consequences.`,
  );
};

export const buildOutlineScaffoldDeck = (input: GenerateDeckInput): Deck => {
  const subject = resolveIntentSubject(input);
  const slideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, (input.plan?.storyline?.length ?? 0) + 1);
  const contracts = buildSlideContracts(input, slideCount);
  const slideBriefs = buildSlideBriefs(input, contracts);
  const rawDeck = {
    title: input.plan?.title ?? `${subject}: key ideas`,
    summary: buildOutlineDeckSummary(input),
    slides: contracts.map((contract) => ({
      title: buildContractTitle(input, contract),
      learningGoal: buildContractLearningGoal(input, contract),
      keyPoints: buildContractAnchoredKeyPoints(
        input,
        contract,
        slideBriefs[contract.index]?.requiredClaims.length
          ? (slideBriefs[contract.index]?.requiredClaims ?? [])
          : input.groundingHighlights ?? [],
      ).slice(0, 3),
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: "",
      advancedExplanation: "",
    })),
  };

  return DeckSchema.parse(normalizeDeck(rawDeck, input));
};

export const applyPlanDrivenDeckShape = (
  slides: Record<string, unknown>[],
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): Record<string, unknown>[] => {
  const contracts = buildSlideContracts(input, slides.length);
  const subject = resolveIntentSubject(input);
  const avoidDirectOrganizationPersona =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview" &&
    !isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);

  return slides.map((slide, index) => {
    const contract = contracts[index];
    if (!slide || !contract) {
      return slide;
    }

    const title = typeof slide.title === "string" ? slide.title.trim() : "";
    const contractAnchor = [subject, contract.focus, contract.objective ?? "", contract.evidence ?? ""].join(
      " ",
    );
    const roleAnchors = buildContractRoleAnchors(input, contract);
    const keyPoints = toStringArray(slide.keyPoints);
    const examples = toStringArray(slide.examples);
    const sourceBackedSubject =
      deriveSlideArcPolicy(input as ArcPolicyInput) === "source-backed-subject";
    const sourceBackedGroundingAnchors = sourceBackedSubject
      ? buildSourceBackedGroundingAnchors(input, contract)
      : [];
    const sourceGroundedKeyPointCount = sourceBackedGroundingAnchors.length
      ? keyPoints.filter((point) =>
          matchesStrictGroundedAnchor(point, sourceBackedGroundingAnchors),
        ).length
      : 0;
    const sourceGroundedExampleCount = sourceBackedGroundingAnchors.length
      ? examples.filter((example) =>
          matchesStrictGroundedAnchor(example, sourceBackedGroundingAnchors),
        ).length
      : 0;
    const roleAlignedExampleCount = examples.filter((example) =>
      matchesAnySlideAnchor(example, roleAnchors),
    ).length;
    const evidenceAlignedKeyPointCount = contract.evidence
      ? keyPoints.filter((point) => matchesAnySlideAnchor(point, [contract.evidence!])).length
      : 0;
    const evidenceAlignedExampleCount = contract.evidence
      ? examples.filter((example) => matchesAnySlideAnchor(example, [contract.evidence!])).length
      : 0;
    const concretePointPool = uniqueNonEmptyStrings(
      [
        ...keyPoints,
        typeof slide.beginnerExplanation === "string" ? slide.beginnerExplanation : "",
        typeof slide.advancedExplanation === "string" ? slide.advancedExplanation : "",
        ...examples,
        ...toStringArray(slide.speakerNotes),
      ].filter(
        (value) =>
          value.length > 18 &&
          !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
          !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)) &&
          (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(value)),
      ),
    );
    const roleReadyConcretePointPool =
      isOrganizationRoleKind(contract.kind)
        ? concretePointPool.filter((value) =>
            organizationRoleTextSupportsContract(contract, value),
          )
        : concretePointPool;

    const replacementPoints = buildContractAnchoredKeyPoints(
      input,
      contract,
      isOrganizationRoleKind(contract.kind)
        ? roleReadyConcretePointPool
        : roleReadyConcretePointPool.length > 0
        ? roleReadyConcretePointPool
        : concretePointPool,
    );

    const introNeedsRepair =
      index === 0 &&
      (looksAbstractForIntro(title) ||
        !title ||
        keyPoints.some(
          (point) =>
            DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) ||
            DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)),
        ));

    const titleNeedsRepair =
      introNeedsRepair ||
      title.length > 84 ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(title)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(title)) ||
      looksDanglingSlidePhrase(title) ||
      (avoidDirectOrganizationPersona &&
        isOrganizationRoleKind(contract.kind) &&
        usesDirectOrganizationPersona(title)) ||
      looksUnsupportedOrganizationValueCase(contract, title) ||
      looksUnsupportedOrganizationValueToolDetail(contract, title) ||
      looksUnsupportedOrganizationOperationsToolStory(contract, title) ||
      organizationSpecificTechStackLooksUnsupported(input, contract, title) ||
      organizationRoleHeadingNeedsRepair(contract.kind, title) ||
      (isOrganizationRoleKind(contract.kind) &&
        organizationRoleSignalsAnotherRole(contract.kind, title)) ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        !matchesAnySlideAnchor(title, [contract.evidence, contract.objective ?? "", contract.focus])) ||
      (contract.kind === "workshop-practice" &&
        !matchesAnySlideAnchor(title, [contract.objective ?? contract.focus, contract.evidence ?? ""])) ||
      (index > 0 &&
        roleAnchors.length > 0 &&
        !matchesAnySlideAnchor(title, roleAnchors)) ||
      !hasMeaningfulAnchorOverlap(title, contractAnchor);

    const learningGoalText =
      typeof slide.learningGoal === "string" ? slide.learningGoal.trim() : "";
    const learningGoalNeedsRepair =
      !learningGoalText ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(learningGoalText)) ||
      looksMalformedCandidatePoint(learningGoalText) ||
      looksDanglingSlidePhrase(learningGoalText) ||
      (avoidDirectOrganizationPersona &&
        isOrganizationRoleKind(contract.kind) &&
        usesDirectOrganizationPersona(learningGoalText)) ||
      looksUnsupportedOrganizationValueCase(contract, learningGoalText) ||
      looksUnsupportedOrganizationValueToolDetail(contract, learningGoalText) ||
      looksUnsupportedOrganizationOperationsToolStory(contract, learningGoalText) ||
      organizationSpecificTechStackLooksUnsupported(input, contract, learningGoalText) ||
      organizationRoleHeadingNeedsRepair(contract.kind, learningGoalText) ||
      (isOrganizationRoleKind(contract.kind) &&
        organizationRoleSignalsAnotherRole(contract.kind, learningGoalText)) ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        !matchesAnySlideAnchor(learningGoalText, [contract.evidence, contract.objective ?? "", contract.focus])) ||
      (contract.kind === "workshop-practice" &&
        !matchesAnySlideAnchor(learningGoalText, [contract.objective ?? contract.focus, contract.evidence ?? ""])) ||
      (index > 0 &&
        roleAnchors.length > 0 &&
        !matchesAnySlideAnchor(learningGoalText, roleAnchors)) ||
      !hasMeaningfulAnchorOverlap(learningGoalText, contractAnchor);

    const alignedKeyPoints = keyPoints.filter(
      (point) =>
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(point)) &&
        !DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)) &&
        hasMeaningfulAnchorOverlap(
          point,
          `${roleAnchors.join(" ")} ${contractAnchor} ${title}`,
        ),
    );
    const keyPointsNeedRepair =
      keyPoints.length < 3 ||
      alignedKeyPoints.length < 2 ||
      (isOrganizationRoleKind(contract.kind) &&
        countOrganizationRoleAlignedValues(contract.kind, keyPoints) < Math.min(2, keyPoints.length)) ||
      (isOrganizationRoleKind(contract.kind) &&
        keyPoints.some((point) => !organizationRoleTextSupportsContract(contract, point))) ||
      keyPoints.some((point) => looksUnsupportedOrganizationValueCase(contract, point)) ||
      keyPoints.some((point) => looksUnsupportedOrganizationValueToolDetail(contract, point)) ||
      keyPoints.some((point) => looksUnsupportedOrganizationOperationsToolStory(contract, point)) ||
      keyPoints.some((point) => looksMalformedCandidatePoint(point)) ||
      keyPoints.some((point) =>
        DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point)),
      ) ||
      keyPoints.some((point) =>
        organizationSpecificTechStackLooksUnsupported(input, contract, point),
      ) ||
      (sourceBackedSubject &&
        sourceBackedGroundingAnchors.length > 0 &&
        (contract.kind === "subject-detail" ||
          contract.kind === "subject-implication" ||
          contract.kind === "subject-takeaway") &&
        sourceGroundedKeyPointCount + sourceGroundedExampleCount < 2) ||
      (avoidDirectOrganizationPersona &&
        isOrganizationRoleKind(contract.kind) &&
        keyPoints.some((point) => usesDirectOrganizationPersona(point))) ||
      (contract.kind === "entity-value" &&
        contract.evidence &&
        evidenceAlignedKeyPointCount + evidenceAlignedExampleCount < 2) ||
      (contract.kind === "workshop-practice" &&
        (roleAlignedExampleCount === 0 ||
          (contract.evidence &&
            evidenceAlignedKeyPointCount + evidenceAlignedExampleCount === 0)));

    const nextTitle = titleNeedsRepair ? buildContractTitle(input, contract) : title;
    const learningGoal = toAudienceFacingLearningGoal(
      learningGoalNeedsRepair
        ? buildContractLearningGoal(input, contract)
        : learningGoalText,
    );
    const visuals =
      slide.visuals && typeof slide.visuals === "object"
        ? (slide.visuals as Record<string, unknown>)
        : {};
    const imagePrompt = `Editorial presentation visual about ${input.topic}: ${contract.focus}.`;
    const imageSlots = toRecordArray(visuals.imageSlots);
    const beginnerExplanationText =
      typeof slide.beginnerExplanation === "string"
        ? slide.beginnerExplanation.trim()
        : "";
    const beginnerExplanationNeedsRepair =
      beginnerExplanationText.length < 90 ||
      looksMalformedCandidatePoint(beginnerExplanationText) ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(beginnerExplanationText)) ||
      (avoidDirectOrganizationPersona &&
        isOrganizationRoleKind(contract.kind) &&
        usesDirectOrganizationPersona(beginnerExplanationText)) ||
      !hasMeaningfulAnchorOverlap(beginnerExplanationText, contractAnchor);
    const advancedExplanationText =
      typeof slide.advancedExplanation === "string"
        ? slide.advancedExplanation.trim()
        : "";
    const advancedExplanationNeedsRepair =
      !advancedExplanationText ||
      looksMalformedCandidatePoint(advancedExplanationText) ||
      DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(advancedExplanationText)) ||
      (avoidDirectOrganizationPersona &&
        isOrganizationRoleKind(contract.kind) &&
        usesDirectOrganizationPersona(advancedExplanationText)) ||
      !hasMeaningfulAnchorOverlap(advancedExplanationText, contractAnchor);
    const heroStatementText =
      typeof visuals.heroStatement === "string" ? visuals.heroStatement.trim() : "";
    const heroStatementNeedsRepair =
      index === 0 &&
      (!heroStatementText || !hasMeaningfulAnchorOverlap(heroStatementText, contractAnchor));
    const nextKeyPoints = keyPointsNeedRepair ? replacementPoints : keyPoints.slice(0, 4);
    const nextBeginnerExplanation = beginnerExplanationNeedsRepair
      ? replacementPoints.join(" ")
      : beginnerExplanationText;
    const nextAdvancedExplanation = advancedExplanationNeedsRepair
      ? isOrganizationRoleKind(contract.kind) &&
          !isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
        ? buildOrganizationRoleAdvancedExplanation(contract, input.topic)
        : replacementPoints.slice(1, 3).join(" ") ||
          replacementPoints[0] ||
          toAudienceFacingSentence(`${contract.focus} is one concrete part of ${input.topic}`)
      : advancedExplanationText;
    const roleReadyExampleEvidence =
      contract.evidence &&
      canUseAsSlidePoint(input, contract.evidence) &&
      !looksOverlyPromotionalSourceCopy(contract.evidence) &&
      (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(contract.evidence)) &&
      (!isOrganizationRoleKind(contract.kind) ||
        organizationRoleTextSupportsContract(contract, contract.evidence))
        ? contract.evidence
        : "";
    const nextExamples =
      contract.kind === "entity-value"
        ? uniqueNonEmptyStrings([
            roleReadyExampleEvidence,
            ...examples.filter((example) =>
              canUseAsSlideExample(input, example) &&
              organizationRoleTextSupportsContract(contract, example) &&
              (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(example)) &&
              !organizationSpecificTechStackLooksUnsupported(input, contract, example),
            ),
          ]).slice(0, 3)
        : contract.kind === "entity-operations"
          ? uniqueNonEmptyStrings([
              roleReadyExampleEvidence,
            ...examples.filter((example) =>
              canUseAsSlideExample(input, example) &&
              organizationRoleTextSupportsContract(contract, example) &&
              (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(example)) &&
              !organizationSpecificTechStackLooksUnsupported(input, contract, example),
            ),
          ]).slice(0, 2)
        : contract.kind === "workshop-practice"
          ? uniqueNonEmptyStrings([
              roleReadyExampleEvidence,
              contract.objective ?? "",
              ...examples.filter((example) => canUseAsSlideExample(input, example)),
            ]).slice(0, 3)
          : isOrganizationRoleKind(contract.kind)
            ? examples.filter(
                (example) =>
                  canUseAsSlideExample(input, example) &&
                  organizationRoleTextSupportsContract(contract, example) &&
                  (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(example)) &&
                  !organizationSpecificTechStackLooksUnsupported(input, contract, example),
              )
            : examples.filter((example) => canUseAsSlideExample(input, example));
    const contentNeedsVisualRefresh =
      titleNeedsRepair ||
      learningGoalNeedsRepair ||
      keyPointsNeedRepair ||
      beginnerExplanationNeedsRepair ||
      advancedExplanationNeedsRepair ||
      heroStatementNeedsRepair;
    const visualAnchor = [
      nextTitle || buildContractTitle(input, contract),
      learningGoal,
      ...nextKeyPoints,
      nextBeginnerExplanation,
      nextAdvancedExplanation,
    ]
      .join(" ")
      .trim();
    const visualsNeedRepair = shouldRefreshDerivedVisuals(visuals, visualAnchor);
    const nextVisuals = contentNeedsVisualRefresh
      || visualsNeedRepair
      ? deriveVisuals(
          {
            ...slide,
            title: nextTitle || buildContractTitle(input, contract),
            learningGoal,
            keyPoints: nextKeyPoints,
            examples: nextExamples,
            beginnerExplanation: nextBeginnerExplanation,
            advancedExplanation: nextAdvancedExplanation,
            visuals: {
              ...(typeof visuals.layoutTemplate === "string"
                ? { layoutTemplate: visuals.layoutTemplate }
                : {}),
              ...(typeof visuals.accentColor === "string"
                ? { accentColor: visuals.accentColor }
                : {}),
              ...(typeof visuals.imagePrompt === "string"
                ? { imagePrompt: visuals.imagePrompt }
                : {}),
              ...(Array.isArray(visuals.imageSlots)
                ? { imageSlots: visuals.imageSlots }
                : {}),
            },
          },
          {
            keyPoints: nextKeyPoints,
            examples: nextExamples,
            likelyQuestions: toStringArray(slide.likelyQuestions),
            order: index,
            totalSlides: slides.length,
            learningGoal,
            title: nextTitle || buildContractTitle(input, contract),
          },
        )
      : {
          ...visuals,
          ...(heroStatementNeedsRepair ? { heroStatement: replacementPoints[0] } : {}),
          imagePrompt:
            typeof visuals.imagePrompt === "string" && visuals.imagePrompt.trim().length > 0
              ? visuals.imagePrompt
              : imagePrompt,
          imageSlots:
            imageSlots.length > 0
              ? imageSlots.map((slot, imageIndex) => ({
                  ...slot,
                  id:
                    typeof slot.id === "string" && slot.id.trim().length > 0
                      ? slot.id
                      : `${String(slide.id ?? "slide")}-image-${imageIndex + 1}`,
                  prompt:
                    typeof slot.prompt === "string" && slot.prompt.trim().length > 0
                      ? slot.prompt
                      : imagePrompt,
                }))
              : [
                  {
                    id: `${String(slide.id ?? "slide")}-image-1`,
                    prompt: imagePrompt,
                    caption: contract.focus,
                    altText: `${input.topic} visual`,
                    style: "editorial",
                    tone: index === 0 ? "accent" : "neutral",
                  },
                ],
        };

    return {
      ...slide,
      title: nextTitle || buildContractTitle(input, contract),
      learningGoal,
      keyPoints: nextKeyPoints,
      examples: nextExamples,
      beginnerExplanation: nextBeginnerExplanation,
      advancedExplanation: nextAdvancedExplanation,
      visuals: nextVisuals,
    };
  });
};

export const normalizeDeck = (
  value: unknown,
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
    | "groundingSourceType"
    | "targetDurationMinutes"
    | "plan"
    | "targetSlideCount"
  >,
): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as Record<string, unknown>;
  const slides = Array.isArray(candidate.slides) ? candidate.slides : [];
  const topic = decodeHtmlEntities(input.topic).replace(/\s+/g, " ").trim();
  const candidateTitle =
    typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? decodeHtmlEntities(candidate.title)
      : "";
  const fallbackSourceIds = input.groundingSourceIds ?? [];
  const fallbackSourceType =
    input.groundingSourceType ??
    (fallbackSourceIds.length > 0 ? "mixed" : "topic");
  const now = new Date().toISOString();
  const sourceCandidate =
    candidate.source && typeof candidate.source === "object"
      ? (candidate.source as Record<string, unknown>)
      : null;
  const fallbackSlideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, slides.length || 4);

  const normalizedSlides = slides.map((slide, index) => {
    if (!slide || typeof slide !== "object") {
      return slide;
    }

    const slideCandidate = slide as Record<string, unknown>;
    const title =
      typeof slideCandidate.title === "string" && slideCandidate.title.trim().length > 0
        ? decodeHtmlEntities(slideCandidate.title).trim()
        : `Slide ${index + 1}`;
    const learningGoal = toAudienceFacingLearningGoal(
      typeof slideCandidate.learningGoal === "string" &&
      slideCandidate.learningGoal.trim().length > 0
        ? decodeHtmlEntities(slideCandidate.learningGoal).trim()
        : `${title} stays connected to ${topic}.`,
    );
    const keyPoints = toStringArray(slideCandidate.keyPoints);
    const inferredKeyPoints =
      keyPoints.length > 0
        ? keyPoints
        : [
            learningGoal,
            `Keep this slide connected to the main topic: ${topic}.`,
            "Use one concrete point that the audience can remember.",
          ];
    const requiredContext = toStringArray(slideCandidate.requiredContext);
    const speakerNotes = toStringArray(slideCandidate.speakerNotes);
    const examples = toStringArray(slideCandidate.examples);
    const likelyQuestions = toStringArray(slideCandidate.likelyQuestions);
    const dependenciesOnOtherSlides = toStringArray(
      slideCandidate.dependenciesOnOtherSlides,
    );
    const visualNotes = toStringArray(slideCandidate.visualNotes);
    const beginnerExplanation =
      typeof slideCandidate.beginnerExplanation === "string" &&
      slideCandidate.beginnerExplanation.trim().length > 0
        ? decodeHtmlEntities(slideCandidate.beginnerExplanation).trim()
        : inferredKeyPoints.slice(0, 2).join(" ");
    const advancedExplanation =
      typeof slideCandidate.advancedExplanation === "string" &&
      slideCandidate.advancedExplanation.trim().length > 0
        ? decodeHtmlEntities(slideCandidate.advancedExplanation).trim()
        : uniqueNonEmptyStrings([
            inferredKeyPoints[0] ?? "",
            inferredKeyPoints[1] ?? "",
            learningGoal,
          ])
            .slice(0, 2)
            .join(" ");

    return {
      ...slideCandidate,
      id:
        typeof slideCandidate.id === "string" && slideCandidate.id.trim().length > 0
          ? slideCandidate.id
          : createId("slide"),
      order: index,
      title,
      learningGoal,
      keyPoints: inferredKeyPoints,
      requiredContext,
      speakerNotes,
      beginnerExplanation,
      advancedExplanation,
      examples:
        examples.length > 0
          ? examples
          : inferredKeyPoints.slice(0, 1),
      likelyQuestions: likelyQuestions,
      canSkip:
        typeof slideCandidate.canSkip === "boolean"
          ? slideCandidate.canSkip
          : index === fallbackSlideCount - 1,
      dependenciesOnOtherSlides,
      visualNotes:
        visualNotes.length > 0
          ? visualNotes
          : ["Keep the visual tightly aligned with the visible slide claims."],
      visuals: deriveVisuals(slideCandidate, {
        keyPoints: inferredKeyPoints,
        examples: examples.length > 0 ? examples : inferredKeyPoints.slice(0, 1),
        likelyQuestions:
          likelyQuestions,
        order: index,
        totalSlides: slides.length || fallbackSlideCount,
        learningGoal,
        title,
      }),
    };
  });

  const shapedSlides = applyPlanDrivenDeckShape(normalizedSlides, input);

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id
        : createId("deck"),
    pedagogicalProfile: normalizePedagogicalProfile(candidate.pedagogicalProfile),
    title: normalizeDeckTitle(candidateTitle, input),
    topic,
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim().length > 0
        ? decodeHtmlEntities(candidate.summary)
        : `A coherent presentation about ${topic} built around a simple teaching arc.`,
    source:
      sourceCandidate
        ? {
            ...sourceCandidate,
            type: normalizeSourceType(sourceCandidate.type, fallbackSourceType),
            topic,
            // Never trust model-invented URLs. Only persist source ids that were
            // actually provided by the grounded research pipeline.
            sourceIds: fallbackSourceIds,
          }
        : {
            type: fallbackSourceType,
            topic,
            sourceIds: fallbackSourceIds,
          },
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? {
            estimatedDurationMinutes:
              typeof (candidate.metadata as Record<string, unknown>)
                .estimatedDurationMinutes === "number"
                ? (candidate.metadata as Record<string, unknown>)
                    .estimatedDurationMinutes
                : input.targetDurationMinutes ?? 6,
            tags: uniqueNonEmptyStrings([
              ...toStringArray(
                (candidate.metadata as Record<string, unknown>).tags,
              ),
              input.intent?.contentMode === "procedural" ? "procedural" : "",
            ]),
            language:
              typeof (candidate.metadata as Record<string, unknown>).language ===
              "string"
                ? (candidate.metadata as Record<string, unknown>).language
                : "en",
          }
        : {
            estimatedDurationMinutes: input.targetDurationMinutes ?? 6,
            tags: input.intent?.contentMode === "procedural" ? ["procedural"] : [],
            language: "en",
          },
    slides: shapedSlides,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : now,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
        ? candidate.updatedAt
        : now,
  };
};
