import test from "node:test";
import assert from "node:assert/strict";

import { buildRoleSpecificSlideRecoveryFromContext } from "../packages/providers/src/llm/slide-recovery-builders";

test("role-specific recovery uses scoped slide-brief facts before global grounding", () => {
  const scopedOperationClaim =
    "System Verification works through embedded QA teams that support product and project teams during delivery.";
  const recovered = buildRoleSpecificSlideRecoveryFromContext(
    {
      topic: "System Verification",
      intent: {
        subject: "System Verification",
        presentationFrame: "organization",
        organization: "System Verification",
      },
      groundingHighlights: [
        "System Verification offers test automation and quality management services.",
      ],
      groundingCoverageGoals: [
        "Quality assurance services and automation capabilities.",
      ],
      groundingFacts: [
        {
          id: "fact_operations",
          role: "operations",
          claim: scopedOperationClaim,
          evidence: scopedOperationClaim,
          sourceIds: ["https://www.systemverification.com/services"],
          confidence: "high",
        },
        {
          id: "fact_capabilities",
          role: "capabilities",
          claim:
            "System Verification offers test automation and quality management services.",
          evidence:
            "System Verification offers test automation and quality management services.",
          sourceIds: ["https://www.systemverification.com/services"],
          confidence: "high",
        },
      ],
      slideBriefs: [
        {
          index: 0,
          role: "orientation",
          audienceQuestion: "Who is System Verification?",
          requiredClaims: ["System Verification is a QA-focused organization."],
          evidenceFactIds: [],
          forbiddenOverlap: [],
        },
        {
          index: 1,
          role: "entity-operations",
          audienceQuestion: "How does System Verification work in practice?",
          requiredClaims: [scopedOperationClaim],
          evidenceFactIds: ["fact_operations"],
          forbiddenOverlap: [
            "System Verification offers test automation and quality management services.",
          ],
        },
      ],
      plan: {
        title: "System Verification onboarding",
        learningObjectives: ["Understand how the organization works."],
        storyline: ["Identity", "Operating model"],
        recommendedSlideCount: 4,
        audienceLevel: "beginner",
      },
      pedagogicalProfile: {
        audienceLevel: "beginner",
        tone: "supportive and concrete",
        pace: "balanced",
        preferredExampleStyle: "real_world",
        wantsFrequentChecks: true,
        detailLevel: "standard",
      },
    } as any,
    {
      slides: [
        {
          order: 0,
          title: "System Verification",
          examples: [],
          keyPoints: ["System Verification is a QA-focused organization."],
        },
      ],
    } as any,
    {
      id: "slide-operations",
      order: 1,
      title: "Draft operations slide",
      learningGoal: "",
      keyPoints: [],
      examples: [],
    } as any,
    {
      index: 1,
      label: "operations",
      kind: "entity-operations",
      focus: "How System Verification works in practice",
      objective:
        "Explain the delivery model and project-team support behind the organization.",
      evidence: scopedOperationClaim,
    },
  );

  const recoveredText = [
    recovered?.title ?? "",
    recovered?.learningGoal ?? "",
    ...(recovered?.keyPoints ?? []),
    ...(recovered?.examples ?? []),
    recovered?.beginnerExplanation ?? "",
    recovered?.advancedExplanation ?? "",
  ].join(" ");

  assert.ok(recovered);
  assert.match(recoveredText, /embedded QA teams|product and project teams/i);
  assert.doesNotMatch(recoveredText, /test automation and quality management services/i);
});
