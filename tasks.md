# SlideSpeech Tasks

Last updated: 2026-05-03

This file is the canonical active task tracker for the repo.

Use this file for:
- current phases
- status per workstream
- active subtasks
- definition of done

Do not treat these files as competing task trackers:
- [README.md](/Users/johanengwall/github_repos/slidespeech/README.md): product and status narrative
- [architecture-plan.md](/Users/johanengwall/github_repos/slidespeech/docs/architecture-plan.md): architecture reference
- [docs/deck-and-slide-types.md](/Users/johanengwall/github_repos/slidespeech/docs/deck-and-slide-types.md): canonical type reference for deck arcs and slide roles

## Phase Overview

### 1. Demo hardening
Status: done enough

Notes:
- demo was held
- runtime is usable
- services are up and stable enough for active development

### 2. Q&A / STT robustness
Status: done enough for now

Goal:
- make typed Q&A, Record question, and Live voice feel like one coherent product flow
- make voice input understandable and cancellable
- stop low-quality transcripts from turning into nonsense answers
- ensure the answer path has enough grounded context to produce relevant answers when the material exists
- decide whether a question is actually relevant to the presentation before spending answer effort on it
- fetch more information when a relevant question cannot be answered from the current deck/session context alone
- treat English as the primary quality bar for this phase while keeping the architecture compatible with later multilingual support

Definition of done:
- typed Q&A shows a clear modal while the answer is being generated
- Record question shows a clear listening/transcribing flow
- Live voice has stricter gates than Record question
- user can cancel a question before it is sent
- transcript is visible before or while answer generation happens
- obviously bad transcripts do not go straight into backend Q&A
- one English and one Swedish voice question work end-to-end without obvious nonsense

Subtasks:
- [x] Add a shared question-flow state machine for typed Q&A, Record question, and Live voice
- [x] Add a shared question-flow modal with states for listening, transcribing, transcript review, generating answer, and speaking answer
- [ ] Add `Cancel question` support to the modal and wire it through all three entry paths
- [x] Route typed Q&A through the same modal instead of only disabling the send button
- [x] Show transcript text prominently for voice questions
- [x] Add transcript quality gates on backend voice input before calling session interaction
- [x] Remove English hardcodes from browser voice defaults where possible
- [x] Stop assuming English-only backend STT by default
- [x] Tighten Live voice gating so ambient speech/noise is ignored more often than it interrupts
- [x] Enrich Q&A answer context so factual and contextual questions see enough relevant slide, deck, and source material
- [x] Add an explicit relevance classification step so off-topic questions are recognized as off-topic instead of forced into deck-shaped answers
- [x] Distinguish between:
  - relevant and answerable from current deck/session context
  - relevant but missing context
  - not relevant to the current presentation
- [x] For relevant-but-missing questions, add a controlled follow-up research/fetch path before answering
- [ ] Decide what sources that follow-up fetch may use:
  - current deck sources first
  - trusted web research second
  - explicit refusal when grounding still is not sufficient
- [x] Add a final answer-validation gate so obviously non-answers are rejected before they reach the learner
- [x] Add clearer fallback behavior when the available material is insufficient for a reliable answer
- [ ] Verify typed Q&A, Record question, and Live voice separately

Current progress:
- initial shared modal/state machine is implemented in the presenter
- typed Q&A now goes through the same visible flow as voice
- backend voice transcripts are now gated before Q&A is called
- browser speech now follows deck/browser language instead of hardcoded `en-US`
- backend STT code paths now support multilingual/auto mode, and the local runtime is now running `faster-whisper` with model `base`
- Live voice now auto-sends only clear presenter questions and holds uncertain ambient transcripts for review
- answer-path relevance classification is implemented and tested
- relevant grounded factual questions can now trigger controlled follow-up research when the initial source grounding is too weak
- grounded factual answers now go through a final answer-validation gate before they are returned
- rejected homepage/source sludge can now be repaired into a tighter grounded factual snippet instead of only falling back to a refusal
- backend `Record question` still works after the STT switch on an English voice-turn smoke test
- Swedish runtime verification is still pending real microphone/browser input; synthetic `say` audio was not a reliable proxy
- English live Q&A is now materially better on:
  - `System Verification`
  - `VGR`
  - `iPhone`
  - `SpongeBob`

Latest live validation findings:
- `System Verification` fresh generation was still slow (`~195s`) and drifted to a generic “Ensuring Quality in Software” framing instead of clear onboarding/company framing
- `System Verification` typed Q&A for `What countries are System Verification in?` now returns `Sweden, Germany, Bosnia and Herzegovina, Poland, Denmark.`
- `System Verification` backend voice-turn for `Who is the CEO of System Verification?` now gives an honest grounded fallback instead of generic homepage/source sludge
- `System Verification` off-topic rejection worked as intended
- `VGR` typed English Q&A worked for the workshop exercise question
- `VGR` typed Swedish Q&A failed by misclassifying a clearly relevant workshop question as off-topic
- `VGR` backend voice-turn worked for an English contextual usage question
- `SpongeBob` typed off-topic handling now redirects honestly instead of producing a deck-shaped answer
- `SpongeBob` typed factual Q&A for `When did SpongeBob first premiere?` now succeeds in isolated live validation with:
  - `The first episode that actually aired to the public was called 'Help Wanted.' It came out on May 1, 1999, and has the production number 001.`
  - this required a stricter factual-answer gate and better deck-context fallback prioritization
- `SpongeBob` still showed variability in broader chained validation runs earlier, so topic-only English decks are improved but still worth watching
- `iPhone`
  - `Which company created the iPhone?` now returns the clean factual answer `Apple.`
  - `Why was the iPhone important to the history of smartphones?` now returns an acceptable contextual answer in isolated live voice-turn validation, including the fallback path when the model answer times out
- the new answer-validation gate therefore looks useful beyond `System Verification`; it is helping on `iPhone` and `SpongeBob` too, not just the company-grounded case
- `Live voice` browser-specific UI behavior is not yet fully validated in-browser from automation; only the shared transcript/Q&A path has been validated through tests and backend voice-turn checks

### 3. Generation quality
Status: active

Goal:
- return to deck quality after the current Q&A/STT stream is complete
- shift effort upstream into better generation inputs so validation repairs become a safety net, not the main quality mechanism

Definition of done for the next pass:
- hard prompts do not collapse into obviously repetitive or generic slide structure
- onboarding/company prompts stay company-specific
- workshop prompts keep a clear practice/exercise slide
- fresh subject prompts do not drift into unsupported abstract claims
- factual grounding is converted into role-scoped facts before slide generation
- each slide receives a focused brief with allowed evidence instead of the whole grounding pool
- semantic validation remains language-neutral and LLM-assisted where possible

Known open problems:
- `System Verification` still drifts into generic company/value language
- `VGR` still risks weak workshop structure
- evaluator is still more generous than the actual saved deck quality
- whole-deck retries spend too much time repairing decks that were under-specified before generation
- recent System Verification live generation still fell into deterministic fallback after semantic review rejected repeated LLM deck attempts
- fallback must remain safe, but it should not be the normal route for weak-but-repairable decks

Current progress:
- outline-first hardening has started:
  - presentation planning now receives coverage goals separately from visible grounding summary
  - plan generation is explicitly treated as an outline stage with one audience-facing storyline beat per final slide
  - plan normalization expands/trims storyline to the requested slide count so long decks do not need generic extension slides
  - research scaffold labels such as `Research coverage goals` and `Curated grounding highlights` are stripped away before they can become fallback slide text
  - deterministic fallback now prefers curated highlights and grounding facts over raw research summaries when it has to build extra slides
  - scaffold-like outline phrases such as `Explanation of ...` and truncated `into daily` endings are now treated as quality failures before slide text is accepted
- explicit-source organization grounding now tries same-domain support pages before broader web fallback
- explicit-source support search is now host-filtered, so off-domain results cannot silently become grounding
- `System Verification` no longer regresses through the earlier `SIS Global` false-positive support search path
- supporting explicit-source findings are now sanitized more aggressively to remove scraped counters and faq-style question headings before they can seed slide contracts
- fetched research findings now pass through a new LLM-assisted grounding classification step before generation:
  - it curates high-signal grounding highlights and excerpts
  - it marks source roles/relevance and narrows `groundingSourceIds` when it has confidence
  - it feeds a curated grounding summary into generation instead of only the older raw research summary
  - the old heuristic highlight/excerpt path remains as fallback when the classifier fails or returns too little
- `System Verification` now opens with a harder onboarding role and later organization contracts bias toward operational grounding before generic value language
- organization role separation is now stricter in the contract and repair layers:
  - seed acceptance is role-aware for `entity-operations`, `entity-capabilities`, and `entity-value`
  - plan-driven repair now rejects headings and key points that clearly signal the wrong organization role
  - `entity-value` now prefers concrete outcome evidence instead of treating the bare word `value` as enough signal
- role-specific recovery and assessment are now stricter against repair-heavy slide meta:
  - recovered org and subject slides no longer rely on `this slide should...` style fallback language
  - `entity-operations` now requires a concrete operating anchor
  - `entity-value` now requires a concrete example slot only when the evidence contains a real customer case
  - `entity-value` now falls back to an evidence-backed practical consequence when sources do not contain customer-case evidence
  - fabricated customer/client/provider scenarios are rejected across organization-role slides when no supporting case evidence exists
  - onboarding slides now reject common second-person marketing phrases and unsupported customer-impact labels
  - organization contract seed selection now separates operations, capabilities, and value anchors more strictly so service/framework text is not reused as operating-model evidence
  - organization deck titles are now normalized away from marketing-guide phrasing such as `Your Guide`, `excellence`, and `journey`
  - no-case organization value slides now reject tool/framework/CI pipeline detail as the value story unless it is backed by explicit customer-case evidence
  - operations slides now reject service/tool/AI/pipeline stories when the slide is supposed to explain operating model, footprint, teams, and workflow
  - no-case organization value slides now also reject invented ERP transformation, migration project, deployment-delay, proprietary-application, and portal examples
  - workshop-practice evidence now prefers the activity requirement or concrete grounded task instead of a generic learning objective
- fallback slide-point filtering is now stricter:
  - short fragmentary evidence phrases are filtered out more aggressively
  - workshop-practice titles and learning goals are stabilized around a reusable audience-facing action phrase
  - recovery paths now treat more malformed plan text as unusable point candidates instead of leaking it directly into slide copy
- generation latency regression found 2026-04-27:
  - launchpad text made a long-running generation look like it was blocked in `Preparing presenter mode`, even though the API was still retrying deck generation and slide enrichment
  - presenter start now only waits for the active slide narration instead of all slide narrations
  - background narration prefetch now pauses while presenter startup or speech playback is active
  - full deck retries now stop earlier when the only remaining hard failure is cross-slide distinctness
  - plain-text slide enrichment fallback is now limited to one attempt before deterministic recovery
- direct contract inspection for the explicit multi-URL System Verification prompt now shows a healthier arc:
  - orientation
  - operations
  - capabilities
  - value
- `System Verification` still over-indexes service/capability language from same-domain material, so the remaining blocker is now later-slide role fidelity and repair quality rather than domain filtering alone
- latest live signal says the new grounding layer is directionally right but not sufficient yet:
  - it reduces some junk and source duplication
  - but LLM slide enrichment still drags organization slides toward self-promotional service language
- 2026-05-03 System Verification onboarding live check after outline-first hardening:
  - job `genjob_sg51nfmu` completed as `deck_37w28oaf`
  - deck-level deterministic fallback did not appear to trigger, and raw research labels no longer leaked into visible slide text
  - latency was still poor at about 5 minutes 20 seconds
  - content is still not acceptable: slides 4-6 contain fragmentary/recovery-heavy copy such as `Explanation of QA delivery...`, `QA delivery is integrated into daily`, and generic capability/value language
  - next blocker is slide-brief/slide-enrichment quality after the outline, not the existence of an outline stage itself
- generation-first rebuild phase 1 has started:
  - grounding classification can now return role-scoped facts
  - API grounding builds a fallback fact bank from curated highlights/excerpts when the classifier does not return facts
  - provider slide generation now builds slide briefs from contracts and routes scoped facts into outline/enrichment prompts
  - compact fallback prompts now include role-scoped facts and slide briefs
- generation-first phase 2 has started:
  - deterministic recovery paths now prefer scoped slide-brief evidence before global grounding
  - final-slide recovery now preserves a visible closing/questions-welcome role
  - added regression coverage so recovery cannot silently use unrelated global grounding when a slide brief exists

Subtasks:
- [x] Phase 1: Build a language-neutral generation fact bank from curated grounding:
  - role, claim, evidence, source ids, confidence
  - no output-specific correction rules
- [x] Phase 1: Build slide briefs from deck arc + slide contracts:
  - slide role
  - audience question
  - required claims
  - allowed evidence fact ids
  - forbidden overlap with earlier slide briefs
- [x] Phase 1: Pass slide briefs into outline and enrichment prompts so each slide sees scoped evidence first
- [ ] Phase 2: Make slide generation role-first:
  - generate from brief before fallback
  - keep final slide as an explicit closing/invite-to-questions role
  - keep first slide as explicit intro/orientation role
- [ ] Phase 3: Replace whole-deck retry bias with slide-local repair where the failure is isolated
- [ ] Phase 4: Strengthen structured LLM semantic deck review for:
  - source support
  - role drift
  - repeated explanation
  - language consistency
  - weak opening/closing
- [ ] Phase 5: Live validation matrix across several deck types:
  - organization onboarding
  - public-sector/workshop prompt
  - pop-culture factual prompt
  - product/technology prompt
  - multi-URL grounding prompt
- [ ] Phase 5: Track generation latency separately from quality so we know which fixes improve output versus only adding time
- [ ] Tighten the new grounding classifier so unsupported superlatives and homepage self-description are demoted more aggressively
- [ ] Revisit organization onboarding framing now that cleaner grounding is entering the pipeline
- [ ] Revisit workshop slide-role separation
- [ ] Revisit topic-only subject decks so early slides become concrete faster
- [ ] Add structured LLM semantic deck review before deck acceptance so language consistency, role drift, prompt leakage, and template copy are judged semantically instead of through English phrase lists
- [ ] Re-run the live regression suite after the next generation pass

### 4. Visual polish
Status: active

Goal:
- improve slide and presenter clarity without destabilizing the runtime

Definition of done for the next pass:
- presentation overview looks intentional and readable
- question/answer states are visually obvious
- image use remains relevant and non-gimmicky

Subtasks:
- [x] Harden PowerPoint export layout so downloaded decks reserve non-overlapping regions for title, hero, visuals, key points, and footer
- [ ] Revisit presenter overview/thumbnail polish
- [ ] Improve presentation-theme consistency where it clearly helps readability
- [ ] Keep image pipeline honest: real relevant images first, curated fallback only when needed

Current progress:
- PowerPoint export no longer renders cards, callouts, flow diagrams, images, and key points on top of each other; the exporter now chooses one primary content layout per slide
- Exported SVG illustration data is normalized to base64 for `pptxgenjs`, avoiding broken image insertion in downloaded decks
- Export accent fills now use valid 6-digit PowerPoint colors plus transparency instead of invalid 8-digit hex strings
- Added a PPTX package-level regression that inspects generated slide XML and fails when named text boxes overlap or exceed slide bounds

### 5. Code health / refactoring
Status: active

Goal:
- reduce the largest files before the next full logic review
- preserve behavior while moving isolated helpers into cohesive modules
- make generation, Q&A, presenter UI, and validation easier to reason about separately

Definition of done for the next pass:
- no duplicate helper modules with overlapping responsibility
- `openai-compatible.ts`, `session-service.ts`, `question-answer-service.ts`, `session-presenter.tsx`, and validation code have clearer boundaries
- each refactor batch passes typecheck and targeted tests before deeper logic changes resume

Current progress:
- Q&A grounding and session review helpers are already extracted from core services
- generation helper extraction is underway
- `openai-compatible.ts` is reduced from roughly 8.7k lines earlier in the refactor stream to roughly 2.3k lines
- core prompt/template quality guardrails are now centralized in `packages/core/src/text-quality-guards.ts` and explicitly documented as temporary smoke detectors, not multilingual repair logic
- extracted provider modules now own structured-output parsing, normalization, presentation plan normalization, grounding classification normalization, narration review normalization, visual derivation, prompt shaping, slide enrichment prompt construction, slide draft assessment, slide draft anchor matching, slide contract title/learning-goal copy, slide contract point selection, slide contract builder/seed selection, slide recovery/orientation builders, deck normalization/outline shaping, slide contract types, arc policy, deck title normalization, plain-text slide parsing, organization role guards, slide contract rules, slide contract text hygiene, source-backed anchor selection, and workshop text helpers
- removed the duplicate unused `organization-role-guards.ts` module in favor of the imported `organization-role-contracts.ts`
- latest logic validation removed a redundant duplicate `pickContractText` concrete-selection branch while preserving the intended fallback order
- latest validation passed provider typecheck, targeted generation contract/intent tests (`72/72`), full repo typecheck, full `npm test` (`244/244`), and `git diff --check` after extracting deck normalization/outline shaping

Next refactor candidates:
- replace English/template regex quality decisions with structured LLM semantic review as described in [docs/multilingual-quality-strategy.md](/Users/johanengwall/github_repos/slidespeech/docs/multilingual-quality-strategy.md)
- consider extracting `buildIntentPromptLines` only if/when prompt construction grows further
- revisit `apps/web/components/session-presenter.tsx` after the provider split
- revisit `packages/core/src/validation.ts` once generation behavior stabilizes

## Recently completed

- [x] Removed the unstable Qwen3-TTS Apple Silicon experiment from the codebase and local machine
- [x] Documented the Apple Silicon / MLX instability in [README.md](/Users/johanengwall/github_repos/slidespeech/README.md)
- [x] Restored the active TTS path to Piper
- [x] Verified the current app stack is healthy again
- [x] Documented adjacent product references and what SlideSpeech should copy or avoid in [docs/product-landscape.md](/Users/johanengwall/github_repos/slidespeech/docs/product-landscape.md)
- [x] Documented canonical deck arc and slide role definitions in [docs/deck-and-slide-types.md](/Users/johanengwall/github_repos/slidespeech/docs/deck-and-slide-types.md)
- [x] Tightened organization-grounded research so explicit-source support fetch prefers same-domain pages and rejects off-domain fallback matches
- [x] Hardened `organization-overview` slide roles so onboarding opens with identity/orientation and later slides bias toward operations before capabilities/value
- [x] Hardened downloaded PowerPoint export layout and added non-overlap regression coverage
- [x] Extracted another provider refactor batch and validated it with repo typecheck plus the full test suite

## Latest generation validation

- 2026-04-26 alternating live generation pass:
  - `SpongeBob 1999 premiere` now fetches the linked `Help Wanted (SpongeBob SquarePants)` encyclopedia page instead of stopping at the broad series pages
  - latest SpongeBob artifact: [deck_qvn7fvny.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_qvn7fvny.json)
  - SpongeBob is materially better grounded, but still has one cross-slide warning and occasional over-interpretive later-slide copy
  - `VGR AI workshop` no longer passes as clean when weak fallback copy leaks through; latest run correctly reports a `language_quality` warning
  - latest VGR artifact: [deck_lnlcovt3.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_lnlcovt3.json)
  - VGR still needs workshop-recovery work: exercise slides can repeat practical-exercise text, create fragmentary examples, and duplicate `daily work`
  - `System Verification` still exposes the biggest organization-recovery blocker
  - latest System Verification artifact: [deck_jdibpta0.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_jdibpta0.json)
  - the stricter gates catch more tool/CI/customer-case drift during enrichment, but deterministic recovery can still create generic role-template slides if role-specific source facts are too thin
  - next generation step: make organization/workshop recovery either use grounded facts from the research bundle or fail visibly; do not allow generic repair-template text to score as a good deck
- Fresh `System Verification` live generation still shows a real problem in the middle of the deck:
  - opening slide now lands closer to identity/orientation
  - but `what we offer` and `how we work` still cross over or collapse into each other
  - later recovery can still drift back into broad predictive-testing / strategic-intelligence / value-proposition language
- Direct live generation against the current code confirms that:
  - on `2026-04-24`, LM Studio health is currently failing with `fetch failed`
  - live generation passes are therefore exercising the deterministic/recovery path much more than the intended enrichment path
  - the recovery path is cleaner than before, but still not good enough to call `System Verification` or `VGR` done
  - the contract layer is healthier than before
  - but LLM slide enrichment still tends to drag `entity-operations` toward service catalog language
  - and `entity-value` still tends to drift into abstract capability/value messaging unless recovery takes over
  - so the remaining work is primarily in the generation/enrichment layer, not in prompt parsing or same-domain research selection
- Completed live artifacts from this pass:
  - [deck_a2z3o4r8.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_a2z3o4r8.json)
  - [deck_ps4e1d88.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_ps4e1d88.json)
- Honest read:
  - structure is better than before
  - grounding is cleaner than before
  - generation is still not good enough for `System Verification`
  - the next fix should target slide-role fidelity/recovery for `entity-operations`, `entity-capabilities`, and `entity-value`, not more search-domain work
- Multiple explicit source URLs work as intended at the research/runtime layer:
  - the direct grounding set carries both URLs through to `sourceIds`
  - example artifact: [deck_7p1lcpst.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_7p1lcpst.json)
- `Use Google for additional information` now behaves materially better in prompt parsing:
  - it no longer leaks into the subject or search queries for source-backed subject prompts
  - example artifact: [deck_6w4ceeot.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_6w4ceeot.json)
- `Googla information about ...` without explicit URLs is still much weaker than explicit-source grounding:
  - prompt parsing now keeps the organization identity (`System Verification`)
  - but generation quality still falls back toward generic AI/value language
  - example artifact: [deck_66qfdlvr.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_66qfdlvr.json)
- Latest live fallback-focused validation now passes again for:
  - [deck_yip51v51.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_yip51v51.json)
  - [deck_ogbtny9k.json](/Users/johanengwall/github_repos/slidespeech/data/decks/deck_ogbtny9k.json)
- Honest read on those new artifacts:
  - they now pass the stricter repair gate even when LM Studio slide enrichment is falling back
  - `System Verification` is structurally cleaner than before, especially on slide roles and titles
  - but the actual slide copy is still too generic and repetitive
  - `VGR` workshop structure passes, but slide 2 and slide 4 still contain weak phrasing and fallback-heavy copy
  - the next blocker is no longer role drift alone; it is weak `focus/objective` text quality leaking into final copy, especially in organization and workshop decks

## Not active now

- TTS model replacement
- new LLM experiments
