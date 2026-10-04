"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useReducedMotion } from "framer-motion";
import { getAudio } from "./audio";

/** Muted flag from the audio manager (false during SSR; localStorage after hydration). */
export function useMuted(): boolean {
  const audio = getAudio();
  return useSyncExternalStore(audio.subscribe, () => audio.isMuted(), () => false);
}

/**
 * Unlocks audio on the first user gesture anywhere (browsers block sound before one).
 * iOS only honours touchend / click as unlock gestures (pointerdown does not count), so all of
 * them are listened to. The listeners stay for the life of the page: every later gesture also
 * wakes a context iOS suspended (phone call, tab switch), which is what AudioManager.unlock does
 * once unlocked. Also reports prefers-reduced-motion to the audio manager.
 */
export function useAudioUnlock() {
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    getAudio().setReducedMotion(reduced);
  }, [reduced]);
  useEffect(() => {
    const unlock = () => getAudio().unlock();
    const events = ["pointerdown", "touchend", "click", "keydown"] as const;
    for (const e of events) window.addEventListener(e, unlock, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, unlock);
    };
  }, []);
}

/**
 * Persistent sound toggle, pinned to the top-right corner of every screen.
 * A real <button> with aria-pressed (pressed = muted), so Tab + Enter/Space work.
 */
export function MuteToggle() {
  const muted = useMuted();
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label="Mute sound"
      title={muted ? "Sound off (click to unmute)" : "Sound on (click to mute)"}
      data-mute-toggle
      onClick={() => getAudio().toggleMuted()}
      className="fixed right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] z-[60] flex size-11 cursor-pointer items-center justify-center rounded-full border-[3px] border-black bg-white text-xl text-black shadow-[3px_3px_0_#000] hover:bg-yellow-100 aria-pressed:bg-neutral-300"
    >
      <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
    </button>
  );
}
