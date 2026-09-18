"use client";
import { useState } from "react";
import type { GenerationV2Job } from "@slidespeech/types";
import { SlideSceneCanvas } from "@slidespeech/ui";
import styles from "./presentation-studio.module.css";

export function StudioSlides({ result }: { result: Extract<GenerationV2Job, { status: "slides-ready" }>["result"] }) {
  const [selected, setSelected] = useState(0);
  const scene = result.scenes[selected]!;
  const script = result.spokenPresentation?.narrations.scripts[selected];
  const image = result.designs.images?.assets.find((asset) => asset.id === result.designs.designs[selected]!.imageAssetId && asset.approvedForSlideId === scene.slideId);
  return <section className={styles.results} aria-labelledby="slides-heading">
    <p className={styles.eyebrow}>YOUR GENERATED SLIDES</p>
    <h2 id="slides-heading">{result.publication ? "Your complete presentation" : "Your reviewed slide preview"}</h2>
    <p>{result.slideReview.summary}</p>
    {result.publication && <a className={styles.primary} href={`/presentation/${encodeURIComponent(result.publication.id)}`}>Start presentation</a>}
    <div className={styles.slidePreview}><SlideSceneCanvas scene={scene} /></div>
    <nav className={styles.slideNavigation} aria-label="Slide preview navigation">
      <button type="button" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>Previous</button>
      <span aria-live="polite">Slide {selected + 1} of {result.scenes.length}</span>
      <button type="button" disabled={selected === result.scenes.length - 1} onClick={() => setSelected(selected + 1)}>Next</button>
    </nav>
    <div className={styles.slideThumbnails}>{result.scenes.map((item, index) => <button type="button" key={item.slideId} aria-label={`Preview slide ${index + 1}: ${item.title}`} aria-pressed={selected === index} onClick={() => setSelected(index)}><SlideSceneCanvas scene={item} /></button>)}</div>
    {script ? <details className={styles.outlineMaterial}><summary>Read the spoken presentation</summary>
      <p>{script.openingBridge}</p>{script.segments.map((segment, index) => <p key={index}>{segment}</p>)}
      <p>{script.transitionOut}</p>{script.questionInvitation && <p>{script.questionInvitation}</p>}
    </details> : <details className={styles.outlineMaterial}><summary>Material for the presenter</summary>{result.slides.slides[selected]!.speakerNotes.map((note, index) => <p key={index}>{note}</p>)}</details>}
    {image && <details className={styles.outlineMaterial}><summary>Image source</summary><p><a href={image.sourcePageUrl} target="_blank" rel="noreferrer">{new URL(image.sourcePageUrl).hostname}</a></p>{image.sourceCaption && <p>{image.sourceCaption}</p>}<p>Relevance checked against the image. Reuse rights have not been verified.</p></details>}
    <p className={styles.hint}>{result.publication ? "Your presentation is saved in the library. Start it to listen, ask questions by text or microphone, or download the PowerPoint. Voice audio is generated when you start playback." : script ? "The complete spoken script has passed narration and humanizer review. This preview has not been published for playback." : "Reviewed slide preview with source images where suitable. This saved preview has preparation notes, not a reviewed spoken script."}</p>
  </section>;
}
