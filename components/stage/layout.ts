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
