"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type {
  GeneratePresentationResponse,
  SelectSlideResponse,
  SessionSnapshotResponse,
  SessionInteractionResponse as SessionInteractionPayload,
  TranscriptTurn,
  SlideNarration,
  WebResearchQueryResponse,
} from "@slidespeech/types";
import { DebugPanel, PresenterControls, SlidePreviewCard } from "@slidespeech/ui";

import {
  fetchExamplePresentation,
  fetchSessionSnapshot,
  fetchSlideNarration,
  queryExternalResearch,
  generatePresentation,
  interactWithSession,
  selectSlide,
} from "../lib/api";

const sampleTopics = [
  "How retrieval augmented generation works",
  "What a state machine is and why it helps AI runtimes",
  "Vector database fundamentals",
];

const getNarration = (
  response: GeneratePresentationResponse | null,
  slideId?: string,
): SlideNarration | undefined =>
  slideId
    ? response?.narrations.find((narration) => narration.slideId === slideId)
    : undefined;

const mergeResponse = (
  previous: GeneratePresentationResponse | null,
  next:
    | GeneratePresentationResponse
    | SelectSlideResponse
    | SessionSnapshotResponse
    | SessionInteractionPayload,
): GeneratePresentationResponse => {
  const previousNarrations = previous?.narrations ?? [];
  const nextNarrations =
    "narrations" in next
      ? next.narrations
      : next.narration
        ? [next.narration]
        : [];

  const narrationMap = new Map<string, SlideNarration>();

  for (const narration of previousNarrations) {
    narrationMap.set(narration.slideId, narration);
  }

  for (const narration of nextNarrations) {
    narrationMap.set(narration.slideId, narration);
  }

  const nextNarrationBySlideId = {
    ...(previous?.session.narrationBySlideId ?? {}),
    ...next.session.narrationBySlideId,
  };

  for (const narration of nextNarrations) {
    nextNarrationBySlideId[narration.slideId] = narration;
  }

  return {
    deck: next.deck,
    session: {
      ...next.session,
      narrationBySlideId: nextNarrationBySlideId,
    },
    narrations: [...narrationMap.values()],
    provider: next.provider,
  };
};

const toInteractionLog = (
  transcripts: TranscriptTurn[],
): Array<{ role: "user" | "assistant"; text: string }> =>
  transcripts
    .filter(
      (turn): turn is TranscriptTurn & { role: "user" | "assistant" } =>
        turn.role === "user" || turn.role === "assistant",
    )
    .map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

export const PresentationWorkbench = () => {
  const [topic, setTopic] = useState<string>(
    sampleTopics[1] ?? sampleTopics[0] ?? "How an AI tutor works",
  );
  const [response, setResponse] = useState<GeneratePresentationResponse | null>(
    null,
  );
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [commandInput, setCommandInput] = useState("");
  const [interactionLog, setInteractionLog] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [narrationLoadingSlideId, setNarrationLoadingSlideId] = useState<
    string | null
  >(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [selectingSlideId, setSelectingSlideId] = useState<string | null>(null);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [lastTurnDecision, setLastTurnDecision] = useState<
    SessionInteractionPayload["turnDecision"] | null
  >(null);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchResult, setResearchResult] =
    useState<WebResearchQueryResponse | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      try {
        setError(null);
        setIsGeneratingDeck(true);
        const example = await fetchExamplePresentation();
        setResponse(example);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsGeneratingDeck(false);
      }
    });
  }, []);

  const slides = response?.deck.slides ?? [];
  const activeSlide = slides[currentSlideIndex];
  const narration = getNarration(response, activeSlide?.id);
  const sessionState = response?.session.state ?? "idle";
  const isPresenting = sessionState === "presenting" || sessionState === "resuming";

  useEffect(() => {
    if (response) {
      setCurrentSlideIndex(response.session.currentSlideIndex);
    }
  }, [response?.session.currentSlideIndex]);

  useEffect(() => {
    const sessionId = response?.session.id;

    if (!sessionId) {
      return;
    }

    let cancelled = false;
    setIsRefreshingSession(true);

    fetchSessionSnapshot(sessionId)
      .then((snapshot: SessionSnapshotResponse) => {
        if (cancelled) {
          return;
        }

        setResponse((previous) => mergeResponse(previous, snapshot));
        setInteractionLog(toInteractionLog(snapshot.transcripts));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [response?.session.id, response?.session.transcriptTurnIds.length]);

  useEffect(() => {
    if (
      !response ||
      !activeSlide ||
      narration ||
      narrationLoadingSlideId === activeSlide.id
    ) {
      return;
    }

    let cancelled = false;

    setNarrationLoadingSlideId(activeSlide.id);

    fetchSlideNarration(response.session.id, activeSlide.id)
      .then((nextNarration) => {
        if (cancelled) {
          return;
        }

        setResponse((previous) => {
          if (!previous) {
            return previous;
          }

          const alreadyPresent = previous.narrations.some(
            (candidate) => candidate.slideId === nextNarration.slideId,
          );

          return {
            ...previous,
            narrations: alreadyPresent
              ? previous.narrations.map((candidate) =>
                  candidate.slideId === nextNarration.slideId
                    ? nextNarration
                    : candidate,
                )
              : [...previous.narrations, nextNarration],
            session: {
              ...previous.session,
              narrationBySlideId: {
                ...previous.session.narrationBySlideId,
                [nextNarration.slideId]: nextNarration,
              },
            },
          };
        });
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNarrationLoadingSlideId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSlide, narration, narrationLoadingSlideId, response]);

  const transcriptItems = useMemo(
    () =>
      activeSlide
        ? [
            {
              label: "Current teaching goal",
              value: activeSlide.learningGoal,
            },
            {
              label: "Speaker note",
              value:
                activeSlide.speakerNotes[0] ??
                "No speaker note stored for this slide yet.",
            },
            {
              label: "Suggested pause prompt",
              value:
                narrationLoadingSlideId === activeSlide.id
                  ? "Generating narration for this slide..."
                  : narration?.promptsForPauses[0] ??
                    "No pause prompt generated yet.",
            },
          ]
        : [],
    [activeSlide, narration, narrationLoadingSlideId],
  );

  const submitTopic = () => {
    startTransition(async () => {
      try {
        setError(null);
        setCurrentSlideIndex(0);
        setNarrationLoadingSlideId(null);
        setIsGeneratingDeck(true);
        const nextResponse = await generatePresentation(topic);
        setResponse(nextResponse);
      } catch (submitError) {
        setError((submitError as Error).message);
      } finally {
        setIsGeneratingDeck(false);
      }
    });
  };

  const handleSelectSlide = (slideIndex: number) => {
    const targetSlide = slides[slideIndex];
    const sessionId = response?.session.id;

    if (!targetSlide || !sessionId) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setSelectingSlideId(targetSlide.id);
        const result = await selectSlide(sessionId, targetSlide.id);
        setResponse((previous) => mergeResponse(previous, result));
        setCurrentSlideIndex(result.session.currentSlideIndex);
      } catch (selectionError) {
        setError((selectionError as Error).message);
      } finally {
        setSelectingSlideId(null);
      }
    });
  };

  const sendInteraction = (text: string) => {
    const sessionId = response?.session.id;

    if (!sessionId || !text.trim()) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsInteracting(true);
        const result = await interactWithSession(sessionId, text.trim());
        setResponse((previous) => mergeResponse(previous, result));
        setCurrentSlideIndex(result.session.currentSlideIndex);
        setLastTurnDecision(result.turnDecision);
        setCommandInput("");
      } catch (interactionError) {
        setError((interactionError as Error).message);
      } finally {
        setIsInteracting(false);
      }
    });
  };

  const runResearch = () => {
    if (!researchQuery.trim()) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsResearching(true);
        const result = await queryExternalResearch(researchQuery.trim());
        setResearchResult(result);
      } catch (researchError) {
        setError((researchError as Error).message);
      } finally {
        setIsResearching(false);
      }
    });
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white/85 p-6 shadow-panel backdrop-blur md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-teal">
                SlideSpeech MVP / Phase 2
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-ink md:text-4xl">
                Interactive AI presenter with a modular orchestration layer
              </h1>
              <p className="mt-4 max-w-2xl font-body text-base leading-7 text-slate-700">
                Text first, voice later. Decks are generated through a
                replaceable LLM provider interface and presented in a simple
                  runtime with slides, narration, conversation turns, and debug
                  visibility.
              </p>
            </div>
            <div className="rounded-[24px] bg-ink px-4 py-3 text-paper lg:min-w-52">
              <p className="text-xs uppercase tracking-[0.22em] text-paper/60">
                Active provider
              </p>
              <p className="mt-1 break-all text-base font-semibold md:text-lg">
                {response?.provider ?? "loading"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-[22px] border border-slate-200 bg-paper px-4 py-4 md:px-5">
              <label
                className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500"
                htmlFor="topic"
              >
                Topic or teaching prompt
              </label>
              <textarea
                id="topic"
                className="mt-3 min-h-24 w-full resize-none bg-transparent text-base leading-7 text-ink outline-none"
                onChange={(event) => setTopic(event.target.value)}
                value={topic}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {sampleTopics.map((sampleTopic) => (
                  <button
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-ink hover:text-ink"
                    key={sampleTopic}
                    onClick={() => setTopic(sampleTopic)}
                    type="button"
                  >
                    {sampleTopic}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="rounded-[22px] bg-coral px-5 py-3 text-base font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isPending || isGeneratingDeck}
              onClick={submitTopic}
              type="button"
            >
              {isGeneratingDeck ? "Generating deck..." : "Generate deck"}
            </button>
          </div>

          {isGeneratingDeck ? (
            <div className="mt-5 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Generating a deck with a local model. This can take 1 to 3
              minutes depending on the model and hardware.
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {activeSlide ? (
            <section className="mt-6 rounded-[30px] bg-ink p-5 text-paper md:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-paper/60">
                    Presenter View
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold md:text-3xl">
                    {activeSlide.title}
                  </h2>
                  <p className="mt-4 max-w-3xl font-body text-base leading-7 text-paper/90 md:text-lg">
                    {narrationLoadingSlideId === activeSlide.id
                      ? "Generating narration for this slide..."
                      : narration?.narration ?? activeSlide.beginnerExplanation}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {activeSlide.keyPoints.map((point) => (
                      <span
                        className="rounded-full border border-paper/20 px-3 py-1.5 text-xs text-paper/80 md:text-sm"
                        key={point}
                      >
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="w-full rounded-[22px] bg-white/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/60">
                    Runtime status
                  </p>
                  <div className="mt-4 space-y-3 text-sm text-paper/85">
                    <div className="flex items-center justify-between">
                      <span>Session state</span>
                      <span className="font-semibold">
                        {sessionState}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Current slide</span>
                      <span className="font-semibold">
                        {currentSlideIndex + 1} / {slides.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Mode</span>
                      <span className="font-semibold">
                        {isPresenting ? "Presenting" : "Paused"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Generation</span>
                      <span className="font-semibold">
                        {isGeneratingDeck
                          ? "Deck generation"
                          : isRefreshingSession
                            ? "Session sync"
                          : narrationLoadingSlideId === activeSlide?.id
                            ? "Narration loading"
                            : "Idle"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <PresenterControls
                  canGoBack={currentSlideIndex > 0}
                  canGoForward={currentSlideIndex < slides.length - 1}
                  isPresenting={isPresenting}
                  onBack={() => handleSelectSlide(Math.max(currentSlideIndex - 1, 0))}
                  onForward={() =>
                    handleSelectSlide(
                      Math.min(currentSlideIndex + 1, slides.length - 1),
                    )
                  }
                  onTogglePresenting={() =>
                    sendInteraction(isPresenting ? "stop" : "continue")
                  }
                />
              </div>
            </section>
          ) : null}
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <DebugPanel title="Conversation">
            <div className="space-y-4">
              <div className="rounded-[18px] border border-slate-200 bg-paper px-4 py-4">
                <label
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                  htmlFor="session-command"
                >
                  Talk naturally about this presentation
                </label>
                <textarea
                  id="session-command"
                  className="mt-3 min-h-24 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none"
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder="Ask a question, say what is unclear, request an example, or just continue the conversation."
                  value={commandInput}
                />
                <button
                  className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!response || !commandInput.trim() || isInteracting}
                  onClick={() => sendInteraction(commandInput)}
                  type="button"
                >
                  {isInteracting ? "Sending..." : "Send"}
                </button>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Shortcut actions
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "stop",
                    "continue",
                    "back",
                    "explain simpler",
                    "give example",
                    "go deeper",
                    "repeat",
                  ].map((command) => (
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!response || isInteracting}
                      key={command}
                      onClick={() =>
                        sendInteraction(
                          command === "go deeper" ? "deepen" : command,
                        )
                      }
                      type="button"
                    >
                      {command}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </DebugPanel>

          <DebugPanel title="Session Runtime">
            <div className="space-y-4">
              {transcriptItems.map((item) => (
                <div
                  className="rounded-[22px] bg-paper px-4 py-3"
                  key={item.label}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                    {item.value}
                  </p>
                </div>
              ))}
              {lastTurnDecision ? (
                <div className="rounded-[22px] bg-paper px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Last turn interpretation
                  </p>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                    <p>
                      <span className="font-semibold text-ink">Mode:</span>{" "}
                      {lastTurnDecision.responseMode}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Needs:</span>{" "}
                      {lastTurnDecision.inferredNeeds.join(", ") || "none"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Effects:</span>{" "}
                      {Object.entries(lastTurnDecision.runtimeEffects).length > 0
                        ? Object.entries(lastTurnDecision.runtimeEffects)
                            .map(([key, value]) => `${key}=${String(value)}`)
                            .join(", ")
                        : "none"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </DebugPanel>

          <DebugPanel title="Interaction Log">
            <div className="max-h-[280px] space-y-3 overflow-auto">
              {interactionLog.length === 0 ? (
                <p className="font-body text-sm leading-6 text-slate-700">
                  No interaction yet.
                </p>
              ) : (
                interactionLog.map((entry, index) => (
                  <div
                    className={`rounded-[18px] px-4 py-3 text-sm leading-6 ${
                      entry.role === "assistant"
                        ? "bg-paper text-slate-700"
                        : "bg-slate-100 text-ink"
                    }`}
                    key={`${entry.role}-${index}`}
                  >
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {entry.role}
                    </p>
                    <p className="font-body">{entry.text}</p>
                  </div>
                ))
              )}
            </div>
          </DebugPanel>

          <DebugPanel title="External Research">
            <div className="space-y-4">
              <div className="rounded-[18px] border border-slate-200 bg-paper px-4 py-4">
                <label
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                  htmlFor="research-query"
                >
                  Search the web explicitly
                </label>
                <textarea
                  id="research-query"
                  className="mt-3 min-h-20 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none"
                  onChange={(event) => setResearchQuery(event.target.value)}
                  placeholder="Use this when the deck is not enough and you want external sources."
                  value={researchQuery}
                />
                <button
                  className="mt-3 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isResearching || !researchQuery.trim()}
                  onClick={runResearch}
                  type="button"
                >
                  {isResearching ? "Researching..." : "Run web research"}
                </button>
              </div>

              {researchResult ? (
                <div className="space-y-3">
                  <div className="rounded-[18px] bg-paper px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Summary
                    </p>
                    <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                      {researchResult.summary}
                    </p>
                  </div>
                  <div className="max-h-[260px] space-y-3 overflow-auto">
                    {researchResult.results.map((result) => (
                      <div
                        className="rounded-[18px] bg-paper px-4 py-3"
                        key={result.url}
                      >
                        <p className="text-sm font-semibold text-ink">
                          {result.title}
                        </p>
                        <p className="mt-1 break-all text-xs text-slate-500">
                          {result.url}
                        </p>
                        <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                          {result.snippet}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="font-body text-sm leading-6 text-slate-700">
                  External research is separate from deck-grounded teaching. Use
                  it explicitly when you want outside sources.
                </p>
              )}
            </div>
          </DebugPanel>

          <DebugPanel title="Deck JSON">
            <pre className="max-h-[360px] overflow-auto rounded-[18px] bg-slate-950 p-4 text-xs leading-5 text-emerald-300">
              {JSON.stringify(response?.deck ?? {}, null, 2)}
            </pre>
          </DebugPanel>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-semibold text-ink">Generated slides</h2>
          <p className="text-sm text-slate-600">
            Internal deck JSON is the source of truth.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {slides.map((slide, index) => (
            <button
              className="min-w-0 text-left disabled:opacity-70"
              disabled={selectingSlideId === slide.id}
              key={slide.id}
              onClick={() => handleSelectSlide(index)}
              type="button"
            >
              <SlidePreviewCard
                isActive={index === currentSlideIndex}
                slide={slide}
              />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
};
