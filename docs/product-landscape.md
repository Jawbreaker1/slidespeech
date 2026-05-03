# SlideSpeech Product Landscape

Last reviewed: 2026-04-23

This document is a product reference, not an active task tracker.

Use it for:
- competitor orientation
- product inspiration
- understanding where adjacent tools are stronger today
- deciding what SlideSpeech should copy, avoid, or treat as out of scope

Do not use this file as a status board.
Active implementation tracking lives in [tasks.md](/Users/johanengwall/github_repos/slidespeech/tasks.md).

## Market reality

There are many tools that solve one part of the problem well.
There are very few that convincingly solve the whole chain:

1. generate a strong deck
2. present it live in a usable runtime
3. support interactive audience questions
4. answer from grounded material without embarrassing failures

The market is therefore fragmented rather than dominated by one obvious full-stack competitor.

## Closest adjacent products

### Deck generation first

- [Gamma](https://gamma.app/products/presentations)
  - strong at prompt-to-deck creation, editing, and export
  - useful reference for fast structure, framing, and export workflow
- [Plus AI](https://plusai.com/)
  - strong at native PowerPoint and Google Slides workflow
  - useful reference for "real slides, not just an AI canvas" positioning
- [Prezi](https://prezi.com/)
  - useful reference for presentation-first storytelling, but less relevant to SlideSpeech's runtime Q&A ambition

### Presentation runtime and audience participation

- [Canva Live](https://www.canva.com/features/canva-live/)
  - strong at presenter-only control surface, audience join flow, and live question visibility
  - useful reference for presenter UX rather than AI behavior

### AI copresenter / Q&A layer

- [PresEngage](https://presengage.com/)
  - closest reference for AI Q&A layered on top of uploaded slides, notes, research, and URLs
  - strong at audience connect flow, question collection, and follow-up positioning

### AI presenter / narration layer

- [MyPresenter AI](https://www.mypresenter.ai/)
  - close reference for "AI presents your deck and answers questions"
  - appears stronger on narration/runtime positioning than on native deck generation
- [SlidesOrator](https://www.slidesorator.com/)
  - close reference for interruptible narration plus Q&A
  - useful reference for runtime interaction patterns
- [HeyGen Interactive Avatar](https://www.heygen.com/interactive-avatar/)
  - adjacent reference for avatar-based interactive conversation
  - not a strong template for SlideSpeech's current priorities

## What these tools appear to do better today

### 1. Cleaner product entrypoints

The best adjacent products make it very obvious how the audience joins the experience.

Strong references:
- [Canva Live](https://www.canva.com/features/canva-live/)
- [PresEngage](https://presengage.com/)

What SlideSpeech should learn:
- provide a dedicated audience entrypoint
- make Q&A feel like a core part of the product, not a side control
- use explicit join surfaces such as:
  - QR code
  - short link
  - audience slide

### 2. Better presenter-only control surfaces

The best runtime tools clearly separate:
- what the audience sees
- what the presenter sees

Strong reference:
- [Canva Live](https://www.canva.com/features/canva-live/)

What SlideSpeech should learn:
- better presenter console
- visible question queue
- transcript confidence and "unclear question" states
- clearer runtime controls and status indicators

### 3. Stronger "AI knows this material" setup

The best Q&A-oriented tools explicitly show that the AI has learned:
- the deck
- notes
- URLs
- source documents

Strong references:
- [PresEngage](https://presengage.com/)
- [MyPresenter AI](https://www.mypresenter.ai/)

What SlideSpeech should learn:
- show the knowledge bundle before presentation starts
- make the source set visible
- reduce the feeling that the system is improvising from weak context

### 4. More productized interruption handling

The nearest AI presenter tools emphasize that narration can be interrupted for Q&A.

Strong references:
- [SlidesOrator](https://www.slidesorator.com/)
- [MyPresenter AI](https://www.mypresenter.ai/)

What SlideSpeech should learn:
- interruption should be a first-class runtime concept
- the switch between "presenting" and "answering" should feel explicit and reliable
- transcript, answer generation, and resume states should be visually obvious

### 5. Better question logging and post-talk value

Some adjacent tools turn audience questions into a durable asset instead of a transient interaction.

Strong reference:
- [PresEngage](https://presengage.com/)

What SlideSpeech should learn:
- store all questions
- record whether the answer was strong, weak, or uncertain
- keep a follow-up queue for questions that need better research

## What SlideSpeech should not copy

### Avatar-first presentation

References:
- [HeyGen Interactive Avatar](https://www.heygen.com/interactive-avatar/)
- parts of [SlidesOrator](https://www.slidesorator.com/)

Reason to avoid for now:
- high gimmick risk
- not needed to prove the core product
- adds complexity before deck/runtime/Q&A quality is solid

### PDF-first workflow

References:
- [SlidesOrator](https://www.slidesorator.com/)
- likely parts of [MyPresenter AI](https://www.mypresenter.ai/)

Reason to avoid for now:
- reduces control over structure and semantics
- weaker fit for a grounded, generated, editable teaching pipeline

### SMS-first audience interaction

Reference:
- [PresEngage](https://presengage.com/)

Reason to avoid for now:
- useful for some live-room scenarios
- not necessary for SlideSpeech's current product direction
- adds an extra channel before core web runtime quality is fully reliable

## Why no one seems to combine the whole chain well

This is an inference from the product landscape, not a direct quote from competitors.

The likely reason is that the "whole chain" is actually four separate products:

1. deck generation
2. presentation runtime
3. AI Q&A / copresenter
4. narration / presenter delivery

Each category has:
- different buyers
- different failure modes
- different technical stacks
- different product expectations

That makes the combined product much harder than it appears.

### Failure costs are public

Weak slide generation is annoying.
Weak live Q&A is embarrassing.
Weak narration and interruption handling feel broken immediately in front of an audience.

That means the integrated product has a much harsher quality bar than any one subsystem on its own.

### Positioning is hard

A combined product is hard to describe cleanly:
- is it a slide generator?
- a presentation platform?
- an AI tutor?
- a sales copresenter?
- a training runtime?

Many companies therefore ship only one or two layers rather than the full chain.

## SlideSpeech implication

SlideSpeech should not try to copy one competitor wholesale.
It should copy the strongest idea from each adjacent category.

### Best references by area

- deck generation:
  - [Gamma](https://gamma.app/products/presentations)
  - [Plus AI](https://plusai.com/)
- presenter runtime:
  - [Canva Live](https://www.canva.com/features/canva-live/)
- AI Q&A and knowledge bundle:
  - [PresEngage](https://presengage.com/)
- interruption-aware narration:
  - [MyPresenter AI](https://www.mypresenter.ai/)
  - [SlidesOrator](https://www.slidesorator.com/)

### Practical product direction

The most useful near-term inspiration for SlideSpeech is:

1. a clearer audience join surface
2. a clearer presenter console
3. a visible knowledge bundle
4. a more explicit question lifecycle
5. durable logging of audience questions and weak-answer follow-up

These are more valuable right now than:
- avatars
- novelty voice personas
- extra channels such as SMS

## What to revisit later

When the core runtime is stronger, revisit:
- whether a public audience participation layer should exist
- whether audience follow-up becomes a product feature
- whether a lightweight avatar or visual presenter persona adds anything real
