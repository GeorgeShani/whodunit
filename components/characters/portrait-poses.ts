/**
 * Maps an engine Emotion (13 values) to one of Toon's 7 sprite poses
 * (neutral, talking, angry, nervous, shocked, smug, sad; docs/ART_BIBLE.md §6).
 * Pose files follow assets/characters/<portrait>/<pose>.webp; availability
 * comes from assets/characters/anchors.json.
 */
import type { Emotion } from "@/engine/types";

/** Preferred pose order per emotion (first available wins). */
export const EMOTION_POSE_PREFERENCES: Record<Emotion, readonly string[]> = {
  calm: ["neutral"],
  nervous: ["nervous", "shocked"],
  defensive: ["angry", "nervous", "smug"],
  angry: ["angry"],
  sad: ["sad"],
  scared: ["nervous", "shocked"],
  smug: ["smug"],
  amused: ["smug", "talking"],
  flustered: ["nervous", "shocked"],
  suspicious: ["smug", "angry"],
  shocked: ["shocked", "nervous"],
  panicked: ["shocked", "nervous"],
  relieved: ["neutral", "talking"],
};

/** Used when none of the preferred poses exist. */
export const FALLBACK_POSES = ["neutral", "talking"] as const;

/** Returns the pose to show, or null when no poses exist (render a silhouette). */
export function resolvePose(emotion: Emotion, available: readonly string[], speaking = false): string | null {
  if (available.length === 0) return null;
  if (speaking && available.includes("talking")) return "talking";
  for (const pose of [...EMOTION_POSE_PREFERENCES[emotion], ...FALLBACK_POSES]) {
    if (available.includes(pose)) return pose;
  }
  return available[0];
}

export function portraitSrc(portrait: string, pose: string): string {
  return `/assets/characters/${portrait}/${pose}.webp`;
}
