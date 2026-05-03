# Deck And Slide Types

This document is the canonical reference for generation-time deck arcs and slide roles.

Use it to answer:
- what kinds of decks the generator currently supports
- what slide roles are currently active
- which roles are legacy or dormant
- where overlap is allowed and where it is not

Do not treat `README.md` or `tasks.md` as competing references for these type definitions.

## Layering

There are three different levels in the current generation model:

1. Upstream intent axes
- `presentationFrame`
- `contentMode`
- `deliveryFormat`

2. Internal deck arc policy
- the generator collapses intent into one active deck arc

3. Slide contract kind
- each slide is assigned a role inside that arc

These layers are related, but they are not interchangeable.

## Upstream intent axes

Defined in `packages/types/src/providers.ts`.

### `presentationFrame`
- `subject`
- `organization`
- `mixed`

### `contentMode`
- `descriptive`
- `procedural`

### `deliveryFormat`
- `presentation`
- `workshop`

These are the user-facing classification axes.
They are broader than the internal arc policies.

## Active deck arc policies

Defined and selected in `packages/providers/src/llm/openai-compatible.ts`.

There are currently 4 active deck arc policies:

### 1. `procedural`
Used for step-by-step or how-to presentations.

Typical shape:
- orientation
- ingredients / setup
- steps
- quality / guardrails / completion

### 2. `organization-overview`
Used for company, onboarding, and organization-grounded decks.

Typical shape:
- orientation
- operations
- capabilities
- coverage / development / synthesis for longer decks
- value or workshop practice

### 3. `source-backed-subject`
Used when the topic is a subject/case/event but the deck is explicitly grounded in source material.

Typical shape:
- orientation
- detail
- implication
- takeaway

### 4. `subject-explainer`
Used for more general subject explanation without strong explicit grounding.

Typical shape:
- orientation
- detail
- implication
- takeaway

## Active slide contract kinds

The planner currently emits 14 active slide kinds.

### `orientation`
Opening slide.

Purpose:
- orient the audience
- establish what this presentation is about
- explain why it matters or how to read the deck

### `subject-detail`
Concrete descriptive detail about a subject, case, event, or concept.

Purpose:
- make the topic specific early
- avoid vague overview filler

### `subject-implication`
Middle-slide interpretation or consequence.

Purpose:
- explain why the earlier detail matters
- connect evidence to meaning

### `subject-takeaway`
Closing slide for subject/case decks.

Purpose:
- synthesize the arc
- leave the audience with the main conclusion

### `entity-capabilities`
What an organization offers or is equipped to do.

Purpose:
- describe services, responsibilities, domains, or capabilities

Must not collapse into:
- operating model
- customer outcome/value proof

### `entity-operations`
How an organization works in practice.

Purpose:
- describe delivery model, collaboration, footprint, workflow, or operating pattern

Must not collapse into:
- service catalog
- abstract value language

### `entity-value`
Concrete example, consequence, or customer outcome showing why the organization matters.

Purpose:
- close the organization arc with evidence of impact

Must not collapse into:
- generic “we create value” copy
- pure capabilities list

### `workshop-practice`
Audience exercise or concrete workshop activity.

Purpose:
- give the audience something to do
- make workshop decks meaningfully interactive

### `procedural-ingredients`
Required setup, inputs, materials, or prerequisites.

Purpose:
- prepare the audience to follow the process

### `procedural-steps`
The actual sequence of steps.

Purpose:
- explain how to do the thing

### `procedural-quality`
Checks, pitfalls, completion criteria, or quality guardrails.

Purpose:
- close the procedural arc with operational confidence

### `coverage`
Required coverage area.

Purpose:
- cover a requested or source-backed aspect that does not fit cleanly into operations, capabilities, or value
- keep longer decks from repeating the same organization role

### `development`
Middle-slide progression role.

Purpose:
- advance the story with a distinct mechanism, role, or consequence
- give longer decks a separate explanatory center without duplicating operations or capabilities

### `synthesis`
Synthesis role before the final value slide in longer organization decks.

Purpose:
- connect the main covered areas before the deck closes on practical value
- prevent the final value slide from having to carry both recap and outcome proof

## Ordering rules

The current planner is intentionally stricter at the edges than in the middle.

### First slide
The first slide is effectively reserved for `orientation`.

That is a hard role decision, not hardcoded copy.

### Last slide
The final slide is arc-dependent:
- subject decks end in `subject-takeaway`
- organization decks end in `entity-value`
- workshop decks may end in `workshop-practice`
- procedural decks end in `procedural-quality`

This is also a hard role decision, not a hardcoded summary template.

## Overlap policy

Overlap between roles is allowed at the topic level.
It is not allowed at the role-definition level.

Examples:
- `entity-operations` and `entity-capabilities` may both reference the same organization
- `subject-detail` and `subject-implication` may both reference the same event

But:
- a slide should not simultaneously be treated as both `entity-capabilities` and `entity-operations`
- a value slide should not be accepted just because it mentions “value”
- a middle slide should not silently drift into the same role as the opening or closing slide

## Change rules

If a new deck arc or slide kind is introduced, update all of these:

1. `packages/providers/src/llm/openai-compatible.ts`
- type definitions
- arc selection
- contract ordering
- fallback focus / title / goal logic

2. tests
- especially `tests/slide-contract-language.test.ts`

3. this document

Do not add new kinds only in prompt text or ad hoc repair logic.
If the system depends on a role, it must be explicit here and in the type layer.
