# SlideSpeech

SlideSpeech is an MVP for an interactive AI presenter and AI teacher.

The core idea is not "generate slides and stop there". The product is an orchestration runtime that can:

- turn a topic or source material into a teachable deck
- present it step by step
- let the learner interrupt naturally
- answer in context
- adapt the teaching style
- and resume from the right place

The architecture is intentionally modular so LLM, vision, STT, TTS, VAD, storage, and research backends can be swapped without rewriting the core product logic.

## Generation pipeline

SlideSpeech is not meant to be "one prompt in, one static deck out".
The product goal is a grounded teaching pipeline with two modes:

- a generation pipeline that turns a topic or source bundle into a teachable presentation
- a runtime pipeline that presents, answers questions, adapts, and resumes in context

### Current generation pipeline

Today, generation is quality-first and still more conservative than fast.
In plain terms, the system currently does this:

1. Interpret the user prompt into a structured teaching intent.
2. Decide whether live web research is needed, and if so fetch and summarize sources.
3. Build a grounded presentation plan.
4. Generate a deck draft, often through multiple guarded attempts.
5. Enrich slides one by one into the internal slide schema.
6. Validate and repair the deck when quality checks fail.
7. Generate the first narration so presenter mode can start.
8. Continue background enrichment for later narrations and final review.

```mermaid
flowchart TD
    A["Prompt or source-aware request"] --> B["Intent extraction"]
    B --> C["Research planning"]
    C --> D["Explicit source fetch and search"]
    D --> E["Grounding bundle"]
    E --> F["Presentation plan"]
    F --> G["Deck generation"]
    G --> H["Slide-by-slide enrichment"]
    H --> I["Validation and repair"]
    I --> J["Save deck and generate intro narration"]
    J --> K["Background narration and review"]
```

This is why SlideSpeech can already produce grounded, narration-aware decks, but also why generation can still take too long: several LLM-heavy stages are still serialized and guarded.

### Target pipeline

The target architecture is faster, cleaner, and more progressive.
The goal is to make the first usable deck appear quickly while keeping quality high through structured enrichment afterward.

In plain terms, the target system should do this:

1. Turn the prompt into a clean intent contract: subject, audience, format, constraints, and required activities.
2. Build a strong evidence bundle from trusted sources only when grounding is actually needed.
3. Generate a coherent deck from that contract with fewer retries and less repair.
4. Return a usable first result early.
5. Enrich narration, illustrations, QA, and presenter assets progressively in the background.
6. Keep question answering, STT, and TTS on a separate fast runtime path instead of blocking generation.

```mermaid
flowchart TD
    A["Prompt or source bundle"] --> B["Intent contract"]
    B --> C["Research planner"]
    C --> D["Trusted evidence bundle"]
    D --> E["Deck scaffold and content generation"]
    E --> F["Usable first deck returned early"]
    F --> G["Progressive enrichment"]
    G --> H["Narration"]
    G --> I["Illustrations"]
    G --> J["QA and review"]
    F --> K["Fast interactive runtime"]
    K --> L["Speech-to-text"]
    K --> M["Question answering"]
    K --> N["Text-to-speech"]
```

### What this means in practice

- The current system is already architected around provider boundaries and grounded generation.
- The target system keeps that architecture, but moves toward fewer retries, less repair, earlier first render, and much faster interaction.
- This is the path to a demo-worthy product: good presentations in a reasonable time, then fast question answering on top.

## Current status

Implemented now:

- topic to internal deck JSON
- web presenter runtime
- per-slide narration generation
- segmented narration with per-slide progress tracking
- text-based conversational interruption flow
- browser-native speech recognition when available, with backend audio upload as fallback
- browser playback through a backend TTS provider for narration points and answers
- real local TTS through the macOS system voice backend
- structured visual slides with layouts, cards, callouts, flow blocks, and local illustration slots
- provider-driven slide illustration pipeline with mock-local rendering and hosted web-image lookup
- session state machine and narration-aware resume planning
- automatic web-grounded deck generation for time-sensitive topics when hosted research is enabled
- LM Studio integration behind an `LLMProvider`
- explicit external web research API and UI panel
- file-based persistence for decks, sessions, and transcripts

Not implemented yet:

- realtime voice runtime
- document and PPTX ingestion
- visual slide analysis
- provenance-aware runtime use of external research
- real backend STT provider beyond browser-native recognition and the mock server adapter

## Product principles

- provider interfaces first
- no vendor logic in core orchestration
- internal deck JSON is the source of truth
- simple, testable modules over clever but fragile abstractions
- explicit state transitions
- explicit provenance when external knowledge is used

## Current-topic grounding

Deck generation is topic-only by default, but time-sensitive topics can be
web-grounded automatically before the LLM builds the deck.

- examples: `latest`, `current`, `today`, `recent`, year-based topics like `2026`
- hosted web research runs first
- its summary and source URLs are passed into deck generation as grounding
- resulting decks should use `source.type = "mixed"` with external `sourceIds`

If hosted web research is not enabled, the API now fails fast for topics that
look time-sensitive instead of silently pretending the model has fresh facts.

## Architecture

```text
apps/
  api/        HTTP API, provider wiring, session orchestration
  web/        Next.js UI for generation, presenting, and debugging

packages/
  core/       state machine, planners, conversation runtime, resume logic
  providers/  LLM, web research, storage, export, mock speech/vision adapters
  types/      domain models, zod schemas, provider contracts
  ui/         shared UI components
```

Core product IP lives in `packages/core`.
Stable contracts live in `packages/types`.

This is what keeps migrations cheap:

- LM Studio now, vLLM later
- local speech stack now, hosted speech later
- file storage now, SQLite/Postgres later

without changing the teaching runtime itself.

## Conversation-first runtime

The runtime is designed so learner input is treated as conversation first, command second.

A user turn can produce:

- a natural assistant response
- inferred learner needs such as confusion, example, deepen, repeat
- runtime effects such as pause, back, restart slide, adapt detail level
- a resume plan

That lets turns like:

`I do not get why the processing step matters here`

behave like a real teaching interruption instead of a hardcoded button command.

## Provider model

Main interfaces live in [`packages/types/src/providers.ts`](packages/types/src/providers.ts).

Key interfaces:

- `LLMProvider`
- `VisionProvider`
- `SpeechToTextProvider`
- `TextToSpeechProvider`
- `VoiceActivityProvider`
- `WebResearchProvider`
- `DeckExporter`
- `DeckIngestionProvider`
- `DeckRepository`
- `SessionRepository`
- `TranscriptRepository`

Main domain models live in [`packages/types/src/domain.ts`](packages/types/src/domain.ts).

Key models:

- `Deck`
- `Slide`
- `SlideNarration`
- `Session`
- `UserInterruption`
- `ResumePlan`
- `PedagogicalProfile`
- `TranscriptTurn`

## Web research

Web augmentation is implemented as an explicit capability, not a hidden side effect.

Available endpoints:

- `GET /api/research/health`
- `POST /api/research/query`
- `POST /api/research/fetch`

Current behavior:

- search for external sources
- fetch selected pages
- summarize findings
- keep this separate from deck-grounded teaching

This is deliberate. The runtime should know when it is using:

- deck-grounded knowledge
- document-grounded knowledge
- externally augmented knowledge

instead of blending them invisibly.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Copy environment defaults if needed:

```bash
cp .env.example .env
```

3. Start the app:

```bash
npm run dev
```

4. Open:

- web: [http://localhost:3000](http://localhost:3000)
- api: [http://localhost:4000](http://localhost:4000)

## Stable local ports

Use fixed ports during development:

- web: `3000`
- api: `4000`
- LM Studio: `1234`

For a fixed-port API smoke test:

```bash
npm run verify:api
```

## LM Studio

LM Studio is supported as an OpenAI-compatible backend, but it is not treated as the center of the architecture.

Example config:

```bash
LLM_PROVIDER=lmstudio
ILLUSTRATION_PROVIDER=mock
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
LMSTUDIO_MODEL=your-loaded-model
LLM_TIMEOUT_MS=180000
LLM_FALLBACK_TO_MOCK_ON_ERROR=false
```

The LM Studio adapter lives in [`packages/providers/src/llm/lmstudio-llm-provider.ts`](packages/providers/src/llm/lmstudio-llm-provider.ts).

## Web research provider

The project supports both mock and hosted web research providers.

Example config:

```bash
WEB_RESEARCH_PROVIDER=mock
WEB_RESEARCH_TIMEOUT_MS=15000
```

or

```bash
WEB_RESEARCH_PROVIDER=hosted
WEB_RESEARCH_TIMEOUT_MS=15000
```

## Testing

Useful commands:

```bash
npm run typecheck
npm test
npm run build --workspace @slidespeech/web
npm run verify:api
```

## Roadmap

### Next

- document and PPTX ingestion
- real backend STT provider

### After that

- provenance-aware runtime use of external research
- stronger pedagogy engine
- visual slide analysis

## Recommended files to read first

- [`docs/architecture-plan.md`](docs/architecture-plan.md)
- [`packages/core/src/session-service.ts`](packages/core/src/session-service.ts)
- [`packages/core/src/conversation-turn-engine.ts`](packages/core/src/conversation-turn-engine.ts)
- [`packages/core/src/resume-planner.ts`](packages/core/src/resume-planner.ts)
- [`apps/api/src/server.ts`](apps/api/src/server.ts)
- [`apps/web/components/presentation-workbench.tsx`](apps/web/components/presentation-workbench.tsx)

## License

No license has been added yet.
