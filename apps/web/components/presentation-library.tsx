"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ListSavedPresentationsResponse, SavedPresentationSummary } from "@slidespeech/types";

import { deleteSavedPresentation, listSavedPresentations } from "../lib/api";

const PAGE_SIZE = 12;

const formatTimestamp = (value: string): string => {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const readinessLabel = (item: SavedPresentationSummary): string => {
  if (item.ready) {
    return "Ready";
  }

  const generation = item.generation;
  if (!generation) {
    return "Unknown";
  }

  return `${generation.narrationReadySlides}/${generation.totalSlides} ready`;
};

const qualityLabel = (
  item: SavedPresentationSummary,
): { text: string; tone: "good" | "warning" | "bad" | "neutral" } => {
  const score = item.evaluation?.overallScore ?? item.validation?.overallScore;
  const failChecks =
    item.evaluation?.checks.filter((check) => check.status === "fail").length ?? 0;
  const severeValidationIssues =
    item.validation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const hasCriticalValidationSignal =
    item.validation?.issues.some((issue) =>
      ["DECK_INCOHERENCE", "GROUNDING_MISMATCH", "VISUAL_TEXT_MISMATCH"].includes(
        issue.code,
      ),
    ) ?? false;

  if (hasCriticalValidationSignal || failChecks > 0 || severeValidationIssues > 0) {
    return {
      text: score !== undefined ? `${Math.round(score * 100)}% · flagged` : "Flagged",
      tone: "bad",
    };
  }

  if (score !== undefined) {
    return {
      text: `${Math.round(score * 100)}%`,
      tone: score >= 0.82 ? "good" : score >= 0.68 ? "warning" : "bad",
    };
  }

  return { text: "Unknown", tone: "neutral" };
};

export const PresentationLibrary = () => {
  const [items, setItems] = useState<SavedPresentationSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const loadPage = async (nextOffset: number, replace = false) => {
    setError(null);
    setIsLoading(true);

    try {
      const result: ListSavedPresentationsResponse = await listSavedPresentations({
        limit: PAGE_SIZE,
        offset: nextOffset,
        readyOnly: true,
      });

      setItems((previous) =>
        replace ? result.items : [...previous, ...result.items],
      );
      setOffset(result.offset + result.items.length);
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPage(0, true);
  }, []);

  const emptyState = useMemo(
    () => !isLoading && items.length === 0 && !error,
    [error, isLoading, items.length],
  );

  const handleDelete = async (sessionId: string) => {
    setDeletingSessionId(sessionId);
    setError(null);

    try {
      await deleteSavedPresentation(sessionId);
      setItems((previous) => previous.filter((item) => item.sessionId !== sessionId));
      setTotal((previous) => Math.max(previous - 1, 0));
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingSessionId(null);
    }
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
                Ready presentations
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                Browse presentations that finished background enrichment and are ready to open directly in presenter mode.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                href="/"
              >
                Back to launchpad
              </Link>
              <Link
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white"
                href="/workbench"
              >
                Open workbench
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-8 rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)] md:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                Library
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                Fully prepared sessions
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Showing only sessions where all narration finished. Delete poor runs directly here.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
              {total} ready presentation{total === 1 ? "" : "s"}
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
              {error}
            </div>
          ) : null}

          {emptyState ? (
            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
              <p className="text-lg font-semibold text-slate-900">
                No ready presentations yet.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Generate a presentation and let background enrichment finish before it appears here.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const quality = qualityLabel(item);

                return (
                  <article
                    className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.04)]"
                    key={item.sessionId}
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {item.sourceType}
                      </p>
                      <h3 className="mt-2 line-clamp-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">
                        {item.title}
                      </h3>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      {readinessLabel(item)}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                    {item.summary}
                  </p>

                  <dl className="mt-4 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <dt>Slides</dt>
                      <dd className="font-semibold text-slate-800">{item.slideCount}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Updated</dt>
                      <dd className="text-right font-semibold text-slate-800">
                        {formatTimestamp(item.updatedAt)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Quality</dt>
                      <dd
                        className={`font-semibold ${
                          quality.tone === "bad"
                            ? "text-rose-700"
                            : quality.tone === "warning"
                              ? "text-amber-700"
                              : quality.tone === "good"
                                ? "text-emerald-700"
                                : "text-slate-800"
                        }`}
                      >
                        {quality.text}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:bg-coral/90"
                      href={`/present/${item.sessionId}`}
                    >
                      Open presenter
                    </Link>
                    <button
                      className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={deletingSessionId === item.sessionId}
                      onClick={() => void handleDelete(item.sessionId)}
                      type="button"
                    >
                      {deletingSessionId === item.sessionId ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  </article>
                );
              })}
            </div>
          )}

          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <button
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                onClick={() => void loadPage(offset, false)}
                type="button"
              >
                {isLoading ? "Loading..." : "Load more"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
};
