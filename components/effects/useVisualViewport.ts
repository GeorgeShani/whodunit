"use client";

import { useEffect } from "react";

/** The keyboard counts as open when the visual viewport is this much shorter than the window. */
export const KEYBOARD_MIN_PX = 120;
/** Below this visible height the stage art is dropped (data-kb) so the chat + question box fit. */
export const KEYBOARD_COMPACT_PX = 460;

export interface ViewportMetrics {
  keyboard: boolean;
  /** Visible height in px, or null when the keyboard is closed (use 100dvh). */
  height: number | null;
  top: number;
  compact: boolean;
}

/** Pure: what the page should do for a given window / visual viewport. */
export function viewportMetrics(innerHeight: number, vvHeight: number, vvOffsetTop: number): ViewportMetrics {
  const keyboard = innerHeight - vvHeight > KEYBOARD_MIN_PX;
  return { keyboard, height: keyboard ? Math.round(vvHeight) : null, top: keyboard ? Math.round(vvOffsetTop) : 0, compact: keyboard && vvHeight < KEYBOARD_COMPACT_PX };
}

/**
 * Keeps the game inside the VISIBLE viewport while the on-screen keyboard is
 * open (iOS Safari does not resize the layout viewport for it, and dvh does
 * not change): sets --app-h / --app-top on <html> and data-kb when it is
 * short. The focused input is scrolled into view once the keyboard settles.
 * With no keyboard nothing is set and the CSS falls back to 100dvh.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      const m = viewportMetrics(window.innerHeight, vv.height, vv.offsetTop);
      if (m.height === null) {
        root.style.removeProperty("--app-h");
        root.style.removeProperty("--app-top");
        root.removeAttribute("data-kb");
        return;
      }
      root.style.setProperty("--app-h", `${m.height}px`);
      root.style.setProperty("--app-top", `${m.top}px`);
      if (m.compact) root.setAttribute("data-kb", "");
      else root.removeAttribute("data-kb");
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches("input, textarea")) el.scrollIntoView({ block: "nearest" });
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
      root.removeAttribute("data-kb");
    };
  }, []);
}
