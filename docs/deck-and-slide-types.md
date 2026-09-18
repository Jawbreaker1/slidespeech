# Deck And Slide Types

This document is the inventory and mapping reference for generation-time deck
modes, deck arcs, and slide roles.

It must not define a competing pipeline. The source-of-truth hierarchy is:

1. `docs/generation-pipeline-v2.md` defines the target V2 pipeline and typed
   artifacts.
2. `docs/generation-architecture-map.md` shows the active implementation map
   and legacy removal status.
3. This file lists role inventories and mappings so old and new terms do not
   become ambiguous during implementation.

If this file conflicts with `generation-pipeline-v2.md`, the V2 architecture
wins and this file should be corrected in the same change.

## V2 Target Deck Modes

Defined by `PromptClassification.deckMode` in the V2 architecture:

- `teaching`
- `onboarding`
- `sales`
- `strategy`
- `report`
- `workshop`
- `how-to`
- `comparison`
- `story`

These are user/request-level modes. They are not slide roles and must not write
visible slide copy.

## V2 Target SlidePlan Roles

Defined by `SlidePlan.role` in the V2 architecture:

- `intro`
- `context`
- `evidence`
- `mechanism`
- `example`
- `comparison`
- `implication`
- `activity`
- `decision`
- `summary`
- `conclusion`

These are the target roles for new Pipeline 2.0 implementation.

Rules:

- The first slide must use `intro`.
- The last slide must use `conclusion`.
- A body slide must have a distinct reason to exist.
- A role may constrain generation, but the role label itself must not appear as
  visible slide copy.
- New V2 roles require updates to `generation-pipeline-v2.md`, the type layer,
  semantic review prompts, and this file.

## V2 Target Visual Roles

Defined by `SlideDesignSpec.visualRole` in the V2 architecture:

- `hero`
- `evidence`
- `process`
- `comparison`
- `quote`
- `timeline`
- `map`
- `gallery`
- `checklist`
- `dashboard`
- `question`

Visual roles guide layout selection. They must not rewrite facts or create
semantic slide content.

## Implemented V2 Layouts

These 20 registry entries are available to the slide-design agent. They define
geometry and compatible content shapes, never a topic-specific storyline or copy.

| Layout ID | Family | Content shape |
| --- | --- | --- |
| `editorial-opening` | hero | statement |
| `editorial-statement` | editorial | statement |
| `split-comparison` | comparison | two sides, at most four items per side |
| `numbered-process` | process | at most four steps |
| `editorial-quote` | evidence | quote and attribution |
| `closing-question` | closing | question and optional guidance |
| `image-opening` | hero | statement + whole source image inspected for this slide |
| `image-editorial` | editorial | statement + whole source image inspected for this slide |
| `title-banner` | hero | large title, statement and supporting aside |
| `title-minimal` | hero | whitespace-led title and compact statement |
| `statement-band` | editorial | full-width emphatic statement |
| `statement-sidebar` | editorial | separate title and explanatory regions |
| `comparison-bands` | comparison | two compact comparison groups, at most three items each |
| `comparison-ledger` | comparison | aligned comparison entries, at most four items each |
| `process-vertical` | process | at most four stacked steps, distinct labels and explanations |
| `process-timeline` | timeline | at most four ordered milestones; grounded labels, no invented dates |
| `quote-spotlight` | evidence | focal quotation with a distinct title and attribution |
| `closing-split` | closing | distinct guidance and audience-question regions |
| `image-left` | editorial | whole source image on the left, commentary on the right |
| `image-caption` | editorial | whole image with a statement and note below or beside it |

Paper, Editorial and Signal are complete design systems, not just palettes or
layout IDs. Paper uses restrained sans-serif report layouts and balanced columns.
Editorial uses literary serif hierarchy, margin titles and image-led magazine
spreads. Signal uses oversized sans-serif poster compositions, offset titles and
numbered step grids. The same layout role has different physical geometry in
each system, including image placement and caption treatment. The catalog's
purpose describes the content role; the selected theme owns its composition.
The design agent selects one per deck, or honors the explicit Advanced choice.
The 20-entry milestone is implemented; gallery, spatial diagrams and data charts
are not implied by the larger visual-role vocabulary. The four image layouts require an exact asset
approved by vision for that slide; otherwise only text layouts are available.
They preserve the whole image with identical geometry in browser and PPTX.
There is no automatic stock image, crop or subject-specific layout rule. Studio uses
the same full upstream Source Serif 4 / Source Sans 3 assets as server measurement.
One layout frame supplies both the renderer and author writing contract, including
field paths, widths and font-measured line capacity. Geometry is not duplicated
in agent prompts. Native PPTX font availability and complex-script rendering
remain acceptance work; these font files do not cover every script.

## Legacy Transitional Arc Policies

The following arc names may still appear in tests, old planning helpers, or
transitional code such as `packages/providers/src/llm/slide-arc-policy.ts`.
They are inventory only and must not shape new V2 implementation.

### `procedural`

Old use:
- step-by-step or how-to presentations

V2 mapping:
- deck mode: `how-to`
- likely slide roles: `intro`, `context`, `mechanism`, `activity`,
  `summary`, `conclusion`

### `organization-overview`

Old use:
- company, onboarding, and organization-grounded decks

V2 mapping:
- deck mode: `onboarding`, `sales`, `report`, or `teaching` depending on the
  prompt
- likely slide roles: `intro`, `context`, `evidence`, `example`,
  `implication`, `conclusion`

### `source-backed-subject`

Old use:
- subject/case/event decks explicitly grounded in source material

V2 mapping:
- deck mode: `teaching`, `report`, or `story`
- likely slide roles: `intro`, `context`, `evidence`, `mechanism`,
  `implication`, `conclusion`

### `subject-explainer`

Old use:
- general subject explanation without strong explicit grounding

V2 mapping:
- deck mode: `teaching`
- likely slide roles: `intro`, `context`, `mechanism`, `example`,
  `summary`, `conclusion`

## Legacy Transitional Slide Contract Kinds

The following V1/V1.5 kinds are not V2 targets. They are listed only to prevent
ambiguous reuse while old tests and transitional helpers are removed.

| Legacy kind | V2 role mapping | Status |
| --- | --- | --- |
| `orientation` | `intro` | Legacy term. New code should use `intro`. |
| `subject-detail` | `context` or `evidence` | Legacy term. Allocate facts explicitly in `SlidePlan`. |
| `subject-implication` | `implication` | Legacy term. |
| `subject-takeaway` | `conclusion` | Legacy term. |
| `entity-capabilities` | `evidence` or `summary` | Legacy term. Avoid service-catalog copy. |
| `entity-operations` | `mechanism` or `context` | Legacy term. |
| `entity-value` | `implication`, `example`, or `conclusion` | Legacy term. |
| `workshop-practice` | `activity` | Legacy term. |
| `procedural-ingredients` | `context` | Legacy term. |
| `procedural-steps` | `mechanism` or `activity` | Legacy term. |
| `procedural-quality` | `summary` or `conclusion` | Legacy term. |
| `coverage` | Depends on allocated facts | Legacy catch-all; do not recreate as V2 role. |
| `development` | `mechanism`, `example`, or `implication` | Legacy catch-all; do not recreate as V2 role. |
| `synthesis` | `summary` or `conclusion` | Legacy term. |

## Overlap Policy

Overlap between roles is allowed at the topic level. It is not allowed at the
role-definition level.

Examples:

- `context` and `evidence` may both mention the same organization.
- `evidence` and `implication` may both reference the same event.
- `summary` and `conclusion` may recap earlier material.

But:

- a slide should not silently satisfy multiple body roles without an explicit
  `overlapPolicy`
- a conclusion should not introduce new named facts; its recap uses earlier
  material explicitly allocated in `allowedFactIds` and `overlapPolicy`
- a body slide should not drift into intro or closing work

## Change Rules

If a new deck mode, slide role, visual role, or legacy mapping is introduced,
update all relevant references:

1. `docs/generation-pipeline-v2.md`
2. `docs/generation-architecture-map.md`, if the stage boundary changes
3. the type layer
4. semantic review prompts
5. this document

Do not add new kinds only in prompt text, local fallback, normalization, or ad
hoc repair logic.
