import type {
  Deck,
  GenerateDeckInput,
  GroundingFact,
  Slide,
  SlideBrief,
} from "@slidespeech/types";

import {
  DECK_SHAPE_INSTRUCTIONAL_PATTERNS,
  DECK_SHAPE_META_PATTERNS,
  countAnchorOverlap,
  hasMeaningfulAnchorOverlap,
  looksOverlyPromotionalSourceCopy,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";
import { buildOrganizationRolePromptGuidance } from "./organization-role-contracts";
import { compactGroundingSummary } from "./prompt-shaping";
import { summarizeRevisionGuidance } from "./research-planning";
import {
  buildArcPolicyPromptLines,
  deriveSlideArcPolicy,
  isWorkshopPresentation,
  resolveIntentFocusAnchor,
  resolveIntentSubject,
} from "./slide-arc-policy";
import type {
  SlideContract,
  SlideDraftAssessment,
} from "./slide-contract-types";

const resolveHowWorksSubject = (subject: string): string | undefined => {
  const match = /^how\s+(.+?)\s+works$/i.exec(subject.trim());
  return match?.[1]?.trim() || undefined;
};

export const buildSlideEnrichmentPromptLines = (input: {
  deck: Deck;
  slide: Slide;
  contract: SlideContract;
  generationInput: GenerateDeckInput;
  slideBrief?: SlideBrief;
  priorAssessment?: SlideDraftAssessment | null;
}): string[] => {
  const subject = resolveIntentSubject(input.generationInput);
  const slideBrief =
    input.slideBrief ?? input.generationInput.slideBriefs?.[input.slide.order];
  const factById = new Map(
    (input.generationInput.groundingFacts ?? []).map((fact) => [fact.id, fact]),
  );
  const slideBriefFacts = (slideBrief?.evidenceFactIds ?? [])
    .map((factId) => factById.get(factId))
    .filter((fact): fact is GroundingFact => Boolean(fact));
  const scopedEvidence = uniqueNonEmptyStrings([
    ...(slideBrief?.requiredClaims ?? []),
    ...slideBriefFacts.flatMap((fact) => [fact.claim, fact.evidence]),
  ]);
  const scopedEvidenceKeys = new Set(scopedEvidence.map((value) => value.toLowerCase()));
  const howWorksSubject = resolveHowWorksSubject(subject);
  const focusAnchor = resolveIntentFocusAnchor(input.generationInput);
  const groundingSummaryCandidates = compactGroundingSummary(
    input.generationInput.groundingSummary ?? "",
  )
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 28);
  const previousSlide = input.deck.slides[input.slide.order - 1];
  const nextSlide = input.deck.slides[input.slide.order + 1];
  const organizationArc = deriveSlideArcPolicy(input.generationInput) === "organization-overview";
  const sourceBackedArc = deriveSlideArcPolicy(input.generationInput) === "source-backed-subject";
  const proceduralOrientation =
    input.generationInput.intent?.contentMode === "procedural" &&
    input.contract.kind === "orientation";
  const earlierSlideDigest = input.deck.slides
    .slice(0, input.slide.order)
    .map((priorSlide) =>
      [priorSlide.title, priorSlide.learningGoal].filter(Boolean).join(": "),
    )
    .filter(Boolean)
    .slice(-3);
  const relevanceAnchor = uniqueNonEmptyStrings([
    subject,
    focusAnchor ?? "",
    input.contract.focus,
    input.contract.objective ?? "",
    input.contract.evidence ?? "",
    input.generationInput.intent?.presentationGoal ?? "",
    input.generationInput.plan?.learningObjectives?.[input.slide.order] ?? "",
    input.generationInput.plan?.storyline?.[input.slide.order] ?? "",
    input.slide.title,
    input.slide.learningGoal,
  ]).join(" ");
  const groundingExcerptCandidates = uniqueNonEmptyStrings(
    input.generationInput.groundingExcerpts ?? [],
  ).filter((value) => value.length >= 24);
  const contextCandidates = uniqueNonEmptyStrings([
    ...scopedEvidence,
    ...(scopedEvidence.length > 0 ? [] : groundingExcerptCandidates),
    ...(scopedEvidence.length > 0 ? [] : groundingSummaryCandidates),
    ...(scopedEvidence.length > 0
      ? []
      : input.generationInput.groundingHighlights ?? []),
    ...(scopedEvidence.length > 0
      ? []
      : input.generationInput.groundingCoverageGoals ?? []),
    ...(input.generationInput.plan?.learningObjectives ?? []),
    ...(input.generationInput.plan?.storyline ?? []),
    input.deck.summary,
    input.slide.title,
    input.slide.learningGoal,
    ...input.slide.keyPoints,
  ]).filter(
    (value) =>
      value.length >= 18 &&
      !DECK_SHAPE_META_PATTERNS.some((pattern) => pattern.test(value)) &&
      !DECK_SHAPE_INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(value)) &&
      !looksOverlyPromotionalSourceCopy(value),
  );
  const relevantContext = contextCandidates
    .map((value) => ({
      value,
      score: countAnchorOverlap(value, relevanceAnchor),
    }))
    .filter(
      (candidate) =>
        candidate.score > 0 ||
        scopedEvidenceKeys.has(candidate.value.toLowerCase()) ||
        hasMeaningfulAnchorOverlap(candidate.value, subject),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((candidate) => candidate.value);
  const sourceEvidenceCandidates =
    scopedEvidence.length > 0 ? scopedEvidence : groundingExcerptCandidates;
  const scopedFactLines = slideBriefFacts.map((fact) => {
    const evidence =
      fact.evidence && fact.evidence !== fact.claim
        ? ` Evidence: ${fact.evidence}`
        : "";
    const sources = fact.sourceIds.length ? ` Sources: ${fact.sourceIds.join(", ")}` : "";
    return `[${fact.role}/${fact.confidence}] ${fact.claim}${evidence}${sources}`;
  });

  const claimStyleGuidance = (() => {
    switch (input.contract.kind) {
      case "orientation":
        if (howWorksSubject) {
          return `Introduce the starting situation for ${howWorksSubject} before explaining the mechanism. Do not repeat the full input/state/output loop yet. Avoid broad benefit claims unless the mechanism on this slide explains them directly.`;
        }
        if (proceduralOrientation) {
          return `Open the how-to deck by defining what a good finished result looks, tastes, feels, or does for ${subject}. Use concrete topic-specific cues. Do not write about materials, steps, checks, the presentation, or the presenter as abstract categories.`;
        }
        return `State concrete subject-facing claims about ${subject}. Name what it is, what changes because of it, or what makes it recognizable. Do not describe the presentation or the presenter.`;
      case "subject-detail":
        if (howWorksSubject) {
          return `Explain the mechanism inside ${howWorksSubject}: the input or trigger, the internal state or process change, and the visible response. Keep benefit claims out of this slide.`;
        }
        return `Keep this slide concrete. Explain one defining detail, event, mechanism, or subarea within ${subject} itself. Do not jump ahead to summary or broad significance language.`;
      case "subject-implication":
        if (howWorksSubject) {
          return `Explain what changes in the next response because of the mechanism. Use a concrete cause-and-effect path, not unsupported claims about accuracy, trust, personalization, or transformation.`;
        }
        return `Explain why the earlier detail matters. Focus on consequence, significance, lesson, or interpretation instead of re-describing the same detail.`;
      case "subject-takeaway":
        if (howWorksSubject) {
          return `Close by giving the audience a simple way to judge whether ${howWorksSubject} worked: what changed, what response was produced, and how the flow continues. Include a concise invitation for questions.`;
        }
        return `Synthesize the strongest takeaway from ${subject}. Connect the earlier concrete detail and implication without introducing a brand-new subtopic.`;
      case "procedural-ingredients":
        return `Explain what the main inputs contribute to the final result in ${subject.toLowerCase()}. Use concrete ingredient names, quantities, ratios, or quality cues when they are obvious for the topic. Avoid abstract phrases such as "core inputs" or "base structure". Do not invent precise causal mechanisms unless they are grounded; prefer observable roles such as flavor, texture, acidity, heat, or freshness.`;
      case "procedural-steps":
        return `Explain the main steps in concrete procedural language. Short action-oriented phrasing is allowed for how-to decks, as long as each point is specific and useful. Use observable checks over unsupported causal claims. Do not claim that timing, salt, acid, resting, or ingredient order causes moisture, crunch, or flavor changes unless that detail is grounded.`;
      case "procedural-quality":
        return `Explain how to recognize and adjust the final result. Use specific tasting, texture, serving, or adjustment cues instead of repeating earlier ingredient or preparation points. Avoid universal claims about serving immediately, resting time, or chemical effects unless the deck has grounding for them.`;
      case "entity-capabilities":
        return `Explain what ${subject} does through concrete capabilities, services, responsibilities, or focus areas. Keep the language factual and organization-facing rather than abstract or promotional.`;
      case "entity-operations":
        return `Explain how ${subject} works in practice through delivery, customer work, operating methods, or concrete processes. Prefer operational detail over slogans.`;
      case "entity-value":
        return `Explain one concrete outcome, customer example, or practical consequence that shows why ${subject} matters. Tie the slide to one recognizable evidence anchor and avoid broad value or mission language.`;
      case "workshop-practice":
        return `Design this slide around one practical task, exercise, or applied scenario. The audience should use the slide to apply the ideas, not just hear them restated. Include a concrete task, one starting material or scenario, one constraint or review check, and one expected output or decision.`;
      case "synthesis":
        return `State what should be remembered about ${subject}. Connect the strongest ideas, consequences, or examples without turning the slide into facilitation or wrap-up meta language.`;
      default:
        return `Write complete declarative claims about ${subject}. Prefer mechanisms, roles, consequences, or concrete subareas over advice about what someone should do.`;
    }
  })();

  return [
    `Subject: ${subject}`,
    focusAnchor ? `Concrete focus anchor: ${focusAnchor}` : null,
    input.generationInput.intent?.organization
      ? `Organization context: ${input.generationInput.intent.organization}`
      : null,
    input.generationInput.intent?.framing
      ? `Framing context: ${input.generationInput.intent.framing}`
      : input.generationInput.presentationBrief
        ? `Framing context: ${input.generationInput.presentationBrief}`
        : null,
    input.generationInput.intent?.presentationFrame
      ? `Presentation frame: ${input.generationInput.intent.presentationFrame}`
      : null,
    input.generationInput.intent?.audienceCues?.length
      ? `Audience: ${input.generationInput.intent.audienceCues.join("; ")}`
      : null,
    input.generationInput.pedagogicalProfile?.audienceLevel
      ? `Audience level: ${input.generationInput.pedagogicalProfile.audienceLevel}`
      : null,
    input.generationInput.intent?.presentationGoal
      ? `Presentation goal: ${input.generationInput.intent.presentationGoal}`
      : null,
    input.generationInput.intent?.deliveryFormat
      ? `Format: ${input.generationInput.intent.deliveryFormat}`
      : null,
    ...buildArcPolicyPromptLines(input.generationInput),
    input.generationInput.intent?.activityRequirement
      ? `Participant activity requirement: ${input.generationInput.intent.activityRequirement}`
      : null,
    `Slide order: ${input.slide.order + 1} of ${input.deck.slides.length}`,
    `Slide role: ${input.contract.label}`,
    `Slide kind: ${input.contract.kind}`,
    `Slide focus: ${input.contract.focus}`,
    input.contract.objective ? `Slide objective: ${input.contract.objective}` : null,
    slideBrief?.audienceQuestion
      ? `Slide audience question: ${slideBrief.audienceQuestion}`
      : null,
    slideBrief?.requiredClaims.length
      ? `Required slide claims:\n${slideBrief.requiredClaims
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    scopedFactLines.length > 0
      ? `Allowed evidence facts for this slide:\n${scopedFactLines
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    slideBrief?.closingIntent ? `Closing intent: ${slideBrief.closingIntent}` : null,
    input.contract.evidence ? `Slide evidence anchor: ${input.contract.evidence}` : null,
    input.contract.evidence
      ? "Use the evidence anchor concretely. Do not replace it with broader abstract company messaging, history, or mission language unless the slide explicitly requires that."
      : null,
    `Claim style guidance: ${claimStyleGuidance}`,
    input.generationInput.pedagogicalProfile?.audienceLevel === "beginner"
      ? "Beginner audience constraint: use concrete everyday language and avoid academic jargon unless the slide defines it in plain words."
      : null,
    `Draft title: ${input.slide.title}`,
    proceduralOrientation
      ? "Draft learning goal: replace the placeholder with one concrete topic-specific success cue."
      : `Draft learning goal: ${input.slide.learningGoal}`,
    previousSlide ? `Previous slide title: ${previousSlide.title}` : "Previous slide title: none",
    nextSlide ? `Next slide title: ${nextSlide.title}` : "Next slide title: none",
    earlierSlideDigest.length > 0
      ? `Earlier slides already cover:\n${earlierSlideDigest.map((value) => `- ${value}`).join("\n")}`
      : null,
    input.contract.distinctFrom?.length
      ? `Do not reuse these earlier slide anchors:\n${input.contract.distinctFrom
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    slideBrief?.forbiddenOverlap.length
      ? `Do not repeat these earlier brief claims:\n${slideBrief.forbiddenOverlap
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    relevantContext.length > 0
      ? `${scopedEvidence.length > 0 ? "Scoped grounding for this slide" : "Relevant grounding"}:\n${relevantContext.map((value) => `- ${value}`).join("\n")}`
      : "Relevant grounding: none",
    sourceEvidenceCandidates.length > 0
      ? `Grounded source excerpts:\n${sourceEvidenceCandidates
          .slice(0, 6)
          .map((value) => `- ${value}`)
          .join("\n")}`
      : null,
    scopedEvidence.length > 0
      ? "Use the allowed evidence facts as the factual boundary for this slide. Do not borrow concrete claims from other slide briefs unless the same fact is listed above."
      : null,
    "This slide must add a distinct explanatory center. Do not restate the same explanation, role, or takeaway used on earlier slides.",
    sourceEvidenceCandidates.length > 0
      ? "Prefer concrete details from the grounded source excerpts over broad company-value language or generic summary copy."
      : null,
    sourceBackedArc
      ? "When using grounded facts, do not claim one fact caused another unless the source text explicitly states that causal connection. Separate related facts rather than inventing a cause-and-effect bridge."
      : null,
    organizationArc
      ? "Teach the organization/entity itself, not the abstract generic concept behind its name."
      : null,
    organizationArc && !isWorkshopPresentation(input.generationInput)
      ? `Use third-person organization language: write "${subject}" or "the organization", not "we", "our", "you", or "your".`
      : null,
    organizationArc &&
    (input.generationInput.intent?.framing || input.generationInput.presentationBrief)
      ? "Keep the slide inside the framing scope. If the framing implies onboarding, orientation, introduction, or overview, orient a newcomer to the organization itself rather than broadening into a generic guide to the wider field."
      : null,
    organizationArc ? buildOrganizationRolePromptGuidance(input.contract) : null,
    input.priorAssessment
      ? `Local quality feedback from earlier draft: ${input.priorAssessment.reasons.join(" ")}`
      : null,
    input.generationInput.revisionGuidance
      ? `Revision guidance: ${summarizeRevisionGuidance(input.generationInput.revisionGuidance)}`
      : null,
  ].filter((line): line is string => Boolean(line));
};
