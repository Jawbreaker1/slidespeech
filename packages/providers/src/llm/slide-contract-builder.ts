import type { GenerateDeckInput } from "@slidespeech/types";

import {
  countAnchorOverlap,
  DECK_SHAPE_INSTRUCTIONAL_PATTERNS,
  DECK_SHAPE_META_PATTERNS,
  contractTextSimilarity,
  hasMeaningfulAnchorOverlap,
  looksOverlyPromotionalSourceCopy,
  normalizeComparableText,
  toAudienceFacingSentence,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import { organizationRoleSeedTextSupports } from "./organization-role-contracts";
import { extractCoverageRequirements } from "./prompt-shaping";
import {
  deriveSlideArcPolicy,
  framingImpliesOrientation,
  isWorkshopPresentation,
  resolveIntentSubject,
  resolveOrganizationDisplayName,
  usesOrganizationIdentity,
} from "./slide-arc-policy";
import {
  buildSlideContractKinds,
  buildSlideContractLabel,
  contractRequiresEvidence,
  contractSeedPriorities,
  openingSeedPriorities,
} from "./slide-contract-rules";
import {
  NON_SLIDEABLE_COVERAGE_PATTERNS,
  compactGroundingHighlight,
  isGenericOpeningFocus,
  isOrientationCoverageAnchor,
  pickContractText,
  resolveSourceBackedCaseAnchor,
  sanitizeContractText,
  shouldLeadWithGroundingHighlight,
} from "./slide-contract-text";
import type {
  ArcPolicyInput,
  ContractSeed,
  ContractSeedSource,
  SlideContract,
} from "./slide-contract-types";
import {
  looksLikeWorkshopBriefEcho,
  lowerCaseFirstCharacter,
  resolveAudienceLabel,
  subjectToActionPhrase,
  subjectToWorkshopNounPhrase,
} from "./workshop-text";

const pickOpeningFocus = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  openingHighlight?: string,
): string => {
  const subject = resolveIntentSubject(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const useSourceBackedCaseOpening = sourceBackedOpeningShouldLeadWithCase(input);
  const focusAnchor =
    arcPolicy === "source-backed-subject" && !useSourceBackedCaseOpening
      ? undefined
      : resolveSourceBackedCaseAnchor(input);
  const entityName =
    usesOrganizationIdentity(input)
      ? resolveOrganizationDisplayName(input)
      : subject;
  const explicitCoverageRequirements = uniqueNonEmptyStrings(
    (input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""))
      .map((requirement) => sanitizeContractText(requirement, subject)),
  ).filter((value) => !isGenericOpeningFocus(subject, value));
  const coverageGoals = uniqueNonEmptyStrings(
    (input.groundingCoverageGoals ?? []).map((goal) =>
      sanitizeContractText(goal, subject),
    ),
  ).filter((value) => !isGenericOpeningFocus(subject, value));
  const learningObjectives = uniqueNonEmptyStrings(input.plan?.learningObjectives ?? []).filter(
    (value) => !isGenericOpeningFocus(subject, value),
  );
  const presentationGoal = input.intent?.presentationGoal
    ? sanitizeContractText(input.intent.presentationGoal, subject)
    : "";
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const orientationFraming = framingImpliesOrientation(input);
  const howWorksSubject = resolveHowWorksSubject(subject);
  if (
    howWorksSubject &&
    arcPolicy !== "source-backed-subject" &&
    arcPolicy !== "organization-overview"
  ) {
    return `The starting situation for ${howWorksSubject}`;
  }
  const workshopNounPhrase = subjectToWorkshopNounPhrase(subject);
  const highlight = openingHighlight ? compactGroundingHighlight(openingHighlight, subject) : "";
  const openingAnchors = [explicitCoverageRequirements[0], coverageGoals[0], learningObjectives[0]];
  const leadingHighlight = shouldLeadWithGroundingHighlight(subject, highlight, openingAnchors)
    ? highlight
    : undefined;
  const workshopOpeningAnchor = workshop
    ? pickContractText(
        input,
        [
          `${entityName}: reviewable drafts for ${workshopNounPhrase}`,
          `Reviewable outputs before shared daily work`,
          input.plan?.learningObjectives?.[0],
          input.intent?.presentationGoal,
          input.plan?.storyline?.[0],
          subject,
        ],
        { preferConcrete: true },
      )
    : undefined;
  if (organizationArc && !workshop && orientationFraming) {
    return `Who ${entityName} is`;
  }
  const candidate = pickContractText(
    input,
    arcPolicy === "source-backed-subject"
      ? useSourceBackedCaseOpening
        ? [
            focusAnchor,
            explicitCoverageRequirements[0],
            coverageGoals[0],
            leadingHighlight,
            highlight,
            learningObjectives[0],
            input.plan?.storyline?.[0],
            presentationGoal,
            subject,
          ]
        : [
            subject,
            presentationGoal,
            learningObjectives[0],
            input.plan?.storyline?.[0],
          ]
      : arcPolicy === "organization-overview"
        ? workshop
          ? [
              workshopOpeningAnchor,
              learningObjectives[0],
              input.plan?.storyline?.[0],
              presentationGoal,
              subject,
              explicitCoverageRequirements[0],
              leadingHighlight,
            ]
          : [
              `Who ${entityName} is`,
              input.plan?.learningObjectives?.[0],
              input.plan?.storyline?.[0],
              presentationGoal,
              subject,
              explicitCoverageRequirements[0],
              coverageGoals[0],
              leadingHighlight,
              highlight,
            ]
      : [
          leadingHighlight,
          explicitCoverageRequirements[0],
          coverageGoals[0],
          learningObjectives[0],
          presentationGoal,
          usesOrganizationIdentity(input)
            ? `What ${entityName} does and why it matters`
            : undefined,
          highlight,
          subject,
          `What ${subject} is and why it matters`,
        ],
    { preferConcrete: true },
  );

  return candidate || subject;
};

const pickOpeningObjective = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  openingHighlight?: string,
): string | undefined => {
  const subject = resolveIntentSubject(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const useSourceBackedCaseOpening = sourceBackedOpeningShouldLeadWithCase(input);
  const focusAnchor =
    arcPolicy === "source-backed-subject" && !useSourceBackedCaseOpening
      ? undefined
      : resolveSourceBackedCaseAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const entityName =
    usesOrganizationIdentity(input)
      ? resolveOrganizationDisplayName(input)
      : subject;
  const orientationFraming = framingImpliesOrientation(input);
  const howWorksSubject = resolveHowWorksSubject(subject);
  if (
    howWorksSubject &&
    arcPolicy !== "source-backed-subject" &&
    arcPolicy !== "organization-overview"
  ) {
    return isInterruptionAwareTeachingSubject(howWorksSubject)
      ? `A learner interruption creates a pause that the teacher answers without losing the lesson`
      : `The starting situation before the mechanism changes the response`;
  }
  if (arcPolicy === "source-backed-subject" && !useSourceBackedCaseOpening) {
    return undefined;
  }
  if (arcPolicy === "organization-overview" && !workshop) {
    return orientationFraming
      ? `${entityName} is a QA specialist organization with a visible operating footprint, delivery model, and service portfolio`
      : `${entityName} operates through QA services, delivery collaboration, and software quality outcomes`;
  }
  if (arcPolicy === "organization-overview" && workshop) {
    const workshopNounPhrase = subjectToWorkshopNounPhrase(subject);
    return `${entityName} teams keep ${workshopNounPhrase} tied to real planning, backlog, testing, and review work`;
  }
  const candidate = pickContractText(
    input,
    arcPolicy === "source-backed-subject"
      ? [
          focusAnchor,
          input.groundingCoverageGoals?.[0],
          input.plan?.learningObjectives?.[0],
          input.plan?.storyline?.[0],
          openingHighlight,
          input.intent?.presentationGoal,
        ]
      : arcPolicy === "organization-overview" && workshop
        ? [
            input.plan?.learningObjectives?.[0],
            input.intent?.presentationGoal,
            input.plan?.storyline?.[0],
            input.intent?.coverageRequirements?.[0],
          ]
        : arcPolicy === "organization-overview"
          ? [
              input.plan?.learningObjectives?.[0],
              input.plan?.storyline?.[0],
              input.intent?.presentationGoal,
              input.intent?.coverageRequirements?.[0],
              input.groundingCoverageGoals?.[0],
            ]
      : [
          input.intent?.presentationGoal,
          input.intent?.activityRequirement,
          input.plan?.learningObjectives?.[0],
          openingHighlight,
          ...(input.intent?.coverageRequirements ?? []),
          ...(input.groundingCoverageGoals ?? []),
        ],
    { preferConcrete: true },
  );

  const normalized = candidate ? sanitizeContractText(candidate, subject) : "";
  return normalized || undefined;
};

const buildContractSeeds = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): ContractSeed[] => {
  const subject = resolveIntentSubject(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const seeds: ContractSeed[] = [];
  const seen = new Set<string>();
  const derivedFocusAnchor = resolveSourceBackedCaseAnchor(input);

  const addSeeds = (
    source: ContractSeedSource,
    values: string[],
    normalize: (value: string) => string = (value) => sanitizeContractText(value, subject),
  ) => {
    values.forEach((value, order) => {
      const normalized = normalize(value);
      if (
        !normalized ||
        (workshop && looksLikeWorkshopBriefEcho(normalized)) ||
        isOrientationCoverageAnchor(subject, normalized) ||
        NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        looksOverlyPromotionalSourceCopy(normalized)
      ) {
        return;
      }

      const key = normalizeComparableText(normalized);
      if (!normalized || seen.has(key)) {
        return;
      }

      seen.add(key);
      seeds.push({
        id: `${source}:${order}:${key}`,
        text: normalized,
        source,
        order,
      });
    });
  };

  if (derivedFocusAnchor) {
    addSeeds("focusAnchor", [derivedFocusAnchor]);
  }
  if (input.intent?.presentationGoal) {
    addSeeds("presentationGoal", [input.intent.presentationGoal]);
  }
  addSeeds(
    "coverageRequirement",
    input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? ""),
  );
  addSeeds("coverageGoal", input.groundingCoverageGoals ?? []);
  addSeeds("learningObjective", input.plan?.learningObjectives ?? []);
  addSeeds("storyline", input.plan?.storyline ?? []);
  addSeeds(
    "groundingHighlight",
    (input.groundingHighlights ?? []).map((highlight) =>
      compactGroundingHighlight(highlight, subject),
    ),
    (value) => value,
  );
  if (input.intent?.activityRequirement) {
    addSeeds("activityRequirement", [input.intent.activityRequirement]);
  }

  return seeds;
};

const WORKSHOP_PRACTICE_CONCRETE_PATTERNS = [
  /\bworkflow\b/i,
  /\bmeeting notes\b/i,
  /\baction items?\b/i,
  /\brisk lists?\b/i,
  /\brequirement clarifications?\b/i,
  /\bscenario(?:s)?\b/i,
  /\bexercise\b/i,
  /\btask\b/i,
  /\boutput\b/i,
  /\bdecision\b/i,
  /\breview\b/i,
  /\bdraft\b/i,
  /\bprompt\b/i,
  /\bchecklist\b/i,
];

const WORKSHOP_PRACTICE_ARTIFACT_PATTERNS = [
  /\bmeeting notes?\b/i,
  /\baction items?\b/i,
  /\brisk lists?\b/i,
  /\bbacklog\b/i,
  /\brequirements?\b/i,
  /\btest scenarios?\b/i,
  /\bcoverage questions?\b/i,
  /\bdraft\b/i,
  /\bprompt\b/i,
  /\bchecklist\b/i,
];

const pickWorkshopPracticeEvidence = (
  input: Pick<
    GenerateDeckInput,
    "intent" | "groundingHighlights" | "groundingCoverageGoals" | "plan" | "topic"
  >,
  focus: string,
  objective: string,
  fallbackEvidence: string | undefined,
): string | undefined => {
  const subject = resolveIntentSubject(input as Pick<GenerateDeckInput, "topic" | "intent">);
  const candidates = uniqueNonEmptyStrings([
    input.intent?.activityRequirement ?? "",
    ...(input.groundingHighlights ?? []),
    ...(input.groundingCoverageGoals ?? []),
    ...(input.plan?.learningObjectives ?? []),
    fallbackEvidence ?? "",
  ]).filter(
    (value) =>
      value.length >= 24 &&
      !looksLikeWorkshopBriefEcho(value) &&
      WORKSHOP_PRACTICE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
  );

  const ranked = candidates
    .map((value, index) => ({
      value,
      index,
      score:
        (WORKSHOP_PRACTICE_CONCRETE_PATTERNS.some((pattern) => pattern.test(value))
          ? 6
          : 0) +
        countAnchorOverlap(value, `${focus} ${objective} ${subject}`) * 2 +
        (hasMeaningfulAnchorOverlap(value, `${focus} ${objective}`) ? 3 : 0),
    }))
    .sort((left, right) =>
      left.score === right.score ? left.index - right.index : right.score - left.score,
    );

  return ranked[0]?.value;
};

const toParticipantActivitySentence = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!normalized) {
    return "";
  }

  if (
    /^(?:map|draft|review|summarize|create|write|choose|select|use|identify|compare|refine|generate)\b/i.test(
      normalized,
    )
  ) {
    return toAudienceFacingSentence(
      `Participants ${lowerCaseFirstCharacter(normalized)}`,
    );
  }

  return toAudienceFacingSentence(normalized);
};

export const buildWorkshopPracticeRecoveryPoints = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
): string[] => {
  const subject = resolveIntentSubject(input);
  const activity =
    [
      input.intent?.activityRequirement,
      contract.evidence,
      contract.objective,
      contract.focus,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => sanitizeContractText(value, subject))
      .find(
        (value) =>
          value.length > 0 &&
          !looksLikeWorkshopBriefEcho(value) &&
          !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) =>
            pattern.test(value),
          ),
      ) ?? "";
  const actionPhrase = subjectToActionPhrase(subject);

  return uniqueNonEmptyStrings([
    activity ? toParticipantActivitySentence(activity) : "",
    toAudienceFacingSentence(
      `The exercise has three steps: select one meeting note, backlog item, risk list, or test scenario; ask for one reviewable draft; review it before sharing`,
    ),
    toAudienceFacingSentence(
      `The review checks factual accuracy, missing context, sensitive information, and whether the draft fits the team's rules`,
    ),
    toAudienceFacingSentence(
      `The reusable result is one task-specific prompt, output, or review checklist for how to ${actionPhrase}`,
    ),
  ]).slice(0, 3);
};

const selectDistinctContractSeed = (options: {
  seeds: ContractSeed[];
  usedSeedIds: Set<string>;
  usedTexts: string[];
  preferredSources: ContractSeedSource[];
  fallbackSources?: ContractSeedSource[];
}): ContractSeed | undefined => {
  const fallbackSources = options.fallbackSources ?? options.preferredSources;
  const allowedSources = new Set([...options.preferredSources, ...fallbackSources]);
  const sourceRank = new Map<ContractSeedSource, number>();

  options.preferredSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, index);
    }
  });
  fallbackSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, options.preferredSources.length + index);
    }
  });

  const ranked = options.seeds
    .filter((seed) => !options.usedSeedIds.has(seed.id) && allowedSources.has(seed.source))
    .map((seed) => {
      const similarity = options.usedTexts.reduce(
        (max, usedText) => Math.max(max, contractTextSimilarity(seed.text, usedText)),
        0,
      );
      const distinctnessBucket =
        seed.source === "focusAnchor"
          ? 0
          : similarity >= 0.72
            ? 2
            : similarity >= 0.58
              ? 1
              : 0;
      const specificity = tokenizeDeckShapeText(seed.text).length;
      return {
        seed,
        distinctnessBucket,
        sourceOrder: sourceRank.get(seed.source) ?? Number.MAX_SAFE_INTEGER,
        specificity,
        similarity,
      };
    })
    .sort((left, right) => {
      if (left.distinctnessBucket !== right.distinctnessBucket) {
        return left.distinctnessBucket - right.distinctnessBucket;
      }
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }
      if (left.specificity !== right.specificity) {
        return right.specificity - left.specificity;
      }
      if (left.similarity !== right.similarity) {
        return left.similarity - right.similarity;
      }
      return left.seed.order - right.seed.order;
    });

  return ranked[0]?.seed;
};

const selectAlignedContractSeed = (options: {
  seeds: ContractSeed[];
  usedSeedIds: Set<string>;
  preferredSources: ContractSeedSource[];
  referenceTexts: string[];
}): ContractSeed | undefined => {
  const allowedSources = new Set(options.preferredSources);
  const sourceRank = new Map<ContractSeedSource, number>();
  options.preferredSources.forEach((source, index) => {
    if (!sourceRank.has(source)) {
      sourceRank.set(source, index);
    }
  });

  const ranked = options.seeds
    .filter((seed) => !options.usedSeedIds.has(seed.id) && allowedSources.has(seed.source))
    .map((seed) => {
      const alignment = options.referenceTexts.reduce(
        (max, reference) =>
          Math.max(
            max,
            countAnchorOverlap(seed.text, reference) * 2 +
              (hasMeaningfulAnchorOverlap(seed.text, reference) ? 3 : 0),
          ),
        0,
      );
      const specificity = tokenizeDeckShapeText(seed.text).length;
      return {
        seed,
        alignment,
        specificity,
        sourceOrder: sourceRank.get(seed.source) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.alignment !== right.alignment) {
        return right.alignment - left.alignment;
      }
      if (left.sourceOrder !== right.sourceOrder) {
        return left.sourceOrder - right.sourceOrder;
      }
      return right.specificity - left.specificity;
    });

  return ranked[0]?.seed;
};

const seedAlignsToReferenceTexts = (
  value: string,
  referenceTexts: string[],
): boolean =>
  referenceTexts.some(
    (reference) => countAnchorOverlap(value, reference) >= 2,
  );

const candidateIsDistinctFromRecent = (
  value: string | undefined,
  usedTexts: string[],
): boolean => {
  if (!value) {
    return false;
  }

  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  return usedTexts
    .slice(-4)
    .every(
      (usedText) =>
        normalizeComparableText(usedText) !== normalized &&
        contractTextSimilarity(value, usedText) < 0.72,
    );
};

const looksGenericContractPlanStep = (value: string | undefined): boolean => {
  const normalized = normalizeComparableText(value ?? "")
    .replace(/^(?:understand|explain|show|describe|summarize|see)\s+/, "")
    .replace(/^(?:how|why|what)\s+/, "");
  return (
    normalized === "it matters" ||
    normalized === "why it matters" ||
    normalized === "key takeaway" ||
    normalized === "the takeaway" ||
    normalized === "one concrete detail" ||
    normalized === "concrete detail" ||
    normalized === "the approach matters" ||
    normalized === "why the approach matters"
  );
};

const usableContractPlanValue = (
  value: string | undefined,
  usedTexts: string[],
): string | undefined =>
  !looksGenericContractPlanStep(value) && candidateIsDistinctFromRecent(value, usedTexts)
    ? value
    : undefined;

const sourceBackedOpeningShouldLeadWithCase = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): boolean => {
  if (deriveSlideArcPolicy(input) !== "source-backed-subject") {
    return true;
  }

  const subject = resolveIntentSubject(input);
  const subjectTokenCount = tokenizeDeckShapeText(subject).length;
  const focusAnchor = input.intent?.focusAnchor?.trim();

  if (focusAnchor) {
    return (
      subjectTokenCount >= 5 ||
      /\p{N}/u.test(subject) ||
      countAnchorOverlap(subject, focusAnchor) >= 2
    );
  }

  return subjectTokenCount >= 5 || /\p{N}/u.test(subject);
};

const resolveHowWorksSubject = (subject: string): string | undefined => {
  const match = /^how\s+(.+?)\s+works$/i.exec(subject.trim());
  return match?.[1]?.trim() || undefined;
};

const isInterruptionAwareTeachingSubject = (subject: string): boolean =>
  /\binterruption/i.test(subject) &&
  /\b(?:ai\s+)?(?:teacher|teaching|tutor|tutoring)\b/i.test(subject);

const buildContractFallbackFocus = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  kind: SlideContract["kind"],
): string => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const entityName =
    usesOrganizationIdentity(input)
      ? resolveOrganizationDisplayName(input)
      : subject;
  const howWorksSubject = resolveHowWorksSubject(subject);

  switch (kind) {
    case "procedural-ingredients":
      return "Starting choices that shape the result";
    case "procedural-steps":
      return "Preparation sequence and checks";
    case "procedural-quality":
      return "Final balance and readiness checks";
    case "subject-detail":
      return (
        focusAnchor ??
        (howWorksSubject
          ? `The input, state change, and response loop inside ${howWorksSubject}`
          : `A defining mechanism or concrete part of ${subject}`)
      );
    case "subject-implication":
      return howWorksSubject
        ? `How the mechanism affects the next response`
        : `One concrete consequence or implication of ${subject}`;
    case "subject-takeaway":
      return arcPolicy === "source-backed-subject"
        ? focusAnchor
          ? `The strongest supported lesson from ${focusAnchor}`
          : `The strongest supported lesson about ${subject}`
        : howWorksSubject
        ? `How to tell whether the mechanism worked`
        : `What the audience should remember about ${subject}`;
    case "entity-capabilities":
      return workshop
        ? `Where ${subject} helps in daily work`
        : `Core capabilities, services, and technical responsibilities of ${entityName}`;
    case "entity-operations":
      return workshop
        ? `Which guardrails and review steps keep ${subject} safe in practice`
        : `Where ${entityName} operates and how its work is delivered in practice`;
    case "entity-value":
      return `One practical example, outcome, or consequence showing how ${entityName} creates value`;
    case "workshop-practice":
      return input.intent?.activityRequirement &&
        !looksLikeWorkshopBriefEcho(input.intent.activityRequirement)
        ? sanitizeContractText(input.intent.activityRequirement, subject)
        : `Use one real artifact to produce a reviewable AI-assisted draft`;
    case "coverage":
      return `One concrete part of ${subject}`;
    case "development":
      return `The next meaningful part of ${subject}`;
    case "synthesis":
      return `The most important lessons about ${subject}`;
    default:
      return subject;
  }
};

const buildContractFallbackObjective = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  kind: SlideContract["kind"],
): string | undefined => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveSourceBackedCaseAnchor(input);
  const arcPolicy = deriveSlideArcPolicy(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const howWorksSubject = resolveHowWorksSubject(subject);

  switch (kind) {
    case "procedural-ingredients":
      return `How starting choices control flavor, texture, and balance`;
    case "procedural-steps":
      return `How the sequence changes texture, flavor, and consistency`;
    case "procedural-quality":
      return `How final checks confirm balance, texture, and readiness`;
    case "subject-detail":
      return focusAnchor
        ? `How ${focusAnchor} makes ${subject} concrete`
        : howWorksSubject
          ? isInterruptionAwareTeachingSubject(howWorksSubject)
            ? `The teacher keeps the active concept, paused step, and learner question connected`
            : `How the mechanism moves from input to state change to response`
          : `A concrete mechanism or defining part that keeps ${subject} specific`;
    case "subject-implication":
      return howWorksSubject
        ? isInterruptionAwareTeachingSubject(howWorksSubject)
          ? `The side answer points back to the paused concept before the lesson continues`
          : `Why the mechanism changes the next response`
        : `Why one mechanism changes the result or reveals the consequence`;
    case "subject-takeaway":
      return arcPolicy === "source-backed-subject"
        ? focusAnchor
          ? `How ${focusAnchor} supports the strongest lesson`
          : `Which supported lesson the audience should retain`
        : howWorksSubject
          ? isInterruptionAwareTeachingSubject(howWorksSubject)
            ? `The learner ends with the answer and the original lesson still connected`
            : `What the audience should check to know the mechanism worked`
          : `What the audience should remember about ${subject}`;
    case "entity-capabilities":
      return workshop
        ? `Which daily tasks and role-based use cases benefit most from ${subject}`
        : `What ${subject} offers through concrete capabilities, services, or responsibilities`;
    case "entity-operations":
      return workshop
        ? `Which review steps, approved tools, and policy boundaries keep ${subject} safe in daily work`
        : `How ${subject} operates through delivery, teamwork, geographic footprint, or concrete processes`;
    case "entity-value":
      return `Which evidence-backed outcome, example, or consequence makes ${subject} matter in practice`;
    case "workshop-practice":
      return input.intent?.activityRequirement &&
        !looksLikeWorkshopBriefEcho(input.intent.activityRequirement)
        ? sanitizeContractText(input.intent.activityRequirement, subject)
        : `Use one real artifact to produce a reviewable AI-assisted draft`;
    case "coverage":
      return `A required coverage area that keeps the deck specific`;
    case "development":
      return `A distinct mechanism, role, or consequence that advances the story`;
    case "synthesis":
      return `The strongest takeaway the audience should remember`;
    default:
      return undefined;
  }
};

const buildContractReferenceTexts = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "groundingHighlights"
    | "groundingCoverageGoals"
    | "groundingSourceIds"
  >,
  kind: SlideContract["kind"],
  learningObjective: string | undefined,
  storylineValue: string | undefined,
): string[] => {
  const subject = resolveIntentSubject(input);
  const arcPolicy = deriveSlideArcPolicy(input);

  return uniqueNonEmptyStrings([
    learningObjective ?? "",
    storylineValue ?? "",
    buildContractFallbackFocus(input, kind),
    buildContractFallbackObjective(input, kind) ?? "",
    arcPolicy === "organization-overview" && kind === "orientation"
      ? input.intent?.presentationGoal ?? ""
      : "",
    ...(arcPolicy === "organization-overview" && kind === "orientation"
      ? input.intent?.audienceCues ?? []
      : []),
    arcPolicy === "source-backed-subject"
      ? resolveSourceBackedCaseAnchor(input) ?? ""
      : "",
  ]).filter(
    (value) => normalizeComparableText(value) !== normalizeComparableText(subject),
  );
};

export const buildSlideContracts = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
  slideCount: number,
): SlideContract[] => {
  const subject = resolveIntentSubject(input);
  const storyline = uniqueNonEmptyStrings(input.plan?.storyline ?? []);
  const learningObjectives = uniqueNonEmptyStrings(input.plan?.learningObjectives ?? []);
  const seeds = buildContractSeeds(input);
  const contractKinds = buildSlideContractKinds(input, slideCount);
  const arcPolicy = deriveSlideArcPolicy(input);
  const contracts: SlideContract[] = [];
  const usedSeedIds = new Set<string>();
  const usedTexts: string[] = [];

  for (let index = 0; index < slideCount; index += 1) {
    if (index === 0) {
      const openingKind =
        arcPolicy === "procedural"
          ? contractKinds[index] ?? "procedural-ingredients"
          : "orientation";
      const openingPriority = openingSeedPriorities(input);
      const openingHighlight =
        openingKind === "orientation" &&
        (arcPolicy !== "source-backed-subject" ||
          sourceBackedOpeningShouldLeadWithCase(input))
          ? selectDistinctContractSeed({
              seeds,
              usedSeedIds,
              usedTexts,
              preferredSources: openingPriority,
            })?.text
          : undefined;
      const focus =
        arcPolicy === "procedural" && openingKind === "orientation"
          ? "What good looks like for the finished result"
          : openingKind === "orientation"
          ? pickOpeningFocus(input, openingHighlight)
          : buildContractFallbackFocus(input, openingKind);
      const openingObjective =
        arcPolicy === "procedural" && openingKind === "orientation"
          ? "Define the target outcome before choosing ingredients and steps"
          : openingKind === "orientation"
          ? pickOpeningObjective(input, openingHighlight)
          : buildContractFallbackObjective(input, openingKind);
      contracts.push({
        index,
        isFinal: index === slideCount - 1,
        label: buildSlideContractLabel(openingKind, storyline[index]),
        kind: openingKind,
        focus,
        ...(openingObjective && openingObjective !== focus
          ? { objective: openingObjective }
          : {}),
      });
      if (openingHighlight) {
        const openingSeed = seeds.find((seed) => seed.text === openingHighlight);
        if (
          openingSeed &&
          (openingSeed.source !== "focusAnchor" || !input.intent?.focusAnchor?.trim())
        ) {
          usedSeedIds.add(openingSeed.id);
        }
      }
      usedTexts.push(focus);
      if (openingObjective && openingObjective !== focus) {
        usedTexts.push(openingObjective);
      }
      continue;
    }

    const kind = contractKinds[index] ?? "subject-implication";
    const priorities = contractSeedPriorities(kind, input);
    const distinctFrom = uniqueNonEmptyStrings(usedTexts.slice(-4));
    const roleReferenceTexts = buildContractReferenceTexts(
      input,
      kind,
      learningObjectives[index],
      storyline[index],
    );
    const focusSeed =
      arcPolicy === "organization-overview"
        ? selectAlignedContractSeed({
            seeds,
            usedSeedIds,
            preferredSources: priorities.focus,
            referenceTexts: roleReferenceTexts,
          }) ??
          selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts,
            preferredSources: priorities.focus,
          })
        : selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts,
            preferredSources: priorities.focus,
          });
    const acceptedFocusSeed =
      arcPolicy === "organization-overview" &&
      focusSeed &&
      (!seedAlignsToReferenceTexts(focusSeed.text, roleReferenceTexts) ||
        !organizationRoleSeedTextSupports(kind, focusSeed.text))
        ? undefined
        : focusSeed;
    if (acceptedFocusSeed) {
      usedSeedIds.add(acceptedFocusSeed.id);
    }
    const indexedStorylineFocus = usableContractPlanValue(storyline[index], usedTexts);
    const indexedLearningFocus = usableContractPlanValue(learningObjectives[index], usedTexts);
    const distinctAcceptedFocusSeed =
      acceptedFocusSeed &&
      candidateIsDistinctFromRecent(acceptedFocusSeed.text, usedTexts)
        ? acceptedFocusSeed.text
        : undefined;
    const focus = pickContractText(
      input,
      arcPolicy === "source-backed-subject" || arcPolicy === "organization-overview"
        ? [
            acceptedFocusSeed?.text,
            indexedLearningFocus,
            indexedStorylineFocus,
            buildContractFallbackFocus(input, kind),
          ]
        : [
            indexedStorylineFocus,
            indexedLearningFocus,
            distinctAcceptedFocusSeed,
            buildContractFallbackFocus(input, kind),
          ],
      { preferConcrete: true },
    );
    const howWorksSubject = resolveHowWorksSubject(subject);
    const indexedStorylineObjective = usableContractPlanValue(storyline[index], [
      ...usedTexts,
      focus,
    ]);
    const indexedLearningObjective = usableContractPlanValue(learningObjectives[index], [
      ...usedTexts,
      focus,
    ]);
    const fallbackObjective = buildContractFallbackObjective(input, kind);
    const objectiveSeed =
      arcPolicy === "organization-overview"
        ? selectAlignedContractSeed({
            seeds,
            usedSeedIds,
            preferredSources: priorities.objective,
            referenceTexts: [...roleReferenceTexts, focus].filter(
              (value): value is string => Boolean(value),
            ),
          }) ??
          selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts: [...usedTexts, focus],
            preferredSources: priorities.objective,
            fallbackSources: priorities.focus,
          })
        : selectDistinctContractSeed({
            seeds,
            usedSeedIds,
            usedTexts: [...usedTexts, focus],
            preferredSources: priorities.objective,
            fallbackSources: priorities.focus,
          });
    const objectiveReferenceTexts = [...roleReferenceTexts, focus].filter(
      (value): value is string => Boolean(value),
    );
    const acceptedObjectiveSeed =
      arcPolicy === "organization-overview" &&
      objectiveSeed &&
      (!seedAlignsToReferenceTexts(objectiveSeed.text, objectiveReferenceTexts) ||
        !organizationRoleSeedTextSupports(kind, objectiveSeed.text))
        ? undefined
        : objectiveSeed;
    if (acceptedObjectiveSeed) {
      usedSeedIds.add(acceptedObjectiveSeed.id);
    }
    const objective = pickContractText(
      input,
      (
        arcPolicy === "source-backed-subject"
          ? [
              acceptedObjectiveSeed?.text,
              indexedStorylineObjective,
              indexedLearningObjective,
              fallbackObjective,
            ]
          : arcPolicy === "organization-overview"
            ? [
                acceptedObjectiveSeed?.text,
                fallbackObjective,
              ]
          : [
              indexedStorylineObjective,
              indexedLearningObjective,
              ...(howWorksSubject
                ? []
                : [acceptedObjectiveSeed?.text]),
              fallbackObjective,
            ]
      ).filter(
        (candidate) => candidate && normalizeComparableText(candidate) !== normalizeComparableText(focus),
      ),
      { preferConcrete: true },
    );
    const requiresConcreteEvidence =
      contractRequiresEvidence(kind, input) &&
      (arcPolicy === "source-backed-subject" ||
        arcPolicy === "organization-overview" ||
        kind === "workshop-practice");
    const alignedEvidenceSeed =
      requiresConcreteEvidence &&
      (arcPolicy === "source-backed-subject" || arcPolicy === "organization-overview")
        ? selectAlignedContractSeed({
            seeds,
            usedSeedIds,
            preferredSources: priorities.evidence,
            referenceTexts: [focus, objective, ...roleReferenceTexts].filter(
              (value): value is string => Boolean(value),
            ),
          })
        : undefined;
    const fallbackEvidenceSeed = requiresConcreteEvidence
      ? selectDistinctContractSeed({
          seeds,
          usedSeedIds,
          usedTexts: [...usedTexts, focus, objective].filter(
            (value): value is string => Boolean(value),
          ),
          preferredSources: priorities.evidence,
          fallbackSources: priorities.focus,
        })
      : undefined;
    const evidenceSeedCandidate = alignedEvidenceSeed ?? fallbackEvidenceSeed;
    const evidenceSeed =
      evidenceSeedCandidate &&
      normalizeComparableText(evidenceSeedCandidate.text) !== normalizeComparableText(focus) &&
      normalizeComparableText(evidenceSeedCandidate.text) !== normalizeComparableText(objective) &&
      organizationRoleSeedTextSupports(kind, evidenceSeedCandidate.text)
        ? evidenceSeedCandidate
        : fallbackEvidenceSeed &&
            normalizeComparableText(fallbackEvidenceSeed.text) !== normalizeComparableText(focus) &&
            normalizeComparableText(fallbackEvidenceSeed.text) !== normalizeComparableText(objective) &&
            organizationRoleSeedTextSupports(kind, fallbackEvidenceSeed.text)
          ? fallbackEvidenceSeed
          : undefined;
    if (evidenceSeed) {
      usedSeedIds.add(evidenceSeed.id);
    }
    const evidence =
      kind === "workshop-practice"
        ? pickWorkshopPracticeEvidence(input, focus, objective, evidenceSeed?.text)
        : evidenceSeed?.text;

    contracts.push({
      index,
      isFinal: index === slideCount - 1,
      label: buildSlideContractLabel(kind, storyline[index]),
      kind,
      focus,
      ...(objective && objective !== focus
        ? { objective: sanitizeContractText(objective, subject) }
        : {}),
      ...(evidence ? { evidence } : {}),
      ...(distinctFrom.length > 0 ? { distinctFrom } : {}),
    });
    usedTexts.push(focus);
    if (objective && objective !== focus) {
      usedTexts.push(objective);
    }
    if (evidence) {
      usedTexts.push(evidence);
    }
  }

  return contracts;
};

export const buildSlideContractPromptLines = (
  input: Pick<
    GenerateDeckInput,
    | "topic"
    | "presentationBrief"
    | "intent"
    | "plan"
    | "targetSlideCount"
    | "groundingHighlights"
    | "groundingCoverageGoals"
  >,
): string[] => {
  const slideCount =
    input.targetSlideCount ??
    input.plan?.recommendedSlideCount ??
    Math.max(4, (input.plan?.storyline?.length ?? 0) + 1);

  const contracts = buildSlideContracts(input, slideCount);
  return contracts.map((contract) =>
    `Slide ${contract.index + 1}: ${contract.label}. Focus on ${contract.focus}${
      contract.objective ? ` Objective anchor: ${contract.objective}.` : "."
    }${contract.evidence ? ` Evidence anchor: ${contract.evidence}.` : ""}${
      contract.index === contracts.length - 1
        ? " This is the final slide: visibly close the presentation and make it explicit that audience questions are welcome."
        : ""
    }`,
  );
};
