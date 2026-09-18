"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SlideSceneCanvas } from "@slidespeech/ui";
import type { PublishedLibraryItem } from "@slidespeech/types";
import { archivePublishedPresentation, listPublishedPresentations } from "../lib/published-presentations";
import { StudioHeader } from "./studio-header";
import studio from "./presentation-studio.module.css";
import styles from "./presentation-library.module.css";

const date = (value: string) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export function PresentationLibrary() {
  const [items, setItems] = useState<PublishedLibraryItem[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [unavailable, setUnavailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<PublishedLibraryItem>();
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    void listPublishedPresentations({ query, order, offset, limit: 12 }, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      setItems(previous => offset === 0 ? page.items : [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()]);
      setTotal(page.total); setUnavailable(page.unavailableCount); setNextOffset(page.nextOffset);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your library."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, order, offset, reload]);

  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);

  function resetSearch(value: string, sort = order) {
    setQuery(value.trim()); setOrder(sort); setOffset(0); setItems([]); setLoading(true); setReload(value => value + 1);
  }

  async function archive() {
    if (!selected || archiving) return;
    setArchiving(true); setArchiveError(undefined);
    try {
      await archivePublishedPresentation(selected.id);
      setNotice(`"${selected.title}" was moved out of your library.`);
      setSelected(undefined); setOffset(0); setItems([]); setReload(value => value + 1);
    } catch (cause) { setArchiveError(cause instanceof Error ? cause.message : "Could not archive presentation."); }
    finally { setArchiving(false); }
  }

  return <main className={studio.studio}>
    <StudioHeader current="library" />
    <section className={styles.intro} aria-labelledby="library-title">
      <div><p className={studio.eyebrow}>THE STORIES YOU HAVE BUILT</p><h1 id="library-title">Your library.<br /><em>Ready for an audience.</em></h1></div>
      <div className={styles.introAside}><p>A place for your presentations. <br />Revisit the slides, listen to the story, <br />and make room for questions.</p><Link className={styles.create} href="/">Create a presentation <span aria-hidden="true">↗</span></Link></div>
    </section>

    <section aria-label="Saved presentations" className={styles.collection} aria-busy={loading}>
      <div className={styles.toolbar}>
        <h2>{query ? "Search results" : "Your collection"} <span>{loading && !items.length ? "" : String(total).padStart(2, "0")}</span></h2>
        <form className={styles.search} role="search" onSubmit={event => { event.preventDefault(); resetSearch(search); }}>
          <label className={styles.srOnly} htmlFor="library-search">Search presentations</label>
          <input id="library-search" type="search" maxLength={200} placeholder="Find a presentation..." value={search} onChange={event => setSearch(event.target.value)} />
          <button type="submit">Search</button>
        </form>
        <label className={styles.sort}>Sort by<select value={order} onChange={event => resetSearch(query, event.target.value as "newest" | "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      <p className={styles.notice} role="status">{notice}</p>
      {query && <p className={styles.filter}>Results for "{query}" <button type="button" onClick={() => { setSearch(""); resetSearch(""); }}>Clear search</button></p>}
      {error && <div className={styles.message} role="alert"><h3>Your library could not be loaded.</h3><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>}
      {unavailable > 0 && <p className={styles.warning}>{unavailable} saved {unavailable === 1 ? "file could" : "files could"} not be opened. Nothing was deleted.</p>}
      {loading && !items.length ? <div className={styles.loading} role="status"><span />Opening your collection...</div> : !error && !items.length ? <div className={styles.empty}>
        <p className={studio.eyebrow}>{query ? "NOT ON THIS SHELF" : "A FRESH START"}</p><h2>{query ? "No matching presentations." : "Your next story starts here."}</h2>
        <p>{query ? "Try another title or subject." : "Create a presentation in Studio. Your saved slides and spoken presentation will appear here."}</p>
        {!query && <Link className={styles.create} href="/">Open Studio <span aria-hidden="true">↗</span></Link>}
      </div> : <div className={styles.grid}>{items.map((item, index) => <article key={item.id} className={`${styles.card} ${index === 0 && !query && order === "newest" ? styles.featured : ""}`}>
        <Link href={`/presentation/${item.id}`} className={styles.cover} aria-label={`Open presentation: ${item.title}`}><SlideSceneCanvas scene={item.cover} /><span className={styles.openHint}>Open presentation <span aria-hidden="true">↗</span></span></Link>
        <div className={styles.cardBody}>
          <div className={styles.cardMeta}><span>{index === 0 && !query && order === "newest" ? "LATEST PRESENTATION" : "PRESENTATION"}</span><time dateTime={item.publishedAt}>{date(item.publishedAt)}</time></div>
          <h3><Link href={`/presentation/${item.id}`}>{item.title}</Link></h3>
          {item.subject !== item.title && <p className={styles.subject}>{item.subject}</p>}
          <p className={styles.facts}>{item.slideCount} slides <span aria-hidden="true">·</span> Spoken presentation{item.imageCount > 0 && <> <span aria-hidden="true">·</span> {item.imageCount} illustrated</>}</p>
          <div className={styles.cardActions}><Link href={`/presentation/${item.id}`}>Open &amp; present <span aria-hidden="true">↗</span></Link><button type="button" aria-label={`Archive ${item.title}`} onClick={() => { setArchiveError(undefined); setSelected(item); }}>Archive</button></div>
        </div>
      </article>)}</div>}
      {nextOffset !== null && !error && <div className={styles.more}><button type="button" disabled={loading} onClick={() => setOffset(nextOffset)}>{loading ? "Loading..." : "Show more presentations"}</button></div>}
    </section>
    <footer className={studio.footer}><span>Made for understanding.</span><span>SlideSpeech / Library</span></footer>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="archive-title" onCancel={event => { if (archiving) event.preventDefault(); else setSelected(undefined); }}>
      <p className={studio.eyebrow}>KEEP YOUR COLLECTION CLEAR</p><h2 id="archive-title">Archive this presentation?</h2><p>"{selected?.title}" will leave your library. Its original file is kept in a local archive, not permanently deleted.</p>
      {archiveError && <p role="alert" className={studio.error}>{archiveError}</p>}
      <div className={styles.dialogActions}><button type="button" autoFocus disabled={archiving} onClick={() => setSelected(undefined)}>Keep presentation</button><button type="button" disabled={archiving} onClick={() => void archive()}>{archiving ? "Archiving..." : "Archive presentation"}</button></div>
    </dialog>
  </main>;
}
