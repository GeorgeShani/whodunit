/**
 * Interrogation stage geometry, docs/ART_BIBLE.md §7 "Sprite placement rule".
 * Everything is a percentage of the stage frame, so it scales fluidly.
 *
 * - Feet line (sprite canvas y=1200) at 74% of frame height.
 * - Sprite canvas box = 64% of frame height, top = 74 - 64 * 1200/1224 ≈ 11.25%.
 * - Single suspect at x 50%; split-screen confrontation at 28% / 72% with the
 *   LEFT sprite mirrored (sprites face left) so the two face each other.
 * - Relative character scale is baked into the 784x1224 sprites.
 */
import type React from "react";
import { ANCHORS, CANVAS_H, CANVAS_W } from "@/components/characters/sprite-meta";

export const FEET_Y = 1200;
export const FEET_LINE_PCT = 74;
export const SPRITE_BOX_HEIGHT_PCT = 64;
export const SPRITE_BOX_TOP_PCT = FEET_LINE_PCT - (SPRITE_BOX_HEIGHT_PCT * FEET_Y) / CANVAS_H;
export const SINGLE_X_PCT = 50;
export const SPLIT_X_PCT = [28, 72] as const;

export interface StageSlot {
  /** Horizontal feet center, % of frame width. */
  xPct: number;
  /** Face right (scaleX(-1)); overlay offsets mirror with it. */
  mirrored: boolean;
}

/** One actor at centre stage, or a split-screen pair (left mirrored). */
export function stageSlots(count: 1 | 2): StageSlot[] {
  return count === 1
    ? [{ xPct: SINGLE_X_PCT, mirrored: false }]
    : [
        { xPct: SPLIT_X_PCT[0], mirrored: true },
        { xPct: SPLIT_X_PCT[1], mirrored: false },
      ];
}

/** CSS for the sprite canvas box (ART_BIBLE: height 64%, top 11.25%, left x, translateX(-50%)). */
export function spriteBoxStyle(slot: StageSlot) {
  return {
    left: `${slot.xPct}%`,
    top: `${SPRITE_BOX_TOP_PCT}%`,
    height: `${SPRITE_BOX_HEIGHT_PCT}%`,
    aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
    transform: "translateX(-50%)",
  } as const;
}

/** Feet-to-head height of a character, % of frame height (Reginald ≈ 61.3%). */
export function figureHeightPct(portrait: string, pose = "neutral"): number | null {
  const a = ANCHORS.sprites[portrait]?.[pose];
  if (!a) return null;
  return ((FEET_Y - a.headTop[1]) / CANVAS_H) * SPRITE_BOX_HEIGHT_PCT;
}

/** Rear body half-width in canvas px (neutral pose), from anchors.json. */
function bodyHalfWidth(portrait: string): number | null {
  const a = ANCHORS.sprites[portrait]?.neutral;
  return a ? a.bodyBack[0] - a.feet[0] : null;
}

const BASE_SHADOW_PCT = 32;
const REFERENCE = "reginald";

/**
 * Contact-shadow width, % of the sprite box width: ≈32% for a regular build,
 * wider for wide characters (≈68% for Archibald), derived from anchors.json.
 */
export function contactShadowPct(portrait: string): number {
  const ref = bodyHalfWidth(REFERENCE);
  const me = bodyHalfWidth(portrait);
  if (!ref || !me) return BASE_SHADOW_PCT;
  return Math.min(72, Math.max(24, (BASE_SHADOW_PCT * me) / ref));
}

/**
 * Phone-portrait "bust" framing. The ART_BIBLE full-body placement (feet line 74%, box 64%) leaves a face a few
 * pixels wide on a stacked phone stage (~250 px tall), so below the `md` breakpoint in portrait the sprite box
 * is scaled up and shifted so the HEAD fills a fixed share of the stage and sits at a fixed point, whatever the
 * character's build or pose (head size and position come from anchors.json; nothing is hard-coded per character).
 * Desktop, tablets and landscape keep the art-bible placement untouched: the bust values are only applied by the
 * `.sprite-box` rule in globals.css inside that media query.
 */
export const BUST_HEAD_PCT = { 1: 42, 2: 34 } as const;
/** Where the face centre lands, % of stage height. Leaves the top ~25% free for the stress meter and mood badge. */
export const BUST_FACE_Y_PCT = 52;
/** Sprite box height limits, % of stage height (never smaller than the art-bible box). */
export const BUST_MIN_PCT = SPRITE_BOX_HEIGHT_PCT;
export const BUST_MAX_PCT = 360;
/** Bounds on how far a pose's drawn head size (vs neutral) may change the sprite scale. */
export const BUST_POSE_GROWTH = 1.45;
export const BUST_POSE_SHRINK = 0.7;

export interface BustFrame {
  /** Box height, % of stage height. */
  heightPct: number;
  /** Box top, % of stage height. */
  topPct: number;
  /** Horizontal shift, as a FRACTION of the box width, that centres the face on the slot's x. */
  shiftX: number;
}

/** Head height in canvas px (headTop to the mirrored point below headCenter). */
function headHeightPx(portrait: string): number | null {
  const a = ANCHORS.sprites[portrait]?.neutral;
  return a ? 2 * (a.headCenter[1] - a.headTop[1]) : null;
}

/** Bust frame for one actor in `pose`, or null when the character has no anchors (silhouette). */
export function bustFrame(portrait: string, pose: string | null, count: 1 | 2, mirrored: boolean): BustFrame | null {
  const head = headHeightPx(portrait);
  const a = ANCHORS.sprites[portrait]?.[pose ?? "neutral"] ?? ANCHORS.sprites[portrait]?.neutral;
  if (!head || !a) return null;
  // Size by the head the pose actually draws, within limits: bowed poses (small head) are enlarged, lean-ins
  // (big head) are reduced so the face stays about the same size, but a pose never changes the sprite scale by more than these bounds.
  const poseHead = 2 * (a.headCenter[1] - a.headTop[1]);
  const effHead = Math.min(head * BUST_POSE_GROWTH, Math.max(head * BUST_POSE_SHRINK, poseHead));
  const heightPct = Math.min(BUST_MAX_PCT, Math.max(BUST_MIN_PCT, (BUST_HEAD_PCT[count] * CANVAS_H) / effHead));
  const [hx, hy] = a.headCenter;
  const faceX = mirrored ? CANVAS_W - hx : hx;
  return {
    heightPct,
    topPct: BUST_FACE_Y_PCT - (heightPct * hy) / CANVAS_H,
    shiftX: -(faceX - CANVAS_W / 2) / CANVAS_W,
  };
}

/** The CSS custom properties `.sprite-box` reads: art-bible values by default, bust values on phone portrait. */
export function spriteBoxVars(slot: StageSlot, bust: BustFrame | null) {
  const base = spriteBoxStyle(slot);
  return {
    left: base.left,
    aspectRatio: base.aspectRatio,
    "--sb-top": base.top,
    "--sb-h": base.height,
    ...(bust ? { "--bust-top": `${bust.topPct}%`, "--bust-h": `${bust.heightPct}%`, "--bust-shift": String(bust.shiftX) } : { "--bust-top": base.top, "--bust-h": base.height, "--bust-shift": "0" }),
  } as React.CSSProperties;
}
