# Multilingual Quality Strategy

This document defines how SlideSpeech should move from English-heavy string
guards toward multilingual semantic review.

## Principle

Deterministic code should protect structure. The LLM should judge meaning and
generate revised artifacts through explicit stages.

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

The previous generator contained English/template phrase guards that were added
to catch real bad decks quickly. Those modules have been removed from the
generation path. Any remaining deterministic checks should be treated as smoke
alarms for structure, duplication, transport, or source hygiene, not as semantic
deck authors.

Examples of legacy phrase debt:
- prompt leakage such as "specific case study requested in the prompt"
- repair-template fragments such as "one concrete consequence makes..."
- English presentation meta language such as "this slide" or "deck"
- English fragment checks around dangling prepositions and imperative bullets

Core-level semantic phrase guard lists should not be reintroduced. If a
temporary deterministic alarm is unavoidable, document it in
`docs/generation-architecture-map.md`, keep it language-generic, and make the
failure actionable for a V2 stage.

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

3. LLM regeneration
- regenerates the affected artifact through the owning stage
- preserves slide role, grounding, and deck language
- does not use local hardcoded phrase substitutions as a repair path

4. Deterministic final gate
- verifies that the reviewed output is structurally valid
- keeps smoke detectors as safety alarms only
- fails visibly if quality is still uncertain

## Implementation Rules

- Do not add scattered regex/string fixes in generation modules.
- If a temporary deterministic guard is needed, put it behind a named V2 stage
  boundary and document why it is not semantic content repair.
- Every new language-specific guard must have a test and a task note explaining
  when it should be replaced by LLM semantic review.
- Prefer structured LLM tool calls over free-text parsing for semantic review.
- Keep deterministic local recovery structural only; if the system has to
  invent semantic content, use the owning LLM stage or fail visibly.

## Next Migration Steps

1. Build V2 `PromptClassification`, `ResearchPlan`, `FactBank`, `DeckStrategy`,
   `SlidePlan[]`, and `SlideDraft[]` artifacts.
2. Use structured semantic review labels such as `prompt_leakage`,
   `wrong_language`, `role_drift`, `template_language`, `unsupported_claim`,
   and `fragmentary_copy` as retry/rejection signals.
3. Keep structural checks in `validation.ts`, `session-deck-quality.ts`, and
   publication review as gates, not copy-repair systems.
4. Run live scenarios in multiple domains before adding new deterministic
   checks, so the code does not overfit to one prompt.
