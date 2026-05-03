# Multilingual Quality Strategy

This document defines how SlideSpeech should move from English-heavy string
guards toward multilingual semantic review.

## Principle

Deterministic code should protect structure. The LLM should judge and repair
meaning.

This means regex/string guards are allowed for:
- schema and structured-output validation
- empty, too-short, too-long, or duplicate content
- malformed JSON, leaked reasoning, or HTML entities
- slide count, slide role ordering, and required fields
- obvious prompt-instruction leakage used as a smoke detector

Regex/string guards should not become the long-term mechanism for:
- deciding whether a slide is semantically good
- deciding whether a phrase is idiomatic in a specific language
- repairing awkward language
- translating or preserving language choice
- classifying organization roles from natural language
- deciding if generated copy is sufficiently grounded

## Current Debt

The current generator still contains English/template phrase guards that were
added to catch real bad decks quickly. They are useful as temporary alarms, but
they are not a multilingual quality system.

Examples of legacy phrase debt:
- prompt leakage such as "specific case study requested in the prompt"
- repair-template fragments such as "one concrete consequence makes..."
- English presentation meta language such as "this slide" or "deck"
- English fragment checks around dangling prepositions and imperative bullets

Core-level guard lists now live in
`packages/core/src/text-quality-guards.ts` so new debt does not spread across
the codebase.

## Target Pipeline

Generation should use this split:

1. Structural validation
- deterministic and fast
- rejects invalid or incomplete deck data
- never rewrites semantic content except safe normalization

2. LLM semantic review
- judges language consistency, prompt leakage, role fidelity, grounding, and
  audience-facing quality
- uses the requested/deck language as context
- returns structured issue labels and revision guidance

3. LLM semantic repair
- rewrites only the affected fields or slides
- preserves slide role, grounding, and deck language
- does not use local hardcoded phrase substitutions as the primary repair path

4. Deterministic final gate
- verifies that the repaired output is structurally valid
- keeps smoke detectors as a fallback alarm
- fails visibly if quality is still uncertain

## Implementation Rules

- Do not add scattered regex/string fixes in generation modules.
- If a temporary deterministic guard is needed, put it behind a named guard in
  `text-quality-guards.ts` or the relevant provider guard module.
- Every new language-specific guard must have a test and a task note explaining
  when it should be replaced by LLM semantic review.
- Prefer structured LLM tool calls over free-text parsing for semantic review.
- Keep deterministic local recovery conservative; if the system has to invent
  semantic content, ask the LLM or fail visibly.

## Next Migration Steps

1. Add a structured `reviewGeneratedDeckSemantics` provider path that returns
   issue labels such as `prompt_leakage`, `wrong_language`, `role_drift`,
   `template_language`, `unsupported_claim`, and `fragmentary_copy`.
2. Feed those labels into deck retry guidance before accepting a generated deck.
3. Replace English/template phrase checks in `evaluation.ts`,
   `session-deck-quality.ts`, and provider slide assessment with semantic review
   results where possible.
4. Keep the current deterministic guards only as smoke alarms until live
   multilingual scenarios are stable.
