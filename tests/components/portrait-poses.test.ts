import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMOTION_POSE_PREFERENCES, portraitSrc, resolvePose } from "@/components/characters/portrait-poses";
import { ANCHORS, availablePoses, CANVAS_W, EFFECTS, overlayPlacement } from "@/components/characters/sprite-meta";
import { emotionMap } from "@/docs/toonMotion";
import { EmotionSchema } from "@/engine/types";

const CAST = ["reginald", "victoria", "archibald", "gregory"];
const POSES = ["neutral", "talking", "angry", "nervous", "shocked", "smug", "sad"];

describe("sprite assets", () => {
  it("every anchors.json pose has a sprite file on disk, and all 4 x 7 exist", () => {
    for (const id of CAST) {
      expect(availablePoses(id).sort()).toEqual([...POSES].sort());
      for (const pose of availablePoses(id)) {
        expect(existsSync(path.join(process.cwd(), "assets/characters", id, `${pose}.webp`)), `${id}/${pose}`).toBe(true);
      }
    }
    expect(availablePoses("nobody")).toEqual([]);
  });

  it("every overlay referenced by the emotion map has a file and spec", () => {
    for (const { overlays } of Object.values(emotionMap)) {
      for (const fx of overlays) {
        expect(EFFECTS.effects[fx]).toBeDefined();
        expect(existsSync(path.join(process.cwd(), "assets/effects", EFFECTS.effects[fx].file))).toBe(true);
      }
    }
  });
});

describe("emotion -> pose mapping", () => {
  it("maps every engine emotion to a shipped pose for every suspect", () => {
    expect(Object.keys(EMOTION_POSE_PREFERENCES).sort()).toEqual([...EmotionSchema.options].sort());
    for (const id of CAST) {
      for (const emotion of EmotionSchema.options) {
        expect(POSES).toContain(resolvePose(emotion, availablePoses(id)));
      }
    }
  });

  it("uses closest matches, the talking pose while speaking, and falls back sensibly", () => {
    const all = availablePoses("reginald");
    expect(resolvePose("calm", all)).toBe("neutral");
    expect(resolvePose("panicked", all)).toBe("shocked");
    expect(resolvePose("suspicious", all)).toBe("smug");
    expect(resolvePose("angry", all, true)).toBe("talking");
    expect(resolvePose("angry", ["neutral", "sad"])).toBe("neutral");
    expect(resolvePose("angry", ["weird"])).toBe("weird");
    expect(resolvePose("angry", [])).toBeNull();
    expect(portraitSrc("gregory", "sad")).toBe("/assets/characters/gregory/sad.webp");
  });
});

describe("overlayPlacement (ART_BIBLE §5)", () => {
  it("places sweat at headTop + offset * effectScale with the pivot on that point", () => {
    const p = overlayPlacement("reginald", "nervous", "sweat")!;
    const [ax, ay] = ANCHORS.sprites.reginald.nervous.headTop;
    const w = 300; // effectScale 1.0
    expect(p.widthPct).toBeCloseTo((w / CANVAS_W) * 100);
    // pivot (0.5, 0.62) of a square overlay lands on anchor + offset (40, 50)
    expect((p.leftPct / 100) * CANVAS_W + 0.5 * w).toBeCloseTo(ax + 40);
    expect((p.topPct / 100) * 1224 + 0.62 * w).toBeCloseTo(ay + 50);
    expect(p.flip).toBe(false);
    expect(p.layer).toBe("front");
  });

  it("scales with the character's effectScale", () => {
    const g = overlayPlacement("gregory", "angry", "anger")!;
    expect(g.widthPct).toBeCloseTo(((180 * 0.8) / CANVAS_W) * 100);
  });

  it("mirrors the anchor, the offset, the pivot and the overlay image", () => {
    for (const id of CAST) {
      const normal = overlayPlacement(id, "angry", "anger")!;
      const mirrored = overlayPlacement(id, "angry", "anger", { mirrored: true })!;
      // Mirrored box is the horizontal reflection of the normal box across the canvas center.
      expect(mirrored.leftPct).toBeCloseTo(100 - normal.leftPct - normal.widthPct);
      expect(mirrored.topPct).toBeCloseTo(normal.topPct);
      expect(mirrored.pivot[0]).toBeCloseTo(1 - normal.pivot[0]);
      expect(mirrored.flip).toBe(true);
      // anger sits toward the BACK of the head (+x when facing left, -x when mirrored).
      const headTopX = (ANCHORS.sprites[id].angry.headTop[0] / CANVAS_W) * 100;
      expect(normal.leftPct + normal.widthPct / 2).toBeGreaterThan(headTopX);
      expect(mirrored.leftPct + mirrored.widthPct / 2).toBeLessThan(100 - headTopX);
    }
  });

  it("returns null for screen-anchored effects or unknown sprites", () => {
    expect(overlayPlacement("reginald", "neutral", "lightning")).toBeNull();
    expect(overlayPlacement("nobody", "neutral", "sweat")).toBeNull();
  });
});
