/**
 * Typed access to Toon's machine-readable art specs:
 *   assets/characters/anchors.json  (per-sprite anchor points, 784x1224 canvas, facing LEFT)
 *   assets/effects/effects.json     (overlay placement: anchor + offset x effectScale, pivot, width, layer)
 * Placement math follows docs/ART_BIBLE.md section 5, including mirroring.
 */
import { z } from "zod";
import anchorsJson from "@/assets/characters/anchors.json";
import effectsJson from "@/assets/effects/effects.json";
import type { EffectName, Emotion as SpritePose } from "@/docs/toonMotion";

export type { SpritePose, EffectName };

const Point = z.tuple([z.number(), z.number()]);
const AnchorSet = z
  .object({
    headCenter: Point,
    headTop: Point,
    faceFront: Point,
    headBack: Point,
    bodyCenter: Point,
    bodyBack: Point,
    feet: Point,
  }); // extra keys (e.g. bboxTop) are stripped
const AnchorsFile = z.object({
  canvas: Point,
  sprites: z.record(z.string(), z.record(z.string(), AnchorSet)),
});
const EffectSpec = z.object({
  file: z.string(),
  size: Point,
  anchor: z.string(),
  pivot: Point.optional(),
  width: z.number().optional(),
  offset: Point.optional(),
  layer: z.string(),
});
const EffectsFile = z.object({
  effectScale: z.record(z.string(), z.number()),
  effects: z.record(z.string(), EffectSpec),
});

export const ANCHORS = AnchorsFile.parse(anchorsJson);
export const EFFECTS = EffectsFile.parse(effectsJson);
export const [CANVAS_W, CANVAS_H] = ANCHORS.canvas;

export type AnchorName = keyof z.infer<typeof AnchorSet>;

/** Poses Toon shipped for a portrait id (from anchors.json). Empty -> silhouette. */
export function availablePoses(portrait: string): string[] {
  return Object.keys(ANCHORS.sprites[portrait] ?? {});
}

export interface OverlayPlacement {
  effect: EffectName;
  src: string;
  /** Top-left corner and width as % of the sprite canvas (the portrait box). */
  leftPct: number;
  topPct: number;
  widthPct: number;
  /** Overlay pivot as fractions of the overlay image (for transform-origin). */
  pivot: [number, number];
  /** True when the overlay image itself must be flipped (mirrored sprite). */
  flip: boolean;
  layer: "front" | "behind";
}

/**
 * pos = anchor + offset * effectScale; overlay pivot sits on pos; width * effectScale.
 * Mirrored sprites: anchor.x -> canvasW - anchor.x, offset.x -> -offset.x,
 * pivot.x -> 1 - pivot.x, and the overlay image is flipped.
 */
export function overlayPlacement(
  portrait: string,
  pose: string,
  effect: EffectName,
  { mirrored = false }: { mirrored?: boolean } = {},
): OverlayPlacement | null {
  const spec = EFFECTS.effects[effect];
  const anchors = ANCHORS.sprites[portrait]?.[pose];
  if (!spec || !anchors || !(spec.anchor in anchors) || spec.width === undefined) return null;
  if (spec.layer !== "front" && spec.layer !== "behind") return null;

  const scale = EFFECTS.effectScale[portrait] ?? 1;
  const [ax0, ay] = anchors[spec.anchor as AnchorName];
  const [ox0, oy] = spec.offset ?? [0, 0];
  const [px0, py] = spec.pivot ?? [0.5, 0.5];
  const ax = mirrored ? CANVAS_W - ax0 : ax0;
  const ox = mirrored ? -ox0 : ox0;
  const px = mirrored ? 1 - px0 : px0;

  const w = spec.width * scale;
  const h = w * (spec.size[1] / spec.size[0]);
  const x = ax + ox * scale;
  const y = ay + oy * scale;
  return {
    effect,
    src: `/assets/effects/${spec.file}`,
    leftPct: ((x - px * w) / CANVAS_W) * 100,
    topPct: ((y - py * h) / CANVAS_H) * 100,
    widthPct: (w / CANVAS_W) * 100,
    pivot: [px, py],
    flip: mirrored,
    layer: spec.layer,
  };
}
