"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { GenerationV2Job } from "@slidespeech/types";
import { elapsedLabel, estimateLabel, generationPhases, generationStep, generationUnits } from "../lib/generation-progress";
import styles from "./generation-progress-modal.module.css";

type Props = {
  open: boolean; job: GenerationV2Job | null; submitting: boolean; cancelling: boolean;
  error: string | null; connectionError: string | null; returnFocus: RefObject<HTMLElement | null>;
  onDismiss: () => void; onCancel: () => void; onReconnect: () => void;
};

export function GenerationProgressModal({ open, job, submitting, cancelling, error, connectionError, returnFocus, onDismiss, onCancel, onReconnect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(Date.now);
  const active = job?.status === "running" || job?.status === "queued";
  const queued = job?.status === "queued";
  const ready = job?.status === "slides-ready";
  const failed = job?.status === "failed" || job?.status === "rejected" || (!job && Boolean(error));
  const cancelled = job?.status === "cancelled";
  const event = job?.progress.at(-1);
  const step = generationStep(event?.stage);
  const units = generationUnits(job);
  const phase = ready ? generationPhases.length : queued || submitting ? -1 : step?.phase ?? 0;
  const publication = ready ? job.result.publication : undefined;
  const title = connectionError ? "Connection interrupted" : submitting ? "Starting your presentation" : queued ? "Your presentation is in the queue"
    : ready ? publication ? "Your presentation is ready" : "Your slides are ready" : cancelled ? "Generation cancelled"
      : failed ? "Could not finish the presentation" : step?.label ?? "Starting your presentation";

  useEffect(() => {
    if (!open) {
      if (dialog.current?.open) { dialog.current.close(); returnFocus.current?.focus({ preventScroll: true }); }
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => { document.body.style.overflow = previous; };
  }, [open, returnFocus]);

  useEffect(() => {
    if (!open || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, active]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="generation-title" aria-describedby="generation-description"
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    <header className={styles.header}><p>{queued ? "WAITING FOR YOUR TURN" : ready ? "COMPLETE" : failed || cancelled ? "PRESENTATION STATUS" : "GENERATING PRESENTATION"}</p>
      <button type="button" className={styles.hide} onClick={onDismiss} aria-label={active || submitting ? "Hide progress; keep generating" : "Close generation status"}>{active || submitting ? "Hide" : "Close"}<span aria-hidden="true">&times;</span></button></header>
    <div className={styles.current} role="status" aria-live="polite">
      <h2 id="generation-title">{active && !queued && !connectionError && <span className={styles.activity} aria-hidden="true" />}{title}</h2>
      <p id="generation-description">{connectionError ? "The last update is shown below. The server may still be working; reconnect to check without starting again."
        : submitting ? "Sending your brief and requesting a place in the generation queue."
          : queued ? `Queue position ${job.queuePosition}. Your presentation starts automatically when it is your turn.`
            : ready ? "The result is saved. You can review it now, or return to it later."
              : cancelled ? "This run has stopped. You can change the brief and start again."
                : failed ? "This run could not complete. The error details are available below."
                  : step?.detail ?? "The server is preparing your run."}</p>
      {active && event && event.attempt > 1 && <p className={styles.revision}>Revisiting this step: attempt {event.attempt}</p>}
      {active && units && <p className={styles.units}>{units}</p>}
    </div>
    {(active || submitting) && <div className={styles.timing}>
      <div><p>{queued ? "GENERATION TIME AFTER YOUR TURN" : "ESTIMATED TIME LEFT"}</p><strong>{connectionError ? "Waiting for an update" : submitting ? "Preparing estimate" : estimateLabel(job?.estimate)}</strong></div>
      <div className={styles.elapsed}><p>{queued ? "WAITED" : "ELAPSED"}</p><strong>{elapsedLabel(queued ? job.createdAt : job?.startedAt, now)}</strong></div>
      <p className={styles.timingNote}>{queued ? "Waiting time is not included. " : ""}{job?.estimate
        ? `Rough guide from ${job.estimate.sampleCount} completed run${job.estimate.sampleCount === 1 ? "" : "s"} with the same model${job.estimate.lengthAdjusted ? ", adjusted for slide count" : ""}. Research, revisions and shared model load can change this.`
        : "An estimate appears when there are completed runs for the current model. No fixed completion time is assumed."}</p>
    </div>}
    <ol className={styles.phases} aria-label="Generation phases">{generationPhases.map((label, index) => <li key={label} data-state={index < phase ? "done" : index === phase ? "current" : "waiting"} aria-current={index === phase && active && !queued ? "step" : undefined}>
      <span aria-hidden="true">{index < phase ? "\u2713" : String(index + 1).padStart(2, "0")}</span><span>{label}</span><small>{index < phase ? "Done" : index === phase ? failed ? "Stopped here" : cancelled ? "Cancelled" : connectionError ? "Last update" : "In progress" : "Next"}</small>
    </li>)}</ol>
    {(error || (job && "error" in job && !cancelled)) && <div className={styles.error} role="alert"><details><summary>View error details</summary><p>{error ?? (job && "error" in job ? job.error : "")}</p></details></div>}
    {connectionError && <button type="button" className={styles.primary} onClick={onReconnect}>Reconnect to this run</button>}
    <footer className={styles.footer}>
      {active ? <><p>You can hide this window. Generation will continue.<br />Voice audio is prepared when you start playback.</p><button type="button" disabled={cancelling} className={styles.cancel} onClick={onCancel}>{cancelling ? "Cancelling..." : queued ? "Leave queue" : "Cancel generation"}</button></>
        : ready ? <>{publication && <a className={styles.primary} href={`/presentation/${encodeURIComponent(publication.id)}`}>Open presentation <span aria-hidden="true">&#8599;</span></a>}<button type="button" className={styles.secondary} onClick={onDismiss}>Review in studio</button></>
          : !submitting ? <button type="button" className={styles.secondary} onClick={onDismiss}>Back to studio</button> : <p>You will see each step here as it starts.</p>}
    </footer>
  </dialog>;
}
