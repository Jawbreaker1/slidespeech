"use client";
import { useEffect, useRef, useState } from "react";
import { narrationPassages, type PublishedPresentationView } from "@slidespeech/types";
import { SlideSceneCanvas } from "@slidespeech/ui";
import { getPublishedPresentation, publishedSlideAudioUrl } from "../lib/published-presentations";
import { PresenterQuestions } from "./presenter-questions";
import { StudioHeader } from "./studio-header";
import { usePresentationFullscreen } from "./use-presentation-fullscreen";
import styles from "./presentation-studio.module.css";
import player from "./published-presenter.module.css";

export function PublishedPresenter({ id }: { id: string }) {
  const [presentation, setPresentation] = useState<PublishedPresentationView>();
  const [error, setError] = useState<string>();
  const fullscreen = usePresentationFullscreen();
  useEffect(() => {
    const controller = new AbortController();
    setPresentation(undefined); setError(undefined);
    void getPublishedPresentation(id, controller.signal).then((value) => { if (!controller.signal.aborted) setPresentation(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load presentation."); });
    return () => controller.abort();
  }, [id]);
  return <main className={styles.studio}>
    <div inert={fullscreen.active}><StudioHeader current="presenter" /></div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : presentation ? <Playback key={presentation.id} presentation={presentation} fullscreen={fullscreen} /> : <p role="status">Opening your reviewed presentation...</p>}
  </main>;
}

function Playback({ presentation, fullscreen }: { presentation: PublishedPresentationView; fullscreen: ReturnType<typeof usePresentationFullscreen> }) {
  const [selected, setSelected] = useState(0);
  const [passage, setPassage] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const questionsButton = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState("Press play to begin. Audio is prepared by the server on first playback.");
  const audio = useRef<HTMLAudioElement>(null);
  const questionBusy = useRef(false);
  const interrupted = useRef(false);
  const scene = presentation.scenes[selected]!;
  const passages = narrationPassages(presentation.scripts[selected]!);
  const nextAudio = passage + 1 < passages.length
    ? publishedSlideAudioUrl(presentation.id, selected, passage + 1)
    : selected + 1 < presentation.scenes.length ? publishedSlideAudioUrl(presentation.id, selected + 1, 0) : undefined;
  function select(index: number) {
    audio.current?.pause();
    interrupted.current = false;
    setAutoAdvance(false); setSelected(index); setPassage(0);
    setPhase("Ready. Press play when you want to continue.");
  }
  function closeQuestions() { setQuestionsOpen(false); questionsButton.current?.focus(); }
  return <section ref={fullscreen.container} className={`${styles.results} ${fullscreen.active ? player.fullscreen : ""}`} aria-labelledby="presenter-title">
    <header className={player.heading}>
      <div><p className={styles.eyebrow}>YOUR PRESENTATION</p><h1 id="presenter-title">{presentation.title}</h1>
        {fullscreen.active && fullscreen.notice ? <p role="status" className={player.notice}>{fullscreen.notice}</p> : null}</div>
      <div className={player.actions}>
        {fullscreen.active ? <button ref={questionsButton} type="button" className={player.action} aria-expanded={questionsOpen} aria-controls="presenter-questions" onClick={() => setQuestionsOpen(!questionsOpen)}>Ask a question</button> : null}
        <button ref={fullscreen.button} type="button" className={player.action} aria-pressed={fullscreen.active} disabled={fullscreen.pending} onClick={() => void fullscreen.toggle()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={fullscreen.active ? "M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" : "M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"} /></svg>
          {fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
    </header>
    <div className={`${styles.slidePreview} ${player.slide}`}><SlideSceneCanvas scene={scene} /></div>
    <div className={`${styles.playbackBar} ${player.playback}`}>
      <nav className={`${styles.slideNavigation} ${player.navigation}`} aria-label="Presentation navigation">
        <button type="button" onClick={() => select(selected - 1)} disabled={selected === 0}>Previous slide</button>
        <span>Slide {selected + 1} of {presentation.scenes.length}</span>
        <button type="button" onClick={() => select(selected + 1)} disabled={selected === presentation.scenes.length - 1}>Next slide</button>
      </nav>
      <audio key={`${scene.slideId}:${passage}`} ref={audio} controls preload="auto" autoPlay={autoAdvance}
        aria-label={`Spoken presentation: slide ${selected + 1}`} src={publishedSlideAudioUrl(presentation.id, selected, passage)}
        onPlay={(event) => { if (questionBusy.current) { event.currentTarget.pause(); return; } if (interrupted.current) { event.currentTarget.currentTime = 0; interrupted.current = false; } setPhase("Preparing the presenter's voice. The first playback may take a moment."); }}
        onWaiting={() => setPhase("Preparing audio. Your place in the presentation is preserved.")}
        onPlaying={() => setPhase("Presenting. Pause whenever you need.")}
        onPause={() => setPhase("Paused. Play resumes from the same place.")}
        onError={() => { setAutoAdvance(false); setPhase("Audio could not be prepared. Check the speech service, then reload to retry. The reviewed script is available below."); }}
        onEnded={(event) => {
          if (audio.current !== event.currentTarget || questionBusy.current) return;
          if (passage < passages.length - 1) { setAutoAdvance(true); setPassage(passage + 1); }
          else if (selected < presentation.scenes.length - 1) { setAutoAdvance(true); setSelected(selected + 1); setPassage(0); }
          else { setAutoAdvance(false); setPhase("The presentation has ended. You can revisit any slide."); }
        }} />
      <p role="status" className={`${styles.playbackStatus} ${player.status}`}>{phase}</p>
      {nextAudio ? <audio key={nextAudio} src={nextAudio} preload="auto" hidden aria-hidden="true" /> : null}
    </div>
    <div className={`${styles.slideThumbnails} ${player.extras}`}>{presentation.scenes.map((item, index) => <button key={item.slideId} type="button" aria-label={`Show slide ${index + 1}: ${item.title}`} aria-pressed={index === selected} onClick={() => select(index)}><SlideSceneCanvas scene={item} /></button>)}</div>
    <details className={`${styles.outlineMaterial} ${player.extras}`}><summary>Read this slide's spoken script</summary>{narrationPassages(presentation.scripts[selected]!).map((text, index) => <p key={index}>{text}</p>)}</details>
    <div id="presenter-questions" className={player.questions} hidden={fullscreen.active && !questionsOpen}>
    {fullscreen.active ? <div className={player.questionsClose}><button type="button" className={player.action} onClick={closeQuestions}>Close questions</button></div> : null}
    <PresenterQuestions presentationId={presentation.id} slideIndex={selected} interrupt={() => {
      audio.current?.pause(); setAutoAdvance(false);
      interrupted.current = true;
      setPhase("Paused for your question. We will return to the beginning of this spoken passage.");
      return { slideIndex: selected, passageIndex: passage, playbackSeconds: audio.current?.currentTime ?? 0 };
    }} onBusy={(busy) => { questionBusy.current = busy; }} resume={(position) => {
      if (position && (position.slideIndex !== selected || position.passageIndex !== passage)) return;
      if (audio.current && (position || interrupted.current)) audio.current.currentTime = 0;
      interrupted.current = false;
      setQuestionsOpen(false);
      void audio.current?.play().catch(() => setPhase("Press play in the audio controls to continue."));
    }} />
    </div>
  </section>;
}
