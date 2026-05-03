import type { GenerateDeckInput } from "@slidespeech/types";

import {
  DECK_SHAPE_SUMMARY_PATTERNS,
  hasMeaningfulAnchorOverlap,
  normalizeComparableText,
  shortenTitlePhrase,
  usesDirectOrganizationPersona,
} from "./deck-shape-text";
import {
  hasGroundedOrganizationValueCaseEvidence,
  isOrganizationRoleKind,
  organizationRoleSignalsAnotherRole,
  organizationRoleTextSupportsContract,
} from "./organization-role-contracts";
import {
  deriveSlideArcPolicy,
  framingImpliesOrientation,
  isWorkshopPresentation,
  resolveOrganizationDisplayName,
  resolveIntentSubject,
  usesOrganizationIdentity,
} from "./slide-arc-policy";
import {
  compactSourceBackedAnchor,
  isGenericOpeningFocus,
  looksDanglingSlidePhrase,
  pickContractText,
  compactGroundingHighlight,
  resolveSourceBackedCaseAnchor,
  sanitizeContractText,
  sourceBackedFocusEqualsSubject,
} from "./slide-contract-text";
import type { SlideContract } from "./slide-contract-types";
import {
  buildWorkshopPracticeLearningGoalText,
  lowerCaseFirstCharacter,
  resolveAudienceLabel,
} from "./workshop-text";

const proceduralOutcomeLabel = (subject: string): string => {
  const normalized = subject
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:how to\s+)?(?:make|making|prepare|preparing|cook|cooking|build|building|assemble|assembling)\s+(?:the\s+)?/i, "")
    .replace(/[.]+$/g, "")
    .trim();

  return normalized || subject;
};

const resolveHowWorksSubject = (subject: string): string | undefined => {
  const match = /^how\s+(.+?)\s+works$/i.exec(subject.trim());
  return match?.[1]?.trim() || undefined;
};

const isInterruptionAwareTeachingSubject = (subject: string): boolean =>
  /\binterruption/i.test(subject) &&
  /\b(?:ai\s+)?(?:teacher|teaching|tutor|tutoring)\b/i.test(subject);

const sourceBackedTitleLooksUsable = (value: string): boolean => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const tokenCount = trimmed.split(/\s+/).filter(Boolean).length;
  const sentenceLike =
    /\b(?:is|are|was|were|has|have|had|founded|opened|left|entered|provides?|delivers?|produces?)\b/i.test(
      trimmed,
    );

  return (
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    tokenCount <= 8 &&
    !/[.;:]/.test(trimmed) &&
    !looksDanglingSlidePhrase(trimmed) &&
    !(sentenceLike && tokenCount > 6)
  );
};

const sourceBackedOpeningIsBroadSubject = (
  contract: SlideContract,
  subject: string,
): boolean => {
  if (contract.index !== 0 || contract.kind !== "orientation") {
    return false;
  }

  const focus = sanitizeContractText(contract.focus, subject);
  const compactFocus = compactSourceBackedAnchor(focus, subject);
  return sourceBackedFocusEqualsSubject(focus, compactFocus, subject);
};

const sourceBackedAnchorLooksSentenceLike = (value: string): boolean => {
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  return (
    tokenCount >= 7 &&
    /\b(?:is|are|was|were|has|have|had|opened|founded|started|created|developed|released|aired|broadcast|became|reached|left|entered)\b/i.test(
      value,
    )
  );
};

const buildSourceBackedLearningGoal = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  contract: SlideContract,
  subject: string,
  focusAnchor: string | undefined,
): string | undefined => {
  const focus = pickContractText(
    input,
    contract.kind === "subject-takeaway"
      ? [contract.evidence ?? "", focusAnchor, contract.objective, contract.focus]
      : [contract.focus, contract.objective, focusAnchor],
    { preferConcrete: true },
  );
  const compactFocus = compactSourceBackedAnchor(focus, subject);
  const compactAnchor = focusAnchor
    ? compactSourceBackedAnchor(focusAnchor, subject)
    : "";
  const evidence = contract.evidence
    ? compactGroundingHighlight(contract.evidence, subject)
    : "";
  const objectiveText = contract.objective
    ? sanitizeContractText(contract.objective, subject)
    : "";
  const hasDistinctAnchor =
    compactAnchor.length > 0 &&
    normalizeComparableText(compactAnchor) !== normalizeComparableText(subject);

  if (contract.index === 0 && contract.kind === "orientation") {
    if (sourceBackedOpeningIsBroadSubject(contract, subject)) {
      if (!hasDistinctAnchor) {
        return `${subject} has a clear role, mechanism, and operating context.`;
      }

      return sourceBackedAnchorLooksSentenceLike(compactAnchor)
        ? `${subject} begins with a concrete origin story and a visible milestone.`
        : `${subject} is the environment where ${compactAnchor} unfolded through documented details.`;
    }

    if (
      compactFocus &&
      normalizeComparableText(compactFocus) !== normalizeComparableText(subject)
    ) {
      return `${compactFocus} gives ${subject} a specific starting point.`;
    }

    return hasDistinctAnchor
      ? `${compactAnchor} gives ${subject} a specific starting point.`
      : `${subject} starts with one supported fact, event, or role.`;
  }

  if (contract.kind === "subject-detail") {
    if (evidence && evidence.length <= 180) {
      return evidence;
    }

    return sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
      ? hasDistinctAnchor
        ? `${compactAnchor} is the named incident behind this part of ${subject}.`
        : `${subject} needs a named incident, mechanism, or source fact before interpretation.`
      : `${compactFocus} is the named incident or mechanism inside ${subject}.`;
  }

  if (contract.kind === "subject-implication") {
    if (
      objectiveText &&
      !/\b(?:consequence beyond the first|specific event|mechanism, or fact|strongest supported lesson)\b/i.test(
        objectiveText,
      )
    ) {
      return objectiveText.endsWith(".") ? objectiveText : `${objectiveText}.`;
    }

    return sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
      ? hasDistinctAnchor
        ? `${compactAnchor} reveals a broader consequence inside ${subject}.`
        : `${subject} matters through the consequence shown by the evidence.`
      : `${compactFocus} explains what changed after the first incident or fact.`;
  }

  if (contract.kind === "subject-takeaway") {
    if (
      evidence &&
      /\b(?:teach|lesson|showed|revealed|research|studied|because)\b/i.test(evidence)
    ) {
      return evidence;
    }

    if (hasDistinctAnchor && sourceBackedFocusEqualsSubject(focus, compactFocus, subject)) {
      return `${compactAnchor} shows what to carry forward about ${subject}.`;
    }

    if (!compactFocus || sourceBackedFocusEqualsSubject(focus, compactFocus, subject)) {
      return `${subject} ends with the lesson supported by the earlier evidence.`;
    }

    return `${compactFocus} connects the evidence to the main lesson about ${subject}.`;
  }

  return undefined;
};

export const buildContractTitle = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const sourceBackedArc = arcPolicy === "source-backed-subject";
  const entityName = usesOrganizationIdentity(input)
    ? resolveOrganizationDisplayName(input)
    : subject;
  const howWorksSubject = resolveHowWorksSubject(subject);
  const fallbackTitle = (() => {
    switch (contract.kind) {
      case "procedural-ingredients":
        return "Essential ingredients";
      case "procedural-steps":
        return "Key preparation steps";
      case "procedural-quality":
        return contract.isFinal
          ? "Final adjustments and serving"
          : "Taste, texture, and adjustment";
      case "subject-detail":
        return howWorksSubject
          ? isInterruptionAwareTeachingSubject(howWorksSubject)
            ? "The thread uses three signals"
            : "Inside the response loop"
          : "Concrete detail";
      case "subject-implication":
        return howWorksSubject
          ? isInterruptionAwareTeachingSubject(howWorksSubject)
            ? "The link uses shared terms"
            : "Answer and return path"
          : "Why it matters";
      case "subject-takeaway":
        if (sourceBackedArc) {
          return focusAnchor
            ? shortenTitlePhrase(`Why ${compactSourceBackedAnchor(focusAnchor, subject)} mattered`, 72)
            : shortenTitlePhrase(`Why ${subject} matters`, 72);
        }
        return howWorksSubject
          ? isInterruptionAwareTeachingSubject(howWorksSubject)
            ? "Resume from the next action"
            : "Trace the result"
          : "What to remember";
      case "entity-capabilities":
        return workshop ? "Role-based AI use cases" : "Core capabilities and focus areas";
      case "entity-operations":
        return workshop
          ? "Constraints and safe use"
          : arcPolicy === "organization-overview"
            ? "Where it operates and how it works"
            : "How it works in practice";
      case "entity-value":
        return hasGroundedOrganizationValueCaseEvidence(contract)
          ? "Customer outcome"
          : "Practical consequence";
      case "workshop-practice":
        return "Practical exercise";
      default:
        return "";
    }
  })();

  if (input.intent?.contentMode === "procedural" && contract.kind === "orientation") {
    const outcome = proceduralOutcomeLabel(subject)
      .replace(/^(?:perfect|ideal|best)\s+/i, "")
      .toLowerCase();
    if (
      /\b(?:salsa|dip|sauce|soup|salad|bread|cake|meal|dish|food|recipe|cook|bake|tomato|ingredient)\b/i.test(
        subject,
      )
    ) {
      return shortenTitlePhrase(`Bright, scoopable ${outcome}`, 72);
    }
    return shortenTitlePhrase(`Finished ${outcome} target`, 72);
  }
  if (contract.kind === "procedural-ingredients") {
    return "Essential ingredients";
  }
  if (contract.kind === "procedural-steps") {
    return "Key preparation steps";
  }
  if (contract.kind === "procedural-quality") {
    return contract.isFinal
      ? "Final adjustments and serving"
      : "Taste, texture, and adjustment";
  }
  if (contract.kind === "workshop-practice") {
    return fallbackTitle || "Practical exercise";
  }
  if (arcPolicy === "organization-overview" && contract.kind === "entity-value") {
    return fallbackTitle || "Practical consequence";
  }
  if (contract.index === 0) {
    if (howWorksSubject) {
      return isInterruptionAwareTeachingSubject(howWorksSubject)
        ? "Interruption-aware AI teacher"
        : "The starting situation";
    }

    const organizationOpeningTitle =
      arcPolicy === "organization-overview" && usesOrganizationIdentity(input)
        ? workshop
          ? `${entityName}: checked AI drafts in daily work`
          : entityName
        : "";
    if (organizationOpeningTitle && workshop) {
      return shortenTitlePhrase(organizationOpeningTitle, 72);
    }
    const sourceBackedBroadIntroObjective =
      sourceBackedArc && sourceBackedOpeningIsBroadSubject(contract, subject);
    const focus = pickContractText(
      input,
      sourceBackedBroadIntroObjective
        ? [contract.focus, focusAnchor]
        : [contract.objective, contract.focus, focusAnchor],
      { preferConcrete: true },
    );
    if (sourceBackedArc && focus) {
      const compactFocus = compactSourceBackedAnchor(focus, subject);
      if (sourceBackedTitleLooksUsable(compactFocus)) {
        return normalizeComparableText(compactFocus) === normalizeComparableText(subject)
          ? compactFocus
          : shortenTitlePhrase(`${subject}: ${compactFocus}`, 72);
      }
    }
    if (
      focus &&
      !isGenericOpeningFocus(subject, focus) &&
      focus.length <= 72 &&
      !/[.?!]/.test(focus)
    ) {
      if (
        organizationOpeningTitle &&
        workshop &&
        normalizeComparableText(focus) !== normalizeComparableText(entityName) &&
        !normalizeComparableText(focus).includes(normalizeComparableText(entityName))
      ) {
        return shortenTitlePhrase(`${entityName}: ${focus}`, 72);
      }
      return shortenTitlePhrase(focus, 72);
    }

    if (sourceBackedArc && focusAnchor) {
      const fallbackFocus = compactSourceBackedAnchor(focusAnchor, subject);
      if (sourceBackedTitleLooksUsable(fallbackFocus)) {
        return normalizeComparableText(fallbackFocus) === normalizeComparableText(subject)
          ? fallbackFocus
          : shortenTitlePhrase(`${subject}: ${fallbackFocus}`, 72);
      }
    }

    return organizationOpeningTitle || shortenTitlePhrase(subject, 72);
  }

  if (
    arcPolicy === "organization-overview" &&
    isOrganizationRoleKind(contract.kind) &&
    !workshop
  ) {
    return fallbackTitle || `Slide ${contract.index + 1}`;
  }

  const preferredSource = (() => {
    const focus = sanitizeContractText(contract.focus, subject);
    const objective = contract.objective
      ? sanitizeContractText(contract.objective, subject)
      : "";
    const evidence = contract.evidence
      ? sanitizeContractText(contract.evidence, subject)
      : "";

    if (
      arcPolicy === "organization-overview" &&
      contract.kind === "entity-value" &&
      evidence &&
      !organizationRoleSignalsAnotherRole(contract.kind, evidence)
    ) {
      return evidence;
    }

    if (
      objective &&
      (DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(focus)) ||
        focus.length > 84)
    ) {
      return objective;
    }

    return focus || objective;
  })();

  if (
    howWorksSubject &&
    (contract.kind === "subject-detail" ||
      contract.kind === "subject-implication" ||
      contract.kind === "subject-takeaway")
  ) {
    return fallbackTitle || `Slide ${contract.index + 1}`;
  }

  if (
    sourceBackedArc &&
    contract.kind === "subject-takeaway" &&
    /\b(?:audience should remember|practical takeaway)\b/i.test(preferredSource)
  ) {
    return fallbackTitle || "Key takeaway";
  }

  const roleReadyPreferredSource =
    arcPolicy === "organization-overview" &&
    isOrganizationRoleKind(contract.kind) &&
    (!organizationRoleTextSupportsContract(contract, preferredSource) ||
      (!workshop && usesDirectOrganizationPersona(preferredSource)))
      ? ""
      : preferredSource;
  const trimmed = shortenTitlePhrase(roleReadyPreferredSource);
  if (!trimmed) {
    return fallbackTitle || `Slide ${contract.index + 1}`;
  }

  if (
    sourceBackedArc &&
    (roleReadyPreferredSource.length > trimmed.length ||
      looksDanglingSlidePhrase(trimmed) ||
      !sourceBackedTitleLooksUsable(trimmed))
  ) {
    return fallbackTitle || `Slide ${contract.index + 1}`;
  }

  if (/(?:,?\s*(?:and|or))$/i.test(trimmed)) {
    return fallbackTitle || shortenTitlePhrase(trimmed.replace(/(?:,?\s*(?:and|or))$/i, "").trim(), 72);
  }

  const topicPrefixPattern = new RegExp(
    `^${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`,
    "i",
  );
  const withoutTopicPrefix = trimmed.replace(topicPrefixPattern, "").trim() || trimmed;
  const normalized =
    withoutTopicPrefix.charAt(0).toUpperCase() + withoutTopicPrefix.slice(1);

  if (normalized.length <= 72 && !/[.?!]/.test(normalized)) {
    return normalized;
  }

  return fallbackTitle || shortenTitlePhrase(normalized, 72);
};

export const buildContractLearningGoal = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const organizationArc = arcPolicy === "organization-overview";
  const sourceBackedArc = arcPolicy === "source-backed-subject";
  const entityName =
    usesOrganizationIdentity(input)
      ? resolveOrganizationDisplayName(input)
      : subject;
  const audienceLabel = resolveAudienceLabel(input);
  const howWorksSubject = resolveHowWorksSubject(subject);
  const orientationFraming = framingImpliesOrientation(input as Pick<
    GenerateDeckInput,
    "presentationBrief" | "intent"
  >);
  const proceduralOutcome = proceduralOutcomeLabel(subject).toLowerCase();
  const displayProceduralOutcome = proceduralOutcome
    .replace(/^(?:perfect|ideal|best)\s+/i, "")
    .trim() || proceduralOutcome;
  const foodLikeProcedural =
    input.intent?.contentMode === "procedural" &&
    /\b(?:salsa|dip|sauce|soup|salad|bread|cake|meal|dish|food|recipe|cook|bake|tomato|ingredient)\b/i.test(
      subject,
    );
  if (contract.index === 0 && howWorksSubject) {
    return isInterruptionAwareTeachingSubject(howWorksSubject)
      ? `An interruption-aware AI teacher answers side questions without abandoning the lesson path.`
      : `See the starting situation, the internal change, and the visible result.`;
  }
  if (
    input.intent?.contentMode === "procedural" &&
    contract.index === 0 &&
    contract.kind === "orientation"
  ) {
    if (foodLikeProcedural) {
      return `A good ${displayProceduralOutcome} has fresh flavor, controlled heat, and a texture that works with the way it will be served.`;
    }
    return `Define what a good result should taste, feel, or do before the steps begin.`;
  }
  if (contract.index === 0 && organizationArc) {
    if (workshop && usesOrganizationIdentity(input)) {
      return `AI tools help daily work when raw notes, requirements, risks, or defects become checked first drafts.`;
    }
    return orientationFraming
      ? `${entityName} supports software quality through QA work, operating footprint, services, and delivery model.`
      : `${entityName} supports software quality through QA services, regional presence, and delivery collaboration.`;
  }
  if (
    contract.index === 0 &&
    sourceBackedArc &&
    sourceBackedOpeningIsBroadSubject(contract, subject)
  ) {
    return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
      `${subject} starts with one supported fact, event, or role.`;
  }
  if (contract.kind === "procedural-ingredients") {
    if (foodLikeProcedural) {
      return `Choose the tomato base, crunch, heat, acid, and seasoning roles before mixing.`;
    }
    return `Select starting ingredients or materials with clear roles in the final result.`;
  }
  if (contract.kind === "procedural-steps") {
    if (foodLikeProcedural) {
      return `Dice, fold, and taste in stages so texture and seasoning stay controllable.`;
    }
    return `Prepare the ingredients in an order that keeps texture, moisture, and seasoning controlled.`;
  }
  if (contract.kind === "procedural-quality") {
    if (foodLikeProcedural) {
      return contract.isFinal
        ? `Use final taste and texture checks to decide what to adjust before serving.`
        : `Taste and adjust one issue at a time before the final serving check.`;
    }
    return contract.isFinal
      ? `Confirm the result is balanced, cohesive, and ready to serve.`
      : `Taste and adjust one issue at a time before the final serving check.`;
  }
  if (contract.kind === "subject-detail") {
    const focus = pickContractText(
      input,
      [contract.focus, contract.objective],
      { preferConcrete: true },
    );
    const compactFocus =
      arcPolicy === "source-backed-subject"
        ? compactSourceBackedAnchor(focus, subject)
        : focus;
    if (howWorksSubject) {
      return isInterruptionAwareTeachingSubject(howWorksSubject)
        ? `The teacher tracks the active concept, unfinished step, and new question as one lesson thread.`
        : `See how the internal loop turns the starting situation into a response.`;
    }
    if (sourceBackedArc) {
      return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
        `${compactFocus} shows one specific part of ${subject}.`;
    }
    return sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
      ? `See one concrete detail that defines ${subject}.`
      : `See the concrete role of ${lowerCaseFirstCharacter(compactFocus)} within ${subject}.`;
  }
  if (contract.kind === "subject-implication") {
    const focus = pickContractText(
      input,
      [contract.focus, contract.objective],
      { preferConcrete: true },
    );
    const compactFocus =
      arcPolicy === "source-backed-subject"
        ? compactSourceBackedAnchor(focus, subject)
        : focus;
    const implicationVerb = /\b(?:components|layers|loops|systems)\b/i.test(
      compactFocus,
    )
      ? "matter"
      : "matters";
    if (howWorksSubject) {
      return isInterruptionAwareTeachingSubject(howWorksSubject)
        ? `The side answer reuses the lesson's terms so the return sentence feels connected.`
        : `See how the mechanism shapes the next response and return path.`;
    }
    if (sourceBackedArc) {
      return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
        `${compactFocus} explains a consequence inside ${subject}.`;
    }
    return sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
      ? `See why ${subject} matters and what it reveals.`
      : `See why ${lowerCaseFirstCharacter(compactFocus)} ${implicationVerb} within ${subject}.`;
  }
  if (contract.kind === "subject-takeaway") {
    const focus = pickContractText(
      input,
      [contract.focus, contract.objective],
      { preferConcrete: true },
    );
    const compactFocus =
      arcPolicy === "source-backed-subject"
        ? compactSourceBackedAnchor(focus, subject)
        : focus;
    if (howWorksSubject) {
      return isInterruptionAwareTeachingSubject(howWorksSubject)
        ? `The learner gets the side answer and can continue the same task without restarting.`
        : `Summarize how to recognize whether the mechanism produced a traceable result.`;
    }
    if (sourceBackedArc) {
      return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
        `${subject} ends with the strongest supported lesson.`;
    }
    return sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
      ? `Summarize the strongest takeaway from ${subject}.`
      : /\b(?:lesson|matters?|takeaway)\b/i.test(compactFocus)
        ? `Summarize the final takeaway from ${subject}.`
        : `Explain what ${lowerCaseFirstCharacter(compactFocus)} teaches about ${subject}.`;
  }
  if (contract.kind === "entity-capabilities") {
    if (organizationArc) {
      return workshop
        ? audienceLabel
          ? `AI produces different draft artifacts for ${audienceLabel}: status notes, backlog material, and test ideas.`
          : `AI produces different draft artifacts for planning, backlog, and testing work.`
        : `${subject} provides QA services, advisory support, workshops, and automation capabilities.`;
    }
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See what ${subject} does and which capabilities define it.`
      : `See how ${lowerCaseFirstCharacter(focus)} shows what ${subject} offers.`;
  }
  if (contract.kind === "entity-operations") {
    if (organizationArc) {
      return workshop
        ? `Source checks, data sensitivity, and human review decide what AI-assisted work can be shared.`
        : `${subject} operates through delivery collaboration, QA specialists, and regional presence.`;
    }
    const focus = pickContractText(
      input,
      [contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `See how ${subject} works in practice.`
      : `See how ${lowerCaseFirstCharacter(focus)} shows how ${subject} works in practice.`;
  }
  if (contract.kind === "entity-value") {
    if (organizationArc) {
      return hasGroundedOrganizationValueCaseEvidence(contract)
        ? `Explain how one concrete customer outcome shows where ${subject} creates value.`
        : `Early risk identification and data-flow validation show where ${subject} creates value.`;
    }
    const focus = pickContractText(
      input,
      [contract.evidence ?? "", contract.objective, contract.focus],
      { preferConcrete: true },
    );
    return normalizeComparableText(focus) === normalizeComparableText(subject)
      ? `Explain one concrete example of how ${subject} creates value.`
      : `Explain how ${lowerCaseFirstCharacter(focus)} shows where ${subject} creates value.`;
  }
  if (contract.kind === "workshop-practice") {
    return buildWorkshopPracticeLearningGoalText(input);
  }
  const focus = pickContractText(
    input,
    [contract.objective, contract.focus],
    { preferConcrete: true },
  );
  if (contract.index === 0) {
    if (focus && !isGenericOpeningFocus(subject, focus)) {
      if (arcPolicy === "source-backed-subject") {
        const compactFocus = compactSourceBackedAnchor(focus, subject);
        return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
          (sourceBackedFocusEqualsSubject(focus, compactFocus, subject)
            ? `${subject} starts with one supported fact, event, or role.`
            : `${compactFocus} gives ${subject} a specific starting point.`);
      }
      return hasMeaningfulAnchorOverlap(focus, subject)
        ? `See ${lowerCaseFirstCharacter(focus)} and why it matters.`
        : `See how ${lowerCaseFirstCharacter(focus)} matters within ${subject}.`;
    }

    if (arcPolicy === "source-backed-subject" && focusAnchor) {
      return buildSourceBackedLearningGoal(input, contract, subject, focusAnchor) ??
        `${compactSourceBackedAnchor(focusAnchor, subject)} gives ${subject} a specific starting point.`;
    }

    return `See what ${subject} is, why it matters, and one concrete way to recognize it.`;
  }
  if (!focus) {
    return `See one concrete part of ${subject}.`;
  }

  if (
    focus.toLowerCase().includes(subject.toLowerCase()) ||
    /^(?:how|why|what|when|where|who)\b/i.test(focus)
  ) {
    return `See ${lowerCaseFirstCharacter(focus)}.`;
  }

  return hasMeaningfulAnchorOverlap(focus, subject)
    ? `See how ${lowerCaseFirstCharacter(focus)} shapes ${subject}.`
    : `See how ${lowerCaseFirstCharacter(focus)} fits within ${subject}.`;
};
