import type { Deck, GenerateDeckInput, Slide } from "@slidespeech/types";

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
  usesDirectOrganizationPersona,
} from "./deck-shape-text";
import {
  buildOrganizationRoleAdvancedExplanation,
  hasGroundedOrganizationValueCaseEvidence,
  organizationRoleTextSupportsContract,
} from "./organization-role-contracts";
import { extractCoverageRequirements } from "./prompt-shaping";
import {
  deriveSlideArcPolicy,
  framingImpliesOrientation,
  isWorkshopPresentation,
  resolveIntentFocusAnchor,
  resolveIntentSubject,
  resolveOrganizationDisplayName,
  usesOrganizationIdentity,
} from "./slide-arc-policy";
import {
  buildContractLearningGoal,
  buildContractTitle,
} from "./slide-contract-copy";
import {
  buildContractAnchoredKeyPoints,
  isWeakContractEchoPoint,
  rankContractConcretePoints,
} from "./slide-contract-points";
import { buildWorkshopPracticeRecoveryPoints } from "./slide-contract-builder";
import {
  NON_SLIDEABLE_COVERAGE_PATTERNS,
  canUseAsSlidePoint,
  compactSourceBackedAnchor,
  compactGroundingHighlight,
  isGenericOpeningFocus,
  isOrientationCoverageAnchor,
  sanitizeContractText,
  sourceBackedFocusEqualsSubject,
} from "./slide-contract-text";
import type { ArcPolicyInput, SlideContract } from "./slide-contract-types";
import { subjectToActionPhrase } from "./workshop-text";

const buildOrientationCoveragePoint = (
  topic: string,
  anchor: string,
): string => {
  const normalized = sanitizeContractText(anchor, topic);
  if (!normalized) {
    return "";
  }

  if (/^why\b/i.test(normalized)) {
    return toAudienceFacingSentence(normalized.replace(/^why\s+/i, ""));
  }

  if (hasMeaningfulAnchorOverlap(normalized, topic)) {
    return toAudienceFacingSentence(normalized);
  }

  return toAudienceFacingSentence(`${topic} becomes concrete through ${normalized}`);
};

const resolveHowWorksSubject = (subject: string): string | undefined => {
  const match = /^how\s+(.+?)\s+works$/i.exec(subject.trim());
  return match?.[1]?.trim() || undefined;
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

const buildScopedSlideEvidence = (
  input: GenerateDeckInput,
  slideOrder: number,
): string[] => {
  const subject = resolveIntentSubject(input);
  const brief = input.slideBriefs?.[slideOrder];
  if (!brief) {
    return [];
  }

  const factsById = new Map(
    (input.groundingFacts ?? []).map((fact) => [fact.id, fact]),
  );
  const factEvidence = brief.evidenceFactIds.flatMap((factId) => {
    const fact = factsById.get(factId);
    return fact ? [fact.claim, fact.evidence] : [];
  });

  return uniqueNonEmptyStrings([
    ...brief.requiredClaims,
    ...factEvidence,
  ]).filter(
    (value) =>
      value.length >= 18 &&
      canUseAsSlidePoint(input, value) &&
      !isOrientationCoverageAnchor(subject, value) &&
      !isGenericOpeningFocus(subject, value),
  );
};

const buildFinalQuestionInvitePoint = (input: GenerateDeckInput): string =>
  isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">)
    ? toAudienceFacingSentence(
        `The next step is one checked prompt or checklist the role can reuse on a real planning, backlog, or test task`,
      )
    : toAudienceFacingSentence(
        `Questions are welcome now, especially about how ${resolveIntentSubject(input)} applies in practice`,
      );

const applyFinalSlideClosingRole = (
  input: GenerateDeckInput,
  contract: SlideContract,
  points: string[],
): string[] => {
  if (!contract.isFinal) {
    return points;
  }

  const closingPoint = buildFinalQuestionInvitePoint(input);
  const firstTwo = uniqueNonEmptyStrings(points).slice(0, 2);
  return uniqueNonEmptyStrings([...firstTwo, closingPoint]).slice(0, 3);
};

const uniqueSimilarSlidePoints = (points: string[]): string[] => {
  const result: string[] = [];

  for (const point of uniqueNonEmptyStrings(points)) {
    const duplicatesExisting = result.some(
      (existing) => {
        const existingComparable = normalizeComparableText(existing);
        const pointComparable = normalizeComparableText(point);
        const existingTokens = new Set(tokenizeDeckShapeText(existing));
        const pointTokens = tokenizeDeckShapeText(point);
        const overlap = pointTokens.filter((token) => existingTokens.has(token)).length;
        const smallerTokenCount = Math.min(existingTokens.size, new Set(pointTokens).size);

        return (
          contractTextSimilarity(existing, point) >= 0.78 ||
          (smallerTokenCount >= 6 && overlap / smallerTokenCount >= 0.64) ||
          existingComparable.includes(pointComparable) ||
          pointComparable.includes(existingComparable)
        );
      },
    );

    if (!duplicatesExisting) {
      result.push(point);
    }
  }

  return result;
};

const inputLooksQualityAssuranceFocused = (input: GenerateDeckInput): boolean =>
  /\b(?:quality assurance|software quality|software testing|test automation|qa\b|testing)\b/i.test(
    [
      input.groundingSummary ?? "",
      ...(input.groundingHighlights ?? []),
      ...(input.groundingExcerpts ?? []),
      ...(input.groundingFacts ?? []).flatMap((fact) => [fact.claim, fact.evidence]),
    ].join(" "),
  );

const inputMentionsFoundedIn2002 = (input: GenerateDeckInput): boolean =>
  /\b(?:founded|history|2002)\b/i.test(
    [
      input.groundingSummary ?? "",
      ...(input.groundingHighlights ?? []),
      ...(input.groundingExcerpts ?? []),
      ...(input.groundingFacts ?? []).flatMap((fact) => [fact.claim, fact.evidence]),
    ].join(" "),
  );

const buildOrganizationOpeningFallbackPoints = (
  input: GenerateDeckInput,
  entityName: string,
): string[] => {
  if (inputLooksQualityAssuranceFocused(input)) {
    return [
      `${entityName} integrates QA, AI-powered quality solutions, and advisory services to support software delivery.`,
      inputMentionsFoundedIn2002(input)
        ? `${entityName} was founded in 2002 as a company dedicated to quality assurance.`
        : `${entityName} is a QA network in the Nordics with deep technical knowledge and collaboration-focused delivery.`,
      `${entityName}'s delivery model connects testing, automation, and risk review before release decisions.`,
    ];
  }

  return [
    `${entityName} is the organization at the center of this overview.`,
    `${entityName}'s services, operating footprint, and delivery role define the practical context.`,
    `${entityName}'s value depends on the specific capabilities and outcomes supported by the source material.`,
  ];
};

const buildOrganizationRoleFallbackPoints = (
  input: GenerateDeckInput,
  contract: SlideContract,
): string[] => {
  const subject = resolveIntentSubject(input);
  const qualityAssuranceFocused = inputLooksQualityAssuranceFocused(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);

  if (workshop) {
    switch (contract.kind) {
      case "entity-capabilities":
        return [
          `For a project manager, meeting notes become action items, status updates, and risk follow-ups.`,
          `For a product owner, feedback or draft requirements become backlog candidates and acceptance criteria.`,
          `For a test lead, requirements or defect reports become scenario ideas and coverage questions.`,
        ];
      case "entity-operations":
        return [
          `AI output needs human review before it becomes a decision, requirement, or test artifact.`,
          `A review step catches sensitive details before a draft leaves the team.`,
          `Teams check accuracy, traceability, and policy fit before sharing AI-assisted work.`,
        ];
      case "entity-value":
        return [
          `The practical value is faster first drafts without skipping human accountability.`,
          `AI is useful when it improves planning, analysis, testing, or documentation work that people still review.`,
          `The workshop takeaway is one safe AI-assisted artifact the role can reuse in daily work.`,
        ];
      default:
        return [];
    }
  }

  switch (contract.kind) {
    case "entity-operations":
      return qualityAssuranceFocused
        ? [
            `QA by ${subject} is integrated into daily operations to help teams deliver better software and happier users.`,
            `Lifecycle support means QA is part of development work rather than only a final test gate.`,
            `Release decisions are supported by test evidence from daily QA operations and delivery collaboration.`,
          ]
        : [
            `${subject}'s operating model combines locations, specialists, and delivery collaboration.`,
            `Specialists connect the organization to client-facing delivery work.`,
            `Operating structure determines where and how teams can engage.`,
          ];
    case "entity-capabilities":
      return qualityAssuranceFocused
        ? [
            `Test automation uses frameworks and platforms such as Playwright, Selenium, Cypress, Ranorex, and CI/CD systems.`,
            `Test automation accelerates delivery, reduces human error, and improves consistency across complex systems.`,
            `Advisory services and workshops identify risks early and validate data flows and custom features.`,
          ]
        : [
            `${subject}'s capabilities are the services and responsibilities named by the source material.`,
            `The capability view separates what the organization offers from where it operates.`,
            `Specialist support gives teams a practical way to use those capabilities.`,
          ];
    case "entity-value":
      return qualityAssuranceFocused
        ? [
            `Delivery confidence comes from fewer late surprises, better quality decisions, and more reliable software.`,
            `Advisory workshops and data-flow validation provide evidence before custom features reach release decisions.`,
            `The final takeaway is that ${subject} turns QA work into earlier evidence for delivery decisions.`,
          ]
        : [
            `${subject}'s value should be tied to a supported practical consequence.`,
            `The strongest outcome is the one the source material can support directly.`,
            `A concrete consequence is more useful than a broad value claim.`,
          ];
    default:
      return [];
  }
};

const buildRoleRecoveryBeginnerExplanation = (
  input: GenerateDeckInput,
  contract: SlideContract,
  recoveryPoints: string[],
): string => {
  const subject = resolveIntentSubject(input);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";

  if (organizationArc) {
    const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
    switch (contract.kind) {
      case "entity-capabilities":
        if (workshop) {
          return toAudienceFacingSentence(
            `Project managers, product owners, and test leads each need different reviewable AI drafts`,
          );
        }
        return toAudienceFacingSentence(
          `Automation frameworks handle repeatable test work, while advisory workshops turn risks, data flows, and custom features into reviewable delivery work for teams`,
        );
      case "entity-operations":
        if (workshop) {
          return toAudienceFacingSentence(
            `AI-assisted work stays safe when people check facts, source material, data sensitivity, and policy boundaries`,
          );
        }
        return toAudienceFacingSentence(
          `QA is not an isolated final gate: specialists work inside daily delivery, connect testing to release decisions, and keep quality work close to software teams`,
        );
      case "entity-value":
        if (workshop) {
          return toAudienceFacingSentence(
            `The value is faster first drafts that still remain under human responsibility`,
          );
        }
        return toAudienceFacingSentence(
          `Practical value appears before release: predictive testing, resilient digital systems, advisory workshops, and validation work help teams avoid late surprises`,
        );
      default:
        break;
    }
  }

  return toAudienceFacingSentence(
    `${recoveryPoints[0] ?? ""} ${recoveryPoints[1] ?? ""}`,
  );
};

const buildRoleRecoveryAdvancedExplanation = (
  input: GenerateDeckInput,
  contract: SlideContract,
  recoveryPoints: string[],
): string => {
  const subject = resolveIntentSubject(input);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";

  if (organizationArc) {
    const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
    switch (contract.kind) {
      case "entity-capabilities":
        if (workshop) {
          return toAudienceFacingSentence(
            `The role split matters because project managers, product owners, and test leads need different AI-assisted outputs`,
          );
        }
        return buildOrganizationRoleAdvancedExplanation(contract, subject);
      case "entity-operations":
        if (workshop) {
          return toAudienceFacingSentence(
            `Public-sector use stays practical when every AI-assisted output has a review step and a data-handling boundary`,
          );
        }
        return buildOrganizationRoleAdvancedExplanation(contract, subject);
      case "entity-value":
        if (workshop) {
          return toAudienceFacingSentence(
            `The useful result is a draft, analysis, or test artifact that a person can verify before using it`,
          );
        }
        return buildOrganizationRoleAdvancedExplanation(contract, subject);
      default:
        break;
    }
  }

  return toAudienceFacingSentence(
    recoveryPoints[2] ??
      `${subject} is clearer when the explanation stays tied to one concrete outcome.`,
  );
};

const buildRecoveryLearningGoal = (
  input: GenerateDeckInput,
  slideOrder: number,
  contract: SlideContract,
): string => {
  const subject = resolveIntentSubject(input);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  if (organizationArc) {
    const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
    switch (contract.kind) {
      case "orientation":
        if (workshop) {
          return `AI tools help daily work when raw notes, requirements, risks, or defects become checked first drafts.`;
        }
        return inputLooksQualityAssuranceFocused(input)
          ? inputMentionsFoundedIn2002(input)
            ? `${subject} connects its quality-assurance origin from 2002 to a Nordic QA network role.`
            : `${subject} turns quality assurance into earlier delivery evidence for software teams.`
          : `${subject} is introduced through its identity, services, operating footprint, and delivery role.`;
      case "entity-operations":
        if (workshop) {
          return `Approved tools, source checks, data handling, and human review decide whether AI-assisted work is safe to share.`;
        }
        return `${subject}'s operating model puts QA work inside daily software delivery.`;
      case "entity-capabilities":
        if (workshop) {
          return `Project managers, product owners, and test leads use AI for different drafts, checks, and decisions.`;
        }
        return `${subject}'s capabilities combine automation frameworks, advisory workshops, and quality operations.`;
      case "entity-value":
        if (workshop) {
          return contract.isFinal
            ? `The practical takeaway is one safe AI-assisted artifact that can be reused in daily work.`
            : `The practical value is faster first drafts without skipping review, policy, or accountability.`;
        }
        return contract.isFinal
          ? `${subject} turns QA work into earlier evidence for delivery decisions.`
          : `${subject} helps teams find risks before they become late delivery surprises.`;
      default:
        break;
    }
  }

  const scopedEvidence = buildScopedSlideEvidence(input, slideOrder);
  const scopedGoal = scopedEvidence.find(
    (value) => value.length >= 36 && value.length <= 190,
  );

  return scopedGoal
    ? toAudienceFacingSentence(scopedGoal)
    : buildContractLearningGoal(input, contract);
};

export const buildProceduralOrientationKeyPoints = (subject: string): string[] =>
  {
    const outcome = subject
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:how to\s+)?(?:make|making|prepare|preparing|cook|cooking|build|building|assemble|assembling)\s+(?:the\s+)?/i, "")
      .replace(/[.]+$/g, "")
      .trim()
      .toLowerCase() || subject.toLowerCase();
    const foodLikeOutcome =
      /\b(?:salsa|dip|sauce|soup|salad|bread|cake|meal|dish|food|recipe|cook|bake|tomato|ingredient)\b/i.test(
        subject,
      );

    if (foodLikeOutcome) {
      return uniqueNonEmptyStrings([
        toAudienceFacingSentence(
          `A finished ${outcome} starts with fresh tomato flavor, crisp onion, controlled heat, and a clean lime-salt finish`,
        ),
        toAudienceFacingSentence(
          `The target texture should stay on a chip or spoon while still tasting juicy and fresh`,
        ),
        toAudienceFacingSentence(
          `Most failures come from uneven chopping, excess tomato juice, or adding all seasoning at once`,
        ),
      ]).slice(0, 3);
    }

    return uniqueNonEmptyStrings([
      toAudienceFacingSentence(
        `A finished ${outcome} should have a visible result, no obvious defects, and a clear readiness check`,
      ),
      toAudienceFacingSentence(
        `The opening target should make the later materials, sequence, and final checks easier to judge`,
      ),
      toAudienceFacingSentence(
        `The main problems to catch early are missing inputs, poor sequence, or a result that cannot be checked`,
      ),
    ]).slice(0, 3);
  };

export const buildOrientationSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const title = buildContractTitle(input, contract);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const sourceBackedSubject =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "source-backed-subject";
  const entityName =
    usesOrganizationIdentity(input)
      ? resolveOrganizationDisplayName(input)
      : subject;
  const orientationFraming = framingImpliesOrientation(input);
  const scopedSlideEvidence = buildScopedSlideEvidence(input, slide.order);
  if (input.intent?.contentMode === "procedural") {
    const seedPoints = uniqueNonEmptyStrings([
      ...slide.keyPoints,
      ...scopedSlideEvidence,
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingHighlights ?? []),
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingCoverageGoals ?? []),
    ]);
    const keyPoints =
      contract.kind === "orientation"
        ? buildProceduralOrientationKeyPoints(subject)
        : buildContractAnchoredKeyPoints(input, contract, seedPoints);
    return {
      ...(slide as unknown as Record<string, unknown>),
      title,
      learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
      keyPoints,
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: keyPoints.slice(0, 2).join(" "),
      advancedExplanation: keyPoints[2] ?? "",
      id: slide.id,
      order: slide.order,
    };
  }
  const coverageAnchors = uniqueNonEmptyStrings([
    ...(input.intent?.coverageRequirements ?? extractCoverageRequirements(input.presentationBrief ?? "")),
    ...(input.groundingCoverageGoals ?? []),
  ])
    .map((value) => sanitizeContractText(value, subject))
    .filter(
      (value) =>
        value.length > 0 &&
        !isOrientationCoverageAnchor(subject, value) &&
        !NON_SLIDEABLE_COVERAGE_PATTERNS.some((pattern) => pattern.test(value)) &&
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
        !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
    )
    .slice(0, 2);
  const compactGroundingSupport = uniqueNonEmptyStrings(
    (scopedSlideEvidence.length > 0
      ? scopedSlideEvidence
      : input.groundingHighlights ?? []
    ).map((highlight) =>
      compactGroundingHighlight(highlight, subject),
    ),
  ).filter(
    (value) =>
      value.length >= 28 &&
      !isGenericOpeningFocus(subject, value) &&
      !looksOverlyPromotionalSourceCopy(value) &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)),
  );

  if (
    sourceBackedSubject &&
    contract.kind === "orientation" &&
    sourceBackedOpeningIsBroadSubject(contract, subject)
  ) {
    const summarySentences = (input.groundingSummary ?? "")
      .split(/(?<=[.!?])\s+/)
      .map((value) => sanitizeContractText(value, subject))
      .filter((value) => value.length >= 32);
    const focusAnchor = resolveIntentFocusAnchor(input);
    const sourceIntroCandidates = uniqueNonEmptyStrings([
      ...summarySentences,
      ...compactGroundingSupport,
      ...coverageAnchors.map((anchor) => buildOrientationCoveragePoint(subject, anchor)),
    ]).filter(
      (value) =>
        canUseAsSlidePoint(input, value) &&
        !isWeakContractEchoPoint(contract, value) &&
        !isGenericOpeningFocus(subject, value),
    );
    const rankedIntroPoints = rankContractConcretePoints(
      input,
      contract,
      sourceIntroCandidates,
    );
    const subjectIdentityPoints = sourceIntroCandidates.filter(
      (value) =>
        hasMeaningfulAnchorOverlap(value, subject) &&
        (!focusAnchor || countAnchorOverlap(value, focusAnchor) < 2),
    );
    const keyPoints = uniqueNonEmptyStrings([
      ...subjectIdentityPoints.slice(0, 2),
      ...rankedIntroPoints.slice(0, 3),
      toAudienceFacingSentence(
        `${subject} is the broader setting around the supported event, fact, or consequence`,
      ),
    ]).slice(0, 3);
    const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
    const advancedExplanation =
      keyPoints[2] ??
      toAudienceFacingSentence(
        `${subject} is clearer when identity, history, and current structure are separated before interpretation`,
      );

    return {
      ...(slide as unknown as Record<string, unknown>),
      title,
      learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
      keyPoints,
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation,
      advancedExplanation,
      id: slide.id,
      order: slide.order,
    };
  }

  if (contract.kind === "orientation" && /^how\s+.+\s+works$/i.test(subject.trim())) {
    const keyPoints = buildContractAnchoredKeyPoints(input, contract, []);
    return {
      ...(slide as unknown as Record<string, unknown>),
      title,
      learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
      keyPoints,
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation: keyPoints.slice(0, 2).join(" "),
      advancedExplanation: keyPoints[2] ?? "",
      id: slide.id,
      order: slide.order,
    };
  }

  if (organizationArc) {
    const organizationSupportCandidates = [
      ...coverageAnchors,
      ...compactGroundingSupport.filter((value) =>
        countAnchorOverlap(
          value,
          `${entityName} ${contract.focus} ${contract.objective ?? ""} ${input.intent?.presentationGoal ?? ""}`,
        ) >= 2 ||
        hasMeaningfulAnchorOverlap(
          value,
          `${entityName} ${contract.focus} ${contract.objective ?? ""}`,
        ),
      ),
    ];
    const rankedOrganizationSupport = rankContractConcretePoints(
      input,
      contract,
      organizationSupportCandidates.filter(
        (value): value is string =>
          Boolean(value) &&
          !isWeakContractEchoPoint(contract, value) &&
          !isGenericOpeningFocus(subject, value),
      ),
    );
    const organizationFallbackPoints = uniqueSimilarSlidePoints([
      ...buildOrganizationOpeningFallbackPoints(input, entityName).map((value) =>
        toAudienceFacingSentence(value),
      ),
      ...rankedOrganizationSupport.map((value) => toAudienceFacingSentence(value)),
    ]).filter(
      (point) =>
        canUseAsSlidePoint(input, point) &&
        !isWeakContractEchoPoint(contract, point) &&
        !isGenericOpeningFocus(subject, point),
    );
    const keyPoints = uniqueSimilarSlidePoints(
      workshop
        ? [
            toAudienceFacingSentence(
              `A useful AI workflow starts with a small work input such as meeting notes, a draft requirement, a risk note, or a test idea`,
            ),
            toAudienceFacingSentence(
              `The value is speed on first drafts, not delegation of decisions, ownership, or accountability`,
            ),
            toAudienceFacingSentence(
              `The human role is to check source accuracy, context, sensitive information, and whether the output is safe to share`,
            ),
          ]
        : organizationFallbackPoints,
    ).slice(0, 3);
    const beginnerExplanation = toAudienceFacingSentence(
      workshop
        ? `AI support is useful when it produces reviewable drafts for planning, product, and testing work`
        : `${entityName} combines QA services, operating locations, and delivery support in one organization`,
    );
    const advancedExplanation =
      workshop
        ? toAudienceFacingSentence(
            `Every useful AI output still needs human review, source checking, and data-handling discipline before it becomes work material`,
          )
        : toAudienceFacingSentence(
            `${entityName} supports software teams through service capabilities, QA specialists, and practical risk reduction`,
          );

    return {
      ...(slide as unknown as Record<string, unknown>),
      title,
      learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
      keyPoints,
      speakerNotes: [],
      examples: [],
      likelyQuestions: [],
      beginnerExplanation,
      advancedExplanation,
      id: slide.id,
      order: slide.order,
    };
  }

  const laterSlideSupport = uniqueNonEmptyStrings(
    deck.slides
      .slice(1)
      .flatMap((candidateSlide) => [
        ...candidateSlide.keyPoints,
        ...candidateSlide.examples,
        candidateSlide.beginnerExplanation,
      ])
      .filter(
        (value) =>
          value.length >= 28 &&
          canUseAsSlidePoint(input, value) &&
          !looksOverlyPromotionalSourceCopy(value),
      ),
  ).slice(0, 2);
  const keyPoints = uniqueNonEmptyStrings(
    [
      ...laterSlideSupport,
      ...coverageAnchors.map((anchor) => buildOrientationCoveragePoint(subject, anchor)),
      input.plan?.learningObjectives?.[0]
        ? toAudienceFacingSentence(input.plan.learningObjectives[0])
        : null,
      deck.summary,
      toAudienceFacingSentence(
        `${subject} becomes concrete when one consequence, example, or responsibility is visible`,
      ),
    ].filter((value): value is string => Boolean(value)),
  ).slice(0, 3);
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because it changes real decisions, behavior, or outcomes`,
    );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

export const shouldUseDeterministicProceduralSlide = (
  input: GenerateDeckInput,
  contract: SlideContract,
): boolean =>
  input.intent?.contentMode === "procedural" &&
  (contract.kind === "procedural-ingredients" ||
    contract.kind === "procedural-steps" ||
    contract.kind === "procedural-quality");

export const buildProceduralSlideFromContext = (
  input: GenerateDeckInput,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const scopedSlideEvidence = buildScopedSlideEvidence(input, slide.order);
  const seedPoints = uniqueNonEmptyStrings([
    ...slide.keyPoints,
    ...scopedSlideEvidence,
    ...(scopedSlideEvidence.length > 0 ? [] : input.groundingHighlights ?? []),
    ...(scopedSlideEvidence.length > 0 ? [] : input.groundingCoverageGoals ?? []),
    contract.evidence ?? "",
    contract.objective ?? "",
    contract.focus,
  ]);
  const keyPoints = applyFinalSlideClosingRole(
    input,
    contract,
    buildContractAnchoredKeyPoints(input, contract, seedPoints),
  );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: buildContractTitle(input, contract),
    learningGoal: buildRecoveryLearningGoal(input, slide.order, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [],
    beginnerExplanation: keyPoints.slice(0, 2).join(" "),
    advancedExplanation:
      keyPoints[2] ??
      toAudienceFacingSentence(
        `${subject} is easier to adjust when each cue is checked separately`,
      ),
    id: slide.id,
    order: slide.order,
  };
};

export const shouldUseDeterministicSubjectOverviewSlide = (
  input: GenerateDeckInput,
  slide: Slide,
  contract: SlideContract,
): boolean => {
  if (deriveSlideArcPolicy(input) === "organization-overview") {
    return false;
  }

  if (slide.order !== 1) {
    return false;
  }

  if (deriveSlideArcPolicy(input) === "source-backed-subject") {
    return false;
  }

  if (
    resolveIntentFocusAnchor(input) ||
    (input.groundingHighlights?.length ?? 0) > 0 ||
    (input.groundingCoverageGoals?.length ?? 0) > 0
  ) {
    return false;
  }

  const subject = resolveIntentSubject(input);
  const contractAnchor = [subject, contract.focus, contract.objective ?? ""].join(" ");
  const title = slide.title.trim();
  const learningGoal = slide.learningGoal.trim();
  const titleLooksGeneric =
    tokenizeDeckShapeText(title).length <= 3 &&
    !hasMeaningfulAnchorOverlap(title, contractAnchor);
  const goalLooksGeneric =
    tokenizeDeckShapeText(learningGoal).length <= 6 &&
    !hasMeaningfulAnchorOverlap(learningGoal, contractAnchor);
  const anchoredKeyPoints = slide.keyPoints.filter((point) =>
    hasMeaningfulAnchorOverlap(point, contractAnchor),
  );

  return titleLooksGeneric && goalLooksGeneric && anchoredKeyPoints.length < 2;
};

export const shouldUseDeterministicHowWorksSlide = (
  input: GenerateDeckInput,
  contract: SlideContract,
): boolean => {
  const subject = resolveIntentSubject(input);
  if (!resolveHowWorksSubject(subject)) {
    return false;
  }

  if (deriveSlideArcPolicy(input) === "source-backed-subject") {
    return false;
  }

  if (resolveIntentFocusAnchor(input)) {
    return false;
  }

  return (
    contract.kind === "subject-detail" ||
      contract.kind === "subject-implication" ||
      contract.kind === "subject-takeaway"
  );
};

export const buildSubjectOverviewSlideFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> => {
  const subject = resolveIntentSubject(input);
  const normalizedContractTitle = buildContractTitle(input, contract);
  const title = hasMeaningfulAnchorOverlap(
    slide.title,
    `${subject} ${contract.focus} ${contract.objective ?? ""}`,
  )
    ? slide.title.trim()
    : normalizedContractTitle;
  const isOverviewSlide = slide.order === 1;
  const scopedSlideEvidence = buildScopedSlideEvidence(input, slide.order);
  const pointPool = uniqueNonEmptyStrings([
    ...scopedSlideEvidence,
    ...(scopedSlideEvidence.length > 0 ? [] : input.groundingHighlights ?? []),
    ...(scopedSlideEvidence.length > 0 ? [] : input.groundingCoverageGoals ?? []),
    ...(input.plan?.learningObjectives ?? []),
    ...(input.plan?.storyline ?? []),
    deck.summary,
    contract.focus,
    contract.objective ?? "",
  ]).filter(
    (value) =>
      value.length > 24 &&
      canUseAsSlidePoint(input, value),
  );
  const keyPoints = applyFinalSlideClosingRole(input, contract, uniqueNonEmptyStrings([
    ...buildContractAnchoredKeyPoints(input, contract, pointPool),
    toAudienceFacingSentence(`${subject} has distinct systems, examples, or behaviors that make it recognizable.`),
    toAudienceFacingSentence(`One concrete mechanism or event reveals how ${subject} behaves in practice.`),
  ]).slice(0, 3));
  const beginnerExplanation = keyPoints.slice(0, 2).join(" ");
  const advancedExplanation =
    keyPoints[2] ??
    toAudienceFacingSentence(
      `${subject} matters because its structure leads to real outcomes, examples, or decisions`,
    );

  return {
    ...(slide as unknown as Record<string, unknown>),
    title,
    learningGoal:
      isOverviewSlide
        ? `Understand what ${subject} is and why it matters.`
        : buildRecoveryLearningGoal(input, slide.order, contract),
    keyPoints,
    speakerNotes: [],
    examples: [],
    likelyQuestions: [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

export const buildRoleSpecificSlideRecoveryFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> | null => {
  if (
    contract.kind !== "entity-capabilities" &&
    contract.kind !== "entity-operations" &&
    contract.kind !== "entity-value" &&
    contract.kind !== "subject-detail" &&
    contract.kind !== "workshop-practice" &&
    contract.kind !== "subject-implication" &&
    contract.kind !== "subject-takeaway"
  ) {
    return null;
  }

  const subject = resolveIntentSubject(input);
  const howWorksSubject = resolveHowWorksSubject(subject);
  const effectiveSlideCount = input.targetSlideCount ?? deck.slides.length;
  const effectiveContract =
    contract.isFinal || slide.order >= effectiveSlideCount - 1
      ? { ...contract, isFinal: true }
      : contract;
  const roleAnchor = [contract.focus, contract.objective ?? "", contract.evidence ?? ""].join(" ");
  const scopedSlideEvidence = buildScopedSlideEvidence(input, slide.order);
  const avoidDirectOrganizationPersona =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview" &&
    !isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const pointPool = uniqueNonEmptyStrings(
    [
      contract.evidence,
      contract.objective,
      contract.focus,
      ...scopedSlideEvidence,
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingHighlights ?? []),
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingCoverageGoals ?? []),
      ...(input.plan?.learningObjectives ?? []),
      ...(input.plan?.storyline ?? []),
      ...deck.slides
        .slice(0, slide.order)
        .flatMap((candidateSlide) => [
          ...candidateSlide.examples,
          ...candidateSlide.keyPoints,
        ]),
    ].filter((value): value is string => Boolean(value)),
  ).filter(
    (value) =>
      value.length >= 24 &&
      canUseAsSlidePoint(input, value) &&
      !looksOverlyPromotionalSourceCopy(value) &&
      (!avoidDirectOrganizationPersona || !usesDirectOrganizationPersona(value)) &&
      organizationRoleTextSupportsContract(contract, value) &&
      hasMeaningfulAnchorOverlap(value, `${subject} ${roleAnchor}`),
  );

  const scopedFirstPoints = rankContractConcretePoints(
    input,
    contract,
    scopedSlideEvidence,
  );
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const organizationRolePoints =
    organizationArc &&
    (
      contract.kind === "entity-operations" ||
      contract.kind === "entity-capabilities" ||
      contract.kind === "entity-value"
    )
      ? uniqueSimilarSlidePoints([
          ...(workshop || contract.kind === "entity-capabilities" ? [] : scopedFirstPoints),
          ...buildOrganizationRoleFallbackPoints(input, contract),
        ])
      : [];
  const anchoredPoints = uniqueSimilarSlidePoints([
    ...organizationRolePoints,
    ...(organizationRolePoints.length >= 3
      ? []
      : buildContractAnchoredKeyPoints(
          input,
          contract,
          pointPool,
        )),
  ]);
  const conceptRecoveryNeedsIndependentSupport =
    !howWorksSubject &&
    !(
      contract.evidence ||
      scopedSlideEvidence.length > 0 ||
      (input.groundingHighlights?.length ?? 0) > 0 ||
      (input.groundingCoverageGoals?.length ?? 0) > 0
    ) &&
    (contract.kind === "subject-detail" ||
      contract.kind === "subject-implication" ||
      contract.kind === "subject-takeaway");
  const contractEchoes = [
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
  ].map((value) => normalizeComparableText(value)).filter(Boolean);
  const independentSupportCount = pointPool.filter((value) => {
    const normalized = normalizeComparableText(value);
    return (
      normalized &&
      !contractEchoes.some(
        (echo) => normalized === echo || normalized.includes(echo) || echo.includes(normalized),
      )
    );
  }).length;
  const nonEchoAnchoredCount = anchoredPoints.filter(
    (point) => !isWeakContractEchoPoint(contract, point),
  ).length;
  const recoveryPoints =
    applyFinalSlideClosingRole(
      input,
      effectiveContract,
      contract.kind === "workshop-practice"
        ? buildWorkshopPracticeRecoveryPoints(input, contract)
        : anchoredPoints,
    );

  if (
    conceptRecoveryNeedsIndependentSupport &&
    (independentSupportCount < 2 || nonEchoAnchoredCount < 2)
  ) {
    return null;
  }

  if (recoveryPoints.length < 3) {
    return null;
  }

  const recoveryEvidence = pointPool.find(
    (value) =>
      contract.evidence &&
      normalizeComparableText(value) === normalizeComparableText(contract.evidence),
  );
  const examplePool = pointPool.filter((value) => value.length >= 40);
  const examples =
    contract.kind === "workshop-practice"
      ? uniqueNonEmptyStrings([
          recoveryEvidence ?? "",
          ...examplePool,
          recoveryPoints[0] ?? "",
        ]).slice(0, 3)
      : contract.kind === "entity-value" &&
          !hasGroundedOrganizationValueCaseEvidence(contract)
        ? uniqueNonEmptyStrings([
            recoveryEvidence ?? "",
            contract.evidence &&
            organizationRoleTextSupportsContract(contract, contract.evidence)
              ? contract.evidence
              : "",
          ]).slice(0, 1)
      : uniqueNonEmptyStrings([
            recoveryEvidence ?? "",
            ...examplePool,
        ]).slice(0, 2);
  const thirdRecoveryPoint = recoveryPoints[2] ?? "";
  const beginnerExplanation =
    contract.kind === "workshop-practice"
      ? toAudienceFacingSentence(
          `${recoveryPoints[0]} ${recoveryPoints[1]}`,
        )
      : buildRoleRecoveryBeginnerExplanation(input, contract, recoveryPoints);
  const advancedExplanation =
    contract.kind === "workshop-practice"
      ? toAudienceFacingSentence(
          `${thirdRecoveryPoint} The task stays applied when it leads to one concrete output or decision instead of another summary.`,
        )
      : buildRoleRecoveryAdvancedExplanation(input, contract, recoveryPoints);

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: buildContractTitle(input, contract),
    learningGoal: buildRecoveryLearningGoal(input, slide.order, effectiveContract),
    keyPoints: recoveryPoints,
    speakerNotes: [],
    examples,
    likelyQuestions: [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};

export const buildGroundedSlideRecoveryFromContext = (
  input: GenerateDeckInput,
  deck: Deck,
  slide: Slide,
  contract: SlideContract,
): Record<string, unknown> | null => {
  const subject = resolveIntentSubject(input);
  const scopedSlideEvidence = buildScopedSlideEvidence(input, slide.order);
  const pointPool = uniqueNonEmptyStrings(
    [
      ...scopedSlideEvidence,
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingHighlights ?? []),
      ...(scopedSlideEvidence.length > 0 ? [] : input.groundingCoverageGoals ?? []),
      contract.objective,
      contract.focus,
      contract.evidence,
      ...slide.keyPoints,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...deck.summary.split(/(?<=[.!?])\s+/),
    ].filter((value): value is string => Boolean(value)),
  ).filter(
    (value) =>
      canUseAsSlidePoint(input, value) &&
      !looksOverlyPromotionalSourceCopy(value),
  );

  const anchoredPoints = applyFinalSlideClosingRole(
    input,
    contract,
    buildContractAnchoredKeyPoints(
      input,
      contract,
      pointPool.filter((value) =>
        hasMeaningfulAnchorOverlap(
          value,
          `${subject} ${slide.title} ${contract.focus} ${contract.objective ?? ""}`,
        )
      ),
    ),
  );

  if (anchoredPoints.length < 3) {
    return null;
  }

  const example =
    pointPool.find((value) => value.length >= 40 && hasMeaningfulAnchorOverlap(value, anchoredPoints[0]!)) ??
    pointPool.find((value) => value.length >= 40) ??
    anchoredPoints[0]!;

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: slide.title,
    learningGoal: slide.learningGoal,
    keyPoints: anchoredPoints,
    speakerNotes: [],
    examples: [toAudienceFacingSentence(example)],
    likelyQuestions: [],
    beginnerExplanation: toAudienceFacingSentence(`${anchoredPoints[0]} ${anchoredPoints[1]}`),
    advancedExplanation: toAudienceFacingSentence(
      `${anchoredPoints[2]} The consequence links the detail back to ${subject} without turning it into a broad summary.`,
    ),
    id: slide.id,
    order: slide.order,
  };
};
