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

## Current status

Implemented now:

- topic to internal deck JSON
- web presenter runtime
- per-slide narration generation
- text-based conversational interruption flow
- session state machine and resume planning
- LM Studio integration behind an `LLMProvider`
- explicit external web research API and UI panel
- file-based persistence for decks, sessions, and transcripts

Not implemented yet:

- realtime voice runtime
- document and PPTX ingestion
- visual slide analysis
- provenance-aware runtime use of external research
- narration-position resume within a slide

## Product principles

- provider interfaces first
- no vendor logic in core orchestration
- internal deck JSON is the source of truth
- simple, testable modules over clever but fragile abstractions
- explicit state transitions
- explicit provenance when external knowledge is used

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

- browser mic capture
- VAD and STT wiring
- narration-position resume
- TTS output

### After that

- document and PPTX ingestion
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
