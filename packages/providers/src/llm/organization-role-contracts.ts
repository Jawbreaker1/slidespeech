import type { GenerateDeckInput } from "@slidespeech/types";

import { toAudienceFacingSentence } from "./deck-shape-text";
import type { SlideContract } from "./slide-contract-types";

export type OrganizationRoleKind =
  | "entity-capabilities"
  | "entity-operations"
  | "entity-value";

const ORGANIZATION_ROLE_SIGNAL_PATTERNS: Record<
  OrganizationRoleKind,
  RegExp[]
> = {
  "entity-capabilities": [
    /\bservice(?:s)?\b/i,
    /\bcapabilit(?:y|ies)\b/i,
    /\boffer(?:s|ed|ing)?\b/i,
    /\badvisory\b/i,
    /\bworkshop(?:s)?\b/i,
    /\btesting\b/i,
    /\bquality assurance\b/i,
    /\bquality management\b/i,
    /\bverification support\b/i,
    /\bautomation framework(?:s)?\b/i,
    /\bplaywright\b|\bselenium\b|\bcypress\b|\branorex\b/i,
  ],
  "entity-operations": [
    /\boperate(?:s|d|ing)?\b/i,
    /\boperat(?:ion|ions|ional)\b/i,
    /\bdelivery\b/i,
    /\bdelivered\b/i,
    /\bteam(?:s)?\b/i,
    /\bworkflow(?:s)?\b/i,
    /\bprocess(?:es)?\b/i,
    /\bfootprint\b/i,
    /\bday-to-day\b/i,
    /\bdaily operations\b/i,
    /\bci\/cd\b/i,
    /\bpipeline(?:s)?\b/i,
    /\bsweden\b|\bgermany\b|\bbosnia\b|\bpoland\b|\bdenmark\b/i,
    /\bacross\b/i,
    /\bcollaborat(?:e|es|ion)\b/i,
  ],
  "entity-value": [
    /\bcustomer\b|\bclient\b/i,
    /\boutcome(?:s)?\b/i,
    /\bresult(?:s)?\b/i,
    /\bimpact\b/i,
    /\bexample\b/i,
    /\bcase\b/i,
    /\bconsequence(?:s)?\b/i,
    /\bbenefit(?:s)?\b/i,
    /\bmeasurable\b/i,
    /\breduced\b|\bimproved\b|\bincreased\b|\bsaved\b/i,
    /\brisk\b|\breliab(?:le|ility)\b|\btrustworthy\b/i,
    /\benabled\b|\bkept\b/i,
    /\baudit findings\b/i,
    /\bdeployment\b/i,
    /\bzero-defect\b/i,
    /\bvalue\b/i,
  ],
};

const ORGANIZATION_ROLE_STRONG_SIGNAL_PATTERNS: Record<
  OrganizationRoleKind,
  RegExp[]
> = {
  "entity-capabilities": [
    /\bservice(?:s)?\b/i,
    /\bcapabilit(?:y|ies)\b/i,
    /\boffer(?:s|ed|ing)?\b/i,
    /\badvisory\b/i,
    /\bworkshop(?:s)?\b/i,
    /\btesting\b/i,
    /\bquality assurance\b/i,
    /\bquality management\b/i,
    /\bverification support\b/i,
    /\bautomation framework(?:s)?\b/i,
    /\bplaywright\b|\bselenium\b|\bcypress\b|\branorex\b/i,
  ],
  "entity-operations": [
    /\boperate(?:s|d|ing)?\b/i,
    /\boperat(?:ion|ions|ional)\b/i,
    /\bdelivery model\b/i,
    /\bdelivered\b/i,
    /\bteam(?:s)?\b/i,
    /\bworkflow(?:s)?\b/i,
    /\bprocess(?:es)?\b/i,
    /\bfootprint\b/i,
    /\bday-to-day\b/i,
    /\bdaily operations\b/i,
    /\bsweden\b|\bgermany\b|\bbosnia\b|\bpoland\b|\bdenmark\b|\bnordics?\b/i,
    /\bcross-regional\b|\bdistributed\b|\bgeographic\b/i,
    /\bcollaborat(?:e|es|ion)\b/i,
  ],
  "entity-value": [
    /\boutcome(?:s)?\b/i,
    /\bresult(?:s)?\b/i,
    /\bimpact\b/i,
    /\bconsequence(?:s)?\b/i,
    /\bbenefit(?:s)?\b/i,
    /\bmeasurable\b/i,
    /\breduced\b|\bimproved\b|\bincreased\b|\bsaved\b/i,
    /\brisk\b|\breliab(?:le|ility)\b|\btrustworthy\b/i,
    /\benabled\b|\bkept\b/i,
    /\baudit findings\b/i,
    /\bdeployment\b/i,
    /\bzero-defect\b/i,
  ],
};

const ORGANIZATION_VALUE_CONCRETE_PATTERNS = [
  /\bcustomer\b|\bclient\b/i,
  /\boutcome(?:s)?\b/i,
  /\bresult(?:s)?\b/i,
  /\bimpact\b/i,
  /\bexample\b/i,
  /\bcase\b/i,
  /\bconsequence(?:s)?\b/i,
  /\bbenefit(?:s)?\b/i,
  /\bmeasurable\b/i,
  /\breduced\b|\bimproved\b|\bincreased\b|\bsaved\b/i,
  /\brisk\b|\breliab(?:le|ility)\b|\btrustworthy\b/i,
  /\benabled\b|\bkept\b/i,
  /\baudit findings\b/i,
  /\bdeployment\b/i,
  /\bzero-defect\b/i,
];

const ORGANIZATION_VALUE_CASE_EVIDENCE_PATTERNS = [
  /\bcase stud(?:y|ies)\b/i,
  /\b(?:customer|client)\b.+\b(?:used|needed|reduced|improved|increased|saved|enabled|kept|implemented|validated|deployed|prevented|avoided)\b/i,
  /\b(?:used|needed|reduced|improved|increased|saved|enabled|kept|implemented|validated|deployed|prevented|avoided)\b.+\b(?:customer|client)\b/i,
  /\bcase\b.+\b(?:reduced|improved|increased|saved|enabled|kept)\b/i,
  /\b(?:reduced|improved|increased|saved)\b.+\b(?:\d+%|\d+\s*percent|forty percent)\b/i,
  /\b[a-z]+(?:\s+[a-z]+){0,3}\s+(?:provider|company|team|organization|organisation)\b.+\b(?:used|reduced|improved|validated|deployed|prevented|avoided|enabled)\b/i,
];

const ORGANIZATION_VALUE_UNSUPPORTED_CASE_PATTERNS = [
  /\ba\s+[a-z]+(?:\s+[a-z]+){0,3}\s+(?:provider|company|client|customer|team|organization|organisation)\b/i,
  /\bcustomer\s+(?:impact|value|outcomes?|results?|scenario|example)\b/i,
  /\b(?:client|customer)\s+(?:ci\/cd|delivery|project|projects|pipelines?|systems?|stakeholders?|teams?|workflows?|collaboration)\b/i,
  /\b(?:customer|client)\s+(?:used|needed|reduced|improved|deployed|validated|prevented|avoided|enabled)\b/i,
  /\b(?:retail|logistics|financial services|healthcare|manufacturing|banking|insurance)\s+(?:provider|company|client|customer|team|organization|organisation)\b/i,
  /\bduring\s+a\s+[a-z]+(?:\s+[a-z]+){0,4}\s+transformation\b/i,
  /\b(?:erp|crm|system|digital)\s+transformation\b/i,
  /\b(?:migration|transformation|deployment)\s+project\b/i,
  /\bcomplex\s+(?:system|erp|crm|digital)\s+(?:changes?|transformations?|migrations?)\b/i,
  /\ba\s+business\s+.+\buses?\b/i,
  /\blegacy\s+(?:inventory|erp|crm)\s+system\b/i,
  /\bcustom(?:er)?(?:-built)?\s+(?:portal|application|system|software|architecture)\b/i,
  /\bproprietary\s+(?:application|system|software|platform)\b/i,
  /\bspecific business requirements\b/i,
  /\bdata synchronization issues?\b/i,
  /\bdeployment delays?\b/i,
  /\bsupplier portal\b/i,
];

const ORGANIZATION_VALUE_TOOL_DETAIL_PATTERNS = [
  /\bplaywright\b|\bselenium\b|\bcypress\b|\branorex\b/i,
  /\bautomation framework(?:s)?\b/i,
  /\bautomated testing\b/i,
  /\bautomated test suite(?:s)?\b/i,
  /\bci\/cd\b/i,
  /\bpipeline(?:s)?\b/i,
  /\btest automation\b/i,
];

const ORGANIZATION_SPECIFIC_TECH_STACK_PATTERNS = [
  /\bplaywright\b/i,
  /\bselenium\b/i,
  /\bcypress\b/i,
  /\branorex\b/i,
  /\bci\/cd\b/i,
];

const ORGANIZATION_OPERATIONS_UNSUPPORTED_TOOL_STORY_PATTERNS = [
  /\bplaywright\b|\bselenium\b|\bcypress\b|\branorex\b/i,
  /\bautomation framework(?:s)?\b/i,
  /\bautomated validation\b/i,
  /\btest automation\b/i,
  /\bci\/cd\b/i,
  /\bclient\s+(?:development|delivery)?\s*pipeline(?:s)?\b/i,
  /\bcustomer\s+(?:development|delivery)?\s*pipeline(?:s)?\b/i,
  /\bpredictive testing\b/i,
  /\bai-powered quality solutions?\b/i,
  /\bdigital delivery hubs?\b/i,
  /\btesting centers?\b/i,
];

const hasOrganizationValueCaseEvidenceText = (value: string): boolean =>
  ORGANIZATION_VALUE_CASE_EVIDENCE_PATTERNS.some((pattern) =>
    pattern.test(value),
  );

export const hasGroundedOrganizationValueCaseEvidence = (
  contract: SlideContract,
): boolean => {
  const evidenceText = contract.evidence ?? "";

  return hasOrganizationValueCaseEvidenceText(evidenceText);
};

export const ORGANIZATION_ROLE_KINDS: OrganizationRoleKind[] = [
  "entity-capabilities",
  "entity-operations",
  "entity-value",
];

export const isOrganizationRoleKind = (
  kind: SlideContract["kind"],
): kind is OrganizationRoleKind =>
  kind === "entity-capabilities" ||
  kind === "entity-operations" ||
  kind === "entity-value";

export const looksUnsupportedOrganizationValueCase = (
  contract: SlideContract,
  value: string,
): boolean => {
  if (
    !isOrganizationRoleKind(contract.kind) ||
    hasGroundedOrganizationValueCaseEvidence(contract)
  ) {
    return false;
  }

  if (contract.kind === "entity-value" && /\bcustomers?\b/i.test(value)) {
    return true;
  }

  return ORGANIZATION_VALUE_UNSUPPORTED_CASE_PATTERNS.some((pattern) =>
    pattern.test(value),
  );
};

const organizationValueNoCaseTextLooksToolDetail = (value: string): boolean =>
  ORGANIZATION_VALUE_TOOL_DETAIL_PATTERNS.some((pattern) => pattern.test(value)) &&
  !hasOrganizationValueCaseEvidenceText(value);

export const organizationSpecificTechStackLooksUnsupported = (
  input: Pick<
    GenerateDeckInput,
    "groundingHighlights" | "groundingCoverageGoals"
  >,
  contract: SlideContract,
  value: string,
): boolean => {
  const matchingPatterns = ORGANIZATION_SPECIFIC_TECH_STACK_PATTERNS.filter((pattern) =>
    pattern.test(value),
  );
  if (matchingPatterns.length === 0) {
    return false;
  }

  const evidenceText = [
    contract.focus,
    contract.objective ?? "",
    contract.evidence ?? "",
    ...(input.groundingHighlights ?? []),
    ...(input.groundingCoverageGoals ?? []),
  ].join(" ");

  return !matchingPatterns.every((pattern) => pattern.test(evidenceText));
};

export const looksUnsupportedOrganizationValueToolDetail = (
  contract: SlideContract,
  value: string,
): boolean =>
  contract.kind === "entity-value" &&
  !hasGroundedOrganizationValueCaseEvidence(contract) &&
  organizationValueNoCaseTextLooksToolDetail(value);

export const looksUnsupportedOrganizationOperationsToolStory = (
  contract: SlideContract,
  value: string,
): boolean =>
  contract.kind === "entity-operations" &&
  ORGANIZATION_OPERATIONS_UNSUPPORTED_TOOL_STORY_PATTERNS.some((pattern) =>
    pattern.test(value),
  );

export const countOrganizationRoleSignals = (
  kind: OrganizationRoleKind,
  value: string,
): number =>
  ORGANIZATION_ROLE_SIGNAL_PATTERNS[kind].reduce(
    (count, pattern) => count + (pattern.test(value) ? 1 : 0),
    0,
  );

const countStrongOrganizationRoleSignals = (
  kind: OrganizationRoleKind,
  value: string,
): number =>
  ORGANIZATION_ROLE_STRONG_SIGNAL_PATTERNS[kind].reduce(
    (count, pattern) => count + (pattern.test(value) ? 1 : 0),
    0,
  );

const getOrganizationRoleSignalScores = (value: string) => ({
  "entity-capabilities": countOrganizationRoleSignals("entity-capabilities", value),
  "entity-operations": countOrganizationRoleSignals("entity-operations", value),
  "entity-value": countOrganizationRoleSignals("entity-value", value),
});

const organizationRoleTextSupports = (
  kind: SlideContract["kind"],
  value: string,
): boolean => {
  if (!isOrganizationRoleKind(kind) || !value.trim()) {
    return true;
  }

  const scores = getOrganizationRoleSignalScores(value);
  const expected = scores[kind];
  const bestOther = Math.max(
    ...ORGANIZATION_ROLE_KINDS.filter((candidate) => candidate !== kind).map(
      (candidate) => scores[candidate],
    ),
  );

  if (expected === 0) {
    return false;
  }

  const strongExpected = countStrongOrganizationRoleSignals(kind, value);
  if (kind === "entity-operations" && strongExpected === 0) {
    return false;
  }

  if (
    kind === "entity-value" &&
    !ORGANIZATION_VALUE_CONCRETE_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    return false;
  }

  if (
    kind === "entity-operations" &&
    (scores["entity-capabilities"] >= expected || scores["entity-value"] >= expected) &&
    strongExpected < 2
  ) {
    return false;
  }

  if (
    kind === "entity-value" &&
    bestOther >= 2 &&
    bestOther >= expected
  ) {
    return false;
  }

  if (bestOther >= 2 && bestOther > expected) {
    return false;
  }

  return true;
};

export const organizationRoleSeedTextSupports = (
  kind: SlideContract["kind"],
  value: string,
): boolean =>
  organizationRoleTextSupports(kind, value) &&
  !(kind === "entity-value" && organizationValueNoCaseTextLooksToolDetail(value));

export const organizationRoleTextSupportsContract = (
  contract: SlideContract,
  value: string,
): boolean =>
  organizationRoleTextSupports(contract.kind, value) &&
  !looksUnsupportedOrganizationValueCase(contract, value) &&
  !looksUnsupportedOrganizationValueToolDetail(contract, value) &&
  !looksUnsupportedOrganizationOperationsToolStory(contract, value);

export const organizationRoleSignalsAnotherRole = (
  kind: SlideContract["kind"],
  value: string,
): boolean => {
  if (!isOrganizationRoleKind(kind) || !value.trim()) {
    return false;
  }

  const scores = getOrganizationRoleSignalScores(value);
  const expected = scores[kind];
  const bestOther = Math.max(
    ...ORGANIZATION_ROLE_KINDS.filter((candidate) => candidate !== kind).map(
      (candidate) => scores[candidate],
    ),
  );

  return bestOther >= 2 && bestOther > expected;
};

export const countOrganizationRoleAlignedValues = (
  kind: SlideContract["kind"],
  values: string[],
): number =>
  values.filter((value) => organizationRoleTextSupports(kind, value)).length;

export const buildOrganizationRolePromptGuidance = (
  contract: SlideContract,
): string | null => {
  switch (contract.kind) {
    case "entity-capabilities":
      return "This is the capabilities slide. Focus on services, technical strengths, frameworks, and areas of responsibility. Do not turn it into a geography, delivery-model, or customer-outcome slide.";
    case "entity-operations":
      return "This is the operations slide. Focus on where the organization operates, how delivery works, how teams collaborate, and what the operating model looks like in practice. Do not turn it into a service catalog, framework list, or abstract value slide.";
    case "entity-value":
      return hasGroundedOrganizationValueCaseEvidence(contract)
        ? "This is the value slide. Center it on the source-backed customer example, measurable outcome, or consequence. Do not reopen the service catalog, tools, operating footprint, or general company messaging unless they are directly part of that evidence."
        : "This is the value slide. Center it on one evidence-backed practical consequence. Do not invent a customer, client, industry, provider, case study, metric, deployment story, framework story, tool stack, or CI/CD pipeline unless the evidence explicitly provides it as a customer case.";
    default:
      return null;
  }
};

export const buildOrganizationRoleAdvancedExplanation = (
  contract: SlideContract,
  topic: string,
): string => {
  switch (contract.kind) {
    case "entity-capabilities":
      return toAudienceFacingSentence(
        `Framework coverage such as Playwright, Selenium, Cypress, Ranorex, and CI/CD support connects ${topic}'s capabilities to practical delivery tooling`,
      );
    case "entity-operations":
      return toAudienceFacingSentence(
        `${topic}'s operating support is grounded in daily QA operations, lifecycle support, and release decision work rather than a separate handoff after development`,
      );
    case "entity-value":
      return toAudienceFacingSentence(
        hasGroundedOrganizationValueCaseEvidence(contract)
          ? `One concrete customer outcome makes ${topic} clearer than a general value claim`
          : `${topic}'s value comes from earlier evidence before release through advisory workshops, data-flow validation, and custom-feature checks`,
      );
    default:
      return toAudienceFacingSentence(
        `${contract.focus} is one concrete part of ${topic}`,
      );
  }
};

export const organizationRoleHeadingNeedsRepair = (
  kind: SlideContract["kind"],
  value: string,
): boolean => {
  if (!isOrganizationRoleKind(kind) || !value.trim()) {
    return false;
  }

  switch (kind) {
    case "entity-capabilities":
      return /\bwhere it operates\b|\bworks in practice\b|\bdelivery\b|\bfootprint\b/i.test(value);
    case "entity-operations":
      return /\bvalue\b|\boffer(?:s|ing)?\b|\bservice(?:s)?\b|\bcapabilit(?:y|ies)\b/i.test(value);
    case "entity-value":
      return /\bservice(?:s)?\b|\bframework(?:s)?\b|\bdelivery\b|\bwhere it operates\b|\bworks in practice\b/i.test(value) &&
        !ORGANIZATION_VALUE_CONCRETE_PATTERNS.some((pattern) => pattern.test(value));
    default:
      return false;
  }
};
