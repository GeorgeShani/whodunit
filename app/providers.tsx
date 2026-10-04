"use client";

import { MotionConfig } from "framer-motion";
import { MuteToggle, useAudioUnlock } from "@/components/effects/MuteToggle";
import { useVisualViewport } from "@/components/effects/useVisualViewport";

/**
 * App-wide client wrapper:
 * - MotionConfig reducedMotion="user": under prefers-reduced-motion, Framer
 *   Motion skips transform/layout animation (shakes, bounces, spins, scale
 *   pops) and keeps opacity, so screens and overlays crossfade instead (#9).
 * - Audio unlocks on the first user gesture; the mute toggle is on every screen.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useAudioUnlock();
  useVisualViewport();
  return (
    <MotionConfig reducedMotion="user">
      {children}
      <MuteToggle />
    </MotionConfig>
  );
}
