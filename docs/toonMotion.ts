// WHODUNIT?! — toon motion presets for Framer Motion (framer-motion >= 10 or `motion/react`).
// Source of truth: docs/ART_BIBLE.md §6. Sprites face LEFT; front = -x, back = +x.
// Apply sprite variants on a motion element with style={{ originX: 0.5, originY: 1 }} so squash/stretch pivots on the feet.
import type { Variants, Transition } from "framer-motion";

export type CharacterId = "reginald" | "victoria" | "archibald" | "gregory";
export type Emotion = "neutral" | "talking" | "angry" | "nervous" | "shocked" | "smug" | "sad";
export type EffectName =
  | "impact" | "sweat" | "anger" | "confusion" | "surprise" | "speed"
  | "discovery" | "shock" | "lightning" | "smoke" | "dust";
export type SfxCue =
  | "boing" | "slide_whistle" | "impact" | "wah_wah" | "thunder"
  | "door_slam" | "fanfare" | "siren" | "dialogue_pop";

export const spriteSrc = (id: CharacterId, e: Emotion) => `/assets/characters/${id}/${e}.webp`;
export const effectSrc = (e: EffectName) => `/assets/effects/${e}.webp`;

/** Rubbery springs */
export const springs = {
  snappy: { type: "spring", stiffness: 520, damping: 18, mass: 0.8 },
  bouncy: { type: "spring", stiffness: 300, damping: 10, mass: 1 },
  heavy:  { type: "spring", stiffness: 200, damping: 14, mass: 1.6 },
  soft:   { type: "spring", stiffness: 140, damping: 20, mass: 1 },
} satisfies Record<string, Transition>;

/** Per-emotion sprite motion. Animate `animate={emotion}` after swapping the sprite src. */
export const spriteVariants: Variants = {
  neutral: { // idle breathing
    scaleX: [1, 0.995, 1], scaleY: [1, 1.015, 1], y: 0, rotate: 0, x: 0,
    transition: { duration: 2.4, ease: "easeInOut", repeat: Infinity },
  },
  talking: { // bouncy bob with a little stretch on each syllable
    scaleX: [1, 0.98, 1.02, 1], scaleY: [1, 1.03, 0.98, 1], y: [0, -6, 0, 0], rotate: 0, x: 0,
    transition: { duration: 0.36, ease: "easeInOut", repeat: Infinity },
  },
  angry: { // stomp-squash, then a hot shake
    scaleX: [1, 1.15, 0.92, 1.04, 1], scaleY: [1, 0.85, 1.1, 0.97, 1],
    x: [0, 0, -6, 6, -4, 4, 0], y: 0, rotate: 0,
    transition: {
      scaleX: { duration: 0.45, times: [0, 0.25, 0.55, 0.8, 1], ease: "easeOut" },
      scaleY: { duration: 0.45, times: [0, 0.25, 0.55, 0.8, 1], ease: "easeOut" },
      x: { duration: 0.3, delay: 0.4, repeat: 2, ease: "linear" },
    },
  },
  nervous: { // posture collapse + endless jitter
    scaleY: 0.94, scaleX: 1.03, y: 4, rotate: -1.5,
    x: [0, -2, 2, -1, 1, 0],
    transition: {
      scaleY: springs.soft, scaleX: springs.soft, y: springs.soft, rotate: springs.soft,
      x: { duration: 0.3, repeat: Infinity, ease: "linear" },
    },
  },
  shocked: { // anticipation squash -> huge stretch/hop -> settle
    scaleX: [1, 1.2, 0.8, 1.05, 0.98, 1], scaleY: [1, 0.8, 1.35, 0.95, 1.03, 1],
    y: [0, 0, -40, 0, -6, 0], rotate: 0, x: 0,
    transition: { duration: 0.6, times: [0, 0.15, 0.4, 0.65, 0.85, 1], ease: "easeOut" },
  },
  smug: { // lean back (top toward +x) with nose up
    rotate: 4, y: -4, scaleY: 1.02, scaleX: 1, x: 0,
    transition: springs.bouncy,
  },
  sad: { // droop forward and sink, then a slow sway
    scaleY: 0.94, scaleX: 1.02, y: 8, x: 0,
    rotate: [-2, -3, -2],
    transition: {
      scaleY: { duration: 0.8, ease: "easeOut" }, scaleX: { duration: 0.8, ease: "easeOut" }, y: { duration: 0.8, ease: "easeOut" },
      rotate: { duration: 3, repeat: Infinity, ease: "easeInOut" },
    },
  },
};

/** Overlay animations. Use initial="hidden" animate="show" exit="exit" plus the named variant. */
export const overlayVariants: Variants = {
  hidden: { scale: 0, opacity: 0, rotate: 0 },
  popIn: { // default: 0 -> 1.2 -> 1 with a jiggle
    scale: [0, 1.2, 1], opacity: 1, rotate: [0, -8, 6, 0],
    transition: { duration: 0.35, times: [0, 0.6, 1], ease: "easeOut" },
  },
  throb: { scale: [1, 1.12, 1], opacity: 1, transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" } },
  drip: { y: [0, 14], opacity: [1, 0], scale: 1, transition: { duration: 0.9, repeat: Infinity, ease: "easeIn" } },
  spin: { rotate: 360, scale: 1, opacity: 1, transition: { duration: 2.4, repeat: Infinity, ease: "linear" } },
  slowSpin: { rotate: [0, 360], scale: [0, 1.25, 1], opacity: 1,
    transition: { rotate: { duration: 8, repeat: Infinity, ease: "linear" }, scale: { duration: 0.3, times: [0, 0.6, 1] } } },
  punch: { scale: [0, 1.4, 1], opacity: [1, 1, 0], rotate: [0, 10, 0],
    transition: { duration: 0.6, times: [0, 0.3, 1], ease: "easeOut" } },
  whoosh: { x: [40, 0], opacity: [0, 1, 0], scale: 1, transition: { duration: 0.35, ease: "easeOut" } },
  puff: { scale: [0.3, 1.1], opacity: [1, 0], transition: { duration: 0.6, ease: "easeOut" } },
  flash: { opacity: [0, 1, 0.2, 1, 0], scale: 1, transition: { duration: 0.5, times: [0, 0.1, 0.3, 0.45, 1] } },
  exit: { scale: 0.6, opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
};

/** Which overlay loop each effect uses after its intro. */
export const effectMotion: Record<EffectName, { intro: string; loop?: string; durationMs?: number }> = {
  impact:    { intro: "punch", durationMs: 600 },
  sweat:     { intro: "popIn", loop: "drip" },
  anger:     { intro: "popIn", loop: "throb" },
  confusion: { intro: "popIn", loop: "spin" },
  surprise:  { intro: "popIn", durationMs: 900 },
  speed:     { intro: "whoosh", durationMs: 350 },
  discovery: { intro: "popIn", loop: "throb", durationMs: 1400 },
  shock:     { intro: "slowSpin" },
  lightning: { intro: "flash", durationMs: 500 },
  smoke:     { intro: "puff", durationMs: 600 },
  dust:      { intro: "puff", durationMs: 600 },
};

/**
 * Emotion -> sprite + overlays + SFX lives in ONE place in the app:
 * components/effects/emotion-map.ts (POSE_CUES + EMOTIONS), built from ART_BIBLE §6.
 */

/** Scene-level beats (apply to the stage/camera container or to a character wrapper). */
export const beatVariants: Variants = {
  cameraShake: { x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.35, ease: "linear" } },
  cameraPunchIn: { scale: [1, 1.08], transition: springs.heavy },
  accuse: { x: [0, 12, -30, -20], scaleX: [1, 0.92, 1.1, 1], transition: { duration: 0.4, times: [0, 0.3, 0.7, 1], ease: "easeOut" } },
  victoryHop: { y: [0, -30, 0, -10, 0], scaleY: [1, 1.08, 0.9, 1.03, 1], transition: { duration: 0.7, ease: "easeOut" } },
  desaturate: { filter: ["grayscale(0)", "grayscale(0.6)", "grayscale(0)"], transition: { duration: 1.4, times: [0, 0.3, 1] } },
  enter: { // slide in from the right (they face left), landing squash
    x: ["60vw", "0vw"], scaleX: [1, 1, 1.15, 0.95, 1], scaleY: [1, 1, 0.85, 1.05, 1],
    transition: { x: springs.snappy, scaleX: { duration: 0.5, delay: 0.25 }, scaleY: { duration: 0.5, delay: 0.25 } },
  },
  exit: { // anticipation lean back, then zip off to the left
    rotate: [0, 6, -4], x: ["0vw", "2vw", "-70vw"], opacity: [1, 1, 0],
    transition: { duration: 0.5, times: [0, 0.3, 1], ease: "easeIn" },
  },
  whiteFlash: { opacity: [0, 1, 0, 0.8, 0], transition: { duration: 0.6, times: [0, 0.08, 0.25, 0.35, 1] } },
};

/** Beat recipes: what to play, in order (ms offsets). */
export const beats = {
  accusation:      [{ at: 0, accuser: "accuse", sfx: "impact" }, { at: 120, stage: "cameraShake", effect: "impact", on: "accused.faceFront" }, { at: 200, accused: "shocked" }],
  clueDiscovered:  [{ at: 0, investigator: "discovery@headTop", sfx: "fanfare" }, { at: 0, clue: "popIn" }],
  wrongAccusation: [{ at: 0, stage: "desaturate", sfx: "siren" }, { at: 300, accuser: "sad", effect: "confusion", sfx: "wah_wah" }, { at: 300, accused: "smug" }],
  caseSolved:      [{ at: 0, stage: "whiteFlash", sfx: "thunder" }, { at: 150, culprit: "shocked", effect: "shock" }, { at: 900, culprit: "angry" }, { at: 900, others: "victoryHop", stage: "cameraPunchIn", sfx: "fanfare" }],
  lightningTransition: [{ at: 0, stage: "whiteFlash", effect: "lightning" }, { at: 150, swapScene: true }, { at: 400, sfx: "thunder" }],
  entrance:        [{ at: 0, character: "enter", effect: "speed", sfx: "slide_whistle" }, { at: 250, effect: "dust@feet" }],
  exit:            [{ at: 0, character: "exit", effect: "smoke@feet", sfx: "door_slam" }],
} as const;
