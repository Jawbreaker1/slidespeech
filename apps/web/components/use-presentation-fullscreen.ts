"use client";
import { useEffect, useRef, useState } from "react";

export function usePresentationFullscreen() {
  const container = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"off" | "native" | "window">("off");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const active = mode !== "off";

  useEffect(() => {
    function sync() {
      if (document.fullscreenElement === container.current) setMode("native");
      else setMode((value) => value === "native" ? "off" : value);
    }
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!active) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      // A question dialog owns Escape while open. Do not close both surfaces.
      if (mode === "window" && event.key === "Escape" && !event.defaultPrevented && !container.current?.querySelector("dialog[open]")) {
        event.preventDefault(); setMode("off");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      button.current?.focus({ preventScroll: true });
    };
  }, [active, mode]);

  async function toggle() {
    if (pending || !container.current) return;
    setNotice("");
    if (mode === "window") { setMode("off"); return; }
    setPending(true);
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else if (typeof container.current.requestFullscreen === "function" && document.fullscreenEnabled !== false) await container.current.requestFullscreen();
      else {
        setMode("window");
        setNotice("Expanded to this window. Fullscreen is unavailable in this browser.");
      }
    } catch {
      if (document.fullscreenElement === container.current) setNotice("Use Escape or your browser controls to leave fullscreen.");
      else {
        setMode("window");
        setNotice("Fullscreen was blocked. The presentation now fills this window.");
      }
    } finally { setPending(false); }
  }

  return { container, button, active, pending, notice, toggle };
}
