"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { SLIDE_THEMES, PRESENTATION_THEME_IDS, type PresentationThemeId, type GenerationV2Job } from "@slidespeech/types";
import { cancelGenerationV2Job, getGenerationV2Job, startGenerationV2Job } from "../lib/generation-v2-jobs";
import { StudioOutline } from "./studio-outline";
import { StudioSlides } from "./studio-slides";
import { StudioHeader } from "./studio-header";
import styles from "./presentation-studio.module.css";
import { ThemePreview } from "./theme-preview";
import { GenerationProgressModal } from "./generation-progress-modal";
import { estimateLabel, generationStep } from "../lib/generation-progress";

export function PresentationStudio() {
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState("");
  const [duration, setDuration] = useState("");
  const [forceResearch, setForceResearch] = useState(false);
  const [theme, setTheme] = useState<PresentationThemeId | "">("");
  const [job, setJob] = useState<GenerationV2Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const [progressOpen, setProgressOpen] = useState(false);
  const statusRef = useRef<HTMLElement>(null);
  const queued = job?.status === "queued";
  const active = queued || job?.status === "running";
  const busy = submitting || active || restoring;
  const overrideCount = Number(slideCount !== "") + Number(duration !== "") + Number(forceResearch) + Number(theme !== "");

  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("run");
    if (!id) { setRestoring(false); return; }
    const controller = new AbortController();
    getGenerationV2Job(id, controller.signal).then((saved) => {
      setJob(saved);
      setProgressOpen(saved.status === "running" || saved.status === "queued");
      setTopic(saved.request.topic);
      setSlideCount(saved.request.targetSlideCount?.toString() ?? "");
      setDuration(saved.request.targetDurationMinutes?.toString() ?? "");
      setForceResearch(saved.request.useWebResearch === true);
      setTheme(saved.request.theme ?? "");
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not restore the run.");
    }).finally(() => { if (!controller.signal.aborted) setRestoring(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const id = job.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setConnectionError(null);
    const poll = async () => {
      try {
        const next = await getGenerationV2Job(id, controller.signal);
        if (controller.signal.aborted) return;
        setJob(next);
        if (next.status === "running" || next.status === "queued") timer = setTimeout(poll, 1500);
      } catch (cause) {
        if (!controller.signal.aborted) setConnectionError(cause instanceof Error ? cause.message : "Connection interrupted. The server may still be working.");
      }
    };
    timer = setTimeout(poll, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.status, reconnect]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSubmitting(true);
    setJob(null);
    setProgressOpen(true);
    setError(null);
    setConnectionError(null);
    try {
      const next = await startGenerationV2Job({
        topic: topic.trim(),
        ...(slideCount ? { targetSlideCount: Number(slideCount) } : {}),
        ...(duration ? { targetDurationMinutes: Number(duration) } : {}),
        ...(forceResearch ? { useWebResearch: true } : {}),
        ...(theme ? { theme } : {}),
      });
      setJob(next);
      const url = new URL(window.location.href);
      url.searchParams.delete("research");
      url.searchParams.set("run", next.id);
      url.hash = "";
      window.history.replaceState(null, "", url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start generation. Check the API connection.");
    } finally { setSubmitting(false); }
  }

  async function cancel() {
    if (!job || cancelling) return;
    setCancelling(true);
    try { setJob(await cancelGenerationV2Job(job.id)); setConnectionError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel. The server may still be working."); }
    finally { setCancelling(false); }
  }

  const lastEvent = job?.progress.at(-1);
  const currentLabel = generationStep(lastEvent?.stage)?.label ?? "Starting your presentation";
  const published = job?.status === "slides-ready" && Boolean(job.result.publication);
  return (
    <main className={styles.studio}>
      <StudioHeader current="studio" />
      <section className={styles.intro}>
        <div><h1>New presentation</h1><p className={styles.introCopy}>Describe your subject and add any sources. Review the slides, then present or download.</p></div>
      </section>
      <div className={styles.workspace}>
        <section className={styles.composer} aria-labelledby="brief-heading">
          <div className={styles.sectionHeading}><span className={styles.number}>01</span><h2 id="brief-heading">Presentation brief</h2></div>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <label className={styles.promptLabel} htmlFor="presentation-brief">What would you like to present?</label>
              <textarea id="presentation-brief" required minLength={3} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Tell us the topic, who it is for, and what you want them to take away. Add source URLs here, if you have them." rows={6} />
              <p className={styles.hint}>A subject is enough to start. Audience, purpose and sources make it more specific.</p>
              <details className={styles.advanced}>
                <summary><span>Advanced <span className={styles.override}>{overrideCount ? `${overrideCount} custom ${overrideCount === 1 ? "setting" : "settings"}` : "Style, length and research"}</span></span><span className={styles.plus} aria-hidden="true">+</span></summary>
                <div className={styles.settings}>
                  <fieldset className={styles.themePicker}>
                    <legend>Presentation style</legend>
                    <label className={styles.themeAutomatic}><input type="radio" name="theme" value="" checked={theme === ""} onChange={() => setTheme("")} />Let the agent choose for this story</label>
                    <div className={styles.themeChoices}>{PRESENTATION_THEME_IDS.map(id => {
                      const option = SLIDE_THEMES[id];
                      return <label key={id} className={styles.themeChoice}>
                        <input type="radio" name="theme" value={id} checked={theme === id} onChange={() => setTheme(id)} />
                        <span className={styles.themeSample}><ThemePreview theme={id} /></span>
                        <strong>{option.label}</strong><small>{option.description}</small>
                      </label>;
                    })}</div>
                  </fieldset>
                  <label>Target slides<input aria-label="Target slides" type="number" min={2} max={30} placeholder="Automatic" value={slideCount} onChange={(event) => setSlideCount(event.target.value)} /><small>Includes introduction and conclusion.</small></label>
                  <label>Speaking time<input aria-label="Speaking time in minutes" type="number" min={1} max={60} placeholder="Minutes, optional" value={duration} onChange={(event) => setDuration(event.target.value)} /><small>A planning target, not exact timing.</small></label>
                  <label className={styles.checkbox}><input type="checkbox" checked={forceResearch} onChange={(event) => setForceResearch(event.target.checked)} />Always research the web</label>
                  <button type="button" className={styles.textButton} onClick={() => { setSlideCount(""); setDuration(""); setForceResearch(false); setTheme(""); }}>Reset advanced settings</button>
                  <p className={styles.hint}>Each style has its own compositions, typography and image placement, not just different colors. The agent adapts layouts to your content. Saved presentations keep their original design.</p>
                </div>
              </details>
            </fieldset>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.submitRow}>
              <button className={styles.primary} disabled={busy || topic.trim().length < 3} type="submit">{restoring ? "Restoring run..." : submitting ? "Starting your presentation..." : queued ? "Presentation queued" : active ? "Generating presentation" : job?.status === "slides-ready" ? "Generate another presentation" : "Generate presentation"}<span aria-hidden="true">{"\u2197"}</span></button>
              <p>Includes slides and a spoken presentation.</p>
            </div>
          </form>
        </section>
        <aside className={styles.status} ref={statusRef} tabIndex={-1} aria-label="Presentation progress">
          <p className={styles.eyebrow}>PROGRESS</p>
          <h2>{job ? job.status === "queued" ? "Your presentation is in the queue" : job.status === "slides-ready" ? published ? "Ready to present" : "Saved slide preview" : job.status === "cancelled" ? "Generation cancelled" : job.status === "failed" || job.status === "rejected" ? "Could not finish" : "Generating presentation" : "Ready when you are"}</h2>
          <div className={styles.liveStatus} role="status" aria-live="polite">
            {job?.status === "queued" ? <>Queue position {job.queuePosition}. Your presentation starts automatically when it is your turn. You can leave this page and return using this run's link.</> : active ? <><span className={styles.pulse} />{currentLabel}{lastEvent && lastEvent.attempt > 1 ? ` - attempt ${lastEvent.attempt}` : ""}</> : job?.status === "slides-ready" ? published ? "Slides and spoken script are approved and saved in your library. Explore them below or start presenting." : job.result.spokenPresentation ? "Saved slides and reviewed script. This result is not published for playback." : "Saved slide preview. No reviewed spoken script yet." : job && "error" in job ? job.error : "Generation includes research, slides and a spoken script. You can follow each step here."}
          </div>
          {active && lastEvent?.stage === "research-execution" && lastEvent.completedUnits !== undefined && <p className={styles.hint}>{lastEvent.completedUnits} source requests made so far.</p>}
          {active && lastEvent?.stage === "evidence-selection" && lastEvent.totalUnits !== undefined && <p className={styles.hint}>{lastEvent.completedUnits ?? 0} of {lastEvent.totalUnits} source pages assessed.</p>}
          {active && lastEvent?.stage === "slide-generation" && lastEvent.totalUnits !== undefined && <p className={styles.hint}>{lastEvent.completedUnits ?? 0} of {lastEvent.totalUnits} slides written and fitted.</p>}
          {connectionError && <div role="alert" className={styles.error}><p>{connectionError}</p><button type="button" className={styles.textButton} onClick={() => setReconnect((value) => value + 1)}>Reconnect to this run</button></div>}
          {active && <><p className={styles.hint}>{connectionError ? "Estimate paused until reconnection." : `${queued ? "After your turn: " : "Estimated time left: "}${estimateLabel(job?.estimate)}`}</p><button type="button" className={styles.primary} onClick={() => setProgressOpen(true)}>View generation progress</button></>}
          {active && <button type="button" className={styles.cancel} disabled={cancelling} onClick={cancel}>{cancelling ? "Cancelling..." : queued ? "Leave queue" : "Cancel generation"}</button>}
          {job?.status === "slides-ready" && <a className={styles.reviewLink} href="#slides-heading">Explore your slides &darr;</a>}
          {job && job.progress.length > 0 && <details className={styles.runDetails}><summary>View steps and attempts</summary><ol>{job.progress.map((event, index) => <li key={`${event.stage}-${event.attempt}-${index}`}><span>{generationStep(event.stage)?.label ?? event.stage}</span><small>{event.status} &middot; {event.attempt}</small></li>)}</ol></details>}
          <ol className={styles.journey}>
            <li><span>01</span><div><strong>Research</strong><p>Understand the brief. Find the material.</p></div></li>
            <li><span>02</span><div><strong>Slides & script</strong><p>Write, design and review the presentation.</p></div></li>
            <li><span>03</span><div><strong>Present</strong><p>Listen, ask questions or download your PowerPoint.</p></div></li>
          </ol>
          <p className={styles.previewNote}>Slides and spoken script are prepared and reviewed together. Voice audio is generated when you start playback.</p>
        </aside>
      </div>
      {job?.status === "slides-ready" && <StudioSlides key={job.id} result={job.result} />}
      {job?.status === "slides-ready" && <StudioOutline result={job.result} />}
      {job?.status === "slides-ready" && <section className={styles.results} aria-labelledby="research-heading">
        <p className={styles.eyebrow}>RESEARCH AND SOURCES</p>
        <h2 id="research-heading" tabIndex={-1}>{job.result.subject}</h2>
        <p>{job.result.reviewSummary}</p>
        <div className={styles.resultGrid}><div><h3>{job.result.factBank.facts.length} facts to build on</h3><ol className={styles.facts}>{job.result.factBank.facts.map((fact) => <li key={fact.id}>{fact.claim}<small>{fact.origin === "model-knowledge" ? "Model knowledge" : "Source-backed"}</small></li>)}</ol></div><div><h3>Source material</h3>{job.result.sources.length ? <ul className={styles.sources}>{job.result.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} {"\u2197"}</a><small>{new URL(source.url).hostname}</small></li>)}</ul> : <p>No external sources were used in this run. These facts come from model knowledge.</p>}</div></div>
      </section>}
      <footer className={styles.footer}><span>SlideSpeech</span><span>Studio</span></footer>
      <GenerationProgressModal open={progressOpen} job={job} submitting={submitting} cancelling={cancelling}
        error={error} connectionError={connectionError} returnFocus={statusRef} onDismiss={() => setProgressOpen(false)}
        onCancel={() => void cancel()} onReconnect={() => setReconnect((value) => value + 1)} />
    </main>
  );
}
