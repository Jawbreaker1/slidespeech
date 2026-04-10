# SlideSpeech MVP Architecture Plan

## Product framing

The MVP is an orchestrated teaching runtime, not a slide generator. Phase 1 keeps the runtime text-first while locking in the abstractions needed for later speech, multimodal slide analysis, and provider migration.

## Repo structure

```text
apps/
  api/      # HTTP API, orchestration wiring, provider selection
  web/      # Next.js presenter/runtime UI

packages/
  core/     # session logic, planners, classifier, state transitions
  providers/# provider adapters and repository implementations
  types/    # domain models, zod schemas, provider contracts
  ui/       # shared React presentation widgets

data/
  decks/
  sessions/
  transcripts/

docs/
  architecture-plan.md

tests/
  interrupt-classifier.test.ts
  state-machine.test.ts
```

## Architectural decisions

1. `packages/types` owns the stable boundary.
   All providers, repositories, deck/session models, and API payloads are declared here.

2. `packages/core` owns product IP.
   Presentation planning, narration orchestration, interrupt classification, resume planning, and state transitions stay provider-agnostic.

3. `packages/providers` owns replaceable adapters.
   LM Studio, mock speech, file storage, topic ingestion, and PPTX export live here without leaking vendor details into core.

4. `apps/api` only wires modules together.
   The API selects providers from env, exposes generation endpoints, persists sessions/decks, and becomes the future event hub for richer runtime behaviour.

5. `apps/web` stays thin.
   The UI renders the runtime, drives controls, and visualizes the deck JSON without reimplementing domain logic.

## Phase 1 implementation scope

- Topic input only
- JSON deck generation
- Slide narration generation
- Text-based presenter runtime
- Mock providers by default
- LM Studio available behind the `LLMProvider` interface
- File-based persistence

## Migration path

- Step 1: `LMStudioLLMProvider` via OpenAI-compatible HTTP.
- Step 2: swap to `OpenAICompatibleLLMProvider` against vLLM or another local server.
- Step 3: swap individual speech/vision providers independently.
- No core planner/session logic changes should be required.

