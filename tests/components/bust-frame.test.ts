import { describe, expect, it } from "vitest";
import { ANCHORS, CANVAS_H, CANVAS_W } from "@/components/characters/sprite-meta";
import {
  BUST_FACE_Y_PCT,
  BUST_HEAD_PCT,
  BUST_MAX_PCT,
  BUST_MIN_PCT,
  bustFrame,
  SPRITE_BOX_HEIGHT_PCT,
  spriteBoxStyle,
  spriteBoxVars,
} from "@/components/stage/layout";

const SUSPECTS = ["reginald", "victoria", "archibald", "gregory"];
const poses = (id: string) => Object.keys(ANCHORS.sprites[id]);

/** Where a pose's face lands in a unit stage (0..1) for a bust frame, from the frame maths alone. */
function faceBox(id: string, pose: string, count: 1 | 2, mirrored: boolean) {
  const f = bustFrame(id, pose, count, mirrored)!;
  const a = ANCHORS.sprites[id][pose];
  const hh = (a.headCenter[1] - a.headTop[1]) / CANVAS_H; // half head height, fraction of the box
  const boxH = f.heightPct / 100;
  const boxW = (boxH * CANVAS_W) / CANVAS_H; // fraction of stage height
  const cy = f.topPct / 100 + (boxH * a.headCenter[1]) / CANVAS_H;
  return { cy, halfH: hh * boxH, boxW, f };
}

describe("phone-portrait bust framing (bustFrame)", () => {
  it("is null for a character without anchors (silhouette fallback)", () => {
    expect(bustFrame("nobody", "neutral", 1, false)).toBeNull();
  });

  it("puts the face centre at BUST_FACE_Y_PCT of the stage for every suspect and pose", () => {
    for (const id of SUSPECTS) {
      for (const pose of poses(id)) {
        const { cy } = faceBox(id, pose, 1, false);
        expect(cy * 100).toBeCloseTo(BUST_FACE_Y_PCT, 5);
      }
    }
  });

  it("keeps every face inside the stage, clear of the top meter band and the bottom edge", () => {
    for (const id of SUSPECTS) {
      for (const pose of poses(id)) {
        for (const count of [1, 2] as const) {
          const { cy, halfH } = faceBox(id, pose, count, false);
          expect(cy - halfH).toBeGreaterThan(0.22); // below the stress meter / mood badge band
          expect(cy + halfH).toBeLessThan(0.85);
        }
      }
    }
  });

  it("neutral heads take BUST_HEAD_PCT of the stage height (unless clamped)", () => {
    for (const id of SUSPECTS) {
      const { halfH, f } = faceBox(id, "neutral", 1, false);
      if (f.heightPct > BUST_MIN_PCT && f.heightPct < BUST_MAX_PCT) expect(halfH * 2 * 100).toBeCloseTo(BUST_HEAD_PCT[1], 5);
    }
  });

  it("scales a pose's head within bounds, never below the art-bible box or above the max", () => {
    for (const id of SUSPECTS) {
      for (const pose of poses(id)) {
        const f = bustFrame(id, pose, 1, false)!;
        expect(f.heightPct).toBeGreaterThanOrEqual(BUST_MIN_PCT);
        expect(f.heightPct).toBeLessThanOrEqual(BUST_MAX_PCT);
      }
    }
  });

  it("shows smaller heads for two-actor splits than for a single actor", () => {
    for (const id of SUSPECTS) {
      expect(bustFrame(id, "neutral", 2, false)!.heightPct).toBeLessThan(bustFrame(id, "neutral", 1, false)!.heightPct);
    }
  });

  it("shifts the box so the face is centred on the slot, and mirrors the shift for a mirrored slot", () => {
    for (const id of SUSPECTS) {
      for (const pose of poses(id)) {
        const a = ANCHORS.sprites[id][pose];
        const plain = bustFrame(id, pose, 1, false)!;
        const mirrored = bustFrame(id, pose, 1, true)!;
        expect(plain.shiftX).toBeCloseTo(-(a.headCenter[0] - CANVAS_W / 2) / CANVAS_W, 8);
        // face x after the shift (fraction of box width, box centred on the slot) is 0.5 of the box = slot centre
        expect(0.5 + (a.headCenter[0] - CANVAS_W / 2) / CANVAS_W + plain.shiftX).toBeCloseTo(0.5, 8);
        expect(0.5 + (CANVAS_W - a.headCenter[0] - CANVAS_W / 2) / CANVAS_W + mirrored.shiftX).toBeCloseTo(0.5, 8);
      }
    }
  });

  it("falls back to the neutral anchors for an unknown pose", () => {
    expect(bustFrame("reginald", "no-such-pose", 1, false)).toEqual(bustFrame("reginald", "neutral", 1, false));
    expect(bustFrame("reginald", null, 1, false)).toEqual(bustFrame("reginald", "neutral", 1, false));
  });
});

describe("spriteBoxVars", () => {
  const slot = { x: 50, mirrored: false } as never;

  it("always carries the art-bible box (desktop, tablet, landscape) as the default values", () => {
    const v = spriteBoxVars(slot, bustFrame("reginald", "neutral", 1, false)) as Record<string, string>;
    const base = spriteBoxStyle(slot);
    expect(v["--sb-top"]).toBe(base.top);
    expect(v["--sb-h"]).toBe(base.height);
    expect(v["--sb-h"]).toBe(`${SPRITE_BOX_HEIGHT_PCT}%`);
    expect(v.left).toBe(base.left);
  });

  it("exposes the bust values separately", () => {
    const bust = bustFrame("victoria", "angry", 1, false)!;
    const v = spriteBoxVars(slot, bust) as Record<string, string>;
    expect(v["--bust-h"]).toBe(`${bust.heightPct}%`);
    expect(v["--bust-top"]).toBe(`${bust.topPct}%`);
    expect(Number(v["--bust-shift"])).toBe(bust.shiftX);
  });

  it("without anchors the bust vars equal the art-bible box (no shift)", () => {
    const v = spriteBoxVars(slot, null) as Record<string, string>;
    expect(v["--bust-h"]).toBe(v["--sb-h"]);
    expect(v["--bust-top"]).toBe(v["--sb-top"]);
    expect(v["--bust-shift"]).toBe("0");
  });
});
