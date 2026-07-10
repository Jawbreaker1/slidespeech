import type {
  DeckSemanticReviewResult,
  ReviewDeckSemanticsInput,
} from "@slidespeech/types";

import { normalizeDeckSemanticReviewResult } from "./deck-semantic-review-normalization";
import { buildCompactDeckReviewSummary } from "./narration-review-normalization";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ToolCallRequest<T> = {
  functionName: string;
  functionDescription: string;
  parameters: Record<string, unknown>;
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  tokenAttempts?: number[];
  disableLmStudioBudgetLift?: boolean;
  parse: (value: unknown) => T;
};

export type OpenAICompatibleDeckSemanticReviewRuntime = {
  chatToolCall: <T>(input: ToolCallRequest<T>) => Promise<T>;
};

const DECK_SEMANTIC_REVIEW_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "score", "summary", "issues"],
  properties: {
    approved: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message", "revisionInstruction"],
        properties: {
          code: {
            type: "string",
            enum: [
              "prompt_leakage",
              "wrong_language",
              "mixed_language",
              "role_drift",
              "template_language",
              "unsupported_claim",
              "fragmentary_copy",
              "source_noise",
              "repetitive_copy",
              "weak_opening",
              "weak_closing",
              "other",
            ],
          },
          severity: {
            type: "string",
            enum: ["info", "warning", "error"],
          },
          slideId: { type: "string" },
          message: { type: "string" },
          revisionInstruction: { type: "string" },
        },
      },
    },
  },
};

const buildDeckSemanticReviewSystemPrompt = (): string =>
  [
    "You are a strict semantic QA reviewer for generated teaching decks.",
    "Judge meaning, language consistency, slide-role fidelity, source grounding, prompt leakage, and whether the copy is audience-facing.",
    "Do not rewrite the deck. Return issue labels and concrete revision instructions only.",
    "Do not penalize the deck merely for being concise. Penalize generic filler, unsupported claims, wrong-language or mixed-language output, repeated slide roles, and template repair language.",
    "Prompt leakage means exposed instructions, schema/tool text, source-role labels, URLs, brief wording, or mentions of slides/decks/templates/presentation generation. Do not call ordinary subject-mechanism descriptions prompt leakage.",
    "Only use prompt_leakage when audience-facing copy explicitly exposes generator instructions, schema/tool fields, source/brief labels, URLs, presenter/slide-management instructions, or presentation-generation wording.",
    "Do not classify an audience-facing final sentence that welcomes questions as prompt_leakage. If it is generic or replaces the takeaway, use weak_closing or template_language instead.",
    "Do not classify ordinary how-to language, procedural action guidance, quality checks, or audience-facing imperatives as prompt_leakage. If such copy is generic or awkward, use template_language or weak_opening/weak_closing with warning severity instead.",
    "Titles such as 'Concrete detail', 'Why it matters', or 'Conclude with the takeaway' are template_language unless the surrounding copy exposes actual generator instructions.",
    "Do not call ordinary value propositions, role-specific examples, review checks, or safety constraints prompt leakage merely because they summarize why the topic matters.",
    "For workshop decks, concrete participant tasks, role examples, review steps, and action-oriented exercise wording are valid audience-facing content when they are specific and complete.",
    "Native organization names, acronyms, and source-language proper nouns do not by themselves make a deck mixed-language.",
    "Learning goals may describe what a system, mechanism, process, or organization does when that statement would help the audience understand the subject.",
    "For how-it-works decks, a scenario such as a learner interrupting a lesson is subject content, not prompt leakage, if the points explain the mechanism.",
    "Each deck-outline block contains a slide number/id, title, learning-goal line, and bullet points. The slide number/id is review metadata, not deck content, and must not be cited as prompt leakage.",
    "Use the slide briefs as the expected role and claim map. If a slide answers a different audience question, misses its required claim, or borrows another slide's role, report role_drift.",
    "For grounded decks, concrete factual claims should be traceable to the grounding summary, highlights, or role-scoped facts. If an important concrete claim has no support, report unsupported_claim rather than guessing it is true.",
    "For narrow source-backed decks, do not require broader significance, impact, legacy, or why-it-matters claims unless they are grounded. An opening that names the exact subject identity, title, date, or source-backed starting point is acceptable when broader context would be unsupported.",
    "For ungrounded topic-only decks, do not report unsupported_claim for ordinary domain guidance, common examples, or plausible process advice. Use unsupported_claim only for specific statistics, named cases, source claims, or implausible facts that would need evidence.",
    "For repeated slides, compare the actual titles, learning goals, and bullets. If two slides have the same explanatory center even with different wording, report repetitive_copy.",
    "The opening slide should orient the audience to the subject before jumping into a middle detail. Report weak_opening when slide 1 starts mid-story or lacks subject identity/context.",
    "The final slide should provide a concise synthesis or takeaway and, when appropriate, make audience questions welcome. For narrow source-backed decks, a cautious synthesis of verified anchors is acceptable; do not require unsupported impact or legacy. Report weak_closing when it only repeats earlier content or lacks a closing role.",
    "Wrong-language or mixed-language issues are about the audience-facing slide copy. Do not count proper nouns, source titles, organization names, or place names as language mixing.",
    "Do not fail a deck solely because a final title is concise, as long as the final slide contains concrete audience-facing content.",
    "Do not penalize a concise final-slide invitation for audience questions when it appears only as part of the closing slide.",
    "For procedural/how-to decks, concrete action-oriented guidance is acceptable and often preferred when it is specific, safe, and audience-facing.",
    "Call the provided tool and do not answer in plain text.",
  ].join(" ");

const buildDeckSemanticReviewUserPrompt = (
  input: ReviewDeckSemanticsInput,
): string =>
  [
    `Requested topic: ${input.generationInput.topic}`,
    input.generationInput.presentationBrief
      ? `Presentation brief: ${input.generationInput.presentationBrief}`
      : null,
    input.generationInput.intent
      ? `Intent: ${JSON.stringify(input.generationInput.intent)}`
      : null,
    input.generationInput.groundingSummary
      ? `Grounding summary: ${input.generationInput.groundingSummary}`
      : "Grounding summary: none",
    input.generationInput.groundingHighlights?.length
      ? `Grounding highlights: ${input.generationInput.groundingHighlights.join(" | ")}`
      : null,
    input.generationInput.groundingFacts?.length
      ? `Role-scoped facts:\n${input.generationInput.groundingFacts
          .slice(0, 12)
          .map(
            (fact) =>
              `- [${fact.role}/${fact.confidence}] ${fact.claim} Evidence: ${fact.evidence}`,
          )
          .join("\n")}`
      : null,
    !input.generationInput.groundingSummary &&
    !input.generationInput.groundingHighlights?.length &&
    !input.generationInput.groundingFacts?.length
      ? "Grounding policy: this is an ungrounded topic-only deck, so evaluate ordinary domain guidance for coherence and usefulness rather than source support."
      : null,
    input.generationInput.slideBriefs?.length
      ? `Slide briefs:\n${input.generationInput.slideBriefs
          .map(
            (brief) =>
              `- Slide ${brief.index + 1}: ${brief.role}; question: ${brief.audienceQuestion}; required claims: ${brief.requiredClaims.join(" | ") || "none"}`,
          )
          .join("\n")}`
      : null,
    `Generated deck title: ${input.deck.title}`,
    `Generated deck language: ${input.deck.metadata.language}`,
    `Generated deck summary: ${input.deck.summary}`,
    `Audience: ${input.pedagogicalProfile.audienceLevel}`,
    `Deck outline:\n${input.deck.slides
      .map((slide) => buildCompactDeckReviewSummary(slide))
      .join("\n\n")}`,
    "Return fields: approved, score, summary, issues.",
    "Issue code must be one of: prompt_leakage, wrong_language, mixed_language, role_drift, template_language, unsupported_claim, fragmentary_copy, source_noise, repetitive_copy, weak_opening, weak_closing, other.",
    "Issue severity must be info, warning, or error.",
    "Each issue must include message and revisionInstruction. Include slideId when the issue is slide-specific.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const reviewDeckSemanticsWithOpenAICompatibleProvider = (
  input: ReviewDeckSemanticsInput,
  runtime: OpenAICompatibleDeckSemanticReviewRuntime,
): Promise<DeckSemanticReviewResult> =>
  runtime.chatToolCall({
    functionName: "return_deck_semantic_review",
    functionDescription:
      "Return the semantic QA review for a generated teaching deck before it is accepted.",
    parameters: DECK_SEMANTIC_REVIEW_PARAMETERS,
    messages: [
      { role: "system", content: buildDeckSemanticReviewSystemPrompt() },
      { role: "user", content: buildDeckSemanticReviewUserPrompt(input) },
    ],
    maxTokens: 1800,
    timeoutMs: 12000,
    tokenAttempts: [1800, 2600],
    disableLmStudioBudgetLift: true,
    parse: normalizeDeckSemanticReviewResult,
  });
