import type { GenerationV2Job } from "@slidespeech/types";
import styles from "./presentation-studio.module.css";

type OutlineResult = Pick<Extract<GenerationV2Job, { status: "slides-ready" }>["result"], "strategy" | "slidePlans" | "factBank" | "outlineReview">;

export function StudioOutline({ result }: { result: OutlineResult }) {
  const { strategy, slidePlans, factBank, outlineReview } = result;
  const facts = new Map(factBank.facts.map((fact) => [fact.id, fact]));
  return <section className={styles.results} aria-labelledby="outline-heading">
    <div className={styles.outlineHeading}>
      <div><p className={styles.eyebrow}>THE STORY BEFORE THE SLIDES</p><h2 id="outline-heading" tabIndex={-1}>Your presentation outline</h2></div>
      <p>{strategy.slideCount} slides <span aria-hidden="true">/</span> about {strategy.durationMinutes} minutes<br /><small>For {strategy.audience}</small></p>
    </div>
    <details className={styles.runDetails}><summary>Outline review notes</summary><p>{outlineReview.summary}</p></details>
    <ol className={styles.outline}>
      {slidePlans.slides.map((slide, index) => <li key={slide.slideId}>
        <span className={styles.outlineNumber}>{String(index + 1).padStart(2, "0")}</span>
        <div className={styles.outlineBody}>
          <p className={styles.eyebrow}>{slide.role}</p>
          <h3>{strategy.storyArc[index]?.audienceQuestion}</h3>
          <details className={styles.outlineMaterial}>
            <summary>{slide.allowedFactIds.length} allocated facts &middot; View material</summary>
            <ul>{slide.allowedFactIds.map((id) => {
              const fact = facts.get(id);
              return fact ? <li key={id}>{fact.claim}<small>{slide.requiredFactIds.includes(id) ? "Essential" : "Supporting"} &middot; {fact.origin === "model-knowledge" ? "Model knowledge" : "Source-backed"}{fact.allowedUse === "narration-only" ? " / narration only" : ""}</small></li> : null;
            })}</ul>
          </details>
        </div>
      </li>)}
    </ol>
    <p className={styles.hint}>This is the reviewed outline, not the final slide design or spoken script. <a href="#research-heading">See all research and sources below.</a></p>
  </section>;
}
