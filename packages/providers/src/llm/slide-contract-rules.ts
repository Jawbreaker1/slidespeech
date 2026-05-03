import type { GenerateDeckInput } from "@slidespeech/types";

import {
  deriveSlideArcPolicy,
  isWorkshopPresentation,
} from "./slide-arc-policy";
import type {
  ArcPolicyInput,
  ContractSeedSource,
  SlideContract,
} from "./slide-contract-types";

export const buildFinalSlideQuestionPoint = (
  contract: Pick<SlideContract, "kind" | "isFinal">,
): string => {
  switch (contract.kind) {
    case "subject-takeaway":
      return "A useful closing question is: which concrete situation would prove the takeaway.";
    case "entity-value":
      return "A useful closing question is: which supported consequence would change a concrete decision.";
    case "workshop-practice":
      return "A useful closing question is: which real task, constraint, or review step should the exercise use.";
    case "procedural-quality":
      return contract.isFinal
        ? "A useful closing question is: what would you adjust before serving, shipping, or calling the work complete."
        : "";
    case "synthesis":
      return contract.isFinal
        ? "A useful closing question is: which practical example connects the main ideas."
        : "";
    default:
      return "";
  }
};

export const buildSlideContractKinds = (
  input: Pick<
    GenerateDeckInput,
    "intent" | "groundingHighlights" | "groundingCoverageGoals" | "groundingSourceIds"
  >,
  slideCount: number,
): SlideContract["kind"][] => {
  if (slideCount <= 0) {
    return [];
  }

  const remainingSlideCount = Math.max(0, slideCount - 1);
  const workshop = isWorkshopPresentation(input);
  const arcPolicy = deriveSlideArcPolicy(input);

  if (remainingSlideCount === 0) {
    return ["orientation"];
  }

  if (arcPolicy === "procedural") {
    if (slideCount >= 4) {
      return [
        "orientation",
        "procedural-ingredients",
        ...Array.from({ length: slideCount - 3 }, (_, index) =>
          index === 0 ? "procedural-steps" : "procedural-quality",
        ),
        "procedural-quality",
      ];
    }

    return Array.from({ length: slideCount }, (_, index) =>
      index === 0
        ? "procedural-ingredients"
        : index === 1
          ? "procedural-steps"
          : "procedural-quality",
    );
  }

  if (arcPolicy === "organization-overview") {
    if (workshop) {
      if (remainingSlideCount === 1) {
        return ["orientation", "workshop-practice"];
      }
      if (remainingSlideCount === 2) {
        return ["orientation", "entity-capabilities", "workshop-practice"];
      }
      return [
        "orientation",
        "entity-capabilities",
        ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
          index === remainingSlideCount - 2 ? "workshop-practice" : "entity-operations",
        ),
      ];
    }

    if (remainingSlideCount === 1) {
      return ["orientation", "entity-value"];
    }
    if (remainingSlideCount === 2) {
      return ["orientation", "entity-operations", "entity-value"];
    }

    if (remainingSlideCount === 3) {
      return [
        "orientation",
        "entity-operations",
        "entity-capabilities",
        "entity-value",
      ];
    }

    const extraMiddleCount = Math.max(0, slideCount - 5);
    const extraMiddleKinds: SlideContract["kind"][] = Array.from(
      { length: extraMiddleCount },
      (_, index) => (index % 2 === 0 ? "coverage" : "development"),
    );

    return [
      "orientation",
      "entity-operations",
      "entity-capabilities",
      ...extraMiddleKinds,
      "synthesis",
      "entity-value",
    ];
  }

  if (workshop) {
    if (remainingSlideCount === 1) {
      return ["orientation", "workshop-practice"];
    }
    if (remainingSlideCount === 2) {
      return ["orientation", "subject-detail", "workshop-practice"];
    }
    return [
      "orientation",
      "subject-detail",
      ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
        index === remainingSlideCount - 2 ? "workshop-practice" : "subject-implication",
      ),
    ];
  }

  if (remainingSlideCount === 1) {
    return ["orientation", "subject-takeaway"];
  }
  if (remainingSlideCount === 2) {
    return ["orientation", "subject-detail", "subject-takeaway"];
  }

  return [
    "orientation",
    "subject-detail",
    ...Array.from({ length: remainingSlideCount - 1 }, (_, index) =>
      index === remainingSlideCount - 2 ? "subject-takeaway" : "subject-implication",
    ),
  ];
};

export const contractSeedPriorities = (
  kind: SlideContract["kind"],
  input?: ArcPolicyInput,
): {
  focus: ContractSeedSource[];
  objective: ContractSeedSource[];
  evidence: ContractSeedSource[];
} => {
  const sourceBackedSubject = input
    ? deriveSlideArcPolicy(input) === "source-backed-subject"
    : false;

  switch (kind) {
    case "subject-detail":
      if (sourceBackedSubject) {
        return {
          focus: [
            "focusAnchor",
            "coverageRequirement",
            "coverageGoal",
            "learningObjective",
            "storyline",
            "groundingHighlight",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
            "focusAnchor",
          ],
          evidence: [
            "groundingHighlight",
            "coverageGoal",
            "focusAnchor",
            "learningObjective",
            "storyline",
          ],
        };
      }
      return {
        focus: ["focusAnchor", "coverageRequirement", "groundingHighlight", "coverageGoal", "storyline", "learningObjective", "presentationGoal"],
        objective: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "presentationGoal", "focusAnchor"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline", "focusAnchor"],
      };
    case "subject-implication":
      if (sourceBackedSubject) {
        return {
          focus: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "coverageRequirement",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
          ],
          evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
        };
      }
      return {
        focus: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "subject-takeaway":
      if (sourceBackedSubject) {
        return {
          focus: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "coverageRequirement",
            "presentationGoal",
          ],
          objective: [
            "learningObjective",
            "storyline",
            "coverageGoal",
            "groundingHighlight",
            "presentationGoal",
          ],
          evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
        };
      }
      return {
        focus: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal"],
      };
    case "entity-capabilities":
      return {
        focus: ["coverageRequirement", "groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
        objective: ["coverageGoal", "groundingHighlight", "learningObjective", "storyline"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "entity-operations":
      return {
        focus: ["coverageGoal", "groundingHighlight", "storyline", "learningObjective", "coverageRequirement"],
        objective: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline", "coverageRequirement"],
        evidence: ["groundingHighlight", "coverageGoal", "storyline", "learningObjective"],
      };
    case "entity-value":
      return {
        focus: ["coverageGoal", "learningObjective", "storyline", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "workshop-practice":
      return {
        focus: ["activityRequirement", "learningObjective", "coverageGoal", "groundingHighlight", "storyline", "coverageRequirement", "presentationGoal"],
        objective: ["activityRequirement", "learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "activityRequirement", "coverageGoal", "learningObjective"],
      };
    case "coverage":
      return {
        focus: ["coverageRequirement", "coverageGoal", "learningObjective", "storyline", "groundingHighlight", "presentationGoal"],
        objective: ["learningObjective", "coverageGoal", "storyline", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "development":
      return {
        focus: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["storyline", "learningObjective", "groundingHighlight", "coverageGoal", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
    case "synthesis":
      return {
        focus: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "groundingHighlight", "coverageGoal", "presentationGoal"],
        evidence: ["groundingHighlight", "learningObjective", "storyline", "coverageGoal"],
      };
    default:
      return {
        focus: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "coverageRequirement", "presentationGoal"],
        objective: ["learningObjective", "storyline", "coverageGoal", "groundingHighlight", "presentationGoal"],
        evidence: ["groundingHighlight", "coverageGoal", "learningObjective", "storyline"],
      };
  }
};

export const buildSlideContractLabel = (
  kind: SlideContract["kind"],
  storylineValue: string | undefined,
): string => {
  switch (kind) {
    case "orientation":
      return "orientation";
    case "subject-detail":
      return storylineValue ?? "concrete detail";
    case "subject-implication":
      return storylineValue ?? "why it matters";
    case "subject-takeaway":
      return "takeaway";
    case "entity-capabilities":
      return "core capabilities";
    case "entity-operations":
      return storylineValue ?? "how it works";
    case "entity-value":
      return "practical value";
    case "workshop-practice":
      return "practical exercise";
    case "coverage":
      return storylineValue ?? "required coverage";
    case "development":
      return storylineValue ?? "development";
    case "synthesis":
      return "synthesis";
    case "procedural-ingredients":
      return "ingredients";
    case "procedural-steps":
      return "steps";
    case "procedural-quality":
      return "quality";
  }
};

export const contractRequiresEvidence = (
  kind: SlideContract["kind"],
  input?: ArcPolicyInput,
): boolean => {
  const organizationArc = input
    ? deriveSlideArcPolicy(input) === "organization-overview"
    : false;
  const sourceBackedSubject = input
    ? deriveSlideArcPolicy(input) === "source-backed-subject"
    : false;

  return (
    kind === "entity-value" ||
    kind === "workshop-practice" ||
    kind === "subject-detail" ||
    kind === "subject-implication" ||
    (sourceBackedSubject && kind === "subject-takeaway") ||
    (organizationArc &&
      (kind === "entity-capabilities" || kind === "entity-operations"))
  );
};

export const openingSeedPriorities = (
  input: Pick<
    GenerateDeckInput,
    "intent" | "groundingHighlights" | "groundingCoverageGoals" | "groundingSourceIds"
  >,
): ContractSeedSource[] => {
  const workshop = isWorkshopPresentation(input as Pick<GenerateDeckInput, "intent">);
  switch (deriveSlideArcPolicy(input)) {
    case "source-backed-subject":
      return [
        "focusAnchor",
        "coverageRequirement",
        "coverageGoal",
        "groundingHighlight",
        "learningObjective",
        "storyline",
        "presentationGoal",
      ];
    case "organization-overview":
      return workshop
        ? [
            "learningObjective",
            "storyline",
            "presentationGoal",
            "coverageRequirement",
            "coverageGoal",
            "groundingHighlight",
          ]
        : [
            "learningObjective",
            "storyline",
            "presentationGoal",
            "coverageRequirement",
            "coverageGoal",
            "groundingHighlight",
          ];
    default:
      return [
        "coverageRequirement",
        "coverageGoal",
        "groundingHighlight",
        "learningObjective",
        "storyline",
        "presentationGoal",
      ];
  }
};
