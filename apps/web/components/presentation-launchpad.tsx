"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { PresentationGenerationJobStatusResponse } from "@slidespeech/types";

import {
  enqueuePresentationGeneration,
  fetchPresentationGenerationJobStatus,
} from "../lib/api";

const suggestedTopics = [
  "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
  "Explain how an interruption-aware AI teacher works",
  "Teach the basics of retrieval augmented generation",
];

const statusMessages = [
  "Planning the presentation structure",
  "Gathering and grounding source material",
  "Generating slides and teaching flow",
  "Preparing presenter mode",
];

const lengthPresets = [
  {
    id: "short",
    label: "Short",
    durationMinutes: 3,
    slideCount: 4,
    description: "About 3 minutes",
  },
  {
    id: "medium",
    label: "Medium",
    durationMinutes: 5,
    slideCount: 7,
    description: "About 5 minutes",
  },
  {
    id: "long",
    label: "Long",
    durationMinutes: 8,
    slideCount: 10,
    description: "About 8 minutes",
  },
] as const;

export const PresentationLaunchpad = () => {
  const router = useRouter();
  const [topic, setTopic] = useState(suggestedTopics[0] ?? "");
  const [forceWebResearch, setForceWebResearch] = useState(false);
  const [selectedLengthId, setSelectedLengthId] = useState<
    (typeof lengthPresets)[number]["id"]
  >("medium");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [generationJob, setGenerationJob] =
    useState<PresentationGenerationJobStatusResponse | null>(null);

  const isGenerating = generationJob?.status === "generating";
  const isQueued = generationJob?.status === "queued";
  const isWaitingForGeneration = isGenerating || isQueued;

  useEffect(() => {
    if (!isWaitingForGeneration || startedAt === null) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isWaitingForGeneration, startedAt]);

  const statusMessage = useMemo(() => {
    if (!generationJob) {
      return null;
    }

    if (generationJob.status === "queued") {
      return generationJob.jobsAhead <= 1
        ? "Queued behind the current generation"
        : `Queued behind ${generationJob.jobsAhead} presentation${generationJob.jobsAhead === 1 ? "" : "s"}`;
    }

    return statusMessages[Math.min(Math.floor(elapsedSeconds / 12), statusMessages.length - 1)];
  }, [elapsedSeconds, generationJob]);

  useEffect(() => {
    if (!generationJob || generationJob.status === "completed" || generationJob.status === "failed") {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const nextStatus = await fetchPresentationGenerationJobStatus(generationJob.jobId);

        if (!cancelled) {
          setGenerationJob(nextStatus);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError((pollError as Error).message);
          setGenerationJob(null);
          setStartedAt(null);
        }
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationJob]);

  useEffect(() => {
    if (!generationJob) {
      return;
    }

    if (generationJob.status === "completed" && generationJob.sessionId) {
      setStartedAt(null);
      router.push(`/present/${generationJob.sessionId}`);
      return;
    }

    if (generationJob.status === "failed") {
      setError(generationJob.error ?? "Presentation generation failed.");
      setGenerationJob(null);
      setStartedAt(null);
    }
  }, [generationJob, router]);

  const selectedLength =
    lengthPresets.find((preset) => preset.id === selectedLengthId) ??
    lengthPresets[1];

  const handleGenerate = () => {
    if (!topic.trim()) {
      return;
    }

    void (async () => {
      try {
        setError(null);
        setStartedAt(Date.now());
        const result = await enqueuePresentationGeneration(topic.trim(), {
          useWebResearch: forceWebResearch,
          targetDurationMinutes: selectedLength.durationMinutes,
          targetSlideCount: selectedLength.slideCount,
        });
        setGenerationJob(result);
      } catch (generationError) {
        setError((generationError as Error).message);
        setGenerationJob(null);
        setStartedAt(null);
      }
    })();
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f5ef_0%,#f0ede6_100%)] px-6 py-8 text-slate-900 md:px-10 lg:px-14">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-[32px] border border-slate-200 bg-white/80 px-6 py-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                SlideSpeech
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-slate-950 md:text-5xl">
                Build an interactive presentation, then run it live.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                Start with a topic or a grounded company brief. The system generates a
                pedagogical deck, opens presenter mode, and lets you talk naturally
                during the presentation.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                href="/library"
              >
                Ready presentations
              </Link>
              <Link
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                href="/workbench"
              >
                Open workbench
              </Link>
              <a
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                href="http://localhost:4000/api/presentations/health"
                rel="noreferrer"
                target="_blank"
              >
                API health
              </a>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] md:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              1. Describe the presentation
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
              Topic or source-aware prompt
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Include a URL when you want the deck grounded in current external information.
              For company presentations and current topics, web grounding should be the default.
            </p>

            <textarea
              className="mt-5 min-h-[210px] w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-base leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-coral focus:bg-white"
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Create a presentation about our company. Use https://example.com as the main source."
              value={topic}
            />

            <div className="mt-4 flex flex-wrap gap-2">
              {suggestedTopics.map((suggestion) => (
                <button
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-coral hover:text-slate-900"
                  key={suggestion}
                  onClick={() => setTopic(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <input
                checked={forceWebResearch}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-coral focus:ring-coral"
                onChange={(event) => setForceWebResearch(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  Force web research
                </span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">
                  Use this when the topic depends on current facts even if the wording is not obviously time-sensitive.
                </span>
              </span>
            </label>

            <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-800">
                Presentation length
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Choose the target duration. The generator uses this to steer both
                slide count and presentation scope.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {lengthPresets.map((preset) => {
                  const selected = preset.id === selectedLengthId;

                  return (
                    <button
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        selected
                          ? "border-coral bg-coral text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-coral hover:text-slate-900"
                      }`}
                      key={preset.id}
                      onClick={() => setSelectedLengthId(preset.id)}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Target: about {selectedLength.durationMinutes} minutes and roughly{" "}
                {selectedLength.slideCount} slides.
              </p>
            </div>

            {error ? (
              <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                {error}
              </div>
            ) : null}

            {isWaitingForGeneration ? (
              <div className="mt-4 rounded-[24px] border border-coral/30 bg-coral/10 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-coral/25 border-t-coral" />
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-coral">
                    {isQueued ? "Queued for generation" : "Generating deck"}
                  </p>
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {statusMessage}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {isQueued
                    ? "Only one heavy generation runs at a time in this demo. The page keeps polling until your turn starts."
                    : "Local models can take several minutes. When generation completes, the app opens presenter mode automatically."}
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-coral transition-[width]"
                    style={{
                      width: isQueued
                        ? `${Math.min(36, 14 + elapsedSeconds * 0.35)}%`
                        : `${Math.min(92, 18 + elapsedSeconds * 1.6)}%`,
                    }}
                  />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  {elapsedSeconds}s elapsed
                  {isQueued && generationJob?.queuePosition
                    ? ` · queue position ${generationJob.queuePosition}`
                    : ""}
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-full bg-coral px-6 py-3 text-sm font-semibold text-white transition hover:bg-coral/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isWaitingForGeneration || !topic.trim()}
                onClick={handleGenerate}
                type="button"
              >
                {isQueued ? "Queued..." : isGenerating ? "Generating..." : "Generate presentation"}
              </button>
              <Link
                className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                href="/workbench"
              >
                Advanced builder
              </Link>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-[32px] border border-slate-200 bg-slate-950 px-6 py-6 text-white shadow-[0_20px_60px_rgba(15,23,42,0.16)] md:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">
                2. Run the session
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                Presenter mode is the real product surface
              </h2>
              <div className="mt-5 space-y-3 text-sm leading-6 text-white/70">
                <p>Generate the deck here.</p>
                <p>Open presenter mode automatically.</p>
                <p>Listen to narration, interrupt with questions, and resume from the right point.</p>
              </div>
            </section>

            <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] md:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Input modes
              </p>
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <p className="text-sm font-semibold text-emerald-900">Topic / URL prompt</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-800">
                    Available now. Best for fast generation and web-grounded company decks.
                  </p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-800">Upload PowerPoint or document</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Not implemented yet. The architecture supports it, but ingestion is still the next major build step after STT.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
};
