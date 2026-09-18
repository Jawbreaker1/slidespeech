# SlideSpeech Tasks

Last updated: 2026-09-18

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

## Immediate Priority: Connected Product Flow

Current bounded block (2026-09-18, documentation and checkpoint):
- [x] Replace the contradictory migration-era README with the connected V2 product flow, classification/pipeline diagram, actual setup, shared-library/concurrency scope and explicit remaining limits. Keep canonical architecture and acceptance tracking in their existing documents.
- [x] Add four actual browser screenshots: Studio, source-image presenter, live question progress and filtered Library. Record capture scope; cancel only the documentation question and restore the viewport. No fabricated content or progress.
- [x] Re-run all 518 tests, six workspace typechecks, architecture graph/check and diff check. No runtime implementation changes in this documentation task; the same runtime passed the production web build in the preceding question-progress block.
- [x] Check all 17 README file/image links and the checkpoint file inventory. Local credentials, models and generated data are excluded; a signature scan flags only intentional dummy test passwords. Four browser JPEGs total about 322 KB. Remove one trailing space from the bundled font license without changing its wording.
- [x] Prepare the current implementation for the user-requested commit/push checkpoint. This is not completion of Phase 8 or a new release tag; remaining live acceptance stays open. Git history records the actual checkpoint commit.

Current bounded block (2026-09-18, visible question activity):
- [x] Trace the static modal to its transport boundary: core already emits stage progress, but the web waits for one final JSON response and shows no activity or elapsed time. No LLM change is needed.
- [x] Connect the existing POST to optional typed NDJSON progress (waiting, actual classification/answer/review events, reviewed result or error). Preserve JSON callers, queue admission, cancellation, exact answer identity and fail-closed publication. No extra job store, polling loop, model call or semantic rule.
- [x] Add a visible indeterminate activity indicator, elapsed timer and three observed steps; include existing transcription/audio preparation phases and reduced-motion styling. No percentage, invented ETA or timer-driven stage advancement. Cancel remains available and stale events cannot update another question.
- [x] Targeted tests pass (21): stage event ordering, early progress before result, split UTF-8, truncated/malformed/rejected/error streams, cancellation during a pending read, exact answer identity and JSON compatibility. Workspace typechecks and production web build pass.
- [x] All 518 regression tests, six workspace typechecks, production web build, architecture graph/check and diff check pass. Restart only the idle API and built web server on their existing loopback ports; private tunnel and other work unchanged.
- [x] Real browser through the ordinary proxy: Patrick question shows immediate activity, advancing elapsed time and all three observed stages, then approved answer, audio playback and persistent answer text. Trace `question_answer_dji4mulz`: classification 20.5s, answer 22.9s, review 47.2s; review uses 3,896 tokens. This is a progress/playback path check, not an independent audit of historical facts.
- [x] Second real question shows waiting while the first owns the lane; cancel removes it without affecting the first. Mobile 390x844 shows the active Answer step, rotating indicator and visible Cancel with no horizontal overflow. Active cancellation reaches the server (`question_answer_nu5m3jt2`, aborted review); no stale answer appears. Reset viewport overrides afterward. Fullscreen/physical microphone were not revalidated in this UI task.
- [x] Missing-publication check through the proxy: streamed waiting is followed by a terminal error and closed response; ordinary JSON still returns 404. Unit tests cover unexpected EOF and schema rejection rather than fabricated progress. No semantic policies, prompt rules or capacity settings changed in this task.

Current bounded block (2026-09-18, fact and Q&A completion headroom):
- [x] Inspect actual traces before editing. Four recorded Q&A reviews today exhaust 1,800 tokens; the user-reported `question_answer_bipun276` spends 1,686 on reasoning and truncates its decision. Fact curation in `generation_run_k99sofdv` exhausts 9,500 with 7,579 reasoning tokens, below context capacity. These are incomplete execution, not semantic rejection or a reason to bypass review.
- [x] Map changes to provider-owned fact-curation / qa-review capacity. Keep unchanged full input, schema, low reasoning, finite deadlines, parser correction policy and fail-closed approval. No static content, language heuristics, new stage or automatic retry escalation.
- [x] Isolated unchanged-evidence fact probe with 14,000 allowed completes in 77.6s: 19,092 prompt + 9,579 completion (4,632 reasoning), 34 facts, no reference/schema diagnostics. Record `data/generation-evals/fact-sampling/mu6z9ox3`. Sampling differs; this is work-unit execution evidence, not research acceptance or a full deck.
- [x] Add 3,000 tokens to fact headroom, retaining proportional growth and the 14,000 ceiling. Centralize Q&A limits in the existing helper; keep classification/answer at 1,500/2,500 and raise only review to 5,000. No deadline increase. Add capacity, unchanged-context/low-effort and truncated-approval rejection tests.
- [x] Actual production fact replay, no allowance override: the unchanged failing input completes with 33 facts in 103.7s using 11,613 of 12,500 completion tokens; unrelated autumn-leaf material completes with 10 facts in 17.4s using 1,915 of 10,500. Both preserve references and schema. Record `data/generation-evals/fact-sampling/mu6zcdkf`. These are isolated curation checks, not semantic research approval or a full deck.
- [x] Actual production Q&A review controls: recorded Swedish candidate/scope completes in 29.0s with 2,690 tokens and approval plus transition warnings. Question/slide reconstructed from its trace; exact playback cursor was not persisted, so this is not an exact full-input replay. An unrelated accurate seasons answer is approved (10.2s); the contradictory counterpart is rejected (9.9s). Record `data/generation-evals/question-capacity-2026-09-18.json`. No diagnostic candidate is published.
- [x] All 514 regression tests, six workspace typechecks, architecture graph/check (123 nodes, 219 edges) and diff check pass. Three initial sandboxed HTTP test-server binds were denied; the permitted targeted rerun passes all 34. Restart only the idle API at 13:18 UTC; this also activates the earlier acquisition-diagnostic fix. Web and private tunnel unchanged; API library returns 200.
- [x] Execute three HTTP Q&A tests through the real web-origin proxy: English seasons succeeds in 26.9s (review uses 1,496 tokens). Both Swedish reviews complete without token exhaustion but reject the answers: ambiguous company question has a misleading return transition and unsupported cheaper claim (46.5s); clear seasons question describes sunlight angle incorrectly (30.4s). Record `data/generation-evals/question-http-capacity-2026-09-18.json`. This verifies runtime capacity and retained rejection, not successful multilingual answer-quality acceptance or microphone/audio behavior.
- [ ] Separate quality follow-up: ambiguity classification can label a question relevant while acknowledging an unknown referent; the answer can guess a referent and announce continuation rather than asking for clarification. Review also identifies return-to-narration repetition and a wrong Swedish sunlight-angle description. Investigate those artifact responsibilities without weakening review or adding phrase rules. Not changed in this capacity task.

Current bounded block (2026-09-18, readable sources discarded for missing fonts):
- [x] Reproduce both recorded failures (`generation_run_j1hnd57l`, `generation_run_tt0vw6r6`): homepage and CSS return 200; the site's custom font variants return 404. The renderer rejects the entire page, losing both text and discovered links. Unrelated search candidates are correctly declined; no company-specific selection rule is needed.
- [x] Correct the research-execution resource contract: missing fonts permit actual browser-measured substitute-font layout with an explicit source limitation; missing CSS still rejects. Keep public-network, cancellation, resource budgets and semantic review unchanged. Expose recorded acquisition causes in the no-source error, not a canned recovery.
- [x] Thirty targeted tests and all 510 regression tests pass, plus six workspace typechecks, architecture graph/check and diff check. Generic multilingual/missing-font layout preserves both CSS columns; missing CSS remains fatal and private font URLs never reach the network. Live company homepage now returns 15,321 characters and 39 links; independent W3C standards page returns 8,630 characters and 58 links.
- [x] Unchanged-request Qwen research validation: job `607164b2-255b-4ab8-ada8-d57829de140f`, run `generation_run_i1r9tkoh`, acquires five pages (four unique resolved URLs) without fetch errors, including the company's AI/QA article. Evidence selection and fact curation pass; research review approves at 0.85. The ordinary mixed-grounding plan permits general AI how-to knowledge, clearly separated from company-sourced facts; no prompt, selection policy, reasoning level or review gate changed.
- [x] That run passed outline review, then failed in image selection. Inspect actual LM Studio response: prompt 48,163 tokens + completion 2,013 = loaded context 50,176. All completion tokens were reasoning, despite requested allowance 11,000. This is context exhaustion, not evidence that the output allowance is too low. Candidate payload included 83 images and 390 resolution variants (100,980 characters).
- [x] Separate image semantics from download metadata: retain every candidate, source context and complete deck input; exclude only responsive-resolution arrays from selection/vision prompts. Originals remain available for highest-resolution download and provenance. No model settings, token budget, candidate ranking or publication policy changed.
- [x] Real Qwen replay of the unchanged 11-slide outline and 83 candidates completes selection with prompt 38,464 + completion 3,575 = 42,039 tokens. Vision approves three downloaded assets; one optional image exceeds the existing pixel limit and remains unavailable. Record `data/generation-evals/image-context-2026-09-18.jsonl`. This validates the failing image work unit, not publication or perfect visual choices.
- [x] All 511 regression tests pass, including candidate-context preservation and highest-resolution download; all workspace typechecks, architecture graph/check and diff check pass. Both corrections are live in the API, with web/tunnels unchanged.
- [x] Final diagnostic-contract check: preserve acquisition causes as separate existing diagnostic records, not one concatenated message that can exceed the 2,000-character contract. A regression with multiple long errors passes; all 512 tests and core typecheck pass. Deployment was deferred to avoid interrupting the active run; it is now live following the idle API restart in the capacity block above.
- [x] Record complete unchanged-request run failure: job `665739bd-468a-49d4-a02f-51b89896dd97`, run `generation_run_5ds8q0cx`, stopped at 12:51 UTC. Initial acquisition, evidence selection and fact curation passed. Research review requested evidence for QA documentation/reporting; the resulting second acquisition failed when source selection consumed all 2,400 completion tokens in reasoning. No deck was published; the font correction is not proof of end-to-end success.
- [x] Execute user-requested unchanged-prompt rerun: job `ea216b91-b847-4198-9e9c-ce7ecda8ab46`, run `generation_run_k99sofdv`, 12:57:46-13:05:36 UTC (7m51s), FAILED before slide generation. Nine company pages acquired without fetch errors and all nine evidence selections completed. Broad web-search candidates were declined as irrelevant. Fact curation then exhausted its 9,500-token completion allowance: 7,579 reasoning tokens and truncated structured content. Actual LM Studio usage is 19,092 prompt + 9,500 completion = 28,592, below the loaded 50,176 context; this is output exhaustion, not context exhaustion. Same request, model and low reasoning; no production edits or restarts during that run. Browser showed a retained failure modal; no slides, narration or publication were produced.
- [ ] End-to-end acceptance remains open. Curation capacity was subsequently investigated and corrected with independent controls in the capacity block above. A complete post-change generation, narration and publication still need validation; no full presentation is claimed from the probes.
- [ ] Separate observed research-quality follow-up: Bing RSS returned broad/off-target candidates for both supplementary searches; the agent correctly declined them. Redirected query variants also consumed two fetch slots for the same final page. Record these causes rather than adding a topic-specific query rewrite or hiding the source limitation.

Current bounded block (2026-09-18, visible generation progress):
- [x] Reuse existing job stages in a native modal: immediate submission feedback, actual queue position, current step/attempt, available unit counts, elapsed time, retained errors and completion link. Hide/Escape does not cancel; cancellation is separate and explicit.
- [x] Add optional operational timing from recent successful traces for the configured model. Prefer matching slide counts, otherwise disclose numerical length adjustment. No fixed duration, invented progress percentage, semantic classifier, extra LLM call or changed publication gate. Queued estimates exclude waiting; missing history and overruns are explicit.
- [x] All 507 regression tests pass, including five new timing/clock tests. Six workspace typechecks, production web build, architecture graph/check and diff check pass. Read-only sampling of actual current-model history returns an eight-slide estimate based on two completed runs.
- [x] After explicit user approval, restart the built web app and API on their existing loopback ports. Local homepage returns 200; the unchanged ngrok endpoint still returns 401 without credentials. Both servers are running again.
- [x] Live browser check on desktop and 390x844 mobile: real Qwen stage changes, historical time range, elapsed timer, hide/reopen with focus return, queued position and separate waiting label, leaving the queue, and cancelling an active job all work. Cancel only diagnostic jobs `c4510579-df02-4ad7-a8c6-6dbcd07f8868` and `61586219-77d5-45d1-abed-9bbf35da34e4`; no publication was created. This is progress/control acceptance, not a fresh full-generation or completed/failed-dialog live acceptance claim.

Current bounded block (2026-09-18, password-protected private sharing):
- [x] Identify the actual boundary: browser-side localhost URLs prevent remote use, web/API listen on all interfaces and another application's ngrok tunnel is already active. Do not replace that tunnel without approval.
- [x] Move every browser API/audio/export URL to the web origin; use Next's existing proxy with sufficient queue/work timeout and loopback-only local listeners. Remove broad CORS and reject cross-site browser writes. No new semantic stage or auth-account system.
- [x] Add a fail-closed ngrok launcher with required all-path Basic Auth, random persistent local credentials, restrictive permissions, Git exclusion, Authorization stripping and disabled local traffic inspection. Document operation and shared-library limitations.
- [x] All 502 regression tests, five sharing-specific tests, six workspace typechecks, production build, architecture graph/check and diff check pass. Local listeners are verified on 127.0.0.1 only; secret directory/files are 0700/0600 and Git-ignored.
- [x] Isolate actual ngrok plan restriction: Basic Auth alone works; the additional remove-headers action is denied by this account. Move only header stripping to web middleware, keep mandatory all-path authentication at ngrok, and open a separate tunnel without changing the existing assetbrowser tunnel. No plan upgrade or unprotected endpoint.
- [x] Actual HTTPS: missing/wrong credentials get 401 plus Basic challenge on page, library API, audio and legacy export paths. Correct credentials get 200 for Studio/library HTML, V2 publication JSON and valid WAV audio. Cross-site authenticated POST gets 403; same-origin malformed POST reaches normal 400 input validation. HTTP redirects to HTTPS. The final real question passes authentication/proxy/answer generation but fails the known 1,800-token review capacity (`question_answer_kez3xjci`), not a tunnel timeout; do not claim Q&A acceptance.
- [x] Export test limitation: the existing legacy session-export route cannot accept V2 publication IDs, and the current V2 player has no wired user-facing export route/button. Its unauthenticated route is protected, but no successful V2 download is claimed or implemented in this access task. The earlier download capability gap remains separate.

Current bounded block (2026-09-18, small private-group concurrency):
- [x] Root cause: V2 rejects a second generation, while its independent two-question limit can combine with generation to exceed the model's two configured slots; simultaneous STT is rejected. Keep the shared-library/private-server scope, without accounts or a new semantic pipeline.
- [x] API admission owns one generation plus four waiting jobs, actual queue position and cancellation. Preserve terminal failure and publication rules; retain active/queued history and wait for executor unwind before dispatching the next job.
- [x] Reserve one serial lane for complete Q&A requests alongside generation; use a bounded cancellable request queue before question deadlines start. Reuse the request queue for serial STT. Keep prompts, facts, model, reasoning, semantic reviews and retries unchanged.
- [x] Studio polls queued jobs, displays position and permits leaving the queue. The question/transcription modal explains waiting and remains cancellable. No claim of per-user privacy, durable queue or distributed execution.
- [x] Nineteen targeted tests pass: FIFO, independent results, immutable requests, wait limits, bounded history, failure recovery, queued cancellation, active unwind and sequential STT. All 497 regression tests, six workspace typechecks, production web build, architecture graph/check (122 nodes, 217 edges) and diff check pass.
- [x] Live admission and generation: two actual API submissions return accepted/running and accepted/queued, respectively. Inspect queue position 1 and Leave queue in the browser; cancelling the waiting job leaves the active job untouched. Bread run `generation_run_a3m6t1a1` completes all stages and publishes `presentation_j3uiwpem` in 6m07s while real questions run. A separate waiting job `1f83fb6e-3a32-46ec-8e03-27245ca76395` automatically starts after cancelling the active test job; stop the extra diagnostic jobs afterwards. No existing user job is interrupted.
- [x] Live question isolation and recovery: submit seasons and SpongeBob questions simultaneously during generation. SpongeBob review fails at the existing 1,800-token output limit; seasons then completes with the correct presentation/question identity and reviewed answer. Stage timestamps show the next question starts after the first settles, not on submission. Repeating the pair reproduces the isolated review failure and successful next answer; neither failure stalls generation or the queue. This is not a claim that all Q&A answers succeed.
- [x] Unrelated short-deck control: two simultaneous bread/seasons questions both return HTTP 200, matching presentation/question identities and approved answers in 25s/47s including queue wait (`question_answer_ti2jey23`, `question_answer_ya69slgp`). Archive only our bread test publication through the normal API after validation; existing user presentations remain unchanged. Stop all extra diagnostic generation jobs and close only the queue-test browser tab.
- [x] Two simultaneous real Piper requests for different publications return separate valid WAV containers (621,956 and 1,222,988 bytes). API remains healthy. Physical two-microphone capture and maximum-context parallel model performance are not newly validated; STT scheduling is covered by automated tests.
- [x] Investigate Q&A review capacity/context: the four recorded 1,800-token exhaustions are addressed by the measured provider-capacity change above, not a queue change. Low reasoning, full context and fail-closed behavior remain. Semantic answer/transition acceptance is a separate follow-up, not claimed solved by more output space.

Current bounded block (2026-09-18, presenter fullscreen):
- [x] Keep fullscreen in the V2 runtime consumer. Use the same mounted scene, audio and question components; preserve slide, passage and playback position. No generation, legacy player, narration or publication changes.
- [x] Add a visible enter/exit control, viewport-fit slides and compact playback controls with accessible questions. Use native fullscreen when available and explicitly labelled window-fill when the browser cannot provide it; synchronize native exit, support Escape and restore scrolling/focus.
- [x] Actual browser validation: native enter/exit and Escape, continued audio with the same source and advancing position, slide navigation, retained question text, visible question-generation dialog and cancellation. No new end-to-end answer-quality or microphone acceptance is claimed.
- [x] Separately deny fullscreen using a temporary cross-origin iframe/Permissions-Policy test harness. Window-fill works, with truthful status; Escape cancels an open question without closing presentation mode, then exits the mode on the next press. The harness is outside the repository, not a production fallback path.
- [x] Inspect desktop and 390x844 mobile; verify controls also fit 844x390 landscape. Anchor the question drawer to the actual slide grid row rather than a fixed header offset so long titles cannot cover exit/playback controls. All 489 regression tests, six workspace typechecks, final production build, architecture graph/check and diff check pass. API unchanged; updated production web server is running on 3000.

Current bounded block (2026-09-18, user-requested writer output increase):
- [x] Move the writer's fixed limit into the existing capacity helper and increase it from 4,500 to 7,000 completion tokens per slide, including reasoning and JSON. Keep low effort, unchanged input, 180-second work-unit deadline, existing attempt limits and fail-closed truncation behavior. Do not scale a single-slide call with deck length or add a semantic rule.
- [x] Verify default/revision requests send 7,000 with unchanged full context and low effort; the single-slide allowance stays fixed for 1/7/100-slide workloads. All 489 tests, six workspace typechecks, architecture graph/check and diff check pass. The first sandboxed targeted run could not bind three test HTTP servers; its permitted rerun and full regression pass.
- [x] Sequential live Qwen calls with the production helper (no capacity override) complete and fit on the recovered failing writer input (25.4s, 2,322 total completion tokens) and an unrelated Swedish seed-experiment control (16.3s, 1,726 tokens). Both requests send 7,000. Record `data/generation-evals/writer-capacity-production-2026-09-18.json`. This verifies execution with the new allowance, not causal proof that all token failures are solved or full company-deck quality. No full presentation was regenerated or published.

Current bounded block (2026-09-18, functional Studio and faithful source acquisition):
- [x] Replace the oversized italic marketing hero with a compact functional Studio heading, restrained neutral surface and direct progress copy; preserve generation controls. Production build and desktop browser inspection passed.
- [x] Acquisition owns rendering the exact fetched HTML into one static CSS-coordinate/text representation. No domain rules, inferred pairings, extra semantic stage or content fallback. Existing source identities, timestamps and snippet offsets remain authoritative. Page scripts/media disabled; style/font requests use the public-address transport; bounded browser lifecycle. Preserve whole block lines through evidence segmentation.
- [x] Targeted tests: unrelated CSS-reordered Swedish cards, source scripts/frames/media blocked, private styles blocked before fetch, cancellation, whole-block truncation and exact evidence offsets. 27 targeted tests and all workspace typechecks passed.
- [x] Run the unchanged company brief twice through the normal API: source acquisition and founder associations now pass. The second run (`generation_run_kkrh840u`, job `9f0605ae-d362-46eb-81d1-961c0059d087`) produced seven fitted slides, narration and publication in 10m30s, but failed manual factual acceptance. Publication `presentation_5r41y605` completed before cancellation and was archived through the normal API (recoverable, no existing presentation modified). No acceptable end-to-end result is claimed.
- [x] Full regression: 477 tests passed; all workspace typechecks, production web build, architecture graph/check and diff check passed. All four existing publications parse unchanged. Desktop Studio inspected in browser. Mobile visual acceptance is not yet established.

Follow-on bounded block (2026-09-18, authoring knowledge boundary):
- [x] Inspect actual normal-run artifacts before editing: `generation_run_egvzqsaq` acquired layout, correctly curated founder associations, passed research/outline and generated seven fitted slides. Manual inspection found unsupported product/availability statements in notes and one visible overstatement; slide review approved these. Cancelled before publication. This is not an accepted deck.
- [x] Root cause: broad explanatory model-knowledge scopes were treated as permission to add subject-specific facts, and review concentrated on visible copy rather than applying grounding equally to notes. Share a generic authoring/review policy; no named examples, regex, content rewriting or extra stage.
- [ ] Live negative control FAILED: the exact human-rejected draft was again approved at 0.92 after the shared policy clarification (`data/generation-evals/grounding-boundary-review-2026-09-18.json`). Do not claim the semantic reviewer is fixed. It missed unsupported implementation/availability claims in notes; manual factual review remains necessary. Investigate reviewer scope/context separately rather than appending more scenario instructions.
- [x] Unrelated live Qwen evidence controls pass with the real static-layout acquisition: CSS-reordered Swedish workshop cards correctly associate both people/roles; Swedish crop table preserves quantities and comparison (5.7s / 6.2s). `data/generation-evals/rendered-layout-controls-2026-09-18.jsonl`. Independent public fetch of python.org/about also succeeds; these are acquisition/curation controls, not complete decks.
- [x] Fresh normal generation confirmed that authoring instructions alone do not solve factual drift: unsupported availability, adaptation and market-focus assertions remained in narration. Narration/final review reported some as advisory and still approved. The generated test was archived, not accepted.
- [x] Focused review diagnostic: remove persuasive author-plan/design context and narrow the existing reviewer to independent claims-versus-facts checking. The same bad draft was rejected with three material errors (42.7s); unrelated accurate water explanation was accepted (3.9s). Record `data/generation-evals/focused-review-2026-09-18.jsonl`. Both task framing and projection changed; do not infer which alone explains the result.
- [x] Implement that factual projection in the existing slide-review provider, retaining original fact/slide order and core identity mapping. No new stage, semantic regex, topic-specific instruction or static correction. Tests verify full notes/claims are retained and the writer still receives its original context.
- [x] Actual production-adapter negative control also rejects the recorded unsupported draft under unchanged capacity/low effort: score 0.75, explicit unsupported-capability error plus uncertainty/absence issues, retryRecommended=true. `data/generation-evals/focused-production-review-2026-09-18.json`. This does not establish universal reviewer reliability or validate the newer full draft.
- [x] Implement the author-owned slide revision item below. Only actionable material errors trigger correction, not warnings or a modest score. Never downgrade a rejection in code. A trial additional permissiveness instruction passed small controls but incorrectly approved unsupported product details in the recorded deck; remove that extra layer and retain the focused factual-review instruction. Narration/publication already accept useful imperfect work.
- [x] Regression: 488 tests and all workspace typechecks pass. Tests cover one targeted correction, retained research/design/untouched scenes, complete new-set review, prior artifact traceability, physical-fit feedback, advisory approval at score 0.6, exhausted revisions, provider failure, cancellation and unscoped/upstream feedback. Factual review now also receives existing subtitles; older fact banks without uncertainties remain readable.
- [x] Live Qwen low, sequential: the final focused reviewer accepts three useful-imperfect/hypothetical controls and rejects the corresponding three factual contradictions across pressure, an observational pilot and Swedish seed germination. Results: `data/generation-evals/slide-revision-mu6nofb3/controls.json`. These are diagnostic fixtures, not complete published decks.
- [x] Actual author-owned revision stages also pass all three independent controls: real semantic rejection -> rewrite affected slide -> actual font fit -> exact whole-set approval. Unaffected draft and scene remain byte-equal. Corrected texts were manually read. Record `data/generation-evals/clear-slide-revisions-2026-09-18.json`; these are targeted model/stage probes, not fresh research/narration/publication runs.
- [ ] The recorded company negative is NOT reliably rejected. Additional permissiveness wording and then the restored focused baseline approved unsupported implementation/availability details in repeat tests (`revision_eval_mu6ng5qy`, `revision_eval_mu6njaek`, `revision_eval_mu6np5bq`). The extra policy was removed rather than stacking more instructions or fitting the company. Earlier successful rejection is not sufficient proof of verifier reliability. No diagnostic draft was published.
- [x] Fresh ordinary app run `generation_run_wwp4iilc` / job `18935774-14d1-402f-b8d8-265113dacd7c` passed research/outline/design and wrote six slides, then failed on the final writer call: 4,500 completion tokens, 4,329 reasoning tokens, truncated JSON. This happened before slide review, not because of stricter quality gates. No new presentation or narration was published.
- [x] Inspect the actual server response before changing capacity: the model deliberated about layout, conclusion scope and optional subtitle, then began a coherent answer before truncation. Reconstruct the exact six preceding model responses and final input; an isolated 7,000-token/low-effort probe completed and fitted in 31.9s using only 3,345 tokens. This is sampling evidence, NOT proof that raising the limit solves the failure. Record `data/generation-evals/writer-capacity-probe-2026-09-18.json`; no production change was made in that diagnostic. The later user-requested production increase is tracked above.
- [ ] Next bounded task: simplify and validate the writer's conclusion/recap responsibility from recorded requests, without a new heuristic or full-generation retry. Then run the original brief to publication using the increased allowance above and inspect the spoken content. End-to-end acceptance remains open; do not ask the user to repeat this known failure.
- [ ] Separate dependency maintenance: audit flags existing packages including Next, pptxgenjs and shell-quote. No Playwright advisory reported. Do not mix broad dependency upgrades into source-reading validation; resolve before exposing the service beyond trusted development.

Current bounded block (2026-09-17, repeated company-generation failures; NOT end-to-end accepted):
- [x] Inventory all five recorded attempts before editing: two pre-fix runs missed the bare-domain source (`bm36a77n`, `x9j1wk5n`); `7iywjvud` selected the source but contradicted it with web-research-only mode; `wly60bzq` was manually cancelled after wrong founder associations; `jb4xm263` reached slide review and was rejected for putting narration-only-labelled facts on slides. The latter also retained the wrong founder associations, so bypassing its review would not be a valid fix.
- [x] Classification contract: validate chosen sources, grounding mode and the web control inside the existing structured-client parser, allowing its one bounded model correction. Keep core acceptance unchanged. Do not silently relabel the grounding policy, add a second retry loop or introduce scenario rules.
- [x] Remove premature display permissions from current fact authoring. Research owns supported claims/provenance; allocation and slide writing own visible versus spoken placement. Remove the corresponding competing prompt instructions and allow unlabeled current facts in allocation. Retain read compatibility with old published fact labels; no saved artifact is rewritten.
- [x] Preserve passive HTML block/table structure in the one acquired content representation, with exact downstream offsets. Preserve inline text and escape literal markup; collapse redundant layout wrappers without semantic interpretation. Curation/review now explicitly distinguish DOM order from visual relationships and must retain uncertainty instead of asserting guessed attribution. Do not claim CSS reconstruction or vision acquisition.
- [x] Regression/compatibility: 468 tests, all six workspace typechecks, production web build and architecture/diff checks passed. All four existing publications still parse unchanged. Source scan found no company/domain/person-specific strings in production packages/apps. New transport regression proves one model correction for contradictory source choices, preserving low effort and source identity.
- [x] Normal app test, unchanged brief: job `7b539b50-4d4d-4e6f-b2a9-bb5766bb6576`, run `generation_run_krjcvrrl`. Classification, planning, acquisition and evidence passed; fact curation exhausted 8,000 completion tokens (6,935 reasoning). No outline/slides/narration/publication followed. No production retry or capacity increase was added.
- [x] Isolated same-input diagnostic at the same 8,000 capacity/low effort completed 16 facts in 62.9s, with 5,608 reasoning tokens. The result correctly left founder-role associations unresolved instead of swapping roles. Ordinary research review then rejected the unresolved mandatory per-founder requirements (71.5s); this is a diagnostic, not a resumed/published presentation. Record: `data/generation-evals/fact-sampling/mu615ebq/`. The long reasoning explicitly revisits the ambiguous DOM associations; larger limits alone cannot supply the missing evidence.
- [x] Alternate live Qwen controls on synthetic unrelated source fixtures: grouped workshop cards preserved both name/role/background associations (5.2s); a Swedish crop table preserved both quantities and calculated their difference correctly (6.4s). Record: `data/generation-evals/source-structure-controls-2026-09-17.jsonl`. These are factual-curation controls, not generated/published decks.
- [x] Source capability implemented in the 2026-09-18 block: static rendered CSS coordinates, not screenshot vision or guessed plain-HTML grouping. End-to-end factual acceptance remains a separate gate below.
- [x] Close the `draftOutline` pipeline gap with one bounded author-owned correction of affected slides only. Preserve research/designs/images and untouched drafts/scenes; retain factual feedback through physical fit; record new draft identity and review the entire result. Unscoped/upstream errors, model unavailability or a second rejection still stop. No generic retries or suppressed rejections.
- [ ] End-to-end acceptance remains open. Run the original brief only after the missing visual evidence is available, verify factual associations and the final narrated presentation, and alternate with an unrelated scenario. Do not ask the user to keep retrying this known limitation.

Current bounded block (2026-09-17, scheme-less source intent, maximum 30 minutes):
- [x] Trace failed job `be492571-d3b4-4fd4-90c4-d5ad3f268aef`, run `generation_run_bm36a77n`: capture discarded the scheme-less domain, leaving no direct source target. Four search targets yielded unrelated or no eligible candidates, correctly rejected by the model. No fetch was attempted. Direct acquisition with the production provider successfully retrieved the website, including company and founder material.
- [x] Fix at capture/classification ownership: standard link parsing records candidate text/HTTPS URLs separately from immutable explicit URLs. The existing LLM classifier selects positions semantically; core resolves them into ordinary requested sources. Publication permits only captured candidate URLs while preserving all explicit URLs. No topic rule, added stage, guessed path, automatic candidate promotion, blacklist or static fallback. Existing public-address checks are unchanged.
- [x] 465 regression tests and six workspace typechecks pass. Added multilingual capture, balanced/encoded URL, email/protocol/IP exclusion, duplicate handling, semantic opt-out for product names, invalid/missing selection, direct-plan handoff and publication provenance tests. Previous explicit-only artifact behavior remains compatible; the earlier fuzzy-disabled policy is superseded only for separately classified candidates.
- [x] Live sequential Qwen controls: Swedish website identification selected `https://riksdagen.se/` (8.3s); a domain-shaped framework name with no-web intent selected no sources (4.2s). Records `source_candidates_swedish_website_mu5vq0fo` / `source_candidates_product_not_address_mu5vq6u6`. Restarted API only after controls finished and the original job was already rejected.
- [x] Unchanged original prompt rerun through Studio: job `fb11795e-efc3-41d8-b795-bbce26fa01f2`, run `generation_run_wly60bzq`. Classification selected the exact captured candidate; acquisition directly fetched its HTTPS homepage and followed its www redirect. Company/founder text was retained, with no fetch errors; source acquisition and evidence selection passed. This proves the initial acquisition defect is fixed, not final presentation quality.
- [x] Production web build and architecture/diff checks pass; all four existing published presentations still validate without changes. Architecture contract/map now document candidate recognition versus LLM source intent and the full product action. Search-provider relevance remains an independent open issue: the original exact queries returned unrelated results, and direct source support does not establish search reliability.
- [x] Inspect the normal rerun's remaining stages: research review approved (0.92), and the run reached slide generation, but manual comparison against the rendered source revealed reversed founder roles/backgrounds in three facts. Cancelled the job at 18:51:49 UTC, before publication. This is a failed factual-acceptance test, not a completed presentation. No generated facts were edited and no reviewer bypass was introduced.

Source relationships and factual attribution (partially implemented above; visual acquisition still open):
- [x] Confirm the root cause on the live source: visual cards show Vegard Rossi Westergard as Founder/CEO and Per Hjaldahl as Founding CTO; the fact bank assigns the opposite roles/backgrounds. Source DOM order interleaves role, biography and name, while CSS defines the actual two-column associations. Both people share the same DOM container, so line breaks or nearest-parent grouping alone cannot establish the relationship. The parser removes structural context, and the research reviewer explicitly acknowledges ambiguity but still approves its guess. Evidence is preserved in `generation_run_wly60bzq`.
- [ ] Define the acquisition artifact needed to preserve source relationships (ordinary structural documents versus visually arranged pages) and how the existing evidence/curation/review stages consume it. Reconcile with the earlier flattened-table finding below. Do not add a topic-specific name/role correction, adjacency heuristic, indiscriminate extra reviewer or a claim that plain HTML grouping resolves CSS layout.
- [ ] Validate the chosen approach on unrelated cards, tables and normal prose, including ambiguous evidence. Ambiguous attribution must remain unresolved or require new supporting evidence rather than becoming an asserted fact. Keep LLM semantic ownership and explicitly document any new acquisition capability before implementation.
- [ ] Rerun the unchanged company brief end to end and manually verify founder associations, company claims, slides and narration before marking it accepted. The original source-recognition defect is fixed; factual reliability is not yet accepted.

Current bounded block (2026-09-17, full-presentation product wording):
- [x] Trace the actual submit path before editing: the production job already executes research, slides, narration, final review and durable publication. Studio still describes the historical research/slide-only increments and incorrectly says questions/export are not connected.
- [x] Align submit, progress, cancellation and completed-result copy with full generation; keep unpublished historical previews explicitly distinct. Remove obsolete capability badges and future-feature claims. Preserve the API contract, pipeline, publication gate and explicit playback action; no new generation mode, heuristics or fallback.
- [x] 458 regression tests, all six workspace typechecks, production web build and architecture/diff checks passed. Restarted only the web process, preserved the user's exact unsent brief and verified the enabled Generate presentation button plus corrected workflow copy in the browser. The API stayed running; no model job was submitted or interrupted. Existing publication-only playback conditions and explicit historical-preview messages remain unchanged in behavior.

Current bounded block (2026-09-17, complete design systems, maximum 30 minutes):
- [x] Root cause: theme tokens changed palette and heading font, but all themes shared identical geometry; Studio reinforced this with palette-only Aa swatches. Existing layout variety did not create distinct deck-level art direction.
- [x] Resolve theme-specific compositions before writing/measurement. Keep Paper's report geometry, implement Editorial magazine and Signal typographic-poster compositions in separate modules over shared primitives. Keep the 20 structural layout roles, exact image ownership/whole-image handling, existing LLM selection and immutable saved scenes. No topic heuristics, random restyling or new semantic stage.
- [x] Replace Studio's swatches with schematic previews derived from actual cover frames. Clarify that styles control composition, hierarchy and imagery, not just color.
- [x] Validate all 20 roles in all three systems: content-frame bounds and non-overlap at every valid item count; measured same-copy fixtures across all 60 theme/layout combinations; all four image layouts across all three themes retain exact approved-image ownership and shared browser/native-PPTX geometry. Structural uniqueness ignores palette and typeface. Independently reimported and visually inspected 21 exported PPTX slides across seven representative roles, including images; this is not a desktop PowerPoint/font-portability claim.
- [x] 458/458 regression tests, all six workspace typechecks, final production web build and architecture/diff checks passed (119 nodes, 212 edges). API and production web are running. Desktop and 390px mobile theme selection/reset passed, with document width matching viewport width. Browser inspection caught invalid unquoted numeric font-family names in the new schematic; the preview now uses the shared renderer's quoting convention, and computed styles confirm the actual bundled Serif/Sans families rather than inherited UI fonts.
- [x] Sequential live Qwen, low reasoning, from unchanged approved research/outlines: bread `slides_eval_mu55jxxl` selected Editorial; seasons `slides_eval_mu55n177` selected Signal. Both passed design, slide writing, measured fit and slide review. All six resulting scenes were read and visually inspected. No fresh research, narration, audio or publication was run. Same-copy fixtures at `http://localhost:4313/` are explicitly labelled non-generated; `live.html` separately shows actual model results. Existing saved publications were not changed.
- [x] Guardrail check: physical geometry belongs to the renderer, semantic selection/content stays in existing LLM stages; no topic rules, regex, random restyling, fallback text or added approval stage. Rendering still rejects overflow rather than shrinking or rewriting content. Remaining acceptance is separate: long-note timing (bread reviewer warning), factual/slide-scope judgment (seasons reviewer warnings), broader content density and PowerPoint font portability. These layout tests do not certify factual correctness or complete spoken delivery.

Checkpoint (2026-09-17 local date, narration speech/metadata boundary, maximum 30 minutes):
- [x] Reproduce from the saved publication: all eight scripts contain a delivery-field label inside spoken segments; both reviews approved. Playback preserves the authored passages. Delivery cues have no runtime consumer beyond schema compatibility.
- [x] Compare before implementation: unchanged Qwen review approved the defective eight-slide script again (61.9s); projection alone also missed it (78.8s). Removing ambiguous metadata instructions exposed the defect but still approved it as a warning (69.3s). Therefore both the unused writer field and the review's acceptance policy needed correction, not a renderer filter.
- [x] Simplify the existing writer contract to audience speech and provenance only; retain read compatibility for immutable older publications. Both existing reviews now consume the exact runtime passage sequence. Accidental spoken instructions require rejection and writer revision; legitimate discussion of those concepts is allowed. No semantic regex, blacklist, extra review stage or playback rewriting.
- [x] 457 regression tests, six workspace typechecks, production web build and architecture/diff checks passed. Contract tests preserve all spoken characters, including defective and multilingual examples, and test both review adapters and old-record compatibility. API/web restarted; the original eight-slide publication still parses and is unchanged.
- [x] Live Qwen, low reasoning, sequential: new water/pressure and Swedish fictional-seed narrations passed and were manually read with no instruction leakage. Injected Swedish stage directions were rejected with an error and writer-revision request. A legitimate lesson explaining a fictional editor's delivery-cue field, including its exact name in spoken sentences, passed: no keyword blacklist. Controlled records are in `data/generation-evals/narration-boundary-2026-09-17/`; these small diagnostic fixtures are not published decks.
- [x] Record execution limits: the final policy probe on the old eight-slide script exhausted 10,000 completion tokens without a verdict. Do not claim that full negative test passed. The new source-backed narration refresh passed writing (47.0s) and narration review (51.9s); its first publication review exhausted available completion space and correctly produced no new publication. Original final-review telemetry had 44,578 input tokens against the approximately 50k model window. Do not raise limits, cut semantic context ad hoc or bypass approval here; final-review context responsibility needs a separate bounded investigation.
- [x] Regenerate the source-backed deck's narration through the ordinary stages (`narration_refresh_mu4nwyal`). One explicit replay of only the execution-failed final review, with unchanged input and limits, passed as `publication_eval_mu4o2h1o`. Saved separately as `presentation_lkvwdzsu`; the original `presentation_tgcgsbk1` remains unchanged. Exact equality checks confirm the same slides, measured scenes, fact bank and source images. All eight new scripts were manually read with no leaked instructions. Browser opened the new player and displayed the actual spoken text; real Piper opening audio is a valid 27.75-second mono WAV. This is not a whole-deck listening, physical microphone or new factual certification claim.
- [x] Final negative regression: the current publication reviewer rejected the exact original eight-slide narration (56.5s, 44,496 input / 4,191 completion tokens), explicitly identifying leaked spoken delivery metadata as an error. This test used the unchanged old presentation with its prior approving upstream reviews; it did not edit or republish it. The separate narration-review negative probe remains execution-failed, not a passed test.

Checkpoint (2026-09-16, visual diversity, maximum 30 minutes):
- [x] Root cause: eight catalog entries share one hardcoded palette/font treatment; request.theme is stored but ignored by V2 design/rendering, and variationSeed has no consumer. Do not add random topic rules or a post-generation restyler.
- [x] Extend the existing design-selection contract: choose one supported theme (honor explicit request), choose content-appropriate compositions from 20 entries, and resolve tokens before the author receives its measured field contract. Separate catalog, frame geometry and semantic field binding. Keep previous saved scenes immutable.
- [x] Expose actual supported themes under Advanced: automatic agent choice, Paper, Editorial and Signal; preserve choice when restoring a run and reset it with other preferences.
- [x] Validate all 60 theme/layout frames for canvas bounds and non-overlapping content slots; measure all text-only combinations against the same author contract; verify native PPTX theme/font tokens and all four image placements/ownership. The separately labelled proof renders 60 fitted scenes including real source imagery; no fixture is published.
- [x] Live Qwen `qwen/qwen3.8-27b`, low reasoning, sequential: `slides_eval_mu4mzwrm` (bread, 109.9s) selected Editorial; `slides_eval_mu4n3ck1` (seasons, 101.1s) selected Signal and title-banner. Both actual writing/fit/review runs passed against unchanged previously approved research/outlines. A further design-only control explicitly requested Paper for seasons and received Paper/title-banner/closing-split. These are not fresh research, narration or publication tests. Bread retained its earlier layout sequence; automatic variety is content-driven, not a guarantee every run looks different.
- [x] Desktop browser: theme radio selection, active preference count and reset verified. Mobile Studio's base layout was visually checked at 390px, but the embedded-browser control could not open Advanced inside the test iframe, so mobile theme interaction is not claimed tested. The theme choices have a single-column mobile breakpoint. A labelled browser comparison shows the two actual live outputs; a separate fixture proof shows all three themes/20 entries.
- [x] 453 regression tests, six workspace typechecks, production web build, architecture checks (116 nodes, 205 edges) and diff check passed. Twelve exported proof slides were rendered through an independent PPTX importer with the actual font files registered; no PowerPoint-desktop acceptance or cross-machine font embedding is claimed. API/web were restarted with the change; all three existing publications remain readable and unchanged.
- [ ] Continue content/narration acceptance separately: the seasons slide review approved guidance implying no temperature extremes without axial tilt, which is too broad. Do not confuse successful design/fit checks with factual certification or patch this with a string rule. Spoken-metadata leakage is addressed in the subsequent narration-boundary block above; broad factual acceptance remains open.

Checkpoint (2026-09-16, V2 library and legacy retirement, maximum 30 minutes):
- [x] Identify root cause: `/library` still read V1 session/deck repositories and linked to `/present`, while the three current publications lived in the separate V2 store/player. Do not add a format adapter or mix readiness/quality heuristics into the new library.
- [x] Replace the library with the Studio visual language, actual 16:9 cover scenes, authored titles, metadata search, chronological sorting, pagination, explicit loading/empty/error states, and shared Studio/Library/Presenter navigation. Opening uses the existing V2 player without regeneration or autoplay.
- [x] Add a validated V2 library read model and confirmed recoverable archive action. Invalid records are reported, not repaired. Remove V1 list/delete client methods, service implementation, response schemas and old page logic; old list/delete routes return 410.
- [x] Move historical data, unchanged, to `data/legacy-archive/2026-09-16-library-retirement/`: 560 decks, 566 sessions, 1,020 transcript entries, one evaluation entry and four export entries, with a manifest. Three V2 publications, research traces and model assets are untouched.
- [x] Contract/regression validation: 450/450 tests, all six workspace typechecks and production web build passed. Tests cover empty store, validated-only listing, corruption reporting, pagination/order/search, archive byte preservation and no overwrite/path traversal. API checks: three real V2 publications, search/page selection, invalid limit=400, old list=410.
- [x] Browser acceptance: desktop library shows three current publications and actual covers; search and empty results work; archive cancellation preserves the original, and confirmed archiving was exercised on a disposable publication copy then cleaned up. Seasons playback advanced real audio and navigation returned to the library. Actual app layouts were visually inspected in 390px/768px frames; these are responsive checks, not physical-device microphone/audio tests. The temporary responsive page was removed. After dead-schema removal, 450/450 tests, six workspace typechecks, production build, architecture check and diff check passed. The narration quality defect from the prior block is deliberately not claimed fixed by this UI work.

Checkpoint (2026-09-16, shared completion capacity and source images, maximum 30 minutes):
- [x] Confirm root cause across traces: the whole-artifact allocation/review stages retain small fixed limits despite larger arrays, while reasoning consumes the same allowance. Identify every deck-sized response before editing; do not chase the next failed constant individually.
- [x] Replace the isolated fact helper with one provider-owned capacity policy for research, planning, image selection/design, whole-script writing and reviews. Retain small-deck floors, full input, low effort, finite 14,000 ceiling and existing deadlines/semantic gates. No topic rules, text truncation or retry-time increase. Loaded-context admission is not claimed without tokenization; the provider still rejects oversized requests.
- [x] Inspect missing-image reports: both published bread/seasons runs used zero external sources and received zero image candidates. Their explicit image decisions omitted images; no hidden fallback exists. Automatic image research for model-knowledge-only decks remains a separate product gap, not fixed by capacity allocation.
- [x] Validate workload boundaries and transport serialization with multilingual material: eight-slide allocation=12,000, narration=13,000, design=9,000; small-deck floors, long-duration scaling and the 14,000 ceiling are tested. Full original facts/plans and low effort are retained. All 448 regression tests, six workspace typechecks, separate strict test compilation, architecture graph/check (113 nodes, 199 edges), and diff check passed. No web code changed; the existing verified production build remains in use.
- [ ] Image-only research for a presentation otherwise using model knowledge: define this in the existing research/image responsibilities, respecting the user's web permission. Do not silently replace missing images with generic decoration or pretend current model-only decks have an image search.
- [x] Run the unchanged simple eight-slide/ten-minute source-guided brief through the ordinary app, alone on the model: job `6cd1934c-fa08-4c5e-a255-bd87cfff11b2`, run `generation_run_tg60phie`, publication `presentation_tgcgsbk1`. Completed in 19m 1s with four acquired pages, 50 curated facts, eight fitted slides, four downloaded/vision-approved source images and eight scripts. No diagnostic artifacts or topic-specific code were substituted. All ordinary gates approved, but manual narration acceptance FAILED; see the critical follow-up below. Completion is not a claim of acceptable quality or latency.
- [x] Inspect actual images, not just candidate metadata: 80 candidates yielded a Hillenburg portrait, the marine institute, an early SpongeBoy drawing and the Help Wanted title card. All four appear in measured scenes and browser thumbnails; the large SpongeBoy slide was visually inspected with no overlapping text or cropped image. The title card's placement is only loosely matched to its slide, as the slide reviewer noted. Image rights remain unverified. Previous model-knowledge-only decks still have no image research.
- [x] Alternate with an unrelated recorded-research outline control without overlapping model requests: `outline_eval_mu4l5ame` used the existing seasons research after the image-deck publication. Real Qwen strategy, allocation and outline review all completed in 45.5s with unchanged three-slide capacity floors. Review flagged density as informational. This is an outline/capacity check, not fresh research, independent factual acceptance, narration validation or a newly published presentation. No model job remains active.
- [x] Record the bounded checkpoint without claiming full acceptance: 448 regression tests passed; browser confirms real images. Do not call the spoken presentation ready merely because both model reviewers approved it. Browser is left paused on the image slide, with no autoplay or manual changes to generated content.

Follow-up status after the capacity block:
- [x] Investigate and simplify spoken-output/metadata separation at the existing writer/review boundaries. Original evidence is `generation_run_tg60phie/narration-generation-01.json`: all eight scripts contained a field name inside spoken segments, and both reviews approved. The subsequent controlled experiments, contract simplification, unchanged-original negative regression and new publication are documented in the current narration-boundary block above. No blacklist, persisted-content rewriting or extra gate was added.
- [x] Validate the boundary on unrelated English/Swedish topics, injected delivery instructions and legitimate discussion of script metadata; see the current block and saved controlled results.
- [ ] Continue factual/duration/listening acceptance separately. The original deck had a two-versus-three-year timeline error and exceeded its requested speaking duration. The new writer used the explicit correct year rather than that erroneous interval, without a code substitution; this does not certify all facts or the total spoken duration. Investigate duration at the existing writing responsibility, not through clipping or word-substitution rules.
- [ ] Reduce observed end-to-end latency based on stage traces, not retries or hidden fallback: research through outline took about 7m50s; image/design 1m55s; slide writing 5m38s; slide review 1m03s; narration writing 49s; narration review 62s; publication review 44s. The new capacity policy avoids earlier exhaustion but does not itself make the workflow fast.

Checkpoint (2026-09-16, long-deck curation capacity, under 30 minutes; no deck published):
- [x] Root cause confirmed from complete request/response traces: the unchanged full input produced 41 claim records before a fixed 7,000-token ceiling, with 1,906 reasoning tokens. More context reduction or a new semantic repair layer would not address this execution mismatch.
- [x] Allocate bounded completion capacity from requirement/slide counts (7,000 floor, 14,000 ceiling). Keep full evidence, same prompts, low reasoning, deadline, existing reviews and fail-closed truncation. No topic code or forced fact count.
- [x] Test resource boundaries and exact full context/low effort in provider serialization. Captured animation comparison changes only max_tokens: 12,000 capacity completed 55 facts in 98.7s (10,654 completion / 3,469 reasoning tokens), whereas 7,000 truncated the same input. Ordinary research review approved, but manual inspection found a false version-to-viewership association from flattened table text. This diagnostic is NOT factually accepted or published. Record: `data/generation-evals/fact-sampling/mu4j1ea6/`.
- [x] Unrelated W3C control at the production 8,000 budget completed 18 facts in 74.3s (5,639 completion / 3,087 reasoning tokens), followed by ordinary review approval in 37.1s. Definition, beneficiary categories and contrast guidance were checked against exact linked excerpts. This is a source-stage control, not a newly published deck. Record: `data/generation-evals/fact-sampling/mu4jakea/`.
- [ ] Start a fresh normal-app eight-slide, ten-minute source-guided animation run with relevant images. Inspect publication, slide previews and narration; never substitute diagnostic material or call an incomplete run successful.
- [x] Fresh full-brief job `3e54ecbb-b914-4673-a6fd-12f5cd85065b`, run `generation_run_1vcbo0lc`: research and evidence selection passed; fact curation completed 63 facts in 155.1s (13,628 completion / 5,921 reasoning tokens). Research review then exhausted its unchanged 8,000-token budget. No outline, slides, images or narration were published. This confirms curation execution improvement, not whole-pipeline acceptance.
- [x] Isolate review capacity without a production change: same exact input/prompt/schema/low effort at 14,000 tokens completed when run alone in 129.8s (34,956 prompt / 12,870 completion / 10,362 reasoning). It rejected the planner-added mandatory 1999-review requirement. The larger capacity does not solve excessive required scope or factual-review reliability; production review remains unchanged. Trace: `data/generation-evals/fact-sampling/mu4j1ea6/review-capacity-serial.json`.
- [x] Concurrency caveat: the initial review-capacity probe and separate simple-brief app job `772a0b8d-7b70-4ac4-9098-b4f778559492` both received LM Studio context-exceeded errors at exactly 20:16:53 UTC. Native model metadata reports 50,176 context and parallel=2; the identical review subsequently fit alone (47,826 total tokens). This implicates concurrent workload interaction, not proof that either request individually exceeds the limit. Do not increase model context, lower effort, or add a production retry based on this observation. Avoid overlapping diagnostic and app runs on this server for now.
- [x] Fresh simple-brief job `300e1d17-838e-4b50-a6b9-270fdddde081` ran alone after the interrupted trial. It retained eight slides, ten minutes, source images and the three explicit sources, but used the user's simpler first-episode/origins request instead of the earlier expanded test brief. It is a separate product scenario, not a controlled success for the failed full brief.
- [x] Simple-brief progress, run `generation_run_iu0xowal`: three supplied pages acquired; 46 facts completed in 86.6s (10,075 completion / 2,509 reasoning), ordinary unchanged research review approved in 48.7s (4,511 completion / 3,202 reasoning), then an eight-slide/ten-minute strategy completed. Manually checked the linked excerpts for the episode-origin anecdote, pitch setup and episode/series launch distinction. These checks do not validate all 46 claims or the unfinished deck.
- [x] Simple-brief final outcome: slide allocation exhausted its unchanged 7,000-token ceiling after 59.8s (5,203 reasoning, 1,797 remaining structured-output tokens). No outline approval, visual designs, image validation, narration or publication followed. Both normal app trials are failed, not partial successes advertised as complete decks. All model tests have finished; API/web remain available.
- [ ] Next bounded implementation: define one coherent input/output capacity policy for longer decks across the remaining structured stages, using actual request/response traces and structural work units. Validate against loaded context, preserve full semantic input and low effort, and keep finite deadlines/fail-closed output. Do not keep increasing one hard-coded ceiling after another, retry incomplete output blindly, shrink requested slides, or publish diagnostic artifacts. Separately address planner-added mandatory scope and factual-review weaknesses at their owning boundaries.
- [x] Validation: 446/446 regression tests, all six workspace typechecks, strict compilation of the new tests, architecture graph/check (112 nodes, 194 edges), and diff check passed. API runs the changed provider. No web code changed in this block; the prior verified production web build remains in use rather than rebuilding under the live server.
- [ ] Follow-up root-cause investigation, not a topic correction: document extraction currently flattens HTML table rows/cells/headers into one text stream. In the captured diagnostic, production codes and adjacent audience figures became an unsupported factual relationship which the reviewer approved. Preserve source structure before changing factual prompts; validate on unrelated tables and normal prose. No parser change is included in this capacity block.

Completed bounded block (2026-09-16, natural question return, under 30 minutes):
- [x] Root cause: full-slide audio time has no semantic boundary; the hidden was-playing-at-submit check excludes people who paused to formulate a question. Existing answer generation has a bridge but no exact passage context.
- [x] Replace the interactive player's time-only cursor with existing approved narration passages. Synthesize exact passage text, preload the next clip, preserve normal ordered playback, and return questions to passage time zero. Full-slide audio remains for non-interactive consumers.
- [x] Give the existing answer writer the exact interrupted and following passage with full material; keep the same independent answer/bridge review. No new LLM stage, script rewriting, word timing guess, regex or topic rule.
- [x] Make Continue after answer a visible default-on preference. Disabled preference, replay, clarification, failure and Cancel do not auto-resume. Staying paused speaks no return announcement; manual continuation after a question also starts at the safe boundary.
- [x] Validate passage identity/range, boundary-only resume contract, speech/cache identity and answer-only playback. Browser: paused manually on slide 2, passage 1 at 13.486s, asked why Australian/Swedish seasons differ; real Qwen answered and bridged, real Piper spoke, then the same passage automatically restarted (observed at 5.154s, not the saved 13.486s). Retained answer remained visible.
- [x] Browser controls: Cancel stopped replay and left narration paused; with Continue disabled, a new spoken answer left it paused; replay also stayed paused. With Continue enabled, a genuine needs-clarification response waited for the user rather than starting narration. Physical microphone and subjective whole-talk listening acceptance remain open.
- [x] Regression: 444/444 tests, all six workspace typechecks, independent strict check of the affected tests/scripts, production web build, architecture graph/check and diff check passed. No model-effort increase, static bridge, content rewrite, language regex or topic-specific rule.
- [ ] Continue the separately tracked longer-deck root causes below: coherent source context, bounded curation scope/capacity and claim-level review reliability. This playback increment does not claim SpongeBob or long image-deck acceptance.

Completed bounded block (2026-09-16, source-context integrity):
- [x] Trace the original acquired page versus the selected fragment. The full sentence distinguishes the series launch from the episode; arbitrary character slicing detached its subject before fact curation.
- [x] Replace character cuts with generic multilingual sentence packing and whole-sentence overlap, retaining exact offsets and text. Preserve oversized indivisible sentences rather than silently truncating; aggregate evidence limits still apply. No topic rules, factual substitutions or new review stage.
- [x] Add English, Swedish, French and Japanese boundary/coverage tests, indivisible text, malformed limits and exact selected-source identity. Relevance remains LLM-owned with all existing context.
- [x] Real Qwen recorded-acquisition controls: animation selected 25 snippets / 56,852 characters in 177.5s; W3C selected 19 snippets / 40,401 characters in 119.4s. Five original pages each; unchanged requirements, limits and low effort. Records: `data/generation-evals/evidence-relevance/mu4giba8/`. These are source-stage comparisons, not fresh research or complete decks.
- [x] Inspect source integrity manually: the original episode-page candidate now contains both full premiere/series-launch sentences, though the selector chose other episode excerpts. The selected series source independently preserves the May sneak-peek/July official-premiere distinction. Do not equate a correct candidate boundary with proof of factual selection/review quality. Acquired pages can still end at their original fetch limit; sentence segmentation cannot restore text never acquired.
- [x] Animation curation still exhausts the unchanged 7,000-token production ceiling: 82.5s, 1,906 reasoning tokens and 41 started claims (17 visible-slide, 20 narration-only, 3 qa-only completed before truncation). Partial JSON is rejected; no facts/deck published. This isolates a remaining curation scope/output-capacity problem, not a reason to add topic guards or reduce source context. Record: `data/generation-evals/fact-sampling/mu4gnaoj/`.
- [x] Unrelated W3C curation/review with the replayed evidence: 20 facts in 56.3s (6,104 completion/3,305 reasoning tokens), all six requirements approved in 25.1s. Manually compared definition, disability categories and contrast mechanism against exact linked excerpts. This is a sampled source check, not blanket factual/qualification acceptance. Record: `data/generation-evals/fact-sampling/mu4gpzp0/`. Two model diagnostics overlapped within configured concurrency; timings are not isolated benchmarks.
- [x] Final web/API restarted; existing seasons publication opens paused with Continue enabled and passage-specific real Piper audio. No extra background model run left active. Final regression 444/444, workspace and independent strict types, web build, architecture graph/check and diff check passed.
- [ ] Revalidate fact attribution and long-deck capacity after coherent evidence passes; do not claim full long-deck acceptance from selection alone.

Completed bounded block (2026-09-16, fact/review responsibility simplification, maximum 30 minutes):
- [x] User approved curation = claims/provenance/uncertainty; existing research review = complete coverage/readiness. Canonical architecture and map updated before implementation.
- [x] Remove duplicate curation judgments and generated fact-position contradiction mapping. Preserve full inputs and low effort/current budgets. Fact stage reduced from 430 to 279 lines; no added stage or semantic retry loop.
- [x] Keep historical published artifacts readable through a strict separate legacy schema. New generation accepts only the current contract; mixed formats and historical explicit rejection cannot pass. Existing published `presentation_lsuf41yz` still serves three scenes/scripts after API restart.
- [x] Validate strict references and fail-closed review/publication, including empty facts and malformed/missing/rejected review. Current banks deliberately have no self-approval flag.
- [x] Production-budget recorded controls: W3C curation completed in 38.4s (15 facts, 4,120 completion/1,866 reasoning tokens), review approved all six requirements in 27.6s. Inspected definition, beneficiary groups and contrast guidance against linked excerpts. Animation still exhausted 7,000 tokens in 65.2s, now after 2,385 reasoning tokens and partial factual output (38 started claims). No partial response accepted. Records: `data/generation-evals/fact-sampling/mu4c4o1k/`.
- [x] Separate unchanged 14,000-capacity diagnostic: animation curation completed in 74.3s with 46 facts, 8,846 completion/2,522 reasoning tokens; normal review approved in 48.5s. Manual inspection REJECTS content acceptance: fact 30 conflates the series' July official debut with the first episode. Review also miscounts facts (44 rather than 46) and misidentifies some positions in prose. No diagnostic presentation published and no production budget/effort increase. Records: `data/generation-evals/fact-sampling/mu4c8fdb/`.
- [x] Regression: 439/439 tests, six workspace typechecks, architecture graph/check (112 nodes, 194 edges), and web production build passed. Web and API restarted with the new contract; browser restores the fresh control job correctly.
- [x] Additional strict typecheck of the five affected test files and both diagnostic scripts passed after correcting stale fixture typing (invalid audience property, overly broad review type, deliberate invalid executor cast and fetch mock annotations). Full 439-test suite rerun passed; no production generation behavior changed for these corrections. Diff check passed. Guardrail audit: same stages, full source inputs, unchanged low effort and production ceilings, no scenario rules or fallback, explicit review rejection still blocks.
- [x] Fresh normal-app control `0ca8164b-cdf9-4737-99ca-fd730d3c906d`, run `generation_run_h6dpwy24`: three slides and three scripts published as `presentation_3wdww9kz` in 248 seconds, every stage on first attempt; real Piper first-slide synthesis returns a 2.27 MB WAV. Browser receives and renders the new contract. This passes connected-flow validation, NOT unqualified content acceptance: narration repeats an incorrect 5% orbital-distance variation from model knowledge and all reviews missed it. Do not describe it as an approved factual example.

Next bounded root-cause work (not implemented by this responsibility change):
- [x] P1 source-context integrity: fixed-character cuts detached a date from its grammatical subject. The source-context increment above preserves complete runtime-detected sentence units and validates unrelated/multilingual controls. No date/topic matching, automatic fact rewriting or extra review layer. Semantic attribution and the original acquisition truncation remain limitations, not solved by segmentation.
- [ ] P1 long-brief output capacity/scope: the simplified curator completed only above the unchanged 7,000-token production ceiling. The eight-slide plan drives 20 requirements and dozens of facts/uncertainties. Establish request-proportional scope and a bounded execution policy before changing limits; do not cut source context blindly or raise reasoning effort. Full long-deck/image/narration acceptance remains open.
- [ ] P1 semantic review reliability also affects model-knowledge decks: the seasons control invents a 5% orbital-distance variation, then narration/review repeat or accept it. [NASA's orbital-cycle reference](https://science.nasa.gov/science-research/earth-science/milankovitch-orbital-cycles-and-their-role-in-earths-climate/) gives 3.4%. Its first fact also ambiguously describes the tilt relative to the orbital plane rather than its perpendicular; [US Naval Observatory](https://aa.usno.navy.mil/faq/seasons_orbit.html) defines the geometry explicitly. Investigate unsupported precision and claim-level review attention generically; no numeric/topic blacklist and no additional review cascade. Keep workflow success separate from factual acceptance.

Current bounded block (2026-09-16, R24 fact execution and sampling, maximum 30 minutes):
- [x] Trace the complete curation input and output responsibilities before changing production: full classification, plan and source excerpts are present; one response owns facts, provenance, coverage, source summaries/quality and contradictions.
- [x] Verify configured Qwen3.8 is available and identify the shared client's hard-coded temperature 0.1. The model's official thinking-mode recommendation is 1.0; this is a testable provider hypothesis, not proof of a pipeline fix.
- [x] Add a reusable captured-evidence comparison script. Preserve prompts, schemas, low effort and 7,000-token limit; vary only temperature, alternate order across subjects, record invariant request hashes and raw results. Never inject diagnostic responses into publication.
- [x] Complete six paired animation/W3C/Swedish-source controls. At unchanged 7,000 tokens, animation and Swedish-source cases exhausted output under both temperatures. W3C completed at 0.1 in 34.5s (4,272 tokens, 1,387 reasoning, 14 facts) and at 1.0 in 52.3s (5,658 tokens, 3,213 reasoning, 13 facts). Pair hashes match excluding temperature. Basic W3C claims and contrast guidance were checked against linked excerpts; this is not whole-deck acceptance. No demonstrated reason to adopt a temperature change. Records: `data/generation-evals/fact-sampling/mu4b1uj5/`.
- [x] Separate finite capacity diagnostic: unchanged low/0.1/input/schema, 14,000-token ceiling. Animation completed in 115.7s with 13,429 tokens (7,202 reasoning), 28 facts, but failed the fulfilled-requirement reference contract. It also attached contradiction descriptions to unrelated fact positions. The previous premiere/series-date conflation was absent, but the result is not publishable. Swedish-source curation completed in 69.7s with 7,823 tokens (3,763 reasoning), 25 facts, valid decision references, but still declared the unsupported monarch extension fulfilled. Neither larger capacity nor structural validity establishes factual/coverage correctness. Records: `data/generation-evals/fact-sampling/mu4b9cp5/`.
- [x] Try the standard research-review boundary on the Swedish-source diagnostic. The test harness first exposed an invalid decimal in its generated run ID (fixed with integer identity). A replay then correctly stopped before an LLM review because the historical acquisition artifact lacks today's required targetOutcomes. Do not fabricate acquisition metadata or describe this as a completed model review. No presentation was published.
- [x] Reject blind production changes: no temperature, reasoning, token-ceiling, prompt or gate change adopted. Full evidence is present, and completion-budget exhaustion can reflect substantial redundant analysis rather than an infinite loop. Both curation and independent review currently assess every requirement and make sufficiency judgments; this responsibility overlap is the next architectural decision.
- [x] User approved responsibility simplification in the following block: curation owns claims/provenance/uncertainty and existing research review owns complete coverage/readiness. Architecture, publication invariants, compatibility tests and live controls must change together.
- [x] Validation: 435/435 regression tests, six workspace typechecks, a separate strict typecheck of the new diagnostic script, graph/check (112 nodes, 194 edges), and diff check passed. Capacity-pair requests were also compared programmatically: only max_tokens differs. Canonical architecture is deliberately unchanged pending the ownership decision; no production semantic implementation changed in this block.
- [x] Restore app availability after discovering both servers had stopped between work blocks (existing logs contain no shutdown cause). Started the existing production web build and current API. Studio returns HTTP 200; the saved V2 presentation `presentation_lsuf41yz` returns three slides and three scripts. The old failed job URL returns 404 after restart because jobs are process-local; its trace remains on disk. No new deck was published and no model tests remain running.

Current bounded block (2026-09-16, R24 research responsibility):
- [x] Identify duplicated semantic work: evidence selection builds a segment-by-requirement matrix; fact curation independently links facts to requirements and assesses fulfillment. The earlier sparse-matrix experiment retained this duplication and failed.
- [x] Diagnostic with the exact captured first page, all twenty requirements and unchanged low effort/6,000-token ceiling: relevance-only selection completed in 40.3s, 4,169 completion tokens including 2,709 reasoning. Exact source text is retained; model explanations are not facts. This is execution evidence, not full deck acceptance.
- [x] Remove requirement-matrix generation and validation from the selector. Preserve all supplied questions, requirements and segments. Keep fact curation and publication gates unchanged; no fact, approval or source fallback.
- [x] Revise the canonical EvidenceSet responsibility and architecture map. The historical optional coverage field remains read/reference-validated only so already published records remain usable; new generation does not write it.
- [x] Reproduce the separate fixed-stage budget defect: four of five source pages finished under their individual limits, then the combined selector hit 180s. Generalize the existing sequential deadline helper for both pages and slides, with per-unit cancellation and a 15-minute aggregate cap. No model token/effort changes or timeout retry.
- [x] Unrelated recorded-acquisition control: five W3C accessibility pages completed relevance selection in 85.6s with six requirements and preserved exact excerpts. This is not fresh acquisition or publication acceptance.
- [x] Replace wall-clock-sensitive success/fit-revision assertions with controlled timers after the full suite exposed CPU-load flakiness; no production time limits changed to make tests pass.
- [x] Start fresh source-guided Studio job `23f0708e-bb37-434d-a0f5-5a92b900e76a`, run `generation_run_9z5gf795`, with the unchanged eight-slide, ten-minute brief and three URLs. No claim of working autonomous search.
- [x] Run complete regression/type/architecture validation: 435/435 tests, six workspaces, graph/check (112 nodes, 194 edges), diff check. Live unrelated five-page replay passed; animation replay identified the shared stage deadline above. Existing published three-slide presentation still returns HTTP 200 with all scripts after API restart.
- [x] Inspect the fresh app outcome: all five pages acquired, evidence selection completed in 166.5s with 25 exact source excerpts (56,320 characters). Fact curation then failed in 66.7s: all 7,000 completion tokens were reasoning, with no structured facts. The full job failed after 331.7s; no slides, image approval, narration or presentation were produced. The per-page budget and relevance-only responsibility change are exercised; full long-deck acceptance is NOT achieved.
- [x] Isolate reasoning effort with identical captured fact input, schema, temperature and 7,000-token ceiling. Explicit diagnostic `none` completed in 53.1s with 30 facts, 5,502 completion tokens and zero reasoning tokens. The real response passes `assessFactCurationDecision` with no contract/reference diagnostics. This does not show that `low` is ignored; it shows that effort is not a hard reasoning-token budget. Production remains `low`.
- [x] Inspect actual diagnostic content, not only schema/self-approval: fact 13 attributes the series' July 17 official premiere to the first episode; the cited episode excerpt identifies the July 17 launch with the second episode instead. The broadcast requirement including a time slot is also declared fulfilled without that detail in the fact claims. These are semantic defects, not grounds for topical string checks. Earlier R7 comparisons already showed no-reasoning review misses; this single curation probe does not justify a global `none` switch. Captured response: `data/generation-evals/evidence-relevance/mu3tcymq/fact-none-diagnostic.json`.
- [ ] Next bounded task: resolve R8/R24 planner scope and fact-curation execution/faithfulness with paired captured inputs and unrelated controls. Distinguish requested coverage from planner-added demands; do not blindly raise budgets or add another review layer. Any effort-policy change needs an explicit quality comparison, not just speed/schema success.
- [ ] Complete fresh source-based generation and inspect facts, images, slides and narration before accepting a longer presentation. No automatic retry or diagnostic-output injection.
- [ ] R22 search provider choice requested: Brave API, investigate self-hosted SearXNG, or defer provider replacement. No new external service activated or credentials requested in chat.

Current bounded block (2026-09-16, R21 and a longer image presentation):
- [x] Confirm the root cause: all sequential writer calls and fit revisions shared one fixed 180s stage budget, independent of slide count.
- [x] Extract the shared deadline/cancellation boundary; give each slide one 180s unit budget including its existing fit revision, and derive the writing stage budget from planned units with a 15-minute cap. Preserve model effort, context, prompts and review rules; no timed-out replay or partial publication.
- [x] Run 428 regression tests and six workspace typechecks. Added unit/aggregate timeout, non-cooperative provider, cancellation between slides, preserved output/order and finite budget controls. No SpongeBob-related production strings found in apps/packages.
- [x] Start a fresh Studio run with Qwen3.8, low reasoning, eight slides, ten-minute speaking target, web research and 3-4 relevant source-image slides. Job `0c846eaa-8611-400f-89e7-b07435aedd1a`, run `generation_run_z5hsxun1`. No prewritten facts/slides injected.
- [ ] Inspect final result, actual image relevance, all slides and whole narration; distinguish model approval from content acceptance and measured audio duration from target duration.
- [x] First run rejected after about 59s: zero sources because the Bing RSS responses contained unrelated restaurants, hotels and other topics. Reproduced outside the pipeline; response headers echoed the requested query but item content was wrong. The agent correctly rejected the results. This is not a successful free-search test or proof of a planning failure.
- [x] Record the separate research over-scoping observation: six coverage requests expanded to 23 evidence requirements, including mandatory contemporary reviews/ratings. Do not add an episode-specific workaround.
- [x] Start explicitly labelled source-guided comparison with three URLs, without substituting written facts. Job `8ff279d6-6935-46fa-b48a-4b417cfee2fa`, run `generation_run_4qbkx4f9`, exposed a second root defect: request capture removed a balanced closing parenthesis, giving the episode source a 404. Cancelled this incomplete run; do not count it as final generation acceptance.
- [x] Reproduce delimiter corruption with an unrelated URL regression, then delete custom URL regex/trailing-character trimming. Use `linkify-it` 5.0.2 with fuzzy links disabled. The dependency audit caught an advisory in initially installed 5.0.1; upgraded to the patched release before completion. Parenthesized paths, Markdown/prose wrappers, encoded values, Unicode paths and explicit-only deduplication are covered. 431/431 tests and all workspace typechecks pass; core production dependency audit has zero reported vulnerabilities (not closure of the whole-app R18 audit).
- [x] Restart the identical source-guided brief after the URL correction: job `7cfad9c3-ef70-4d8b-957a-f342778a1902`. No search-provider substitution, manual fact bank, weakened review or topic-specific production code.
- [x] Inspect final run `generation_run_irwjwkn0`: failed after 155.6s at evidence selection, before slide writing, image vision or narration. All three supplied URLs fetched correctly; five pages were acquired overall, each limited to 20,000 characters. Qwen exhausted 6,000 output tokens, including 5,880 reasoning tokens, despite explicit low effort. No longer deck, approved images or ten-minute audio was produced; R21 live acceptance remains pending.
- [x] Controlled diagnostic on the exact first-page input: current schema replay failed at 6,000 tokens in 49.0s (4,253 reasoning). A sparse requirement-ID output variant reduced prompt tokens from 12,920 to 9,910 but still failed at 6,000 in 52.9s (4,727 reasoning). Same source text, all 20 requirements, model, temperature and low effort. The variant was NOT adopted; schema verbosity alone is not an established root fix. Diagnostic artifacts: `data/generation-evals/long-presentation-2026-09-16/`.
- [x] Final regression after patched dependency: 431/431 tests, all six workspace typechecks, architecture graph/check (112 nodes, 193 edges) and diff check pass. No web UI edits or new production web build in this block; existing production web server remains. No topic-specific strings found in production apps/packages.
- [ ] Next bounded research task: address R22 search reliability and isolate R24 selection workload/planning scope using captured inputs and unrelated controls. Do not increase reasoning, blindly raise token ceilings, shrink the user's requested deck, silently substitute handpicked sources, or count a diagnostic as full generation acceptance.

Current bounded block (2026-09-16, Phase 7d, answer audio and confirmed recording):
- [x] Trace the shared provider boundary: legacy VAD accepts arbitrary nonempty bytes, Whisper had VAD disabled and exposed language probability as transcription confidence. Keep legacy voice orchestration disconnected; use installed Silero VAD and explicit unknown confidence, not invented quality scores or word corrections.
- [x] Add server-owned approved answer registration and bounded Piper audio caching. Speak exact reviewed answer plus bridge; reject unknown, expired, cross-publication and unapproved answers. No client-authored replacement speech.
- [x] Initial connection: answer playback, autoplay recovery, retained answer and cancellation. The original time-only/previously-playing resume policy is superseded by the natural-return increment above. Replay and clarification still do not force playback.
- [x] Add immediate-pause recording with an explicit modal, input-level meter, cumulative four-second transcript previews, final editable confirmation and Cancel. Confirmed text enters the same Q&A stages. Meter is not VAD; hands-free detection is not implemented.
- [x] Bound media decoding, recording size/duration, transcription concurrency and worker deadlines. Abort terminates STT work, closes microphone tracks and prevents late permission/response races. Piper compute itself is not cancelled, although playback is.
- [x] Live real-provider synthetic speech test: "Can you explain what yeast does?" transcribed exactly, passed Qwen answer review, and produced 2,628,828 bytes of Piper audio in a 28.4s complete round-trip. This is transport/execution evidence, not independently verified factual quality or a physical microphone test.
- [x] Real silence returned empty transcript. Another synthetic sample misheard "gas" as "guess" (3.2s transcription); base-model recognition quality remains an explicit issue, not hidden behind corrections.
- [x] Browser answer audio played for 11.24s; the interrupted presentation subsequently continued through its final slide. Replay from paused slide 2 left narration paused at time zero after completion. Physical microphone permission/recording acceptance is still pending.
- [x] Regression tests: 423/423 and six workspace typechecks passed. Nine added tests cover approved speech identity/expiry, transport, serial STT, process failures/timeouts/abort recovery, late microphone permission, cumulative recording containers and cancel cleanup.
- [x] Production web build and architecture graph/check passed (111 nodes / 189 edges); whitespace check passed. Restarted web using the production build and the API with current STT code.
- [ ] Blocking browser finding: microphone permission remained unresolved in the in-app browser. Cancel click and Enter/Escape did not close its modal, in both development and production builds; no console error was reported. Reload restores the player. A subsequent typed-question control test cancelled normally and left the presentation paused, isolating the observed failure to the pending microphone flow rather than all question cancellation. Do not call microphone UI accepted or apply a speculative timeout/DOM workaround. Next inspect permission/event delivery versus application cleanup using a real browser permission grant and component-level turn tests.
- [ ] Next bounded block: resolve the permission/Cancel finding and validate physical microphone input, then real hands-free speech onset/echo handling. Separately benchmark STT accuracy; do not install or switch models without an explicit choice.

Guardrails checked: V2 runtime adapters consume approved artifacts; semantics stay
in the existing Qwen pipeline with low reasoning. No new semantic stage, topic
guard or static answer. Live diagnostics: `/tmp/slidespeech-voice-roundtrip.json`,
`/tmp/slidespeech-stt-live.json`, `/tmp/slidespeech-stt-silence.json`.

Completed bounded block (2026-09-15, Phase 7c, text Q&A and legacy retirement):
- [x] Inspect root dependencies before connecting the new player: old Q&A used word overlap, source-window scoring, lexical filters, branching fallback and a separate voice service. Do not adapt V2 to them.
- [x] Remove those three Q&A modules (1,015 lines), legacy voice-turn service (124 lines), SessionService interaction/branch/resume path (roughly 400 lines), and the old API interaction adapter. Retire both old endpoints with HTTP 410; actual interact endpoint checked live. Saved presentation viewing, speech and export remain. Other old provider/conversation modules are not claimed removed.
- [x] Connect the shared V2 question contract and three structured LLM stages: classify, answer/bridge, review. Full published factual/source/slide/script context; no semantic regex, keyword routing or static answers. Same review covers the bridge. Explicit review rejection and provider failure end the question, not the presentation.
- [x] Add native modal pending/Cancel/Escape, pause-on-submit, retained answer with sources/limitations, request cancellation and stale-response protection. Resume uses the unchanged audio element, not regenerated narration or inferred sentence boundaries. Answer remains visible after a slide change.
- [x] Live published bread question about kneading: `question_answer_pwlujwzk`, about 23.5s, relevant mechanistic answer. Scientific assertions originate in model-knowledge facts and are not independently verified. Off-topic current-pricing question `question_answer_hkeelxbp`, about 17.8s, honestly declines live/location data and redirects.
- [x] Unrelated source-based W3C continuation `question_answer_6lshfy7q`: 46.6s, correctly distinguishes decorative null alt from informative alternatives and cites the W3C source. Its universal markup phrasing and simple chart-description advice still need care; this is not closure of R19 or a newly published deck.
- [x] Relevant fresh-research question `question_answer_s1f3z9s5`: about 28.7s, returns insufficient-evidence and explicitly states no current research was performed. No synthetic source/fact result.
- [x] Browser: native opaque pending dialog visually checked; Cancel leaves paused state, no cancelled answer appears. A later question interrupted active Piper audio at 12.902s; answer stayed visible, Continue resumed at 13.093s, and manual Next retained that answer labelled with its original slide. The answered question was about CO2, not a substituted narration point.
- [x] Replace 31 retired interaction tests and dead test fixtures with 15 V2 contract/failure/cancellation/provider tests. Final suite 414/414, six workspace typechecks and production web build passed. Deleted tests concern removed behavior; lower test count is not reduced scope hidden as regression success.
- [x] Subsequent Phase 7d connected approved answer/bridge audio and confirmed recordings. Physical microphone, onset, noise/echo and wider quality acceptance remain open above.
- [ ] Controlled follow-up research and conversation history remain explicit future capabilities. Until then gaps are model-written limitations, not fake research or canned semantic fallback.

Guardrails checked: canonical Q&A responsibilities, unchanged publication/narration,
low reasoning, 60s per model stage / 120s whole question, no new semantic retry loop,
no subject-specific production strings, removed old paths rather than parallel answers.
Live scripts/results/logs: `scripts/eval_generation_v2_questions.ts`,
`data/generation-evals/question_answer_6lshfy7q.json`, `/tmp/slidespeech-qa-*`.
Architecture graph/check passed at 109 nodes / 189 edges. The final shared audio
cursor schema passed all 414 tests and workspace typechecks again; its shape is
unchanged from the already built player. API and web are running. No commit/push
was requested or performed in this block.

Completed implementation block (2026-09-15, Phase 7a live / 7b publication and initial playback):
- [x] Resume real Qwen tests after the user restored it; low reasoning and existing bounded stage deadlines retained.
- [x] Apollo narration continuation `narration_eval_mu32sn0j`: complete script and humanizer review in 55.2s, no semantic retry. Full script read; welcoming opening/transitions/closing, but over-detailed enumeration and new closing material remain concerns. Not fresh research or independently verified facts.
- [x] Unrelated W3C continuation `narration_eval_mu32v2gx`: 79.3s, no retry. Full script read. It repeats the known universal alt-text advice and unsupported highest-leverage assertion; reviewer approves. R19 remains OPEN. This is execution evidence, not semantic acceptance. No phrase guards or prompt-specific patch.
- [x] Add existing planned publication-review/publication stages, exact approved artifact lineage and write-once V2 storage. The final reviewer gives feedback only; malformed, rejected, missing or mismatched review cannot publish. Keep old SessionService/NarrationEngine generation out of the V2 runtime.
- [x] Add dedicated published player and server Piper audio from exact approved passages only. Caller supplies publication/slide ID, not arbitrary spoken content. Preserve position on pause; advance on ended. Delivery cues/source IDs are not voiced. Empty/malformed audio fails and can be retried rather than cached as silence.
- [x] Fresh topic-only live case: bread dough, `generation_run_boww71kv`, completed from a new brief through all research/planning/slides/narration/final-review/publication stages in 338.8s (5m39s). Three slides, no source images requested/acquired, no stage retries. Saved exact result `data/generation-evals/images-generation_run_boww71kv.json`; durable publication `presentation_lsuf41yz`. Diagnostic PPTX exists; not inspected in PowerPoint and user-facing download is still pending.
- [x] Read the entire bread script/reviews. Human-like kitchen opening and connected explanation are present, but repeated transition signposts, new flour-protein advice in the conclusion and unverified model-knowledge claims remain R16/R20 concerns. No manual content edits were made. An approval is not a guarantee of factual correctness.
- [x] Real Piper intro endpoint returned 48.09s mono 22,050Hz PCM audio in 1.95s, 2,120,644 bytes; nonzero waveform and browser playback confirmed. Pause at 14.83s and resume at 15.15s verified from the actual audio element. This is not a claim of complete human listening assessment.
- [x] Browser auto-advance reached slide 3 with actual audio playing; final audio ended at 54.67s, the player became paused/ended and showed the explicit completed state. Manual Previous returned to slide 2 at time zero, paused. No unexpected autoplay on manual navigation. The tested intro was 48.09s; the full presentation, not only a generated audio file, ran through the browser.
- [ ] Mobile, microphone Q&A and broader listening/factual acceptance remain open. Text Q&A is now covered by Phase 7c above.
- [ ] Next: text/voice Q&A with onset interruption and an explicit answer/resume flow, plus downloadable PPTX and remaining content-quality acceptance. Do not mark the interactive product complete.

Publication compatibility observation: attempting to publish the earlier Apollo
artifact failed because its old image decisions lack `required`. No default or
synthetic approval was inserted. The independent fresh bread run uses current
contracts and passed. API has now restarted; prior process-local preview URLs
are unavailable, but saved diagnostic examples remain and the published player
survives restarts. New view: `/presentation/presentation_lsuf41yz`.

Offline verification: 430/430 tests, six workspace typechecks and production web
build pass. New tests exercise explicit/malformed/rejected final approval, exact
upstream artifacts, missing/stale prerequisites, immutable storage/reload, path
traversal and corrupt records, exact spoken text, speech cache identity and invalid
audio. Architecture graph currently 107 nodes / 182 edges. No commit/push requested.

Earlier implementation block (2026-09-15, Phase 7a, whole-deck spoken script):
- [x] Trace the missing handoff before editing: V2 stopped after slide review and exposed draft notes; the retained legacy session service would regenerate point-based narration. Keep that legacy path isolated rather than adapting V2 to it.
- [x] Implement `narration-generation` with full request, fact bank, strategy, ordered slides/allocation and source context. One coherent whole-deck writing call, not a bullet-reading loop. No topic strings, semantic regex or stock introduction/closing.
- [x] Implement the existing `narration-review` humanizer responsibility, explicit approval, one writer-owned revision and a fresh review for the revised artifact. Schema/source/order checks are structural, not semantic scoring. Transport failure and missing/malformed/rejected scripts never become notes fallback.
- [x] Connect these stages to new API jobs with real progress and a readable reviewed script in Studio. Saved slide-only previews remain readable, not publishable. No audio/start/download control is falsely enabled.
- [x] Add tests for full unchanged context, low reasoning, missing scripts/invented sources/missing closing invitation, explicit rejection with no issues, contradictory/malformed review, one revision, stale approval, failure and cancellation.
- [x] Execute live continuations once Qwen returned: Apollo and W3C runs are documented in Phase 7b above. No calls were attempted while offline. Execution passed, but W3C factual-quality acceptance did not.
- [x] Subsequent Phase 7b completed publication and initial Piper playback; Phase 7c connected text Q&A. Broader listening and voice acceptance remain open, without legacy narration generation.

Historical Phase 7a deployment note: the API was retained while Qwen was offline
to preserve the red-panda preview. Phase 7b above supersedes that state: the API
and player are now running with publication and initial speech support. Interactive
questions remain pending; this is not a completed interactive product.

Phase 7a offline verification: 425/425 regression tests, six workspace typechecks,
production web build, diff check and architecture check passed (101 nodes / 169
edges). The existing red-panda Studio run still restores correctly with its real
images and an explicit no-reviewed-script label. No fresh narration or audio
result is claimed. Final descriptive UI copy was adjusted after that build;
it does not change behavior. Live model and actual new-script browser acceptance
remain pending. Test/build logs: `/tmp/slidespeech-narration-{tests,types,build}.log`.

Completed bounded block (2026-09-15, Images 1b-3, visible source images):
- [x] Trace and remove the actual missing handoffs: candidate markup was retained but design always forced imageStrategy=none and the shared renderer rejected images.
- [x] Replace DNS preflight/re-resolution with shared connection-time public address validation, redirect checks and bounded reads. Pin corrected provider sharp 0.35.4; only bounded JPEG/PNG/WebP input reaches it. The older Next sharp and PPTX image-size audit findings remain R18, not claimed fixed project-wide; the new PPTX path receives normalized JPEG only.
- [x] Add design-owned model candidate selection, real pixel vision assessment, exact original/normalized byte identity and per-slide approval provenance. Required unavailable visuals fail; optional omission/rejection is explicit. Vision failure never approves. No filename, publisher or subject heuristics; no stock content and no extra semantic retry loop.
- [x] Add image-opening/image-editorial to the shared layout registry. Browser and native PPTX use the exact normalized asset and whole-image geometry. Writing retains full factual context but does not receive base64 as textual context. Record image model calls in design telemetry.
- [x] Preserve source captions/links and explicitly unverified reuse rights; expose source detail in Studio. Both renderers preserve attribution in notes. User-facing narration, playback and download remain separate unfinished work.
- [x] Investigate a small-thumbnail quality defect in the first live result: acquisition ignored standard srcset. Retain/parse its resolution variants with srcset 5.0.3 and choose within that one image without rewriting URLs; give vision actual decoded dimensions and display geometry. No source-specific size URL manipulation or semantic regex.
- [x] First fresh complete live run: Apollo 11, generation_run_827lfvah, 395.2s from brief/research to three reviewed slides and diagnostic PPTX. Three images inspected, two used (Kennedy and lunar-surface astronaut); conclusion deliberately text-only. No stage retries. Browser visually inspected all slides. This is real generated content, not an authored proof or recorded-research continuation. Saved data: data/generation-evals/images-generation_run_827lfvah.json and matching .pptx. The first run predates the srcset improvement, required-image bookkeeping and aggregate image-token reporting; do not claim those later changes were in that first run.
- [x] Unrelated browser-triggered red-panda run reached slides-ready in 467.5s (7m47s), with three generated slides and two displayed images. Job e4366211-f545-4475-b98c-c0ea6dba4e10 / run generation_run_mgkt8566. Fresh research found 39 image candidates, 32 with responsive variants. Vision inspected a 1280x853 animal photo and a 500x303 range map (higher srcset variant); both were selected and visually inspected in Studio. The optional third inspected image was not used by closing layout. No stage retries. Saved job and diagnostic native PPTX: data/generation-evals/images-generation_run_mgkt8566.job.json and .pptx. Exact embedded PPTX image hashes match both scene images; no claim of opening this new PPTX in PowerPoint.
- [ ] Broader image acceptance: topic-only image research beyond acquired source pages, responsive picture/art-direction and SVG, reuse permission workflow, reliable rejection of low-quality/irrelevant candidates, additional compositions and real PowerPoint visual inspection. No promise that any arbitrary brief now produces excellent images.

Image-block final automated verification: 413/413 regression tests, six workspace typechecks, production web build, diff check and architecture check passed (98 nodes / 158 edges), including the final source-detail/telemetry edits. Tests cover socket DNS rebinding, private/mapped redirects, bounded bytes, raster decoding, pixel transport, failed/rejected vision, slide-specific approval, shared browser/PPTX bytes and coordinates, and responsive resolutions. Root dependency audit remains 14 entries; new undici/ipaddr/provider-sharp/srcset have no entries. Design-stage status remains one stage, not a parallel generation pipeline. No commit/push requested.

Remaining efficiency/quality observations from these image runs: the model sometimes prepares an image for the conclusion which final design does not use. Avoid claiming all approved assets were displayed or all image calls were necessary; final layout intent should inform candidate acquisition in a future ownership review. Initial Apollo vision accepted a small thumbnail and stated inferred authenticity; srcset acquisition now addresses available resolution, but vision remains fallible and is not authenticity/rights certification. Existing R16/R19 factual and conclusion-material concerns are not fixed by adding images.

Browser acceptance: real Studio animal image, range map, source disclosure, next-slide navigation and three thumbnails inspected; scene/thumbnail ratios are 16:9 and body width equals the 1367px viewport. The source map uses its original labels, not translated pixels. Apollo remains open in the existing localhost:4312 diagnostic tabs, correctly labelled fresh research; red-panda Studio remains open on the existing tab. API was not restarted after its successful job, so that URL remains usable. Its process includes the full image/srcset/required-image path; the final aggregate telemetry improvement is in tested source and takes effect on next API restart. No active model test remains. Narration/playback/voice-QA/export UI have not been connected by this block. Reviewer warnings and first-time closing information remain visible; these runs are image integration successes, not proof of perfect presentation content.

Completed bounded block (2026-09-15, Images 1a, candidate discovery):
- [x] Identify the missing handoff: the research provider discards image markup and the research page has no candidate contract. Existing hand-written HTML parsing is also unsuitable for extending quoted attributes, captions and metadata safely.
- [x] Replace hand-written HTML/RSS parsing with pinned htmlparser2 12.0.0; preserve text/link behavior and remove obsolete parsing loops. Cap decoded response bytes before parsing. DOM traversal skips inert subtrees and carries figure-caption context without repeated ancestor scans.
- [x] Retain unapproved image candidates, captions, declared dimensions and exact page/source lineage in the existing acquired-page artifact, with an explicit resource-limit count. Absence of discovery means not collected, not approved or known absent. Never infer relevance, copyright permission or quality from metadata. Unassessed image metadata is excluded from the text-review manifest, not mixed into the LLM's factual context.
- [x] Validate hostile/malformed markup, source identity and resource limits; fetch three unrelated real pages and run the existing MDN full-research live scenario. Automated verification passes, but full research acceptance does not: see the exact failure below. No extra retry or budget increase was added.
- [x] Continue separately with safe bounded asset downloads, then vision and shared rendering: implemented in Images 1b-3 above. Candidate discovery itself did not download or approve pictures.
- [x] Image-download prerequisite: replace the DNS preflight gap before adding binary downloads, with redirect/rebinding tests. Completed in Images 1b-3; broader R18 decoder/dependency findings remain open.

Images 1a validation evidence:
- Final source-adapter fetches found 8 candidates on W3C's functional-images tutorial, 59 on the unrelated Apollo 11 article, and 6 on MDN's HTTP overview. Titles, text and links remain available. Initial and final W3C/Apollo outputs are identical after the traversal refactor. All candidates remain unapproved; no binaries were fetched. Logs: `/tmp/slidespeech-images-final-discovery.json`.
- The fresh MDN/HTTP research run `generation_run_ztyekpfj` acquired four pages and retained 14 page-linked candidate records, including diagram references and publisher/social images. This validates candidate lineage, not image relevance. Its first research review rejected an unnecessarily required design-rationale question and routed a planning revision through the existing retry policy. This is the known scope/cost problem, not an image-discovery failure. The failed final result is recorded below; no end-to-end deck acceptance is implied.
- Automated checks: 403/403 tests, all six workspace typechecks, production web build, diff check and architecture checks (95 nodes / 148 edges) passed. Regression coverage includes quoted delimiters, entities, inert markup, nested figures, 10,000-level nesting, deduplication/count limits, UTF-8 byte limits, stream cancellation, no binary fetch, exact page lineage, old records without discovery and rejection of false approval fields.
- Scope at completion of Images 1a: only img src and social metadata were discovered; no binary or vision support existed in that earlier block. Images 1b-3 above now includes srcset, safe raster assets, vision and visible image layouts. JavaScript/CSS-only images and reuse permission remain pending.
- Final MDN outcome: failed after 692.1s (11m32s). After its planning revision, acquisition again completed with four pages; evidence selection then exhausted 6,000 output tokens, including 4,243 reasoning tokens, with low effort. No sufficient research/deck approval was returned and no further attempt was forced. This is a failure in the existing semantic execution budget, not a successful research/deck benchmark. The initial complete research/review path and three direct source fetches validate the new candidate handoff independently; they do not prove all pipeline behavior is unchanged. Log: `/tmp/slidespeech-images-live-http.log`; full stage records are saved under `data/generation-runs/generation_run_ztyekpfj/`.
- Guardrails checked: one research pipeline, no semantic image ranking or topic filters, no binary download, no inferred vision approval, no static image fallback, no additional model stage or expanded LLM budget. The canonical map distinguishes candidate discovery from pending asset/vision/rendering. The saved W3C slide preview remains open and unchanged; this block does not claim it now has images.
- API and Studio were restarted on the final tested code and the home view loads. The final production build and 403-test run include controlled invalid-URL rejection. No commit/push was requested.

Completed bounded block (2026-09-15, R19 planning responsibility):
- [x] Extend the trace upstream before changing contracts. Correction to the earlier limited trace: `strategy.storyArc[2].purpose` already contains the distortion; allocation and design repeat it. Removing only narrationIntent would leave competing factual accounts.
- [x] Document the narrower artifacts: strategy owns each audience question, allocation owns fact IDs and permissions, design owns visual choices. Remove duplicate prose fields rather than add prompt checklists, reviewers, retries or context summaries.
- [x] Validate strict artifact contracts and preserved full context: 394/394 tests, six workspace typechecks, production web build and architecture checks (93 nodes / 144 edges). Studio browser validation follows the fresh run below. Obsolete planning fields fail validation instead of being silently stripped.
- [x] Run two sequential live cases with low reasoning and unchanged budgets: one continuation from unchanged approved research and one fresh unrelated browser run. Inspect actual copy and notes where produced, and record failures without forcing acceptance. R19 remains open; executing the validation does not mean both cases passed.

Structural-block evidence:
- W3C continuation `plan-and-slides_eval_mu2vxd50` completed in 206.6s from the unchanged approved research of `generation_run_a5mt9fra`. All four slides written in 101.4s; no stage retries. This is a successful integration continuation, not fresh research or proof of a latency improvement over earlier successful writing.
- All four slide texts and notes were read. Strategy now asks questions without the earlier false rule; allocation and design no longer carry duplicate mini-scripts. Nevertheless the writer independently reintroduces the unconditional alt-text advice and an unsupported highest-leverage assertion, while slide review approves at 0.92. R19 is NOT fixed by the structural reduction. The simplification is retained for clear ownership, not presented as solved factual fidelity. No additional prompt patch, reviewer or topic-specific rule is added.
- Source-scope leakage also remains: the draft uses decorative-image guidance from QA-only/unallocated material; review notices it but treats it as a warning. Correct source meaning and material permissions remain semantic acceptance work, not grounds for silently changing the slide output.
- Fresh browser case: narrative point of view for beginner fiction writers, first person versus third-person limited, two explicitly invented versions of one scene. Job `cd94ddd7-83e5-4b2f-8748-ec10e3791069`, run `generation_run_tb16rou4`. This started from the brief through the normal app, not a replayed outline or a prepared slide fixture. It reached approved research (12 model-knowledge facts), strategy, allocation, outline and design, then failed in slide writing after 220.4s overall: 4,500 output tokens exhausted, of which 4,186 were reasoning, despite low effort. No complete slide or partial presentation was published. This is an independent execution-capacity failure, not a schema rejection and not evidence that the simplification caused or solved it; similar exhaustion predates this change. No retry or budget increase was added.
- Browser reconnect during the fresh run and the terminal failure state were checked: the original brief survives, generation becomes available again, and no incomplete slides are exposed. The error is still too technical for end users; improve typed execution-error presentation in its owning UI boundary, not message-text matching. Since this fresh run failed, successful new-outline browser acceptance remains pending; the production build and contract tests alone are not that acceptance.
- Visual inspection of the unmodified W3C continuation uses the existing shared-renderer diagnostic at `http://localhost:4312/`. All four scenes are 16:9, all measured text stays within scene bounds and the page has no horizontal overflow at the current 1367px viewport. This is saved generated output, explicitly labelled as research continuation, not published narration/export. Existing music data remains saved; only the diagnostic server's displayed result changed.
- Guardrails checked: one question owner, no duplicate planning scripts, full original facts/story preserved, no production semantic regex or subject string rules, no static fallback, no new review/retry stage and unchanged low reasoning/budgets. API and Studio run with the new contracts. No commit/push requested.

Next connected-product blocks (each bounded to 30 minutes, implementation then validation):
- [x] Images 1a, discovery: retain source-page candidates, captions and declared dimensions through the existing research bundle. See the completed bounded block above; candidates are not downloaded or approved.
- [x] Images 1b, assets: shared connection policy and bounded raster assets with exact byte identity/source attribution. Corrected decoder for this path, not a project-wide clean security audit.
- [x] Images 2, vision: actual image inputs and per-slide pixel assessments connected to configured Qwen3.8. Vision unavailable cannot approve; no static stock fallback. Broader semantic rejection quality remains acceptance work.
- [x] Images 3, initial design/rendering: agent-selected validated images in two layouts, same whole-image geometry in browser and native PPTX. Deliberate cropping and broad subject/quality acceptance remain pending above.
- [ ] Actual presentation: connected narration generation and humanizer review, preserving factual meaning while producing a coherent introduction, development, transitions and closing invitation. Connect publication, Piper playback and real PPTX export only after their existing gates pass.
- [ ] Voice and text questions: share question understanding/research/answer logic, interrupt playback at speech onset, show live transcription and Cancel, visibly generate and speak the answer, then bridge back and resume. Validate microphone transport, cancellation and stale-response races separately from answer quality.
- [ ] Validate the whole user flow across source-backed, topic-only and multilingual-source cases; distinguish preview, approved publication, export, spoken delivery and actual voice QA evidence.

Completed bounded investigation (2026-09-15, R19 factual authority):
- [x] Trace changed meaning through saved facts, allocation, draft and review before editing. The distortion was observed in `slidePlans[2].narrationIntent`; the later extended trace above finds it already in strategy. Research context was not missing.
- [x] Test a clearer allocation/writing/review instruction contract with unchanged context, schemas, model, budgets and low reasoning. It did not reliably prevent or detect the original distortion.
- [x] Withdraw the instruction-only experiment, including the experimental schema description. Production prompts and runtime are restored to their pre-block state; keep the investigation, reusable controls and architectural requirements, not an unproven prompt patch.
- [x] Add valid positive/negative controls for physical conditions, observational versus causal claims, and Swedish sample scope; preserve full inputs and rejection routing in regression tests.
- [ ] Establish live factual-quality acceptance. The original W3C slides passed both baseline and experimental review; recorded-plan writing still overgeneralized. Do not mark R19 fixed. The structural follow-up is tracked above, not another prompt checklist.
- [x] Inspect two W3C continuations from unchanged research and an unrelated fresh browser-triggered music presentation; record failures and remaining defects below.

R19 investigation evidence (2026-09-15):
- Baseline: the unchanged reviewer re-approved the flawed W3C deck (0.92, 16.0s). The revised contract also approved it (0.85, 37.0s); removing only narrationIntent in an explicitly diagnostic request still approved it (0.92, 37.8s). Thus planning text contains the first error, but removing that text alone is not a demonstrated cure for reviewer blindness. Do not stack further W3C-specific prompt instructions.
- Three unrelated paired controls with real Qwen3.8 and low reasoning: both the experimental and restored production instructions approved 3/3 faithful concise versions and rejected 6/6 deliberately misleading visible-copy/notes versions. Thus these controls do not demonstrate an improvement from the instruction change. They are authored fixtures, not generated decks or proof that subtle errors are caught. Minor informational/warning over-review persists even for correct concise scope. Separate logs: `/tmp/slidespeech-fidelity-controls-validated.log` (experiment) and `/tmp/slidespeech-fidelity-controls-baseline.log` (restored production).
- The first allocation-only diagnostic accidentally included the previous plan in its input, so its output is excluded from quality conclusions. The evaluator now excludes that downstream artifact. The actual `plan-and-slides` continuation uses `planOutline` then `draftOutline`, regenerating every planning artifact from recorded approved research through the existing pipeline.
- That actual continuation, `plan-and-slides_eval_mu2upycb`, completed new strategy, allocation, outline review and designs, but hit the existing 180s whole-writing-stage deadline after 3/4 slides while sharing the configured two-way model capacity with other tests. It produced no accepted slide set. This is a failed integration test, not semantic acceptance; do not increase the deadline as an R19 workaround. See R21.
- A single solo continuation, `plan-and-slides_eval_mu2v0x3w`, also failed, this time on slide-content output exhaustion (4,500 tokens, 3,839 reasoning) after two slides. Therefore contention is not the only failure mode. Both W3C continuations used the experimental instructions and are not successful source-backed acceptance runs. No partial deck was published; no further prompt edits, retries or budget increases were used to force a pass.
- Fresh browser-triggered music run `generation_run_zn2p83cx`, job `0df1d907-9e6f-4dd7-b1b7-deba7d60b1ac`, reached `slides-ready` in 365.2s with eight model-knowledge facts and four generated slides. No source fetch was required by its brief. Writing took 103.4s. It used the experimental instructions, so this demonstrates connected generation, not an improvement attributable to those instructions or restored-production fresh acceptance.
- Music inspection: coherent opening, tempo/meter explanation, clapping comparison and recap/question closing. All four draft texts and notes were read; the main slide and four thumbnails have 16:9 bounds with no text outside their scenes or viewport overflow; direct/Next navigation was exercised. The new 60/180 BPM example appears first in the closing (R16 remains open); music-note explanations are not a finalized narration script. No image, speech, PPTX export or publication acceptance is claimed.
- Saved exact music job and shared-renderer HTML under `data/generation-evals/music-live-preview.json[.html]`; diagnostic view `http://localhost:4312/` is explicitly a saved live result, not a product publication. The API was restarted with restored production instructions, clearing process-local jobs; the old music job URL is no longer reloadable. Studio home and the saved preview are open. No commit/push requested.
- Automated verification: 393/393 tests, all six workspace typechecks, production web build and current architecture checks passed. New tests exercise unmodified factual context across writing/fit revision and explicit semantic rejection routing; they do not pretend a mocked response validates LLM reasoning.

Completed bounded block (2026-09-15, R8 research-review contract):
- [x] Replay the unchanged OpenStreetMap review and capture the actual request/output; separate context size, output-contract cost and semantic insufficiency before editing production logic.
- [x] Correct only the demonstrated generic root cause, retaining low reasoning, the existing finite budget, full factual context, explicit approval and one pipeline.
- [x] Validate on the recorded failure plus unrelated material and known negative evidence; run regression, types/build and architecture checks. Record failures honestly and stop within 30 minutes. Outcomes below distinguish completed integration from remaining semantic defects.

R8 instruction-contract evidence (2026-09-15):
- Root cause contribution: the 22-line review checklist required repetitive role/use auditing and contradicted itself about unsupported-assessment versus generic-issue retry instructions. The recorded baseline used 10,507 input tokens, well inside the loaded 50,176 context, but spent 6,934 of 8,000 output tokens reasoning and was cut off while serializing the audit. This is not evidence of missing context or a low-effort setting being absent.
- Replaced, rather than extended, that checklist with a single nine-part material-sufficiency instruction. Same complete input, schema, 8,000-token ceiling, model and low effort; request comparison confirms only the system instruction changed. OpenStreetMap completed its review in 50.5s versus baseline exhaustion at 79.3s, using 4,870 tokens including 3,725 reasoning. It correctly rejected the unsupported retained-contributor-rights requirement instead of proceeding toward the baseline's incomplete approval.
- Unrelated recorded W3C research: approved in 44.5s with 3,152 tokens (2,617 reasoning). A deliberate false source-attributed claim in a separate in-memory copy was rejected in 46.6s with 3,664 tokens (2,723 reasoning), explicitly targeting the corrupted fact and fact-curation owner. No saved input artifact was modified. These are controlled review evaluations, not fresh presentation success.
- Semantic limitations remain: OpenStreetMap still duplicated one gap as a warning and selected acquisition for feedback suggesting an out-of-plan domain. Do not claim R8/R9 completely solved or add topic-specific corrections; required-scope expansion and semantic retry ownership remain separate root-cause work.
- [x] Production-adapter repeat: the same OpenStreetMap input again completed and rejected the unsupported requirement (86.9s; 5,853 output / 4,924 reasoning tokens). It overlapped the fresh run on the configured two-way concurrency, so wall time is not a controlled latency comparison. The production request differs from the experiment only by the shared client's extra newline before the same JSON schema.
- The repeat proposed model knowledge despite explicit-source grounding and chose curation for an acquisition gap. Existing fact-policy checks still disallow that unsupported origin; do not misrepresent completed review output as reliable correction ownership. Record this under R8/R9 rather than adding phrase filters or silently executing a policy-changing suggestion.
- [x] Automated validation: 389/389 tests, all six workspace typechecks, production web build, current architecture graph/check (93 nodes / 144 edges) and diff check passed. The added real-adapter regression preserves full review input and low/8,000 settings and verifies that one unsupported assessment can carry targeted feedback without a duplicate issue or approval.
- [x] Fresh source-backed application integration: W3C run `generation_run_a5mt9fra`, job `0c323dab-ff2d-432e-be26-e28d44836f16`, completed from the brief through actual sources, research, outline, designs, writing and slide review to `slides-ready` in 643.9s. Four fetched W3C pages, 18 source-backed facts, four generated slides, no stage retries. Research review completed in 31.3s (2,559 output / 1,778 reasoning tokens). This is fresh integration evidence, not a recorded continuation or publication.
- Runtime cost remains high: acquisition 164.8s, evidence selection 134.4s, curation 59.8s, slide writing 104.7s. Do not extrapolate a guaranteed speedup from the controlled review comparison or call the full generation fast.
- Browser: all four live Studio slides inspected, Previous/Next and direct thumbnail selection exercised; current viewport has no horizontal overflow. Measured main slide and thumbnails retain 16:9 and the correct Source Serif 4 family, with text bounds inside their SVGs. Real source labels are displayed, no image placeholders or export/playback controls were introduced. The three main requested topics are developed before the closing question; this case does not close R16 across other topics.
- Human inspection found a semantic loss despite slide-review approval: the source/fact's qualified alt-text guidance became an absolute instruction in visible copy and notes. See R19. The closing's recap is in presenter notes, not visible copy; these notes remain instructions for a future presenter, not humanized speech. No manual content correction was applied to make the test appear successful.
- Guardrails: replaced instructions inside the existing research-review stage; no semantic regex, output-word matching, static prose, fallback approval, context summarization, extra retry/reviewer, or budget/effort increase. API and Studio are running; preview jobs remain process-local. No commit/push requested.

User priority on 2026-09-14: bring the new interface and real V2 execution
together before further isolated research tuning. Work in validated blocks of
at most 30 minutes. Research quality gates remain open; a research preview is
not a published presentation.

This priority supersedes finishing all research tuning before UI and downstream
stage implementation. It does not bypass per-run research approval or the final
publication gates. The first connected slice intentionally ends at research.

- [x] I1: Replaced the legacy launchpad with the new presentation workspace and collapsed Advanced controls mapped to existing request fields. Connected real V2 research through an API adapter with actual stage progress, server cancellation, and explicit research-only results. Browser desktop/mobile, request preservation, missing-run failure, cancellation, and a complete live browser-triggered research run validated. This is the first connected slice, not full generation or a final shared app/deck design system.
- [x] I2 implementation: Connected strategy, per-slide material allocation and explicit outline review to the same run and Studio. No alternative research orchestration, legacy planning, fallback or semantic regex. Research/allocation quality findings from live validation remain tracked below; this milestone is integration, not publishable content quality.
- [ ] I3: Continue that run through shared slide designs/content, coherent narration, and publication; enable presenter/export only after the existing publication contract passes.
- [x] I3a foundation: one typed 1280x720 scene and six initial layout compositions shared by browser and native PPTX rendering. A developer-only study uses explicitly authored test fixtures, never pipeline output. Browser geometry/native text tests pass; this is not a complete or publication-ready renderer.
- [x] I3a export integrity: resolve R17 at the dependency serializer, verify clean installation, and inspect all six design-study slides in actual PowerPoint. These fixtures are not generated-deck acceptance.
- [x] I3a text-fit implementation: explicit font assets and measured glyph/line geometry, Unicode line boundaries, one shared line plan in SVG/native PPTX, and structured overflow/unavailable-font failures. Original text is retained, without shrinking, truncation, or semantic corrections. Six actual-font fixtures inspected in PowerPoint; portable tests use an OFL font.
- [ ] I3a remaining acceptance: distribute licensed theme fonts consistently across server/browser/PowerPoint, add image layouts, expand to the agreed 20+ safe layouts, then validate varied generated content and owning-stage overflow handling. Font embedding and complex-script rendering are not validated. No generated-deck export control until accepted.
- [x] I3b implementation: Agent layout selection and per-slide writing from approved material, measured text fit with one author-owned revision, explicit slide review, and actual Studio scenes. No copy is derived from outline strings. Server/browser share bundled full upstream OFL fonts. Full pipeline and transport regressions pass; live acceptance is tracked separately below.
- [ ] I3b live acceptance: complete and inspect unrelated fresh research-to-slide runs, including source-backed material; no claim of general deck readiness from fixture tests. First new repair-cafe run stopped before slide generation on the known R8 research-review reasoning/token exhaustion (4000 output tokens, 3902 reasoning).
- [ ] I3c: Coherent narration, narration/publication reviews, runtime handoff, and only then user-facing PPTX/playback.
- [ ] I4: Validate the complete connected journey, including text/voice questions and actual PPTX output, across unrelated live scenarios. Research quality and source extraction issues below remain acceptance work, not permission to publish weak output.

I3b implementation/validation (2026-09-14, bounded 30-minute block):
- Added three agent-owned stages, one shared pipeline and actual Studio scene navigation; no topic strings, semantic regex, stock copy or fallback approvals. `plan` remains an explicit diagnostic stop point. The product `execute` requires the slide agent/renderer and cannot return outline-only success. Cancellation and rejected/malformed reviews cannot expose partial slides.
- Automated: final full suite 382/382, all six workspace typechecks, production web build, graph/check (93 nodes / 144 edges), and diff check passed. The additional font regression checks that measured overflow identifies the affected text, not merely a positional element number.
- Fresh unrelated repair-cafe run `generation_run_pzxovkte` and bread run `generation_run_8j2snhw4` both stopped at the existing research-review combined reasoning/output ceiling: 4000 tokens with 3902 and 2860 reasoning tokens respectively. Increased only that stage's finite ceiling to 8000, still reasoning low, no approval-rule change. R8 remains open: this is resource budgeting, not demonstrated resolution of all review problems.
- Fresh repeated bread run `generation_run_i8w089qu` passed research, strategy, allocation, outline review and design selection. Its research review took 36.7s and used 3647 tokens including 2311 reasoning; because this was a new run, it is not a matched-artifact A/B proof that the higher ceiling caused success. The four-slide outline reproduced R16: the conclusion teaches proofing for the first time. Do not claim content quality from its approval.
- That run stopped honestly in slide generation after 287.2s overall: one slide fitted, then a process label needed 76.8px in a 68px slot after its single revision. No slide preview, final review, narration or PPTX was published. The run used the initial numeric-element feedback; current code also includes the exact affected copy, covered by regression. No padding, font shrinking, truncation or word filter was added.
- [x] I3b writing-contract implementation: one layout frame now provides both scene composition and the author's field paths, dimensions and font-measured line capacity. Removed duplicated geometric prose from the prompt, kept all slot dimensions unchanged, and replaced subset fonts with pinned full upstream OFL assets shared by server/browser. Missing glyphs stop as asset errors, not rewrite feedback. Controlled replay and unrelated fresh acceptance are recorded below.
- Browser: updated live stage status and actual API failure shown, no horizontal overflow at 1280px, bundled fonts loaded. Successful generated-scene navigation and mobile acceptance remain unverified because the live run did not pass. The existing manually authored design study is not counted as live generation evidence.
- API restarted with the latest code after the run; traces are retained, process-local preview jobs cleared as designed. Web remains running, and the updated Studio is open. No commit/push requested in this block.

I3b writing-contract validation (2026-09-14, bounded block):
- Root cause: the author received a second, approximate layout description without actual line capacity. The 68px process label accommodates one 38.388px Source Serif line, not two. Font subsets also omitted subscript digits. The solution changes the shared author/rendering contract and asset distribution, not topic text, field geometry, font size or semantic approval policy.
- [x] Automated regression: 388/388 tests, including shared geometry/capacity across all six layouts, stable field-path overflow feedback, preserved scientific symbols/Swedish accents, unavailable-script failure, recorded-outline approval/reference checks, and valid quoted SVG font names. Workspace typechecks passed.
- [x] Controlled live continuation `slides_eval_mu1q8jn8` reused the unchanged approved research/outline from `generation_run_i8w089qu`; all four scenes and explicit slide review completed in 220.5s. This is a slide-stage benchmark, not fresh research or publication. Original recorded artifacts were not overwritten.
- [x] Independent slide-stage continuation `slides_eval_mu1qj7pj` reused the approved bicycle outline `generation_run_pxh79db2`; all four scenes and review completed in 155.8s (design 17.0s, writing 103.4s, review 35.4s). Opening/comparison/process/closing render without overlap or clipping. This outcome validates a second layout/content combination, not a fresh research-to-slides run or the universal correctness of instructional claims.
- [ ] Semantic acceptance remains open: that continuation still introduces the poke test in its conclusion despite slide-review approval. R16 requires a separate root-cause investigation of story allocation and review context; no new topic instruction or deterministic recap has been added.
- [ ] Fresh source-backed acceptance: OpenStreetMap run `generation_run_bmzsyj1u` failed in research review after 270.8s overall, despite successful acquisition/evidence/curation. The review exhausted 8000 output tokens, including 6059 reasoning, after 83.2s. Raising the ceiling in the previous block did not resolve R8. No slide generation, preview or publication was accepted; no further budget/effort change was made.
- [x] Browser root-cause correction: the actual generated-slide inspection showed Source Sans 3 where Source Serif 4 had been measured. Unquoted numeric family names in SVG were invalid CSS and inherited the surrounding font. The shared canvas now quotes family names generically; browser computed styles confirmed the correct families afterward. All four recorded bread scenes were visually inspected without overlap or clipping. This diagnostic view uses actual generated artifacts, is explicitly labeled recorded-input/non-published, and does not populate a product job.
- [x] Final production web build, all six workspace typechecks, architecture map/import graph/check (93 nodes / 144 edges), and diff check passed. API/web remain running; the rebuilt Studio returns HTTP 200. All eight generated scenes were inspected in the shared browser renderer. These checks do not establish PowerPoint font availability or narration quality. Recorded-input evaluation artifacts and their clearly labeled local inspection view are excluded from version control under `data/generation-evals/`.
- [ ] Next bounded block: isolate R8 using the recorded OpenStreetMap acquisition/evidence/facts and inspect where review context/output design induces excessive reasoning. Keep low, do not blindly raise budgets or add another reviewer. Then resolve the cross-topic R16 story/allocation issue before full content acceptance. Successful fresh research-to-slide and actual Studio result navigation remain open; no published-deck claim.
- Guardrails checked: one pipeline and layout definition; no topic matching, semantic regex, hidden font shrinking, static prose, additional repair stage, or publication bypass. Image research/vision, narration/humanizer and publication remain pending.

I1 validation (2026-09-14, under 30 minutes):
- Root cause: only the eval entrypoint invoked V2; the launchpad still called legacy generation. Also, external cancellation stopped at the research pipeline boundary even though individual stages supported it. A regression reproduced continued planning after cancellation before the propagation change.
- Replaced the old launchpad and removed its unused browser generation clients. The API adapter imports the existing research runner and real providers, fixes reasoning at low, and adds no semantic stage, fallback, or topic rule. Preview transport distinguishes research-ready from publication and retains at most 20 in-process jobs with one active run.
- 336/336 full-suite tests, all six workspace typechecks, production web build, architecture graph/check (81 nodes, 118 edges), and diff check passed. Thirty focused adapter/pipeline/runner tests cover cancellation, late responses, immutable request choices, bounded history, retry progress, and failure without fallback. Live HTTP checks returned 400 for malformed input, 404 for a missing run, and 409 for overlapping work.
- Browser validation: desktop and 390px mobile layout; document/viewport width both 390px with no horizontal overflow. Advanced closing preserves choices; reset preserves the brief/source URL; submitted slide count is unchanged in the API request. Cancellation stops the live run, page reload reconnects by job id, an unavailable run shows a recoverable error without silently restarting, and reviewed research is displayed without presenter/export controls. No browser errors were observed on the completed run.
- Fresh W3C run `generation_run_ebeflr15`, started in the Studio with Qwen at low: completed in 339.8s, no stage retries, four fetched W3C pages, 18 source-backed facts, review approved at 0.93 with one informational scope note. Main times: acquisition 122.6s, evidence selection 104.2s, curation 60.4s, review 37.3s. Spot checks of definition, disability coverage, and contrast guidance matched the captured evidence. This passes the app/research integration, not the latency target or all semantic quality gates. Traces remain in ignored `data/generation-runs/generation_run_ebeflr15/`.
- Next: I2, connecting strategy and outline in the same product journey. Do not resume an open-ended series of research-only prompt experiments before that milestone. Existing research defects remain tracked under R8/R9/R14.

I2 validation (2026-09-14, under 30 minutes):
- Responsibility: `GenerationV2Pipeline` composes the unchanged research stage group followed by strategy, allocation and outline review. One run id, immutable request, stage runner and cancellation signal. `GenerationV2Job` replaces the research-only transport rather than adding another UI orchestration. No slides, speech or export are enabled by outline approval.
- New contracts derive from existing strategy/slide/review artifacts. Agent decisions use supplied fact IDs; core owns new IDs and order. Rejection, malformed approval, unknown references, invalid fact permissions and cancellation cannot become `outline-ready`. Outline repair is not implemented; rejection stops with diagnostics instead of replaying research or adding filler.
- Fresh browser-triggered bicycle-gears run `generation_run_xkp6eo7e`: 134.5s from request to reviewed four-slide outline, Qwen3.8 at low, no retries or external research (explicitly requested model knowledge). Strategy 10.4s, allocation 35.5s, outline review 16.3s. Requested four-slide count preserved, body material relevant, no static output. This validates the integration, NOT all content quality: the semantic defects below were visible despite reviewer approval.
- Controlled second topic: `outline_eval_mu1ivj88` continued the previously approved W3C research `generation_run_ebeflr15` without fetching or recuration. All three new stages passed in 76.0s (strategy 12.0s, allocation 44.7s, review 19.4s), four slides, preserved English/source policy. This is a downstream-stage benchmark, not a fresh research-to-outline time. It reproduced the R16 role/allocation issue: a nominal conclusion introduces the first practical action and excludes earlier facts while promising synthesis; review still approved at 0.92. Review approval is not a substitute for inspecting real output.
- Automated: 351/351 full-suite tests passed with local HTTP test permissions; all six workspace typechecks and architecture checks passed (84 nodes / 129 edges). Fifteen new tests cover the connected one-run chain, strategy refusal, invalid fact references/count/intro/conclusion, malformed or explicitly rejected reviews, downstream cancellation, and outline-only transport readiness. The initial sandboxed suite's three failures were local test-server permission errors, not code failures; the permitted rerun passed.
- Browser: actual completed outline inspected on desktop and 390px mobile, including expanded material/presenter direction. Document width stayed 390px with no horizontal overflow. The main view shows the plan, with technical review notes collapsed; no fake slide previews, playback or export controls. Production web build passed; web restarted without restarting the API, preserving the live result.
- [x] R15 implementation and two-topic scope validation: added required `presentationDirections` alongside topical `requestedCoverage`. The missing contract, not output strings, caused delivery instructions to become mandatory research evidence. The regression failed before the contract change and passes after it. Fresh bicycle and W3C classifications/curated facts separate delivery from actual topic coverage. The immutable request is preserved.
- [x] R16 implementation: strategy now selects role/purpose together, before allocation; allocation preserves roles. Removed redundant `forbiddenFactIds`, retaining positive `allowedFactIds` plus required/overlap subsets and draft-used-fact enforcement. The agent selects recap facts and review checks whether intended narration is supported. Fresh bicycle closing selected four earlier facts with explicit recap overlap; no deterministic copying.
- [ ] R16 independent-topic acceptance: W3C did not reach outline due to research-review output exhaustion. Repeat after the existing R8 budget/root-cause work; do not count this as a passed full second-topic outline.
- [x] R17 (High, PPTX acceptance): corrected the confirmed dependency serializer defect. The package is pinned to 3.12.0, and a minimal checked-in dependency patch declares the one actual shared master outside the slide loop in both CJS/ES entrypoints. Root postinstall applies it with failure reporting, including production installs. No app content rewriting, ZIP cleanup, serializer fork, or validation bypass. The former TODO regression is now mandatory and passes; additional coverage includes 1/2/8 slides with custom layouts. See `patches/README.md` for ownership and removal conditions.

R15/R16 and I3a validation (2026-09-14, bounded block):
- Fresh bicycle run `generation_run_pxh79db2`: 145.1s to four-slide reviewed outline, low reasoning, no retries, ten model-knowledge facts. Direction/fact separation and recap allocation improved. Manual inspection still found a reversed mechanical ratio and questionable shifter-number guidance despite reviewer approval. Existing R8 remains open; this is not publishable factual quality.
- Fresh W3C run `generation_run_2lst3e32`: five acquired pages, fifteen source-backed facts, presentation directions correctly excluded from topic facts. Research review exhausted 4000 output tokens, including 2999 reasoning tokens. Stopped as failed before outline; no retry escalation, mock content, or static fallback. Main definition/beneficiary/action material is present, but review and downstream success are NOT validated.
- Shared design proof: six manually authored compositions, Georgia/Trebuchet MS fonts verified installed; one geometry model, editable native PPTX text and notes, explicit unsupported-layout/image failures. No use of the legacy exporter's title normalization or content recovery. HTML study is a separate developer preview, not an extra product generation path.
- Final checks: 357 passing tests and one explicitly TODO failing regression for R17 (358 total), all six workspace typechecks, production web build, architecture check (86 nodes / 130 edges), and diff check. The test exit status does NOT mean PPTX package integrity passed. The independently validated draft failed that gate and was not delivered as a final file.
- Visual checks: HTML proof has no measured text-box overflow. All six draft PPTX slides were rendered and inspected via Artifact Tool despite the package failure, solely for diagnosis. The process composition shows tighter/possibly overlapping text in that import renderer versus the browser; native XML retains the expected box widths. Cross-engine text fit remains an acceptance blocker, not permission to shorten fixture strings to hide the difference. PowerPoint itself was not tested. App and separate design-preview server are running.
- Next at that point: R17 export integrity (now completed below) and layout fit acceptance, then I3b. Do not mark full Phase 5/6/7 complete from outline transport or design fixtures.

R17 validation (2026-09-14, next bounded block):
- Reproduced the missing-master failure as a normal failing test before changing the dependency. Corrected only the erroneous registration loop, not presentation content. The same upstream defect remains in v4.0.1, so no speculative upgrade was made.
- A clean isolated `npm install --omit=dev` and subsequent `npm ci --omit=dev` both applied the versioned correction automatically. A native multi-slide export from that clean installation has no missing declared parts. The production dependency supplies the installer tool even when dev dependencies are omitted.
- Independent finalizer: six-slide proof passed package integrity, declared geometry/font checks and Artifact Tool import without exceptions or suppressed findings. The output is 100492 bytes; SHA-256 `b2ce36867595d7aa64fb616ccfd1a7c9d64f25c1bde3a237ba01729c36b2c173`. Persistent proof: `data/exports/v2-design-study-2026-09-14.pptx` (ignored generated output).
- Actual Microsoft PowerPoint: file opened without a repair dialog; inspected all six slides individually. No visible overlap/clipping in these fixtures, including the process slide. The prior cramped process preview is specific to the external import renderer, not reproduced in PowerPoint. This resolves the fixture ambiguity, not font-aware acceptance for arbitrary future copy or other platforms.
- Final validation: 359/359 tests pass with zero TODOs, all six workspace typechecks pass, production web build and architecture/diff checks pass. The web server is restarted; the API and its current job history were left intact. No LLM generation logic changed, and no new LLM live-run success is claimed for this rendering task.
- Guardrails: no semantic generation change, regex text correction, fallback deck, or publication bypass. Research and humanizer behavior remain unchanged. Next bounded implementation is shared text-fit validation using actual font metrics, before enabling generated slide previews; never shorten test text or silently shrink fonts to hide overflow.

I3a text-fit validation (2026-09-14, next bounded block):
- Root cause: the scene supplied text boxes but no font measurement/line plan, allowing independent browser/PowerPoint wrapping and unchecked overflow. A regression first demonstrated that raw unmeasured scenes exported successfully; both adapters now reject unmeasured or stale layout.
- Fontkit measures explicit font bytes, including glyph availability and ink/advance bounds; Unicode UAX #14 determines legal break positions. One measured line plan drives both adapters. Neither modifies original copy, shrinks fonts, splits unbreakable words, or supplies substitute content/fonts. The process number's reserved box now uses the existing vertical slot up to its divider; no fixture text or font size was altered.
- Automated: 368/368 full-suite tests, zero TODOs; all six workspace typechecks and production web build pass. Nine added tests cover font-aware widths, source preservation/accents/line separators, unbreakable terms, height overflow, missing fonts/weights/glyphs, stale layouts, shared native/browser lines, and invalid dimensions. Tests do not require the host's proprietary fonts; the visual proof explicitly uses the real design fonts.
- Visual/export: six actual-font proof slides passed independent package/geometry/font inspection and import rendering. All six were then individually inspected in Microsoft PowerPoint without repair, overlap or clipping; line breaks match the browser proof. Output SHA-256 `724321282b1f2f8c0061b23662d48b34ea347d69c4da4775793059707455a8b2`, 108826 bytes. This is a manual fixture proof, not AI-generated presentation acceptance.
- Scope: no LLM/research/narration behavior changed, and no fresh LLM run is claimed. Image selection/vision and humanizer remain pending. Portable theme-font distribution, complex-script rendering and actual drafting-stage overflow feedback are still required before publication integration.
- Architecture/diff checks passed (89 nodes / 131 edges). Web rebuilt/restarted and returned HTTP 200, with API/job history untouched. Updated manual proof is retained at `data/exports/v2-text-layout-study-2026-09-14.pptx` (ignored output).
- Follow-up discovered during dependency audit: see R18 below. No unrelated package upgrades were mixed into text-layout implementation.

## Current Review: V2 Integration Before Further Features

Each task is timeboxed to 30 minutes, including its validation. Historical
Phase 4 smoke results below are research-only, not end-to-end app validation.

- [ ] R19 (High, author/review factual fidelity): the W3C fact bank preserves qualified guidance, but the original strategy, allocation and design repeated an unconditional rule. Those duplicate prose fields are now removed and strategy asks questions; a fresh continuation still independently overgeneralizes during writing and review approves. Instruction-only changes were previously tested and withdrawn. Clear negative controls pass even at baseline, but subtle errors evade review. The root cause is not exhausted by redundant planning prose; keep author/reviewer fidelity and source permissions open. No topic-specific replacement or extra reviewer.
- [ ] R20 (High, model-knowledge fact correctness): inspection of recorded bicycle research `generation_run_pxh79db2` found an internally inconsistent fact: a 40/20 tooth-count ratio is correctly named 2:1 but then described as one rear-wheel turn for two pedal revolutions. The reversed relationship is also present in the saved narrationIntent. This predates this block and is not caused by slide compression. Investigate fact-curation/research-review responsibility with unrelated relationship/quantity controls; do not add bicycle-specific arithmetic correction. The recorded bicycle visual preview is not evidence of factual acceptance.
- [x] R21 implementation (High, writing-stage execution budget): replace the fixed shared 180s writer deadline with 180s per planned slide including its existing fit revision, and a summed stage budget capped at 15 minutes. Share cancellation/late-result handling with the runner. Per-unit and aggregate timeout/cancellation regressions pass; the longer live acceptance is tracked above. Other stage budgets are deliberately unchanged, not claimed solved.
- [ ] R22 (Critical to autonomous research): Bing RSS returned unrelated content for all eight SpongeBob queries; repeated raw-wire probes also fail, despite echoing the requested query. A nonempty result list is not a meaningful search health check. Investigate/replace the search provider through its existing boundary, including provider usage terms, not topical query rewrites or manual per-subject sources. Explicit-source testing is a separate supported mode, not a repair of autonomous search. Diagnostics: `/tmp/slidespeech-search-probe.log`, `/tmp/slidespeech-search-wire.log`.
- [x] R23 (High, explicit source URL corruption): unconditional trailing punctuation stripping removed balanced path parentheses. Deleted regex/trim extraction in favor of a standard explicit-link parser. The reproduced regression failed before and passes after; exact URL reaches the request contract. Source-backed live rerun tracked above.
- [ ] R24 (High, evidence-selection execution): the fresh source-guided eight-slide run and exact-input replay exhaust 6,000 output tokens at low effort. Input has ten text segments and twenty evidence requirements; sixteen requirements are mandatory, including details not explicitly demanded in the brief. Sparse output IDs reduce schema size but do not resolve execution. Investigate stage workload and requirement ownership, preserving full source context and user scope; do not claim the schema or reasoning setting alone explains this failure. This blocked testing the longer deck, images and narration.

- [ ] R18 (Critical/High, dependency security): audit reports 14 affected package entries (3 critical, 6 high, 2 moderate, 3 low) in the existing stack, including Next.js 15.5.15, shell-quote via concurrently, and image-size via PptxGenJS. The new Fontkit/linebreak dependencies have no reported audit entries. Before broader deployment or accepting untrusted image assets, verify exploit paths and compatible upstream fixes, upgrade in a separate bounded task, preserve/revalidate the serializer correction and rebuild/live-smoke the app. Do not run a blind major-version audit fix or treat package counts as proven exploitability of this app.

- [x] R1 (High): Preserve the actual `ResearchReviewResult` at publication, including requirement assessments; reject contradictory approvals. Root cause: independently evolved strict review schemas and publication tests using a reduced synthetic review.
- [x] R2 (High): Stop automatic whole-stage replay after execution failures or cancellation. Retry only explicit retryable rejection with feedback. Root cause: the runner conflates technical failure with agent rejection.
- [x] R3: Reconcile the active architecture map with the implemented eval-only research pipeline and pending app integration; run full automated regression.
- [x] R4: User selected `qwen/qwen3.8-27b`; local configuration updated. LM Studio reports Q6_K with 50,176 loaded context tokens and concurrency 2. No fallback or automatic model loading.
- [x] R5: Run sequential Qwen live research gates without prompt changes, inspect actual sources/facts/audits, and record timings and failures. Diagnostic runs completed within 30 minutes; quality/robustness gates did NOT pass, so Phase 4 remains open.
- [x] R6: Replace the fact-decision boolean matrix with bounded sparse lists of selected core-owned IDs, preserving provenance and rejecting unknown/duplicate IDs. Architecture revised and obsolete matrix checks removed. The identical captured source input now yields a fact bank at low reasoning with the same per-call token limit, but still needs a parser retry; this is not closure of the broader robustness/quality gates.
- [x] R10: Deliver the output schema to the model, not only the grammar sampler. Two live description probes confirmed the missing model-visible contract; the W3C review replay then passed on the first response with the correct score scale. Shared-client regression tests, full automated validation, controlled source replays, and a fresh MDN run completed within this task's 30-minute timebox. The broader reasoning and semantic quality gates remain open; no score normalization, extra review stage, or topic rules were added.
- [x] R7 (High): Compare low and explicit none on identical captured research-review inputs after R10 and inspect semantic quality. Six sequential calls across MDN, W3C, and Riksdagen completed. None was faster but falsely approved known source-support gaps; keep low as the explicit default, with none restricted to diagnostic comparisons until R8 is resolved. This closes the deployment comparison, not Phase 4 quality or reasoning-budget robustness.
- [x] R11 (High, discovered during R7): Treat provider-declared token exhaustion as incomplete execution before JSON parsing. Root cause: the shared client ignored `finish_reason=length` when some content existed, so a partial brace triggered an expensive format retry and parseable truncated JSON could be accepted. The client now rejects before parsing; bounded correction remains only for completed malformed responses. Regression and three post-fix live reviews passed the transport acceptance criteria, without claiming the failed research inputs are usable.
- [x] R12 (Critical, exposed by R8a): Explicit fact-bank insufficiency can no longer be overridden by a later approval or a saved publication review. Two regressions demonstrated both boundaries accepting the contradictory state before the correction. Enforce the existing readiness decision, not a new semantic rule; a disagreeing reviewer must request an owning-stage revision.
- [x] R8a (High): Removed the false either/or between a linked contributing fact and an unfulfilled requirement from core and the curation prompt. Supported facts and their provenance can coexist with the remaining gap; partial support is never promoted to completeness. Validated partial and complete inputs through live curation and review; broader semantic quality remains R8.
- [ ] R8 (High): Investigate incomplete requirement approval, over-scoped planning, and review token-budget robustness. The no-reasoning source review approved the entire political-position requirement even though its monarch component was absent. The planner added that component beyond the explicit request. Prompts already ask for necessary requirements and full semantic coverage; appending another topical instruction is not a root-cause fix. Validate generic request scope and evidence sufficiency, not phrase matching. Explicit low also still exhausts the review budget on some inputs, including the fresh Python run below; do not silently change effort, increase budgets, or approve an incomplete review.
- [ ] R9 (High): Correct acquisition completeness and retry ownership before full publication acceptance. R9a fixes the reproduced depth-first budget starvation; R9b1 exposes acquisition metadata and gives acquisition its own bounded retry. Source selection still lacks already fetched content. Complete the smallest coherent content-access contract for informed acquisition; no keyword filters, guessed paths, or new semantic guardrails. The user's connected-flow priority above permits UI and downstream stage implementation while this quality work remains open.
- [x] R9a: Replaced target-by-target depth-first acquisition with bounded priority-ordered rounds after explicit URLs. Each exploratory target gets at most one agent-selected fetch per round, queries are cached, and the per-target limit applies across rounds. Seven regressions cover starvation, failed attempt accounting, per-target limits, later discovered candidates, and non-reducing batch configuration. Rejected candidates are not resubmitted, but new links can reopen a target's selection in a later round. Live source choices validated; scheduling does not prove semantic coverage or close R9.
- [ ] R9b: Give source selection an appropriately bounded view of acquired material, expose acquisition completeness/truncation to review, and support an acquisition-owned retry without regenerating a correct plan. Metadata and retry ownership are implemented in R9b1; bounded content access remains R9b2, not hidden behavior in the scheduler.
- [x] R9b1: Carry a content-free acquisition manifest into review/publication, record attempted and skipped targets, and support acquisition-owned feedback/retry with plan preservation. Regressions reproduced invisible acquisition, skipped-target omission, wrong retry ownership, incomplete publication lineage, and misleading domain-budget reporting. Candidate exhaustion/rejection is an acquisition outcome, not a fake fetch failure. Reference lineage, retry exhaustion, and live review ownership are validated without adding semantic rules; this does not close R9b2 or research quality.
- [ ] R9b2: Give the source-selection agent bounded access to already acquired content and an explicit decision to stop when its target is sufficiently supported. Address redundant candidate assessment from R9a traces without another summary/fact pipeline, first-character heuristics, or unbounded raw-page context. This is not implemented by the manifest, which exposes metadata only.
- [x] R13 (High, exposed by R9a live validation): Aligned the source-selection provider contract with core's actual candidate bounds. The generic static schema admitted position 40 for a 40-candidate batch and selection counts beyond the call limit. Replaced the unused static JSON schema with the input-bounded contract already used by other V2 decisions; no position reinterpretation, semantic rules, or larger retry budget. Two provider regressions reproduced the defect, an empty-candidate test preserves honest rejection, and the exact failing live batch now returns a valid decision.

- [ ] R14 (Medium, exposed by R9b1 live validation): Preserve meaningful source structure during text extraction. The fresh Python page's examples lost line breaks and indentation before evidence selection because the HTML extractor collapses all whitespace. Inspect and replace the structural extraction boundary generically; do not reconstruct code with language-specific rules or claim flattened examples are executable. This is separate from semantic review and is not fixed by acquisition metadata.

Validation log:
- Initial inspection: production generation is still disabled; the working V2 path ends at research review in the eval runner. No current end-to-end deck, narration, or Q&A validation is claimed.
- R1: Real research-stage output reproduced the publication schema failure before the fix. Shared review contracts extracted without a compatibility/recovery layer. 19 targeted tests, all six workspace typechecks, and `git diff --check` passed on 2026-09-14 (within 30 minutes).
- R2: Six regression cases failed before the fix (execution replay, deadline replay, malformed-output replay, and cancellation at three points). After the runner change, 23 targeted tests, all six workspace typechecks, and `git diff --check` passed on 2026-09-14 (within 30 minutes). Parser-feedback retries and explicit agent-rejection retries remain supported.
- R3: README and active Mermaid map now distinguish implemented eval-only research from pending app integration; duplicate outdated README diagrams removed. Full regression passed 296/296 tests; all six workspace typechecks passed. Generated import graph and architecture policy passed (78 nodes, 116 edges) on 2026-09-14, within 30 minutes. Live inference was not run because the configured and loaded models differ.
- R4: `/v1/models` and `/api/v0/models` verified the selected model and loaded context on 2026-09-14. Eval output now includes failed run IDs, total duration, stage progress, and requirement assessments; this changes observability only, not generation behavior.
- Reasoning constraint: user requires at most `low`. Model discovery advertises a default of `xhigh`; the old `chat_template_kwargs.enable_thinking=false` still produced reasoning in a bounded live probe. V2 and the retained LM Studio runtime now send explicit `reasoning_effort: low`, including retries; V2 also permits explicit `none`. No model-name heuristics, higher reasoning setting, or automatic escalation is introduced.
- Reasoning validation: 12 targeted provider tests, all six workspace typechecks, 297/297 full-suite tests, architecture checks, and `git diff --check` passed on 2026-09-14. The low-effort transport correction replaces the ineffective flag rather than adding a second inference path.
- R5 topic-only run `generation_run_2g1o8fl7`: technically succeeded in 87.1s, no stage retries, 21 model-knowledge facts, review score 0.92. Manual quality gate FAILED: a visible claim equates oxidative avian flight muscle with slow-twitch fibers, whereas the [physiology review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4992708/) describes fast oxidative fibers; the cue-switching claim also puts a star compass under clear-day guidance. The reviewer accepted these claims. This was independent manual checking, not extra evidence supplied to the pipeline. Do not treat model self-approval or descriptive knowledgeBasis text as verification of factual correctness; investigate the generic curation/review responsibility, not bird-specific patches.
- R5 Swedish-source run `generation_run_vchkqrok`: FAILED honestly after 210.7s at fact curation. It fetched four Riksdagen pages, selected 14 snippets (31,673 characters), then consumed all 7,000 completion tokens as reasoning with no structured content despite explicit low effort. No fallback or whole-stage replay occurred. Acquisition also exhausted the four-page domain budget before the third planned target; that is reported as no eligible candidates, and neither this gap nor one source's truncation status reaches research review.
- R5 controlled probe `generation_run_vchkqrok_none_probe`: same captured classification, plan, evidence, prompt, and 7,000-token limit; only reasoning changed to none. FAILED after 109.8s including the existing single parser retry. LM Studio reported zero reasoning tokens; both responses exhausted 7,000 content tokens and ended inside repeated per-fact reference fields. Reasoning is therefore not the sole cause. The project's default remains low; this probe is not a fallback or a silent default change.
- R6 automated validation on 2026-09-14: 25 targeted tests, 300/300 full-suite tests, all six workspace typechecks, architecture graph/check (78 nodes, 116 edges), and diff check passed. Tests cover unknown/duplicate references, missing source references, reordered evidence, enrichment without planned requirements, and the zero-source/model-knowledge schema. Provider and core use the same bounded contract; old matrix logic is removed rather than retained as compatibility.
- R6 controlled `generation_run_vchkqrok_sparse_low`: same four sources, 14 snippets, six requirements, and 7,000-token per-call limit. Fact curation succeeded in 97.2s with 20 source-backed facts, after the existing parser retry (11,676 completion tokens, 7,498 reasoning tokens total). The first response exhausted its limit; the retry completed. Independent research review then failed closed in 37.9s, using all 4,000 tokens as reasoning. No research approval or publishable deck is claimed.
- R6 controlled `generation_run_vchkqrok_sparse_none_probe`: same captured input and limits, explicitly isolated from the low default. Fact curation succeeded on its first response in 29.0s (18 source-backed facts, 3,058 completion tokens, zero reasoning). Review completed in 18.4s including one parser retry, but its perfect-score approval was manually rejected for the incomplete compound requirement documented in R8. Useful source facts are present; schema success and self-approval are not sufficient quality evidence.
- R6 unrelated multi-source run `generation_run_1p18me43`: retrieved both exact W3C URLs, selected eight snippets (19,200 characters), and curated 24 source-backed facts on the first call in 49.8s at low effort. Manual comparison found the core definition, disability coverage, and practical design guidance supported by the cited text. The research run still FAILED at review after 185.8s total: both review attempts used the wrong score scale (last response 95, required 0-1). This exposed R10; do not silently divide the score or claim complete pipeline success.
- R10 root-cause evidence: the same tiny live request with a schema-only marker description returned an invented dictionary definition (36 prompt tokens); adding the identical schema to the system prompt returned the exact requested marker (82 prompt tokens). Both used none only for this isolated diagnostic. [Primary documentation](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md#json-schemas--gbnf) confirms schemas are grammar-only and floating-point bounds are not enforced. Two regression assertions failed before the shared-client correction.
- R10 automated validation: the two missing-contract regressions now pass, including the retry path; 12 targeted tests, 300/300 full-suite tests, all six workspace typechecks, architecture graph/check, and diff check passed on 2026-09-14. No agent-specific score instructions, score coercion, or new retry layer were added.
- R10 controlled W3C replay `generation_run_1p18me43_visible_contract`: identical plan, evidence, and 24 facts; only schema visibility changed. Review succeeded on its first response in 30.0s at low effort, score 0.93, with 3,173 completion tokens including 2,062 reasoning tokens. The source-backed facts and full requirement audit were inspected; there is no exported deck or app publication yet.
- R10 controlled Swedish replay `generation_run_vchkqrok_visible_contract`: fact curation returned 22 source-backed facts in 110.9s after one parser retry (13,294 completion tokens, including 9,296 reasoning tokens total). Review still failed closed in 38.8s after using all 4,000 tokens as reasoning. Schema visibility fixes the demonstrated protocol defect, not the remaining reasoning-budget issue; R7 stays open and low remains the default.
- R10 fresh MDN run `generation_run_g87ecic0`: all stages used the visible schema and low reasoning. It fetched the exact requested overview plus three MDN pages, selected 18 snippets (43,200 characters), and produced 20 source-backed facts after one parser retry. The full research run FAILED honestly after 326.9s when review consumed all 4,000 tokens as reasoning. Stage times: classification 5.7s, planning 15.1s, acquisition 41.8s, evidence selection 143.5s, fact curation 82.8s, review 38.1s. The first same-domain target exhausted the four-page budget, later response/statelessness targets had no eligible candidates, and three acquired pages were partial. These confirm R7/R9 across unrelated sources rather than a topic-specific defect.
- R10 MDN manual content inspection: the requested request/response/statelessness material is present and traceable, but visible statelessness claims overlap, and some transport/message-format claims omit the HTTP-version scope. Treat these as R8 semantic curation/review work, not regex corrections or proof that all source-linked facts are ready for publication. No new slide, narration, UI, or PPTX implementation is claimed in this work block.
- Work-block close: R6 and R10 each completed in under 30 minutes; automated regression remains 300/300 with all workspace typechecks and architecture checks passing. All live processes were allowed to complete. Next priority is R7/R8/R9 before Phase 5, using captured inputs for controlled comparisons rather than repeated full research runs. Design and actual PPTX quality milestones are explicitly tracked in Phases 5-7.
- R7 comparison on 2026-09-14: identical input and first-request hashes (excluding reasoning effort) verified across all pairs. MDN low failed in 62.6s after two 4,000-token responses (7,996 reasoning tokens total); none approved in 16.3s/1,122 tokens. W3C low approved in 29.2s/3,055 tokens (1,959 reasoning), none in 10.3s/733 tokens. Riksdagen low failed in 38.3s/4,000 reasoning tokens; none approved in 15.2s/1,020 tokens. The known MDN scope/repetition issues and Riksdagen unsupported monarch extension were not caught by none, so its 3/3 structural success is not a semantic quality pass. Raw responses are in ignored `data/generation-runs/r7-review-comparison/`; no default or budget was changed.
- R11 regression: three new tests reproduced the failure before the fix, including acceptance of parseable JSON marked incomplete by the provider. After the shared-client correction, 28 targeted tests, 303/303 full-suite tests, and all six workspace typechecks passed. The initial restricted full-suite run had three local-server `EPERM` failures; the authorized rerun passed, with no test or application workaround.
- R11 live replays: MDN stopped after one call in 38.0s with an explicit 4,000-token exhaustion diagnostic, rather than the prior two-call 62.6s path. Riksdagen stopped after one call in 32.1s. W3C still completed and approved on the first call in 26.5s at low (score 0.93, 3,128 completion/1,919 reasoning tokens). Timings are individual runs, not throughput guarantees. Results are in ignored `data/generation-runs/r7-review-postfix/`. Architecture graph/check (78 nodes, 116 edges) and diff check passed; no new stage, budget, fallback, or semantic rule was added. R7 and R11 each stayed within their 30-minute work-block limit.
- R8 diagnostic, not an implementation: the same three inputs were reviewed with explicit none while hiding upstream selection coverage, source summaries/quality judgments, and sufficiency/blocking declarations. All original facts, source snippets, request, and plan remained. MDN/W3C/Riksdagen still received 0.95 approvals in 16.9s/9.8s/13.1s; known source-scope errors were not caught. This does not support removing that context as a sufficient fix, so the production input contract remains unchanged. Results are in ignored `data/generation-runs/r7-review-blind/`. R8 remains open: investigate request scope and independent fact-to-evidence judgment before adding further checks or advancing Phase 5.
- R8 review-prompt diagnostic: a shorter replacement emphasizing independent source entailment and request scope did not solve the known errors. The identical MDN/W3C/Riksdagen inputs still received 0.95 approvals with none (14.3s/8.9s/10.9s); all three low probes exhausted the existing 4,000-token limit. Results are in ignored `data/generation-runs/r7-review-source-verification*/`. The replacement prompt was NOT adopted; no topic-specific rule or automatic budget increase was added.
- R8a/R12 validation on 2026-09-14: four new regression tests failed before the corrections. Afterward, 36 targeted tests, 307/307 full-suite tests, all six workspace typechecks, architecture graph/check (78 nodes, 116 edges), and diff check passed. Canonical artifact rules now distinguish contribution from complete fulfillment and require consistent readiness through review and publication. No new stage, retry layer, fallback, or semantic regex was introduced.
- R8a live contract checks: two explicitly synthetic, unrelated source fixtures retained useful partial facts and requirement links while recording the missing accessibility information or upload limit, without inventing either. Low-effort curation took 10.1s/9.6s; reviews rejected the insufficient inputs in 17.9s/15.3s. These are live LLM contract tests, not fresh web acquisition. The second review chose evidence selection when more acquisition was needed, confirming that R9 retry ownership remains unresolved. Results: ignored `data/generation-runs/r8-partial-evidence/`.
- R8a complete-source replay: the real captured W3C input produced 23 source-backed facts on the first low-effort response in 46.2s, preserving sufficient material. Review approved in 29.5s with score 0.92 and an informational role-label observation. This confirms the corrections do not automatically reject complete research; it is not an end-to-end presentation, narration, browser, or PPTX test.
- R8 audit-order diagnostic: emitting evidence assessments before the approval decision, with rationale before assessment status, did not solve the known failures on the same inputs. MDN/W3C/Riksdagen all received perfect-score approvals with explicit none (17.5s/10.0s/13.3s). This schema-order experiment was NOT adopted; the production effort remains low. Results: ignored `data/generation-runs/r7-review-audit-first/`. Stop prompt/order variants and address the known acquisition context and ownership gap next; R8 and R9 remain open.
- R9a/R13 automated validation on 2026-09-14: 317/317 full-suite tests, all six workspace typechecks, architecture graph/check (78 nodes, 115 edges), and diff check passed. Four regressions reproduced the original scheduling/limit defects; three further tests cover later-discovered candidates and a non-reducing batch configuration. Two provider tests failed before the bounded-schema correction; a separate empty-candidate test checks honest rejection. Existing explicit URL priority, domain/total limits, fetch-failure preservation, and fail-closed invalid references remain tested. Work stayed within a 30-minute block; production V2 generation remains disabled.
- R9a initial live acquisition: reused the exact captured MDN and Riksdagen plans with fresh web search/fetch and live Qwen at low, not mock research. MDN stopped honestly after 51.5s because the provider accepted an out-of-range candidate position; Riksdagen acquired the previously starved committee source in 74.8s within the same four-page domain budget. This exposed R13 rather than justifying a positional correction or hidden fallback. Traces: ignored `data/generation-runs/r9-acquisition-rounds/`.
- R13 isolated replay: the identical failed 40-candidate input returned a valid candidate rejection in 7.2s at low after the contract correction. The selected batch itself need not contain a useful source; rejecting it is legitimate. The obsolete unbounded JSON-schema export was removed. Traces: `r9-acquisition-rounds/r13-same-batch-replay.json`.
- R9a/R13 final live acquisition: MDN completed in 85.7s with four sources spanning the explicit URL and all three exploratory targets; Riksdagen completed in 81.3s with four sources including the dedicated committee-work page. No candidate-contract or fetch errors occurred. These are acquisition-only tests, not approved fact banks or full decks. Fresh web responses and model choices vary, so timings are individual comparisons, not a controlled throughput benchmark. Traces: ignored `data/generation-runs/r9-acquisition-rounds-bounded/`.
- Remaining R9 evidence: acquisition was slower than the captured MDN/Riksdagen baselines (41.8s/38.9s), using 14/11 source-selection calls. Many navigation candidates are reconsidered for different targets, and a sole batch winner is submitted again for final ranking. Manual reading confirms the committee page contains useful committee procedure, but the MDN session page mainly covers connections and message structure, not the cookie/session-state explanation inferred by the selector. Thus fair scheduling is demonstrated, not reliable relevance or faster research. R9b must address informed source selection, honest completeness, and retry ownership before claiming Phase 4 closure; do not add title keywords or topic-specific corrections.

- R9b1 implementation on 2026-09-14: review now receives plan, a content-free acquisition manifest, selected evidence, and facts in that order. The manifest preserves acquisition identity, source/page metadata, truncation, actual fetch/search errors, and every target's attempted/skipped outcome. Publication validates that same plan/acquisition/evidence lineage. Acquisition feedback consumes the existing single research retry while preserving the plan; changes to targets, queries, or budgets still belong to planning. There is no new review stage, retry layer, static fallback, semantic regex, or model-specific correction.
- R9b1 automated validation: 328/328 full-suite tests, all six workspace typechecks, architecture graph/check (78 nodes, 115 edges), and diff check passed. Eleven added tests cover metadata visibility, skipped and domain-budget targets, acquisition feedback/plan preservation, evidence-only retry, acquisition retry exhaustion, publication lineage, and separation of candidate rejection from real provider errors. The block stayed below 30 minutes; no application servers were started.
- R9b1 live review contract checks: two explicitly synthetic acquisition-failure fixtures were sent to the real Qwen model at low. Both retained supported facts and rejected the missing requested information, correctly targeting acquisition rather than changing the plan, in 13.8s/11.6s. These are live LLM contract checks, not real network outages. A replay of the real captured W3C material with the manifest passed on its first response in 34.9s, score 0.93. Results: ignored `data/generation-runs/r9b-review-manifest/`.
- R9b1 fresh Python research `generation_run_h67w1epy`: fetched the exact requested Python control-flow URL, selected evidence, and produced 14 source-backed facts on the first curation response. All calls used low and unchanged limits. Full research FAILED honestly after 113.7s when final review exhausted its 4,000-token completion budget, including 3,244 reasoning tokens. No fallback, extra review retry, or publication occurred. The main for/range/break explanations were supported by the captured source, but flattened code examples exposed R14 and some facts exceeded the beginner scope. This is not a successful end-to-end presentation or closure of R8. Results: ignored `data/generation-runs/r9b-python-live/`.

## Remaining Delivery Estimate

Planning estimate on 2026-09-14, not a deadline or a promise of model reliability.
The implemented V2 path is still research-only; a full presentation in the app
remains an upcoming milestone. The ranges below group existing phase tasks,
not new stages or exceptions to their validation gates.

| Remaining area | Planned work blocks, at most 30 minutes each |
| --- | --- |
| Research scope, evidence completeness, and content-quality validation (Phase 4) | 3-5 |
| Strategy, slide content, narration, publication, and runtime integration (Phases 5-7) | 6-8 |
| Shared design system, at least 20 browser/PPTX layouts, UI flow, and Advanced panel (Phases 5-7) | 8-12 |
| Cross-scenario, actual-export, voice, and usability validation (Phase 8) | 3-5 |

Total planning allowance: 20-30 blocks, roughly 10-15 hours of active work,
plus user feedback and external availability. Research quality and visual/export
parity are the largest uncertainties; revise the estimate after Phase 4 closes
and after the first complete V2 presentation. Do not use this estimate to weaken
quality gates or claim the design is done from isolated screenshots.

## Review Remediation Before Phase 4 Can Close

Status: historical validation completed; reopened by Current Review above

The first Phase 4 implementation proved that the stage boundaries are useful,
but also exposed contract defects that must be corrected before deck planning
starts. Each task below is an independently validated work block with a maximum
duration of 30 minutes. A failed or unexplained validation blocks the next task.

- [x] T1: Reconcile the canonical architecture and task tracker with the review findings.
- [x] T2: Add an immutable `PresentationRequestArtifact` and an `EvidenceSet` contract that preserves source metadata and selected evidence for publication and Q&A.
- [x] T3: Wire immutable request input and remove agent-owned identifiers from research-question, explicit-source, and source-selection decisions.
- [x] T4: Remove agent-owned identifiers from fact-curation decisions; initially used stable input positions. R6 supersedes fact references with sparse selections of core-owned IDs; core still assigns all new identities.
- [x] T5: Split raw source acquisition from agentic evidence selection; eliminate prefix-only evidence sampling and make fact curation consume `EvidenceSet`.
- [x] T6: Make `PublishablePresentation` validate the complete artifact lineage, allocated facts, source attributions, and all mandatory reviews.
- [x] T7: Add an explicit `research-review` gate, bounded stage-local retry, stage deadlines, and progress events.
  - [x] T7a: Add stage deadlines with abort propagation through LLM and research transports.
  - [x] T7b: Add a typed stage-progress contract and emit lifecycle events from the stage runner.
  - [x] T7c: Add the agentic `research-review` stage and core-owned review lineage.
  - [x] T7d: Retry a rejected owning stage once with structured review feedback, then fail closed.
  - [x] T7e: Replace position-blind evidence/fact selections with exact core-owned ID-keyed contracts and require an explicit requirement-level research audit. R6 replaces only the fact boolean matrix with sparse ID lists.
- [x] T8: Run the complete automated suite plus alternating topic-only, explicit-source, multi-source, and non-English-source Gemma live gates.
  - [x] T8a: Run the complete automated test and typecheck suites.
  - [x] T8b: Run a topic-only Gemma live gate unrelated to prior fixtures.
  - [x] T8c: Run an explicit-source Gemma live gate.
  - [x] T8d: Run a multi-source Gemma live gate.
  - [x] T8e: Run a non-English-source, English-output Gemma live gate.
- [x] T9: Update the generated architecture graph and close Phase 4 only after all remediation gates pass.

Per-task validation requirements:
- [ ] State stage, artifact, input, output, root cause, and non-goals before code changes.
- [ ] Add contract-focused tests without scenario-specific production logic.
- [ ] Run targeted tests and affected workspace typechecks.
- [ ] Run `git diff --check`.
- [ ] Record the validation result here before checking off the task.

Validation log:
- [x] T1: Canonical stage/artifact boundaries reconciled; stale target fields removed; `git diff --check` passed on 2026-08-24.
- [x] T2: Request and evidence contracts added; 10 targeted tests, types/core typechecks, and `git diff --check` passed on 2026-08-24.
- [x] T3: Request lineage and positional research/source decisions added; 28 targeted tests, all workspace typechecks, `git diff --check`, and a Gemma explicit-source live classification/plan passed on 2026-08-24.
- [x] T4: Fact decisions converted to positional references with core-owned ids; 25 targeted tests and all workspace typechecks passed. Gemma live reached a genuine evidence-insufficiency decision instead of an id-contract failure on 2026-08-24.
- [x] T5: Raw acquisition split from full-page agentic evidence selection; 35 targeted tests, all workspace typechecks, and a Gemma Rust live run passed with complete borrowing/reference coverage on 2026-08-24. Full Phase 4 latency was approximately 110 seconds.
- [x] T6: Publication now validates the complete request-to-narration artifact chain, fact allocation, evidence/source provenance, and exact approved review sets. Eight artifact contract tests, the types workspace typecheck, and `git diff --check` passed on 2026-08-24.
- [x] T7a: Stage execution now enforces a configurable deadline and propagates abort signals through all V2 LLM, search, and fetch calls. Thirty-three targeted tests, types/core/providers typechecks, and `git diff --check` passed on 2026-08-24.
- [x] T7b: Typed stage lifecycle/progress events added at the runner boundary, with structural target/page progress from long research stages. Seventeen targeted tests, types/core/providers typechecks, and `git diff --check` passed on 2026-08-24.
- [x] T7c: Independent agentic research review added with positional agent references and core-owned review, artifact, and fact lineage. Twenty-six targeted tests, types/core/providers typechecks, and `git diff --check` passed on 2026-08-24.
- [x] T7d: Research review now retries the earliest explicitly identified owning artifact once, rebuilds dependent downstream artifacts, and then fails closed. Twenty-one targeted tests, types/core/providers typechecks, and `git diff --check` passed on 2026-08-24.
- [x] T8a: All six workspace typechecks and the complete 274-test suite passed on 2026-08-24.
- [x] T8b: Gemma topic-only live gate passed for migratory bird navigation with model-knowledge grounding, ten role-correct facts, usable slide/narration allocation, and approved research review. The run also exposed and corrected generic fact-role, allowed-use, and grounding-mode review instructions on 2026-08-24.
- [x] T8c: Gemma explicit-source live gate passed for an MDN HTTP presentation with the exact requested URL, complete evidence-requirement coverage, eight source-traceable facts, and approved research review. The first run exposed and corrected a generic unique-segment decision contract on 2026-08-24.
- [x] T8d: Gemma multi-source live gate passed for two W3C accessibility sources with both exact URLs preserved, ten selected snippets, complete requirement coverage, source-correct fact provenance, and approved research review on 2026-08-24.
- [x] T7e: At this historical checkpoint, evidence selection, fact curation, and research review used exact core-supplied ID-keyed objects where ordering could corrupt provenance. R6 supersedes the fact encoding only. Structured parse retry and stage retry remain bounded and fail closed. Three affected workspace typechecks and 52 targeted tests passed on 2026-08-24.
- [x] T8e: Gemma live run `generation_run_oh3um8l1` used Swedish Riksdagen sources and produced English facts. It fetched the direct `Från förslag till lag` page and preserved exact support for proposition/motion, committee preparation, chamber debate, voting buttons, and acclamation. All five requirement audits were manually checked against their snippets. The preceding structurally successful run was manually rejected for incomplete process evidence, which led to T7e rather than a prompt-specific patch.
- [x] T8: Final regression passed all six workspace typechecks and 288/288 tests; `git diff --check` and the stale positional-contract search passed on 2026-08-24.
- [x] T9: `npm run arch:graph` regenerated the import graph with 77 nodes and 113 edges; `npm run arch:check` passed on 2026-08-24.

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
- [x] LLM readiness requires both API health and the configured model id; live validation must use whichever model `.env` names and LM Studio has actually loaded.
- [x] Phase 4 must improve source acquisition for specific non-English public-sector prompts without relaxing fail-closed gates.
- [x] Phase 4 must budget source-bundle size and LLM calls because larger grounding classification calls can time out.
- [x] Phase 7 must remove Q&A dependence on reasoning-content extraction by using an explicit agentic answer contract.
- [x] Q&A no longer converts ranked slide/source snippets into semantic answers when answer generation fails.
- [x] Research/source hygiene no longer prefetches guessed encyclopedia pages or same-domain support paths as hidden semantic fallback.
- [x] Slide planning no longer gets duplicated static arc instructions from intent context.
- [x] Recorded question and live voice are explicitly scheduled for Phase 7 browser/manual validation.

## Phase 3: V2 Types, Interfaces, And Logging

Status: contract remediation complete

Owned V2 stages:
- `PresentationRequestArtifact`
- `PromptClassification`
- `ResearchPlan`
- `ResearchBundle`
- `EvidenceSet`
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
- [x] Preserve the exact structured request, explicit URLs, theme, and pedagogical profile in an immutable `PresentationRequestArtifact`.
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
- [x] Extend `PublishablePresentation` with a runtime-safe `EvidenceSet` and complete artifact lineage validation.
- [x] Ensure agents never generate protocol identifiers owned by core; agents only reference exact supplied keys or bounded positions.
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
- [x] All revised V2 artifacts have explicit schemas or TypeScript types.
- [x] No stage writes visible slide copy before `SlideDraft[]`.
- [x] Failure states are representable without throwing away diagnostics.

## Phase 4: Classification, Research, And Fact Bank

Status: implemented; integration and source-completeness validation reopened on
2026-09-14. See Current Review before starting Phase 5.

Owned V2 stages:
- `PresentationRequestArtifact`
- `PromptClassification`
- `ResearchPlan`
- `ResearchBundle`
- `EvidenceSet`
- `FactBank`
- `ResearchReview`

Goal:
- Build trustworthy context before slide planning.

Implementation tasks:
- [x] Implement prompt intent classification.
- [x] Classify language, audience, presentation goal, and deck mode.
- [x] Preserve exact sources, coverage, slide count, theme, and pedagogical controls independently of classification output.
- [x] Plan research from explicit requirements instead of broad scraping.
- [x] Execute explicit URLs first.
- [x] Execute same-domain support pages only when the research plan requires them.
- [x] Execute broader web research only when the prompt or risk profile requires it.
- [ ] Extend the research acquisition contract to collect relevant image candidates from source pages, retaining exact asset identity, source/image URLs, captions, dimensions and available attribution/usage information. Additional image search stays within the existing research permissions and budgets, not a parallel research path.
- [x] Select relevant evidence from complete acquired content before fact curation.
- [x] Curate a traceable fact bank.
- [x] Preserve missing facts and contradictions.
- [x] Review research sufficiency independently from fact curation with one explicit LLM assessment per evidence requirement.
- [x] Pass `FactBank` and `EvidenceSet` downstream instead of raw scraped text.

Validation:
- [x] Contract test exact explicit URL and requested-coverage preservation.
- [x] Contract test multiple exact URLs and structured request controls.
- [x] Contract test model-knowledge/topic-only execution without network calls.
- [x] Contract test missing required evidence and fail-closed review behavior.
- [x] Live test topic-only, explicit-source, multi-source, and non-English-source scenarios.
- [x] Manually inspect selected snippets, fact provenance, and every requirement audit for the final non-English-source scenario.

Definition of done:
- [x] Generation receives a `FactBank` and `EvidenceSet`, not raw scraped text.
- [x] Missing required facts fail the stage or become explicit user-facing limitations.
- [x] Source-grounded facts carry resolvable evidence and source references.
- [x] Classification cannot discard explicit request data or advanced controls.
- [x] Research and fact agents do not own protocol identifiers.

## Phase 5: Deck Strategy, Slide Allocation, And Design Selection

Status: strategy/allocation/review integrated; semantic quality and design selection pending

Owned V2 stages:
- `DeckStrategy`
- `SlidePlan[]`
- `SlideDesignSpec[]`

Goal:
- Decide the deck story, slide jobs, fact allocation, and layout intent before any visible prose is generated.

Implementation tasks:
- [x] Implement deck strategy generation from classification and fact bank, preserving the immutable request.
- [ ] Define and carry Advanced-menu controls through the existing immutable request and planning contracts, including desired section order and exact slide count; expose no unsupported controls and introduce no parallel planning path.
- [x] Allocate first slide as `intro`.
- [x] Allocate last slide as `conclusion`.
- [ ] Allocate body slides with distinct jobs.
- [x] Allocate allowed facts per slide with bounded references and explicit allowed-use permissions.
- [x] Define overlap policy per slide when needed. Semantic consistency validation remains R16.
- [ ] Select design specs from content needs.
- [ ] Use a vision-capable agent to inspect actual candidate image pixels with topic/source context and intended slide use. Persist relevance/quality decisions for the inspected asset; metadata alone, trusted hosting, or a failed/unavailable vision call must not approve it. Reuse valid assessments instead of adding duplicate calls.
- [ ] Select relevant source images before generic decoration; carry the selected asset and crop through both browser and PPTX. Omit unavailable optional imagery explicitly, or report a required visual gap. Curated/generated illustrations must be deliberate and validated, never unrelated automatic substitutes.
- [ ] Prevent role labels and internal planning text from becoming visible slide copy.
- [ ] Ensure design specs do not rewrite facts.
- [x] Define a coherent visual direction and shared theme tokens for typography, color, spacing, and image treatment; Paper/Editorial/Signal and representative compositions validated in the 2026-09-16 visual-diversity block.
- [ ] Review the visual direction against the canonical Product Experience And Visual Design requirements: a coherent app/deck identity, content-first hierarchy, and layout variety without adding user decisions.
- [ ] Break layout-library implementation into named work blocks of at most 30 minutes, each with its own visual validation; the complete library is a milestone, not one uninterrupted task.
- [x] Build the initial 20-entry layout catalog with shared browser/PowerPoint geometry, field capacities and theme tokens. This covers text, comparison, sequence, quote, closing and whole-image treatments; chart/map/gallery roles still need their own implementations.

Validation:
- [x] Unit test first slide is `intro`.
- [x] Unit test final slide is `conclusion`.
- [ ] Unit test body slide distinctness.
- [x] Unit test fact allocation shape, references, required/allowed/overlap relationships and failure without repair.
- [ ] Unit test overlap policy.
- [x] Unit test unsupported strategy decisions: refusal ends before allocation, malformed allocation count fails without repair.
- [ ] Validate explicit Advanced choices across unrelated prompts: count includes intro/conclusion, requested sections survive planning, unset choices remain agent-owned, and conflicting instructions require clarification rather than silent overrides.
- [ ] Live test onboarding prompt.
- [ ] Live test teaching prompt.
- [ ] Live test workshop/how-to prompt.
- [ ] Live test strategy/report prompt.
- [ ] Compare representative actual PPTX renders with browser slides: no overlap, clipped text, distorted images, or unreadably small type.
- [ ] Test image rejection, unavailable vision, asset/assessment identity mismatch, and no suitable candidates without hidden fallback; verify the chosen image and crop survive PPTX export.
- [ ] Live-test image selection across unrelated subjects, including misleading captions or a relevant page with an unrelated image. Inspect the actual images and vision decisions; verify the configured provider genuinely processes images before claiming vision validation works.

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
- [ ] Implement high-quality PPTX export from the same designs and content: deliberate hierarchy, generous spacing, relevant visuals, and speaker notes rather than repeated slide copy.

Validation:
- [ ] Unit test malformed LLM output.
- [ ] Unit test rejected review output.
- [ ] Unit test missing facts.
- [ ] Unit test repeated main claims.
- [ ] Unit test language mismatch.
- [ ] Live test one previously failing prompt.
- [ ] Live test one unrelated prompt.
- [ ] Render exported decks from unrelated topics and review every slide for readability, layout variety, relevant visuals, and fidelity to the browser presentation.

Definition of done:
- [ ] Bad slide drafts are rejected, not repaired into generic decks.
- [ ] Repeated content is a failure unless explicitly planned.
- [ ] Review rejection blocks publication.

## Phase 7: Narration, Publication, And Runtime Handoff

Status: in progress; publication, speech, answer playback and confirmed recording connected; physical microphone, hands-free voice, follow-up research and broad quality acceptance pending

Owned V2 stages:
- `NarrationScript[]`
- `PublishablePresentation`
- `Grounded Q&A`

Goal:
- Produce a coherent presenter script and publish only complete, reviewed presentations.

Implementation tasks:
- [x] Generate narration after slide drafts are stable.
- [x] Implement the required humanizer assessment within `narration-review`, before publication/TTS: review the complete spoken story for natural wording, rhythm, explanations, transitions, audience/language fit, and a proper opening/closing. Live acceptance remains unchecked below; no parallel pipeline or English-specific style filters.
- [x] Give narration review the strategy, slide plans, stable drafts and permitted facts as well as the complete candidate script, so naturalness never comes at the expense of factual meaning, attribution or uncertainty.
- [x] Route actionable humanizer feedback to one targeted revision owned by narration generation, then review the revised artifact. Reuse the existing retry budget; minor subjective style preferences remain advisory. Never rewrite approved narration during playback.
- [ ] Reject narration that repeats slide bullets instead of presenting the material.
- [x] Publish only after slide review passes.
- [x] Publish only after narration review passes.
- [x] Publish only after final publication review passes.
- [x] Keep typed and confirmed-transcript Q&A on the same V2 runtime path with grounded answer and preserved audio cursor. Follow-up research remains pending.
- [x] Speak the reviewed answer and contextual bridge, then restart the interrupted approved passage when the visible Continue preference is enabled. Broader conversational-quality acceptance remains open.
- [ ] Prototype and review the connected primary journey before implementing the shell refresh: request, progress, preview, start, question/answer/resume, and conclusion/export. Map views to existing states rather than adding a parallel UI state machine.
- [ ] Audit existing controls and remove duplicate navigation, competing primary actions, and default-visible diagnostics; keep theme/voice settings optional with useful defaults.
- [ ] Consolidate detailed presentation controls in one initially collapsed Advanced panel, grouped by structure/style/sources, with an active-override summary and reset to defaults that preserves the request and sources.
- [ ] Refresh the application shell after the generation path is validated: clear generation progress, an intentional visual system, and responsive presenter/Q&A controls.
- [ ] Unify typed and voice question feedback with visible pending work, cancellation, a readable retained answer, and a clear return to the presentation; preserve sources and honest error states.
- [ ] Make overview thumbnails match the actual slide aspect ratio and design; narration progress must not make the page jump.

Validation:
- [x] Unit test missing narration.
- [x] Unit test malformed final review.
- [x] Unit test rejected final review.
- [x] Test humanizer feedback/revision ownership, exhausted revision budget, artifact-specific re-review, and unchanged factual context. Semantic fidelity/quality must still be validated live, not asserted through topic phrases or regex.
- [ ] Listen to complete narrations across unrelated teaching, onboarding and strategy decks using the actual TTS voice. Compare initial/revised scripts with the same voice to separate writing quality from prosody; record repetition, continuity, naturalness, factual drift and added latency. Include a non-English sample before claiming multilingual quality.
- [x] Unit test Q&A answer validation fail-closed behavior.
- [x] Live test typed Q&A across published bread material and a source-backed W3C continuation.
- [x] Live test synthetic recorded audio through real Whisper, Qwen and Piper; do not equate this with physical microphone acceptance.
- [ ] Live test a physical microphone question, transcript editing, noise/echo and hands-free onset interruption.
- [x] Live test manual presenter resume and automatic return after spoken answers; replay preserves paused state. Physical voice acceptance remains pending.
- [ ] Validate the refreshed UI on desktop and mobile, including keyboard access, readable contrast, question cancellation, and stable slide layout during playback.
- [ ] Review the complete flow with the user, not only individual screens; record usability findings and remove unnecessary steps before calling the design complete.
- [ ] Validate both the untouched default flow and the Advanced flow: closing retains choices, reset is clear, unsupported voice options are absent, and submitted choices match the immutable request.

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
- [ ] Run a first-time-user walkthrough without verbal guidance: generate, start, pause, ask by text and voice, cancel, resume, and export. Verify that the downloaded deck matches the quality promised by its preview.
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
