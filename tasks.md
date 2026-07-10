# SlideSpeech Tasks

Last updated: 2026-07-10

This is the active task tracker and implementation strategy. It should track
what is implemented, what remains, and which validation gates must run before
work is considered complete.

It must not define a competing architecture. If this file conflicts with
`docs/generation-pipeline-v2.md`, the V2 architecture wins and this file should
be corrected in the same change.

Legend:
- `[x]` implemented or completed
- `[ ]` not completed yet

Canonical references:
- [README.md](/Users/johanengwall/github_repos/slidespeech/README.md): product narrative
- [docs/generation-pipeline-v2.md](/Users/johanengwall/github_repos/slidespeech/docs/generation-pipeline-v2.md): target generation architecture
- [docs/generation-architecture-map.md](/Users/johanengwall/github_repos/slidespeech/docs/generation-architecture-map.md): active architecture map and legacy removal queue
- [docs/deck-and-slide-types.md](/Users/johanengwall/github_repos/slidespeech/docs/deck-and-slide-types.md): deck and slide type inventory

## Always-On Rules

- Before each major code change, state the V2 stage, artifact, expected input, expected output, and validation gate.
- Do not add prompt-specific production strings, scenario-specific regexes, or static semantic fallback decks.
- Prefer deleting or isolating legacy paths over wrapping them with another recovery layer.
- Keep deterministic code responsible for structure, routing, source hygiene, and safety.
- Keep semantic deck content in LLM stages, or fail the stage.
- Keep natural-language classification, relevance, planning, and quality judgment agentic; do not implement them with keyword inventories, language-specific regexes, or weighted phrase heuristics.
- Pass one named artifact between stages instead of rebuilding semantic context from parallel summaries, excerpts, hints, and fallback instructions.
- If a fix cannot be mapped to a stage contract, stop and update the V2 architecture before editing code.
- After substantial generation/research changes, update the architecture map, run `npm run arch:graph`, and run `npm run arch:check`.

## Recurring Validation Gates

Use this checklist for every implementation phase.

Before coding:
- [ ] Identify the V2 stage and artifact being changed.
- [ ] Identify the legacy path being removed, bypassed, or left untouched.
- [ ] Define the failure mode the change is meant to address.
- [ ] Confirm the change is not a quick patch or prompt-specific guardrail.

During coding:
- [ ] Keep the stage function small and named after its artifact responsibility.
- [ ] Add tests for the artifact contract, not one scenario string.
- [ ] Avoid changing unrelated runtime behavior in the same patch.
- [ ] Update docs only when the phase boundary or implementation status changes.

After each major phase:
- [ ] Run `npm run arch:graph`.
- [ ] Run `npm run arch:check`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run typecheck --workspaces --if-present -- --pretty false`.
- [ ] Run targeted tests for the changed stage.

After every publishable generation milestone:
- [ ] Run `npm test`.
- [ ] Run one live scenario not used to design the fix.
- [ ] Run one source-grounded live scenario.
- [ ] Run one topic-only live scenario.
- [ ] Run one scenario with non-English source material but English deck output.

Fail criteria:
- Generated semantic slide copy comes from fallback, labels, or repair code.
- A malformed or rejected LLM stage is accepted as publishable.
- A deck can publish without required narration.
- Validation silently rewrites weak content into public-looking content.
- Production code adds prompt-specific regex/string correction.

## Phase 1: Cleanup Before V2 Generation

Status: completed

Goal:
- Remove old V1 generation/recovery complexity so V2 is built on clean stage boundaries.

Implemented:
- [x] Remove production deterministic deck generation and static deck recovery.
- [x] Remove legacy slide-contract, deck-normalization, slide-enrichment, slide-recovery, and draft-assessment modules.
- [x] Remove workbench/debug UI and obsolete benchmark/evaluation scripts.
- [x] Disable `OpenAICompatibleLLMProvider.generateDeck` fail-closed until V2 generation exists.
- [x] Split publication review policy out of `SessionService`.
- [x] Split OpenAI-compatible provider tasks into named modules for grounding classification, presentation planning, narration generation, semantic deck review, and final presentation review.
- [x] Split research and grounding orchestration into named API-stage modules.
- [x] Rename validation entry points away from repair language: `validateDeck` and `validateNarrations`.
- [x] Remove API/example defaults that selected mock LLM and mock web research for generation.
- [x] Add API guard so `LLM_PROVIDER=mock` remains test-only and cannot publish user-facing presentations.
- [x] Remove regex-based review-code matching and English slide-number parsing from local narration review follow-up.
- [x] Document remaining fallback categories as runtime safety, render safety, transport compatibility, test-only, or documented temporary routing.
- [x] Mark the historical MVP architecture plan as non-authoritative.
- [x] Make `tasks.md` a checkbox-based implementation tracker.

Still to implement or verify:
- [x] Review [openai-compatible.ts](/Users/johanengwall/github_repos/slidespeech/packages/providers/src/llm/openai-compatible.ts) for accidental V1 behavior.
- [x] Review [session-service.ts](/Users/johanengwall/github_repos/slidespeech/packages/core/src/session-service.ts) for accidental V1 behavior.
- [x] Review [grounding-selection.ts](/Users/johanengwall/github_repos/slidespeech/apps/api/src/services/grounding-selection.ts) for accidental V1 behavior.
- [x] Review [grounding-source-analysis.ts](/Users/johanengwall/github_repos/slidespeech/apps/api/src/services/grounding-source-analysis.ts) for accidental V1 behavior.
- [x] Review [question-answer-service.ts](/Users/johanengwall/github_repos/slidespeech/packages/core/src/question-answer-service.ts) for accidental V1 behavior.
- [x] Re-check remaining fallback/regex references before Phase 2 closes.
- [x] Confirm no production generation module can create a publishable semantic deck without the planned V2 pipeline.
- [x] Confirm no removed V1 module is imported from production code.
- [x] Remove production final-review `repairedNarrations` behavior so narration review cannot become a hidden repair layer.
- [x] Run the full automated validation checklist before starting V2 implementation.
- [x] Run the manual code validation sweep before starting V2 implementation.

Phase 1 validation:
- [x] `npm run arch:check` passed after documentation alignment.
- [x] `git diff --check` passed after documentation alignment.
- [x] `npm run arch:graph` before closing Phase 1.
- [x] `npm run arch:check` before closing Phase 1.
- [x] `git diff --check` before closing Phase 1.
- [x] `npm run typecheck --workspaces --if-present -- --pretty false` before closing Phase 1.
- [x] `npm test` before closing Phase 1.

Definition of done:
- [x] No production generation module can create a publishable semantic deck without the planned V2 pipeline.
- [x] No removed V1 module is imported from production code.
- [x] Architecture map and import graph are current.
- [x] Recurring automated validation passes.
- [x] Manual code validation sweep has been run before V2 implementation starts.

## Phase 2: Validation Sweep

Status: completed

Goal:
- Confirm the cleaned codebase is stable before adding V2 generation.

Required automated checks:
- [x] `npm run arch:graph`
- [x] `npm run arch:check`
- [x] `git diff --check`
- [x] `npm run typecheck --workspaces --if-present -- --pretty false`
- [x] `npm test`
- [x] `npm run verify:api` as a read-only API smoke check; generation endpoints are intentionally excluded until Pipeline 2.0 exists.
- [x] `npm run verify:llm` fails when `.env` points at an unloaded model and passes when `LMSTUDIO_MODEL` is explicitly set to the currently loaded model.

Required manual/live scenarios:
- [x] Topic-only stable subject: Donald Duck context built without web research.
- [x] Explicit single URL: Molted Email context built from `https://molted.email/`.
- [x] Multiple explicit URLs: Donald Duck context built from Wikipedia and Britannica.
- [x] User asks to research/googla: VGR-style prompt failed closed when no trustworthy sources were fetched.
- [x] Company onboarding: Atlassian context built with grounded facts.
- [x] Workshop/practice deck: real-estate marketing workshop intent classified as workshop.
- [x] Entertainment/factual event: Donald Duck topic classified without SpongeBob-specific code.
- [x] Swedish-source grounding with English deck output: currently fail-closed without explicit sources; improve research strategy in Phase 4 instead of patching.
- [x] Typed Q&A: copied an existing session into `/tmp`, asked a typed question, received a relevant answer, and session paused after answering.
- [x] Q&A fallback inspection: removed deterministic context/source answer generation after LLM answer failure; Q&A now fails closed unless the answer LLM and answer validation accept the response.
- [x] Research fallback inspection: removed guessed Wikipedia/direct same-domain URLs; supplemental explicit-source research now uses explicit URLs plus site-scoped search, not hardcoded path candidates.
- [x] Planning fallback inspection: removed duplicated/static arc prompt templates and local focus-anchor derivation; plan prompts now require intro/distinct beats/closing without choosing a fixed semantic arc.
- [x] Source-hygiene inspection: removed abstract marketing semantic blacklists and synthetic "notable focus areas" highlights; local filters now focus on navigation, CTA, scrape, and source-quality noise.
- [x] Record question deferred to Phase 7 because it requires a publishable V2 session.
- [x] Live voice deferred to Phase 7 because it requires a publishable V2 session and browser microphone access.

Definition of done:
- [x] The codebase is stable with generation intentionally fail-closed.
- [x] Remaining fallback/regex references are classified and justified.
- [x] No cleanup item can create or approve publishable semantic deck content.
- [x] Open questions are documented before Phase 3 starts.

Open findings carried into their owning phases:
- [x] LLM readiness requires both API health and the configured model id; `.env` currently expects `qwen/qwen3.6-35b-a3b`.
- [x] Phase 4 must improve source acquisition for specific non-English public-sector prompts without relaxing fail-closed gates.
- [x] Phase 4 must budget source-bundle size and LLM calls because larger grounding classification calls can time out.
- [x] Phase 7 must remove Q&A dependence on reasoning-content extraction by using an explicit agentic answer contract.
- [x] Q&A no longer converts ranked slide/source snippets into semantic answers when answer generation fails.
- [x] Research/source hygiene no longer prefetches guessed encyclopedia pages or same-domain support paths as hidden semantic fallback.
- [x] Slide planning no longer gets duplicated static arc instructions from intent context.
- [x] Recorded question and live voice are explicitly scheduled for Phase 7 browser/manual validation.

## Phase 3: V2 Types, Interfaces, And Logging

Status: completed

Owned V2 stages:
- `PromptClassification`
- `ResearchPlan`
- `ResearchBundle`
- `FactBank`
- `DeckStrategy`
- `SlidePlan[]`
- `SlideDesignSpec[]`
- `SlideDraft[]`
- `ReviewResult`
- `NarrationScript[]`
- `PublishablePresentation`
- `Grounded Q&A`

Goal:
- Add the typed artifacts and stage interfaces before implementing semantic behavior.

Implementation tasks:
- [x] Define `PromptClassification` schema/type.
- [x] Define `ResearchPlan` schema/type.
- [x] Define `ResearchBundle` schema/type.
- [x] Define `FactBank` schema/type.
- [x] Define `DeckStrategy` schema/type.
- [x] Define `SlidePlan[]` schema/type through `SlidePlanSet`.
- [x] Define `SlideDesignSpec[]` schema/type through `SlideDesignSpecSet`.
- [x] Define layout-specific `SlideDraft[]` schema/type through `SlideDraftSet`.
- [x] Define `ReviewResult` schema/type without repair output.
- [x] Define `NarrationScript[]` schema/type through `NarrationScriptSet`.
- [x] Define fail-closed `PublishablePresentation` schema/type.
- [x] Define `GroundedAnswer` and resume-plan runtime types.
- [x] Add stage result metadata for `status`, `warnings`, `errors`, timings, attempts, and source traceability.
- [x] Add file-backed development tracing so every stage result can be inspected by run and attempt.
- [x] Keep production generation fail-closed until downstream phases are complete.

Validation:
- [x] Type-level/runtime schema tests for artifact shape.
- [x] Unit tests for stage result success/reject/error states.
- [x] `npm run arch:graph`
- [x] `npm run arch:check`
- [x] `npm run typecheck --workspaces --if-present -- --pretty false`
- [x] Targeted tests for V2 artifact contracts.

Definition of done:
- [x] All V2 artifacts have explicit schemas or TypeScript types.
- [x] No stage writes visible slide copy before `SlideDraft[]`.
- [x] Failure states are representable without throwing away diagnostics.

## Phase 4: Classification, Research, And Fact Bank

Status: pending

Owned V2 stages:
- `PromptClassification`
- `ResearchPlan`
- `ResearchBundle`
- `FactBank`

Goal:
- Build trustworthy context before slide planning.

Implementation tasks:
- [ ] Implement prompt intent classification.
- [ ] Classify language, audience, presentation goal, and deck mode.
- [ ] Classify grounding mode, requested sources, requested coverage, and requested slide count.
- [ ] Plan research from explicit requirements instead of broad scraping.
- [ ] Execute explicit URLs first.
- [ ] Execute same-domain support pages only when the research plan requires them.
- [ ] Execute broader web research only when the prompt or risk profile requires it.
- [ ] Curate a traceable fact bank.
- [ ] Preserve missing facts and contradictions.
- [ ] Pass `FactBank` downstream instead of raw scraped text.

Validation:
- [ ] Unit test explicit single URL prompt.
- [ ] Unit test multiple URL prompt.
- [ ] Unit test topic-only prompt.
- [ ] Unit test "research/googla" prompt.
- [ ] Unit test requested side coverage preservation.
- [ ] Unit test missing required facts.
- [ ] Live test one company/source deck.
- [ ] Live test one non-company topic.

Definition of done:
- [ ] Generation receives a `FactBank`, not raw scraped text.
- [ ] Missing required facts fail the stage or become explicit user-facing limitations.
- [ ] Source-grounded facts carry source ids and confidence.

## Phase 5: Deck Strategy, Slide Allocation, And Design Selection

Status: pending

Owned V2 stages:
- `DeckStrategy`
- `SlidePlan[]`
- `SlideDesignSpec[]`

Goal:
- Decide the deck story, slide jobs, fact allocation, and layout intent before any visible prose is generated.

Implementation tasks:
- [ ] Implement deck strategy generation from classification and fact bank.
- [ ] Allocate first slide as `intro`.
- [ ] Allocate last slide as `conclusion`.
- [ ] Allocate body slides with distinct jobs.
- [ ] Allocate allowed facts per slide.
- [ ] Define overlap policy per slide when needed.
- [ ] Select design specs from content needs.
- [ ] Prevent role labels and internal planning text from becoming visible slide copy.
- [ ] Ensure design specs do not rewrite facts.

Validation:
- [ ] Unit test first slide is `intro`.
- [ ] Unit test final slide is `conclusion`.
- [ ] Unit test body slide distinctness.
- [ ] Unit test fact allocation.
- [ ] Unit test overlap policy.
- [ ] Unit test unsupported slide requests.
- [ ] Live test onboarding prompt.
- [ ] Live test teaching prompt.
- [ ] Live test workshop/how-to prompt.
- [ ] Live test strategy/report prompt.

Definition of done:
- [ ] Every slide has a distinct reason to exist before prose generation.
- [ ] No slide plan relies on static fallback copy.
- [ ] Layout intent is separated from semantic content.

## Phase 6: Slide Draft Generation And Stage Review

Status: pending

Owned V2 stages:
- `SlideDraft[]`
- `ReviewResult`

Goal:
- Generate visible slide content from allocated facts and design specs, then fail or retry the owning stage when quality is insufficient.

Implementation tasks:
- [ ] Generate slide drafts from `SlidePlan[]`, `FactBank`, and `SlideDesignSpec[]`.
- [ ] Review slide drafts for grounding.
- [ ] Review slide drafts for role fidelity.
- [ ] Review slide drafts for repetition.
- [ ] Review slide drafts for language consistency.
- [ ] Review slide drafts for renderer compatibility.
- [ ] Retry failed slide/content stages with structured feedback.
- [ ] Fail closed after repeated stage failure.
- [ ] Ensure review rejection blocks publication.

Validation:
- [ ] Unit test malformed LLM output.
- [ ] Unit test rejected review output.
- [ ] Unit test missing facts.
- [ ] Unit test repeated main claims.
- [ ] Unit test language mismatch.
- [ ] Live test one previously failing prompt.
- [ ] Live test one unrelated prompt.

Definition of done:
- [ ] Bad slide drafts are rejected, not repaired into generic decks.
- [ ] Repeated content is a failure unless explicitly planned.
- [ ] Review rejection blocks publication.

## Phase 7: Narration, Publication, And Runtime Handoff

Status: pending

Owned V2 stages:
- `NarrationScript[]`
- `PublishablePresentation`
- `Grounded Q&A`

Goal:
- Produce a coherent presenter script and publish only complete, reviewed presentations.

Implementation tasks:
- [ ] Generate narration after slide drafts are stable.
- [ ] Review narration as presenter speech.
- [ ] Reject narration that repeats slide bullets instead of presenting the material.
- [ ] Publish only after slide review passes.
- [ ] Publish only after narration review passes.
- [ ] Publish only after final publication review passes.
- [ ] Keep Q&A on the runtime path with grounded answer and resume planning.
- [ ] Ensure Q&A answers bridge back to the current presentation.

Validation:
- [ ] Unit test missing narration.
- [ ] Unit test malformed final review.
- [ ] Unit test rejected final review.
- [ ] Unit test Q&A answer validation fail-closed behavior.
- [ ] Live test typed Q&A.
- [ ] Live test recorded question.
- [ ] Live test presenter resume.

Definition of done:
- [ ] First narration introduces the presentation.
- [ ] Final narration closes and invites questions.
- [ ] A presentation cannot become user-facing with partial narration.
- [ ] Q&A answers bridge back to the current presentation.

## Phase 8: Cross-Scenario Live Validation And Release Candidate

Status: pending

Goal:
- Prove the new pipeline is not overfit to one deck type.

Required live scenarios:
- [ ] System Verification onboarding
- [ ] VGR / public-sector AI workshop
- [ ] SpongeBob or Donald Duck factual entertainment topic
- [ ] Marketing strategy for newly built properties
- [ ] Product/site deck from a single explicit URL
- [ ] Multi-URL grounded deck
- [ ] Topic-only strategy/report deck
- [ ] Swedish-source grounding with English output

Validation:
- [ ] Record stage diagnostics for each scenario.
- [ ] Compare failures by stage rather than patching visible symptoms.
- [ ] Update the architecture document only if a phase boundary is proven wrong.
- [ ] Run `npm run arch:graph`.
- [ ] Run `npm run arch:check`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run typecheck --workspaces --if-present -- --pretty false`.
- [ ] Run `npm test`.
- [ ] Commit only after automated checks and the agreed live scenario set have completed.

Definition of done:
- [ ] The pipeline produces materially better first drafts across unrelated scenarios.
- [ ] Failures are explainable by stage artifact, not hidden fallback behavior.
- [ ] Remaining issues are documented as explicit next-phase work.
