"use client";
import { useEffect, useRef, useState } from "react";
import type { PresentationQuestion, PresentationQuestionResponse, QuestionProgress } from "@slidespeech/types";
import { askPresentationQuestion, getAnswerAudio, transcribeQuestionAudio } from "../lib/published-presentations";
import { startQuestionRecording, type QuestionRecording } from "../lib/question-recording";
import { questionSteps } from "../lib/question-progress";
import styles from "./presentation-studio.module.css";

type Position = Omit<PresentationQuestion, "text">;
type Phase = "idle" | "permission" | "recording" | "transcribing" | "confirming" | "answering" | "preparing-audio" | "speaking" | "audio-paused";
type Turn = { controller: AbortController; position: Position; continueAfterAnswer: boolean; phase: Phase; recording?: QuestionRecording; preview?: Promise<void>; url?: string; result?: PresentationQuestionResponse };
const phaseTitles: Record<Exclude<Phase, "idle">, string> = {
  permission: "Allow microphone access", recording: "Listening to your question", transcribing: "Transcribing your question",
  confirming: "Check your question", answering: "Preparing your answer", "preparing-audio": "Preparing the presenter's voice",
  speaking: "Your presenter is answering", "audio-paused": "Answer playback paused",
};

export function PresenterQuestions({ presentationId, slideIndex, interrupt, resume, onBusy }: {
  presentationId: string; slideIndex: number;
  interrupt: () => Position;
  resume: (position?: Position) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<PresentationQuestionResponse>();
  const [error, setError] = useState<string>();
  const [previewNote, setPreviewNote] = useState("");
  const [level, setLevel] = useState(0);
  const [continueAfterAnswer, setContinueAfterAnswer] = useState(true);
  const [progress, setProgress] = useState<QuestionProgress>();
  const [phaseStartedAt, setPhaseStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const active = useRef<Turn | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const spoken = useRef<HTMLAudioElement>(null);
  const pending = phase !== "idle";
  const working = ["permission", "transcribing", "answering", "preparing-audio"].includes(phase);
  const stepIndex = questionSteps.findIndex(step => step.stage === progress?.stage);
  const step = questionSteps[stepIndex];
  const elapsed = Math.max(0, Math.floor((now - phaseStartedAt) / 1000));
  const current = (turn: Turn) => active.current === turn && !turn.controller.signal.aborted;
  function changePhase(turn: Turn, value: Phase) { if (current(turn)) { turn.phase = value; setPhase(value); const time = Date.now(); setPhaseStartedAt(time); setNow(time); } }
  function release() {
    const turn = active.current; active.current = null;
    turn?.controller.abort(); turn?.recording?.cancel();
    if (spoken.current) { spoken.current.pause(); spoken.current.removeAttribute("src"); spoken.current.load(); }
    if (turn?.url) URL.revokeObjectURL(turn.url);
    onBusy(false);
  }
  useEffect(() => () => release(), []);
  useEffect(() => { release(); setPhase("idle"); }, [slideIndex]);
  useEffect(() => { if (pending) dialog.current?.showModal(); else dialog.current?.close(); }, [pending]);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  function begin(): Turn {
    const position = interrupt();
    const turn: Turn = { controller: new AbortController(), position, continueAfterAnswer, phase: "idle" };
    active.current = turn; onBusy(true); setError(undefined); return turn;
  }
  function cancel() { release(); setPhase("idle"); setError("Question stopped. The presentation is still paused."); }
  function fail(turn: Turn, reason: unknown) {
    if (!current(turn)) return;
    release(); setPhase("idle");
    setError(reason instanceof DOMException && reason.name === "NotAllowedError" ? "Microphone access was not granted. Allow it in your browser, or type your question." : reason instanceof Error ? reason.message : "The question could not be completed.");
  }
  function finishAnswer() {
    const turn = active.current;
    if (!turn || !current(turn) || !turn.result) return;
    const shouldResume = turn.continueAfterAnswer && turn.result.kind !== "needs-clarification";
    const position = turn.result.resume;
    release(); setPhase("idle");
    if (shouldResume) resume(position);
  }
  async function playAnswer(turn: Turn, result: PresentationQuestionResponse) {
    turn.result = result; changePhase(turn, "preparing-audio");
    const blob = await getAnswerAudio(presentationId, result.answer.artifactId, turn.controller.signal, turn.continueAfterAnswer && result.kind !== "needs-clarification");
    if (!current(turn)) return;
    turn.url = URL.createObjectURL(blob);
    const audio = spoken.current;
    if (!audio) throw new Error("Answer audio is not available in this browser.");
    audio.src = turn.url;
    try { await audio.play(); }
    catch { if (current(turn)) { changePhase(turn, "audio-paused"); setPreviewNote("Press Play answer to hear the response. Browser autoplay may require a click."); } }
  }
  async function submit() {
    const questionText = text.trim();
    if (!questionText || (active.current && active.current.phase !== "confirming")) return;
    const turn = active.current ?? begin();
    setAnswer(undefined); setError(undefined); setProgress(undefined); changePhase(turn, "answering");
    try {
      const result = await askPresentationQuestion(presentationId, { text: questionText, ...turn.position }, turn.controller.signal,
        (value) => { if (current(turn)) setProgress(value); });
      if (!current(turn)) return;
      setAnswer(result); await playAnswer(turn, result);
    } catch (reason) { fail(turn, reason); }
  }
  async function record() {
    if (active.current) return;
    const turn = begin(); setText(""); setLevel(0); setPreviewNote("Live text is a draft. You can edit it before sending."); changePhase(turn, "permission");
    try {
      turn.recording = await startQuestionRecording({ signal: turn.controller.signal,
        onLevel: (value) => { if (current(turn)) setLevel(value); },
        onError: (reason) => fail(turn, reason),
        onPreview: (blob) => {
          if (!current(turn) || turn.phase !== "recording" || turn.preview) return;
          turn.preview = transcribeQuestionAudio(presentationId, blob, turn.controller.signal).then((value) => {
            if (current(turn) && turn.phase === "recording") setText(value.text);
          }).catch(() => { if (current(turn)) setPreviewNote("Live preview is temporarily unavailable. Finish recording for the final transcript."); })
            .finally(() => { delete turn.preview; });
        },
        onComplete: (blob) => {
          if (!current(turn)) return;
          changePhase(turn, "transcribing");
          void (async () => {
            await turn.preview;
            if (!current(turn)) return;
            const result = await transcribeQuestionAudio(presentationId, blob, turn.controller.signal);
            if (!current(turn)) return;
            setText(result.text);
            setPreviewNote(result.text.trim() ? "Check the transcript, edit anything incorrect, then send your question." : "No speech was recognized. Type a question here or cancel and record again.");
            changePhase(turn, "confirming");
          })().catch((reason) => fail(turn, reason));
        },
      });
      if (current(turn)) changePhase(turn, "recording"); else turn.recording.cancel();
    } catch (reason) { fail(turn, reason); }
  }
  async function replay() {
    if (!answer || active.current) return;
    const turn = begin(); turn.continueAfterAnswer = false;
    try { await playAnswer(turn, answer); } catch (reason) { fail(turn, reason); }
  }
  return <section className={styles.questionPanel} aria-labelledby="question-heading">
    <p className={styles.eyebrow}>MAKE IT A CONVERSATION</p><h2 id="question-heading">What would you like to know?</h2>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="presenter-question">Ask about the presentation</label>
      <textarea id="presenter-question" value={text} onChange={(event) => setText(event.target.value)} maxLength={5000} rows={3} disabled={pending} placeholder="Ask for an explanation, an example, or more detail..." />
      <label><input type="checkbox" checked={continueAfterAnswer} disabled={pending} onChange={(event) => setContinueAfterAnswer(event.target.checked)} /> Continue presentation after the answer</label>
      <div className={styles.questionActions}>
        <button type="submit" disabled={pending || !text.trim()}>Ask the presenter</button>
        <button type="button" onClick={() => void record()} disabled={pending}>Record question</button>
        <button type="button" onClick={() => resume()} disabled={pending}>Continue presentation</button>
      </div>
    </form>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {answer ? <article className={styles.questionAnswer} aria-live="polite">
      <p className={styles.eyebrow}>YOUR QUESTION ON SLIDE {answer.resume.slideIndex + 1}</p><p>{answer.answer.question}</p>
      <h3>Presenter's answer</h3><p className={styles.answerText}>{answer.answer.answer}</p>
      {answer.answer.limitations.length ? <details><summary>Limitations</summary><ul>{answer.answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
      {answer.sources.length ? <details><summary>Sources used</summary><ul>{answer.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details> : null}
      <p className={styles.hint}>{answer.resume.bridgeText}</p>
      <div className={styles.questionActions}><button type="button" disabled={pending} onClick={() => void replay()}>Speak answer again</button></div>
    </article> : null}
    <p className={styles.hint}>Recording pauses the presenter immediately. Review the transcript before sending. Hands-free Live Voice and fresh web research are not connected yet.</p>
    <dialog ref={dialog} className={styles.questionDialog} onCancel={(event) => { event.preventDefault(); cancel(); }} aria-labelledby="question-progress-title">
      <p className={styles.eyebrow}>PRESENTATION PAUSED</p>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="question-progress-title">{phase === "answering" ? step?.title ?? (progress ? "Waiting for the presenter" : "Sending your question") : phase === "idle" ? "Question" : phaseTitles[phase]}</h2>
        {phase === "answering" ? <p>{step?.detail ?? (progress ? "Your question has reached the server. It will start when the presenter is available." : "Connecting to the presenter. You can cancel at any time.")}</p> : null}
      </div>
      {working ? <div className={styles.questionActivity}>
        <span className={styles.questionActivityLabel}><span className={styles.questionSpinner} aria-hidden="true" />{phase === "permission" ? "Waiting for permission" : phase === "answering" && !step ? "Waiting to start" : "Working"}</span>
        <span className={styles.questionElapsed} aria-live="off"><span>Elapsed</span><strong>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</strong></span>
      </div> : null}
      {phase === "answering" ? <ol className={styles.questionSteps} aria-label="Answer progress">{questionSteps.map((item, index) => {
        const done = index < stepIndex || (index === stepIndex && progress?.status === "succeeded");
        const currentStep = index === stepIndex && !done;
        return <li key={item.stage} data-state={done ? "done" : currentStep ? "current" : "waiting"} aria-current={currentStep ? "step" : undefined}>
          <span>{item.label}</span><small>{done ? "Done" : currentStep ? "In progress" : "Next"}</small>
        </li>;
      })}</ol> : null}
      {phase === "permission" ? <p role="status">Allow this browser to use your microphone. Nothing is sent as a question without your confirmation.</p> : null}
      {phase === "recording" ? <><label htmlFor="microphone-level">Microphone input</label><meter id="microphone-level" min={0} max={1} value={level} /><p role="status">{previewNote}</p><p className={styles.answerText}>{text || "Waiting for the first transcription preview..."}</p></> : null}
      {phase === "confirming" ? <><p>{previewNote}</p><label htmlFor="confirmed-question">Your transcribed question</label><textarea id="confirmed-question" rows={4} value={text} maxLength={5000} onChange={(event) => setText(event.target.value)} /></> : null}
      {phase === "transcribing" ? <p role="status">Converting your recording into text. If another recording is being processed, yours waits its turn. The presentation stays paused.</p> : null}
      {phase === "answering" ? <><blockquote>{text}</blockquote><p className={styles.hint}>The presentation stays paused. Longer answers can take a moment; you can cancel at any time.</p></> : null}
      {phase === "preparing-audio" ? <p role="status">Your reviewed answer is ready. Preparing its audio.</p> : null}
      {answer && ["preparing-audio", "speaking", "audio-paused"].includes(phase) ? <p className={styles.answerText}>{answer.answer.answer}</p> : null}
      {answer && ["speaking", "audio-paused"].includes(phase) ? <p className={styles.hint}>{active.current?.continueAfterAnswer && answer.kind !== "needs-clarification" ? "After this answer and its bridge, the presenter will pick up the interrupted passage from the beginning." : "The presentation will stay paused after this answer."}</p> : null}
      <audio ref={spoken} controls hidden={phase !== "speaking" && phase !== "audio-paused"} aria-label="Presenter answer" onPlay={() => { const turn = active.current; if (turn) changePhase(turn, "speaking"); }}
        onPause={() => { const turn = active.current; if (turn && turn.phase === "speaking") changePhase(turn, "audio-paused"); }} onEnded={finishAnswer}
        onError={() => { const turn = active.current; if (turn?.url) fail(turn, new Error("Answer audio could not be played. The text answer is still available.")); }} />
      {phase === "audio-paused" ? <p>{previewNote || "Play the answer to continue, or cancel to remain paused."}</p> : null}
      <div className={styles.questionActions}>
        {phase === "recording" ? <button type="button" onClick={() => active.current?.recording?.stop()}>Finish recording</button> : null}
        {phase === "confirming" ? <button type="button" onClick={() => void submit()} disabled={!text.trim()}>Send question</button> : null}
        {phase === "audio-paused" ? <button type="button" onClick={() => void spoken.current?.play().catch((reason) => { const turn = active.current; if (turn) fail(turn, reason); })}>Play answer</button> : null}
        <button type="button" onClick={cancel} autoFocus>Cancel question</button>
      </div>
    </dialog>
  </section>;
}
