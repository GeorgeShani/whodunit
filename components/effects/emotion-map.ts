/**
 * THE emotion mapping (docs/ART_BIBLE.md §6). One table drives everything a
 * character reply triggers: sprite pose, overlays, motion variant, SFX sting
 * and the emotion badge. Nothing else in the app keeps a per-emotion table.
 *
 * engine Emotion (13 values; ending lines use the same enum)
 *   -> pose preference list (first pose the character actually has wins)
 *   -> POSE_CUES[pose]: overlays + motion variant (docs/toonMotion.ts) + SFX.
 */
import type { EffectName, Emotion as ToonPose } from "@/docs/toonMotion";
import type { Emotion } from "@/engine/types";

/** Toon's 7 sprite poses (docs/toonMotion.ts). */
export type SpritePose = ToonPose;

/** Audio cue ids; files live in assets/audio/<file>.{ogg,mp3} (see components/effects/audio.ts). */
export type AudioCue =
  | "dialogue_pop"
  | "door_slam"
  | "slide_whistle_down"
  | "slide_whistle_up"
  | "boing"
  | "wah_wah"
  | "surprise_sting"
  | "impact"
  | "clue_ding"
  | "fanfare"
  | "siren"
  | "thunder"
  | "footsteps_sneak"
  | "ui_click"
  | "rain_loop";

export interface SfxSpec {
  cue: AudioCue;
  /** Linear gain on top of the cue's base volume (ART_BIBLE "-10 dB" = ~0.32). */
  gain?: number;
}

export interface PoseCue {
  /** Effect overlays (assets/effects/effects.json), anchored per anchors.json. */
  overlays: readonly EffectName[];
  /** Key into spriteVariants (docs/toonMotion.ts). */
  motion: SpritePose;
  /** Sting played when a reply switches INTO this pose. */
  sting?: SfxSpec;
  /** Played at the start of every line delivered in this pose. */
  line?: SfxSpec;
}

/** ART_BIBLE §6 "Emotion -> sprite + overlays + motion + SFX". */
export const POSE_CUES: Record<SpritePose, PoseCue> = {
  neutral: { overlays: [], motion: "neutral", line: { cue: "dialogue_pop" } },
  talking: { overlays: [], motion: "talking", line: { cue: "dialogue_pop" } },
  angry: { overlays: ["anger"], motion: "angry", sting: { cue: "door_slam" } },
  nervous: { overlays: ["sweat"], motion: "nervous", sting: { cue: "slide_whistle_down" } },
  shocked: { overlays: ["shock", "surprise"], motion: "shocked", sting: { cue: "boing" } },
  smug: { overlays: [], motion: "smug", sting: { cue: "boing", gain: 0.32 } },
  sad: { overlays: [], motion: "sad", sting: { cue: "wah_wah" } },
};

export interface EmotionSpec {
  /** Preferred poses, closest first. */
  poses: readonly SpritePose[];
  emoji: string;
  /** Tailwind background class for the emotion badge. */
  badge: string;
}

/**
 * Every engine emotion. Ending lines use the same enum, e.g.
 * flustered -> nervous, panicked -> shocked, defensive -> angry.
 */
export const EMOTIONS: Record<Emotion, EmotionSpec> = {
  calm: { poses: ["neutral"], emoji: "😌", badge: "bg-white" },
  nervous: { poses: ["nervous", "shocked"], emoji: "😰", badge: "bg-lime-300" },
  defensive: { poses: ["angry", "nervous", "smug"], emoji: "😤", badge: "bg-orange-300" },
  angry: { poses: ["angry"], emoji: "😡", badge: "bg-red-400" },
  sad: { poses: ["sad"], emoji: "😢", badge: "bg-sky-300" },
  scared: { poses: ["nervous", "shocked"], emoji: "😱", badge: "bg-lime-300" },
  smug: { poses: ["smug"], emoji: "😏", badge: "bg-violet-300" },
  amused: { poses: ["smug", "talking"], emoji: "😄", badge: "bg-white" },
  flustered: { poses: ["nervous", "shocked"], emoji: "😳", badge: "bg-pink-300" },
  suspicious: { poses: ["smug", "angry"], emoji: "🤨", badge: "bg-violet-300" },
  shocked: { poses: ["shocked", "nervous"], emoji: "😲", badge: "bg-yellow-300" },
  panicked: { poses: ["shocked", "nervous"], emoji: "🫨", badge: "bg-lime-300" },
  relieved: { poses: ["neutral", "talking"], emoji: "😮‍💨", badge: "bg-white" },
};

/** Used when none of the preferred poses exist. */
export const FALLBACK_POSES = ["neutral", "talking"] as const;

/** Returns the pose to show, or null when no poses exist (render a silhouette). */
export function resolvePose(emotion: Emotion, available: readonly string[], speaking = false): string | null {
  if (available.length === 0) return null;
  if (speaking && available.includes("talking")) return "talking";
  for (const pose of [...(EMOTIONS[emotion]?.poses ?? []), ...FALLBACK_POSES]) {
    if (available.includes(pose)) return pose;
  }
  return available[0];
}

export function poseCue(pose: string | null): PoseCue {
  return (pose && POSE_CUES[pose as SpritePose]) || POSE_CUES.neutral;
}

/** Everything one reply drives, for a character with the given poses. */
export function cuesFor(emotion: Emotion, available: readonly string[], speaking = false) {
  const pose = resolvePose(emotion, available, speaking);
  const cue = poseCue(pose);
  return { pose, overlays: pose ? cue.overlays : [], motion: cue.motion, sting: cue.sting, line: cue.line };
}

/**
 * The sound a reply makes: a sting when the (settled) pose changes into one
 * that has a sting, otherwise the per-line dialogue pop.
 */
export function replySfx(prev: Emotion | undefined, next: Emotion, available: readonly string[]): SfxSpec {
  const before = prev ? resolvePose(prev, available) : null;
  const after = resolvePose(next, available);
  const cue = poseCue(after);
  if (after !== before && cue.sting) return cue.sting;
  return cue.line ?? { cue: "dialogue_pop" };
}

export function portraitSrc(portrait: string, pose: string): string {
  return `/assets/characters/${portrait}/${pose}.webp`;
}

/** Every sprite URL a character can swap to, plus the overlays those poses use (for preloading). */
export function poseAssetUrls(suspect: { portrait: string; poses: readonly string[] }): string[] {
  const overlays = new Set(suspect.poses.flatMap((p) => POSE_CUES[p as SpritePose]?.overlays ?? []));
  return [...suspect.poses.map((p) => portraitSrc(suspect.portrait, p)), ...[...overlays].map((fx) => `/assets/effects/${fx}.webp`)];
}
