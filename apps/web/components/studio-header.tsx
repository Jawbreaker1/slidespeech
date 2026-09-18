import Link from "next/link";
import styles from "./presentation-studio.module.css";

export function StudioHeader({ current }: { current: "studio" | "library" | "presenter" }) {
  return <header className={styles.header}>
    <Link className={styles.brand} href="/" aria-label="SlideSpeech home">slide<span>speech</span><i aria-hidden="true">.</i></Link>
    <nav aria-label="Main navigation">
      {current === "studio" ? <span aria-current="page">Studio</span> : <Link href="/">Studio</Link>}
      {current === "library" ? <span aria-current="page">Your library</span> : <Link href="/library">Your library</Link>}
      {current === "presenter" && <span aria-current="page">Presenter</span>}
    </nav>
  </header>;
}
