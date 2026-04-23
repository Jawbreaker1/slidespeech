# SlideSpeech Tasks

Last updated: 2026-04-23

This file is the canonical active task tracker for the repo.

Use this file for:
- current phases
- status per workstream
- active subtasks
- definition of done

Do not treat these files as competing task trackers:
- [README.md](/Users/johanengwall/github_repos/slidespeech/README.md): product and status narrative
- [architecture-plan.md](/Users/johanengwall/github_repos/slidespeech/docs/architecture-plan.md): architecture reference

## Phase Overview

### 1. Demo hardening
Status: done enough

Notes:
- demo was held
- runtime is usable
- services are up and stable enough for active development

### 2. Q&A / STT robustness
Status: active

Goal:
- make typed Q&A, Record question, and Live voice feel like one coherent product flow
- make voice input understandable and cancellable
- stop low-quality transcripts from turning into nonsense answers

Definition of done:
- typed Q&A shows a clear modal while the answer is being generated
- Record question shows a clear listening/transcribing flow
- Live voice has stricter gates than Record question
- user can cancel a question before it is sent
- transcript is visible before or while answer generation happens
- obviously bad transcripts do not go straight into backend Q&A
- one English and one Swedish voice question work end-to-end without obvious nonsense

Subtasks:
- [ ] Add a shared question-flow state machine for typed Q&A, Record question, and Live voice
- [ ] Add a shared question-flow modal with states for listening, transcribing, transcript review, generating answer, and speaking answer
- [ ] Add `Cancel question` support to the modal and wire it through all three entry paths
- [ ] Route typed Q&A through the same modal instead of only disabling the send button
- [ ] Show transcript text prominently for voice questions
- [ ] Add transcript quality gates on backend voice input before calling session interaction
- [ ] Remove English hardcodes from browser voice defaults where possible
- [ ] Stop assuming English-only backend STT by default
- [ ] Tighten Live voice gating so ambient speech/noise is ignored more often than it interrupts
- [ ] Verify typed Q&A, Record question, and Live voice separately

### 3. Generation quality
Status: pending after Q&A / STT

Goal:
- return to deck quality after the current Q&A/STT stream is complete

Definition of done for the next pass:
- hard prompts do not collapse into obviously repetitive or generic slide structure
- onboarding/company prompts stay company-specific
- workshop prompts keep a clear practice/exercise slide
- fresh subject prompts do not drift into unsupported abstract claims

Known open problems:
- `System Verification` still drifts into generic company/value language
- `VGR` still risks weak workshop structure
- evaluator is still more generous than the actual saved deck quality

Subtasks:
- [ ] Revisit organization onboarding framing after Q&A/STT is stable
- [ ] Revisit workshop slide-role separation
- [ ] Re-run the live regression suite after the next generation pass

### 4. Visual polish
Status: pending

Goal:
- improve slide and presenter clarity without destabilizing the runtime

Definition of done for the next pass:
- presentation overview looks intentional and readable
- question/answer states are visually obvious
- image use remains relevant and non-gimmicky

Subtasks:
- [ ] Revisit presenter overview/thumbnail polish
- [ ] Improve presentation-theme consistency where it clearly helps readability
- [ ] Keep image pipeline honest: real relevant images first, curated fallback only when needed

## Recently completed

- [x] Removed the unstable Qwen3-TTS Apple Silicon experiment from the codebase and local machine
- [x] Documented the Apple Silicon / MLX instability in [README.md](/Users/johanengwall/github_repos/slidespeech/README.md)
- [x] Restored the active TTS path to Piper
- [x] Verified the current app stack is healthy again

## Not active now

- TTS model replacement
- new LLM experiments
- deeper generation refactors before Q&A/STT is closed enough
