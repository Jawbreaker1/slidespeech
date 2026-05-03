import type { GenerateDeckInput } from "@slidespeech/types";

import {
  DECK_SHAPE_META_PATTERNS,
  DECK_SHAPE_SUMMARY_PATTERNS,
  contractTextSimilarity,
  countAnchorOverlap,
  hasMeaningfulAnchorOverlap,
  looksOverlyPromotionalSourceCopy,
  normalizeComparableText,
  toAudienceFacingSentence,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import {
  ORGANIZATION_ROLE_KINDS,
  countOrganizationRoleSignals,
  hasGroundedOrganizationValueCaseEvidence,
  isOrganizationRoleKind,
  looksUnsupportedOrganizationValueCase,
  looksUnsupportedOrganizationValueToolDetail,
  organizationRoleTextSupportsContract,
} from "./organization-role-contracts";
import {
  deriveSlideArcPolicy,
  isWorkshopPresentation,
  resolveIntentFocusAnchor,
  resolveIntentSubject,
} from "./slide-arc-policy";
import {
  canUseAsSlidePoint,
  sanitizeContractText,
} from "./slide-contract-text";
import type {
  ArcPolicyInput,
  SlideContract,
} from "./slide-contract-types";
import { matchesStrictGroundedAnchor } from "./slide-draft-anchors";
import {
  lowerCaseFirstCharacter,
  resolveAudienceLabel,
  subjectToWorkshopNounPhrase,
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

const proceduralFocusLabel = (focus: string): string =>
  focus
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^to\s+(?:recognize|identify|explain|understand|see)\s+/i, "")
    .replace(/^to\s+/i, "")
    .trim();

const scoreContractConcretePoint = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  point: string,
): number => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const anchors = uniqueNonEmptyStrings([
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    contract.kind === "subject-detail" ||
    contract.kind === "subject-implication" ||
    contract.kind === "subject-takeaway"
      ? focusAnchor ?? ""
      : "",
    subject,
  ]);
  const pointTokens = [...new Set(tokenizeDeckShapeText(point))];
  const contractEchoPenalty = [contract.focus, contract.objective ?? "", contract.evidence ?? ""]
    .filter((anchor) => anchor.length > 0)
    .reduce((penalty, anchor) => {
      const anchorTokens = new Set(tokenizeDeckShapeText(anchor));
      if (anchorTokens.size === 0 || pointTokens.length === 0) {
        return penalty;
      }

      const similarity = contractTextSimilarity(point, anchor);
      const novelTokenCount = pointTokens.filter((token) => !anchorTokens.has(token)).length;
      return similarity >= 0.82 && novelTokenCount <= 1 ? Math.min(penalty, -8) : penalty;
    }, 0);

  const focusOverlap = countAnchorOverlap(point, contract.focus);
  const objectiveOverlap = contract.objective
    ? countAnchorOverlap(point, contract.objective)
    : 0;
  const evidenceOverlap = contract.evidence
    ? countAnchorOverlap(point, contract.evidence)
    : 0;
  const totalOverlap = anchors.reduce(
    (sum, anchor) => sum + countAnchorOverlap(point, anchor),
    0,
  );
  const meaningfulOverlap = anchors.some((anchor) =>
    hasMeaningfulAnchorOverlap(point, anchor),
  )
    ? 3
    : 0;
  const organizationRoleScore = isOrganizationRoleKind(contract.kind)
    ? countOrganizationRoleSignals(contract.kind, point) * 4
    : 0;
  const organizationRolePenalty = isOrganizationRoleKind(contract.kind)
    ? Math.max(
        ...ORGANIZATION_ROLE_KINDS.filter((candidate) => candidate !== contract.kind).map(
          (candidate) => countOrganizationRoleSignals(candidate, point),
        ),
      ) * -3
    : 0;
  const lengthScore = point.length >= 52 ? 2 : point.length >= 36 ? 1 : 0;
  const summaryPenalty = DECK_SHAPE_SUMMARY_PATTERNS.some((pattern) => pattern.test(point))
    ? -4
    : 0;
  const promoPenalty = looksOverlyPromotionalSourceCopy(point)
    ? -6
    : 0;
  const unsupportedOrganizationValuePenalty =
    looksUnsupportedOrganizationValueCase(contract, point) ||
    looksUnsupportedOrganizationValueToolDetail(contract, point)
      ? -10
      : 0;

  switch (contract.kind) {
    case "entity-value":
      return (
        evidenceOverlap * 6 +
        objectiveOverlap * 3 +
        focusOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        organizationRoleScore +
        organizationRolePenalty +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty +
        unsupportedOrganizationValuePenalty
      );
    case "workshop-practice":
      return (
        objectiveOverlap * 5 +
        evidenceOverlap * 4 +
        focusOverlap * 3 +
        totalOverlap +
        meaningfulOverlap +
        organizationRoleScore +
        organizationRolePenalty +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty +
        unsupportedOrganizationValuePenalty
      );
    case "entity-operations":
      return (
        objectiveOverlap * 4 +
        focusOverlap * 3 +
        evidenceOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        organizationRoleScore +
        organizationRolePenalty +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty +
        unsupportedOrganizationValuePenalty
      );
    default:
      return (
        focusOverlap * 3 +
        objectiveOverlap * 2 +
        evidenceOverlap * 2 +
        totalOverlap +
        meaningfulOverlap +
        organizationRoleScore +
        organizationRolePenalty +
        lengthScore +
        contractEchoPenalty +
        summaryPenalty +
        promoPenalty +
        unsupportedOrganizationValuePenalty
      );
  }
};

export const isWeakContractEchoPoint = (
  contract: SlideContract,
  point: string,
): boolean => {
  const pointTokens = [...new Set(tokenizeDeckShapeText(point))];
  if (pointTokens.length === 0) {
    return false;
  }

  return [contract.focus, contract.objective ?? "", contract.evidence ?? ""]
    .filter((anchor) => anchor.length > 0)
    .some((anchor) => {
      const anchorTokens = new Set(tokenizeDeckShapeText(anchor));
      if (anchorTokens.size === 0) {
        return false;
      }

      const similarity = contractTextSimilarity(point, anchor);
      const novelTokenCount = pointTokens.filter((token) => !anchorTokens.has(token)).length;
      return similarity >= 0.82 && novelTokenCount <= 1;
    });
};

export const rankContractConcretePoints = (
  input: Pick<GenerateDeckInput, "topic" | "intent">,
  contract: SlideContract,
  concretePointPool: string[],
): string[] =>
  uniqueNonEmptyStrings(concretePointPool)
    .filter(
      (point) =>
        canUseAsSlidePoint(input, point) &&
        !(contract.kind === "orientation" && isWeakContractEchoPoint(contract, point)) &&
        !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(point)),
    )
    .map((point, index) => ({
      point,
      index,
      score: scoreContractConcretePoint(input, contract, point),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.point.length !== right.point.length) {
        return right.point.length - left.point.length;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.point);

const removeCompositeSlidePoints = (points: string[]): string[] =>
  points.filter((point, index) => {
    const normalizedPoint = normalizeComparableText(point);
    if (!normalizedPoint) {
      return false;
    }

    const containedPoints = points.filter((other, otherIndex) => {
      if (otherIndex === index) {
        return false;
      }

      const normalizedOther = normalizeComparableText(other);
      return (
        normalizedOther.length >= 32 &&
        normalizedPoint.length >= normalizedOther.length * 1.45 &&
        normalizedPoint.includes(normalizedOther)
      );
    });

    return containedPoints.length < 2;
  });

export const buildContractAnchoredKeyPoints = (
  input: Pick<
    GenerateDeckInput,
    "topic" | "intent" | "groundingHighlights" | "groundingCoverageGoals"
  >,
  contract: SlideContract,
  concretePointPool: string[],
): string[] => {
  const subject = resolveIntentSubject(input);
  const focusAnchor = resolveIntentFocusAnchor(input);
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  const audienceLabel = resolveAudienceLabel(input);
  const workshopNounPhrase = subjectToWorkshopNounPhrase(subject);
  const organizationArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "organization-overview";
  const proceduralArc =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "procedural";
  const sourceBackedSubject =
    deriveSlideArcPolicy(input as ArcPolicyInput) === "source-backed-subject";
  const howWorksSubject = resolveHowWorksSubject(subject);
  const interruptionAwareTeachingSubject = howWorksSubject
    ? isInterruptionAwareTeachingSubject(howWorksSubject)
    : false;
  const focus = sanitizeContractText(contract.focus, subject);
  const proceduralOutcome = proceduralOutcomeLabel(subject).toLowerCase();
  const foodLikeProcedural =
    input.intent?.contentMode === "procedural" &&
    /\b(?:salsa|dip|sauce|soup|salad|bread|cake|meal|dish|food|recipe|cook|bake|tomato|ingredient)\b/i.test(
      subject,
    );
  const proceduralFocus = proceduralFocusLabel(focus);
  const objective = contract.objective
    ? sanitizeContractText(contract.objective, subject)
    : "";
  const evidence = contract.evidence
    ? sanitizeContractText(contract.evidence, subject)
    : "";
  const roleReadyEvidence =
    isOrganizationRoleKind(contract.kind) &&
    evidence &&
    !organizationRoleTextSupportsContract(contract, evidence)
      ? ""
      : evidence;
  const lowerFocus = lowerCaseFirstCharacter(focus);
  const anchorStatements = (() => {
    switch (contract.kind) {
      case "orientation":
        return [];
      case "subject-detail":
        return [
          focus
            ? sourceBackedSubject
              ? `${focus} is one specific event, mechanism, or fact inside ${subject}.`
              : `${focus} is one concrete detail that makes ${subject} specific.`
            : focusAnchor
              ? sourceBackedSubject
                ? `${focusAnchor} is one specific event, mechanism, or fact inside ${subject}.`
                : `${focusAnchor} is one concrete detail that makes ${subject} specific.`
              : "",
          objective && objective !== focus
            ? sourceBackedSubject
              ? `${objective} adds the event, mechanism, or evidence that keeps ${subject} specific.`
              : `${objective} becomes clearer when that concrete detail is examined closely.`
            : "",
        ];
      case "subject-implication":
        return [
          focus
            ? sourceBackedSubject
              ? `${focus} connects the earlier evidence to a broader consequence within ${subject}.`
              : `${focus} explains what the earlier detail changes, reveals, or means within ${subject}.`
            : "",
          objective && objective !== focus
            ? sourceBackedSubject
              ? `${objective} interprets the detail rather than restating it.`
              : `${objective} should interpret the detail rather than restate it.`
            : "",
          focusAnchor
            ? sourceBackedSubject
              ? `${focusAnchor} remains the event or evidence behind this consequence.`
              : `The explanation should build on ${focusAnchor} instead of reopening the broad subject from scratch.`
            : "",
        ];
      case "subject-takeaway":
        return [
          focus
            ? sourceBackedSubject
              ? `${focus} connects the strongest lesson from ${subject} to the earlier evidence.`
              : `${focus} ties the strongest lesson from ${subject} to the earlier concrete detail.`
            : "",
          objective && objective !== focus
            ? sourceBackedSubject
              ? `${objective} brings the main evidence and consequence together.`
              : `${objective} becomes clearer when the main detail and implication are brought together.`
            : "",
          focusAnchor
            ? sourceBackedSubject
              ? `${focusAnchor} remains the evidence behind the final lesson.`
              : `The main takeaway should grow out of ${focusAnchor} rather than introducing a different case.`
            : "",
        ];
      case "coverage":
      case "development":
        return [
          focus ? `${focus} is one concrete part of ${subject}.` : "",
          objective && objective !== focus
            ? `${objective} becomes clearer when ${lowerFocus || "this area"} is examined closely.`
            : "",
        ];
      case "procedural-ingredients":
        return [
          proceduralFocus
            ? `${proceduralFocus} should explain what must be balanced before ${proceduralOutcome} starts coming together.`
            : "",
          objective && objective !== focus
            ? `${objective} depends on clear roles for the main materials, flavors, or constraints.`
            : "",
        ];
      case "procedural-steps":
        return [
          proceduralFocus
            ? `${proceduralFocus} should show what each action changes in the final result.`
            : "",
          objective && objective !== focus
            ? `${objective} depends on sequencing, checking, and adjusting while the work is underway.`
            : "",
        ];
      case "procedural-quality":
        return [
          proceduralFocus
            ? contract.isFinal
              ? `${proceduralFocus} should name the final checks that decide when ${proceduralOutcome} is ready to use or serve.`
              : `${proceduralFocus} should separate tasting adjustments from final serving checks.`
            : "",
          objective && objective !== focus
            ? contract.isFinal
              ? `${objective} comes from final checks that confirm the result holds together.`
              : `${objective} comes from small changes that can be tasted, checked, and adjusted before serving.`
            : "",
        ];
      case "synthesis":
        return organizationArc
          ? [
              `${subject} connects QA services, operating footprint, collaboration model, and software quality outcomes.`,
              `Product owners, project managers, and test leads see the model through risk reduction, validation work, and delivery support.`,
            ]
          : [
              focus ? `${focus} captures one of the strongest takeaways from ${subject}.` : "",
              objective && objective !== focus
                ? `${objective} is easier to remember when the main ideas are tied together clearly.`
                : "",
            ];
      case "entity-capabilities":
        return [
          workshop
            ? audienceLabel
              ? `AI produces different draft artifacts for ${audienceLabel}: status notes, backlog material, and test ideas.`
              : `AI produces different draft artifacts for planning, backlog, and testing work.`
            : `${subject} provides QA services, advisory support, workshops, and automation capabilities for software delivery teams.`,
          workshop
            ? `The same raw input can become a project risk note, a backlog candidate, or a test coverage question depending on the role.`
            : `Quality management, quality operations, test automation, and advisory support define the service portfolio.`,
        ];
      case "entity-operations":
        return [
          workshop
            ? `AI output needs human review before it becomes a decision, requirement, or test artifact.`
            : `${subject} operates through delivery collaboration, QA specialists, and regional presence.`,
          workshop
            ? `A review step catches sensitive details before a draft leaves the team.`
            : `Local teams and client-facing delivery practices connect the organization to software quality work.`,
          workshop
            ? `The team confirms the allowed tool and information class before using AI on real material.`
            : "",
        ];
      case "entity-value":
        return hasGroundedOrganizationValueCaseEvidence(contract)
          ? [
              `One concrete customer outcome links ${subject} to software quality decisions.`,
              `A recognizable result shows how the organization affects delivery risk and reliability.`,
            ]
          : [
              `Advisory workshops identify risks early before custom features or data flows reach release decisions.`,
              `Data-flow validation and custom-feature checks provide earlier evidence for software quality decisions.`,
            ];
      case "workshop-practice":
        return [
          audienceLabel
            ? `${audienceLabel} start AI-assisted work from one realistic artifact such as notes, a backlog item, a risk list, or a test scenario.`
            : `AI-assisted work starts from one realistic artifact such as notes, a backlog item, a risk list, or a test scenario.`,
          `The exercise ends with one reusable prompt, output, or decision that can be taken back into daily work.`,
        ];
      default:
        return [];
    }
  })();
  const fallbackStatements = (() => {
    switch (contract.kind) {
      case "orientation":
        return proceduralArc
          ? [
              `The intended result should be clear before materials, timing, or technique are chosen.`,
              `Each action should change the result in a way that can be checked during the process.`,
              `Final checks and small adjustments determine when ${proceduralOutcome} is ready.`,
            ]
          : howWorksSubject
          ? interruptionAwareTeachingSubject
            ? [
                `A learner asks a question before the teacher finishes the current example.`,
                `The answer has to solve the side question without erasing the unfinished task.`,
                `The original lesson path remains active while the side question is handled.`,
              ]
            : [
                `${howWorksSubject} starts with an input or situation that needs a response.`,
                `The mechanism changes an internal process or state before producing a visible result.`,
                `The useful test is whether the result follows from the input without skipping the important middle step.`,
              ]
          : organizationArc
          ? workshop
            ? [
                `${workshopNounPhrase} starts with draft material that a person can check and improve.`,
                `Planning, coordination, backlog, and testing tasks are safer targets than final decisions.`,
                `The first useful result is one reviewable output, not an unverified answer.`,
              ]
            : [
                `${subject} combines quality assurance services, advisory support, and delivery work around software reliability.`,
                `${subject}'s operating footprint and delivery model show where teams can engage the organization.`,
                `Newcomers place ${subject} by connecting its QA identity, locations, service areas, and quality outcomes.`,
              ]
          : [
              `${subject} is clearer when its purpose, structure, and a grounded example are visible together.`,
              `A specific consequence or responsibility shows why ${subject} matters.`,
              `${subject} becomes clearer when people can name what it is and what it changes.`,
            ];
      case "subject-detail":
        return howWorksSubject
          ? interruptionAwareTeachingSubject
            ? [
                `The active concept names what the learner was trying to understand.`,
                `The unfinished step records exactly where the explanation stopped.`,
                `The learner question becomes a temporary focus inside the same lesson thread.`,
              ]
            : [
                `The input tells ${howWorksSubject} that the current situation needs to change.`,
                `The internal state or process keeps track of what changed before any result is shown.`,
                `The output should make the internal change visible as a concrete result.`,
              ]
          : sourceBackedSubject
            ? [
                `${focus || focusAnchor || subject} names the incident or mechanism that moves ${subject} beyond a broad overview.`,
                `Specific evidence keeps ${subject} from becoming a broad overview.`,
                `The detail is strongest when it names what happened, who or what was involved, and what changed.`,
              ]
          : [
              `${contract.focus} gives ${subject} a concrete center instead of leaving it as a broad idea.`,
              `Specific parts, examples, or mechanisms make ${subject} easier to explain and remember.`,
              `One recognizable detail gives the rest of the explanation something concrete to build on.`,
            ];
      case "subject-implication":
        return howWorksSubject
          ? interruptionAwareTeachingSubject
            ? [
                `The answer borrows terms from the paused example so it does not feel detached.`,
                `A return sentence names the shared term that connects the answer to the original problem.`,
                `The next explanation can continue from the unfinished step instead of rebuilding context.`,
              ]
            : [
                `The next result changes because the mechanism has updated what it knows about the current situation.`,
                `Continuity is visible when the result clearly follows from both the input and the internal change.`,
                `The practical consequence is a traceable path from starting signal to visible response.`,
              ]
          : sourceBackedSubject
            ? [
                `${focus || focusAnchor || subject} matters because it connects the event or fact to a broader consequence.`,
                `Consequence and significance add a new layer instead of repeating the same event mechanics.`,
                `The useful implication is what became visible, changed, or mattered after the first detail.`,
              ]
          : [
              `The earlier detail matters because it changes, reveals, or teaches something specific about ${subject}.`,
              `Consequence and significance make the subject clearer than repeating the same description.`,
              `Interpreting the concrete detail clarifies ${subject} more than naming the same detail again.`,
            ];
      case "subject-takeaway":
        return howWorksSubject
          ? interruptionAwareTeachingSubject
            ? [
                `The learner gets the side answer and immediately sees the next action in the original task.`,
                `The lesson fails when the learner has to restate the context after the answer.`,
                `The memorable result is a lesson path that stays continuous after an interruption.`,
              ]
            : [
                `The strongest test is whether ${howWorksSubject} makes the input, internal change, and result visible.`,
                `A good mechanism is easier to explain when the middle step is visible, not just the final result.`,
                `The useful final question is where the trace can break between input, internal change, and visible result.`,
              ]
          : sourceBackedSubject
            ? [
                `${focus || focusAnchor || subject} points to a lesson that depends on the earlier evidence and consequence.`,
                `The final lesson stays tied to what was shown instead of introducing a new unsupported example.`,
                `The closing idea is what the audience can carry forward from the supported incident or mechanism.`,
              ]
          : [
              `The strongest takeaway connects the concrete detail to the larger lesson the audience should retain.`,
              `Earlier evidence and implication make the main lesson easier to remember when they are brought together clearly.`,
              `The takeaway is easier to remember when it names what the subject teaches, not just what happened.`,
            ];
      case "procedural-ingredients":
        return foodLikeProcedural
          ? [
              `Ripe tomatoes give the dip its body, onion adds crunch, and jalapeno or chili should be added gradually so heat can be raised without taking over.`,
              `A small squeeze of lime adds acidity, and a small pinch of salt should be added gradually so the tomato flavor stays balanced.`,
              `Cilantro or another fresh herb belongs near the end so the flavor stays fresh instead of muddy.`,
            ]
          : [
              `The first choices should make the intended flavor, texture, or function clear before the work starts.`,
              `Each material or ingredient should have a visible job in the final result.`,
              `A strong ${proceduralOutcome} is easier to make when the starting choices support the same outcome.`,
            ];
      case "procedural-steps":
        return foodLikeProcedural
          ? [
              `Dice tomatoes and onion into small, similar pieces so the dip stays scoopable.`,
              `Fold in chili, lime, salt, and herbs gradually so heat and acidity can be adjusted before serving.`,
              `Let very juicy tomatoes drain briefly before the final seasoning so the dip does not loosen in the bowl.`,
            ]
          : [
              `The main actions should change the result in ways the audience can check while working.`,
              `Sequencing matters because early choices affect what can still be adjusted later.`,
              `Preparation is easier to control when every step has an observable purpose.`,
            ];
      case "procedural-quality":
        return foodLikeProcedural
          ? contract.isFinal
            ? [
              `Taste the salsa with the chip or food it will be served with because salt, acid, and heat read differently there.`,
              `Adjust only one lever at a time: salt for flatness, lime for dullness, chili for heat, or drained juice for loose texture.`,
                `The strongest finish is balanced flavor plus a texture that still holds together on the serving chip or spoon.`,
              ]
            : [
                `Taste one small sample before serving so salt, acid, heat, or sweetness can be adjusted separately.`,
                `Small adjustments should correct one visible or sensory problem at a time.`,
                `The final serving check is easier when seasoning and texture have already been adjusted.`,
              ]
          : contract.isFinal
            ? [
                `A finished ${proceduralOutcome} should hold together without excess liquid, harsh seasoning, or unfinished texture.`,
                `Serving readiness is easier to judge when the result tastes balanced and looks cohesive.`,
                `The strongest finish names the specific cue that still needs adjustment.`,
              ]
            : [
                `Taste one small sample before serving so salt, acid, heat, or sweetness can be adjusted separately.`,
                `Small adjustments should correct one visible or sensory problem at a time.`,
                `The final serving check is easier when seasoning and texture have already been adjusted.`,
              ];
      case "synthesis":
        return organizationArc
          ? [
              `${subject} combines operating footprint, QA capabilities, collaboration model, and risk reduction into one service story.`,
              `${subject} treats software quality as an integrated delivery responsibility rather than a late testing checkpoint.`,
              `The strongest audience question is which product, project, or test challenge would benefit most from that model.`,
            ]
          : [
              `The most important lessons about ${subject} are easier to retain when they are tied together clearly.`,
              `The key ideas from ${subject} reinforce one another instead of standing alone.`,
              `Value, structure, and example make ${subject} more coherent when they are connected directly.`,
            ];
      case "entity-capabilities":
        return [
          workshop
            ? `For a project manager, meeting notes become action items, status updates, and risk follow-ups.`
            : `${subject} offers QA services, advisory support, workshops, and automation capabilities across software delivery.`,
          workshop
            ? `For a product owner, feedback or draft requirements become backlog candidates and acceptance criteria.`
            : `${subject}'s capabilities are visible through quality management, quality operations, test automation, and advisory support.`,
          workshop
            ? `For a test lead, requirements or defect reports become scenario ideas and coverage questions.`
            : `Product and test teams use those capabilities to validate requirements, data flows, custom features, and release risks.`,
        ];
      case "entity-operations":
        return [
          workshop
            ? `A review step catches sensitive details before a draft leaves the team.`
            : `${subject} works through local teams, collaborative delivery, and QA integrated into client workflows.`,
          workshop
            ? `People check facts, source material, sensitive information, and policy fit before trusting an AI result.`
            : `The operating model connects product owners, project managers, and test leads with QA specialists during delivery.`,
          workshop
            ? `Unverified AI output stays as draft material until a responsible person accepts it.`
            : `Geographic reach and delivery structure determine where the organization can support software quality work.`,
        ];
      case "entity-value":
        return hasGroundedOrganizationValueCaseEvidence(contract)
          ? [
              `A concrete customer outcome or example shows why ${subject} matters in practice.`,
              `Specific quality outcomes show how ${subject} affects delivery risk and software reliability.`,
              `A recognizable result gives product, project, and test teams a concrete reason to care.`,
            ]
          : [
              `Advisory workshops identify risks early before custom features or data flows reach release decisions.`,
              `Data-flow validation and custom-feature checks provide earlier evidence for software quality decisions.`,
              `Validation work helps teams avoid late surprises in custom features and data flows.`,
            ];
      case "workshop-practice":
        return [
          `A practical task starts with one real artifact such as notes, a backlog item, a risk list, or a test scenario.`,
          `The first AI draft is useful only after facts, sensitive information, and policy boundaries are checked.`,
          `The reusable result is one prompt, output, or review checklist for daily work.`,
        ];
      default:
        return [
          focus
            ? `${focus} is one concrete part of ${subject}.`
            : `One concrete area makes ${subject} easier to understand.`,
          focus
            ? `${focus} changes what people notice, decide, or do around ${subject}.`
            : `${subject} becomes clearer when one concrete mechanism or consequence is examined closely.`,
          objective && objective !== focus
            ? `${objective} is one practical reason this part of ${subject} matters.`
            : `${subject} becomes clearer when its mechanisms, roles, or consequences are made explicit.`,
        ];
    }
  })();
  const rankedConcretePoints = rankContractConcretePoints(
    input,
    contract,
    concretePointPool,
  );
  const normalizedEvidence = normalizeComparableText(contract.evidence ?? "");
  const concreteNonEchoPoints = rankedConcretePoints.filter(
    (point) =>
      !isWeakContractEchoPoint(contract, point) ||
      (normalizedEvidence.length > 0 &&
        normalizeComparableText(point) === normalizedEvidence),
  );
  const sourceGroundingAnchors = uniqueNonEmptyStrings([
    contract.evidence ?? "",
    contract.objective ?? "",
    contract.focus,
    ...(input.groundingHighlights ?? []),
    ...(input.groundingCoverageGoals ?? []),
  ]).filter((anchor) => normalizeComparableText(anchor) !== normalizeComparableText(subject));
  const sourceReadyConcretePoints = sourceBackedSubject
    ? concreteNonEchoPoints.filter((point) =>
        matchesStrictGroundedAnchor(point, sourceGroundingAnchors),
      )
    : concreteNonEchoPoints;
  const orientationConcretePoints =
    contract.kind === "orientation"
      ? concreteNonEchoPoints.filter(
          (point) =>
            ![focus, objective]
              .filter((anchor) => anchor.length > 0)
              .some((anchor) => contractTextSimilarity(point, anchor) >= 0.6),
        )
      : concreteNonEchoPoints;
  const prioritizedStatements =
    organizationArc && contract.kind === "orientation"
      ? [
          canUseAsSlidePoint(input, objective)
            ? toAudienceFacingSentence(objective)
            : null,
          canUseAsSlidePoint(input, focus)
            ? toAudienceFacingSentence(focus)
            : null,
          ...anchorStatements
            .filter((statement) => statement.length > 0)
            .map((statement) => toAudienceFacingSentence(statement)),
          ...(orientationConcretePoints.length > 0
            ? orientationConcretePoints.slice(0, 1)
            : rankedConcretePoints.slice(0, 1)
          ).map((point) => toAudienceFacingSentence(point)),
          ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
        ]
      : organizationArc &&
          (contract.kind === "entity-capabilities" ||
            contract.kind === "entity-operations" ||
            contract.kind === "entity-value")
        ? [
            canUseAsSlidePoint(input, roleReadyEvidence)
              ? toAudienceFacingSentence(roleReadyEvidence)
              : null,
            ...concreteNonEchoPoints
              .slice(0, 3)
              .map((point) => toAudienceFacingSentence(point)),
            ...anchorStatements
              .filter((statement) => statement.length > 0)
              .map((statement) => toAudienceFacingSentence(statement)),
            ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
          ]
        : sourceBackedSubject &&
            (contract.kind === "subject-detail" ||
              contract.kind === "subject-implication" ||
              contract.kind === "subject-takeaway")
          ? [
              canUseAsSlidePoint(input, evidence)
                ? toAudienceFacingSentence(evidence)
                : null,
              ...sourceReadyConcretePoints
                .slice(0, 3)
                .map((point) => toAudienceFacingSentence(point)),
              canUseAsSlidePoint(input, objective)
                ? toAudienceFacingSentence(objective)
                : null,
              canUseAsSlidePoint(input, focus)
                ? toAudienceFacingSentence(focus)
                : null,
              ...anchorStatements
                .filter((statement) => statement.length > 0)
                .map((statement) => toAudienceFacingSentence(statement)),
              ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
            ]
        : contract.kind === "workshop-practice"
          ? [
              ...rankedConcretePoints.map((point) => toAudienceFacingSentence(point)),
              ...anchorStatements
                .filter((statement) => statement.length > 0)
                .map((statement) => toAudienceFacingSentence(statement)),
              canUseAsSlidePoint(input, evidence)
                ? toAudienceFacingSentence(evidence)
                : null,
              ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
            ]
        : proceduralArc &&
            (contract.kind === "procedural-ingredients" ||
              contract.kind === "procedural-steps" ||
              contract.kind === "procedural-quality")
          ? [
              ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
            ]
        : contract.kind === "orientation" && howWorksSubject
          ? [
              ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
            ]
        : howWorksSubject &&
            (contract.kind === "subject-detail" ||
              contract.kind === "subject-implication" ||
              contract.kind === "subject-takeaway")
          ? [
              ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
            ]
        : [
            ...(orientationConcretePoints.length > 0
              ? orientationConcretePoints
            : rankedConcretePoints
            ).map((point) => toAudienceFacingSentence(point)),
            ...anchorStatements
              .filter((statement) => statement.length > 0)
              .map((statement) => toAudienceFacingSentence(statement)),
            canUseAsSlidePoint(input, evidence)
              ? toAudienceFacingSentence(evidence)
              : null,
            canUseAsSlidePoint(input, objective)
              ? toAudienceFacingSentence(objective)
              : null,
            canUseAsSlidePoint(input, focus)
              ? toAudienceFacingSentence(focus)
              : null,
            ...fallbackStatements.map((statement) => toAudienceFacingSentence(statement)),
          ];

  const usablePrioritizedStatements = uniqueNonEmptyStrings(
    prioritizedStatements.filter((value): value is string => Boolean(value)),
  ).filter((point) => canUseAsSlidePoint(input, point));
  const concisePrioritizedStatements = removeCompositeSlidePoints(
    usablePrioritizedStatements,
  );
  const keepContentPoints = (points: string[]): string[] =>
    uniqueNonEmptyStrings(points).filter(
      (point) => !/\b(?:closing|final)\s+questions?\b/i.test(point),
    ).slice(0, 3);

  if (concisePrioritizedStatements.length >= 3) {
    return keepContentPoints(concisePrioritizedStatements);
  }

  const usableFallbackStatements = fallbackStatements
    .map((statement) => toAudienceFacingSentence(statement))
    .filter((point) => canUseAsSlidePoint(input, point));

  return keepContentPoints(removeCompositeSlidePoints(uniqueNonEmptyStrings([
    ...concisePrioritizedStatements,
    ...usableFallbackStatements,
  ])));
};
