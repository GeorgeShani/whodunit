import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANCHORS, availablePoses, CANVAS_W, EFFECTS, overlayPlacement } from "@/components/characters/sprite-meta";
import { CUES } from "@/components/effects/audio";
import { cuesFor, EMOTIONS, poseAssetUrls, portraitSrc, POSE_CUES, replySfx, resolvePose } from "@/components/effects/emotion-map";
import { spriteVariants } from "@/docs/toonMotion";
import * as toonMotion from "@/docs/toonMotion";
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
    for (const { overlays } of Object.values(POSE_CUES)) {
      for (const fx of overlays) {
        expect(EFFECTS.effects[fx]).toBeDefined();
        expect(existsSync(path.join(process.cwd(), "assets/effects", EFFECTS.effects[fx].file))).toBe(true);
      }
    }
  });
});

describe("emotion -> pose mapping", () => {
  it("maps every engine emotion to a shipped pose for every suspect", () => {
    expect(Object.keys(EMOTIONS).sort()).toEqual([...EmotionSchema.options].sort());
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

describe("one emotion map drives pose, overlay, motion and sound (ART_BIBLE §6)", () => {
  it("is the only per-emotion table: Toon's motion file no longer carries its own emotionMap", () => {
    expect("emotionMap" in toonMotion).toBe(false);
    expect(Object.keys(POSE_CUES).sort()).toEqual([...POSES].sort());
  });

  it("every pose has a motion variant, and every sound cue has .ogg and .mp3 files", () => {
    for (const [pose, cue] of Object.entries(POSE_CUES)) {
      expect(spriteVariants[cue.motion], pose).toBeDefined();
      for (const sfx of [cue.sting, cue.line].filter(Boolean)) {
        for (const f of CUES[sfx!.cue].files) {
          for (const ext of ["ogg", "mp3"]) expect(existsSync(path.join(process.cwd(), "assets/audio", `${f}.${ext}`)), `${f}.${ext}`).toBe(true);
        }
      }
    }
    for (const def of Object.values(CUES)) {
      for (const f of def.files) expect(existsSync(path.join(process.cwd(), "assets/audio", `${f}.ogg`)), f).toBe(true);
    }
  });

  it("follows the ART_BIBLE table", () => {
    const all = availablePoses("reginald");
    expect(cuesFor("angry", all)).toMatchObject({ pose: "angry", overlays: ["anger"], motion: "angry", sting: { cue: "emo_angry" } });
    expect(cuesFor("nervous", all)).toMatchObject({ pose: "nervous", overlays: ["sweat"], sting: { cue: "emo_nervous" } });
    expect(cuesFor("shocked", all)).toMatchObject({ pose: "shocked", overlays: ["shock", "surprise"], sting: { cue: "emo_shocked" } });
    expect(cuesFor("smug", all).sting).toEqual({ cue: "emo_smug" });
    expect(cuesFor("sad", all).sting).toEqual({ cue: "emo_sad" });
    expect(cuesFor("calm", all)).toMatchObject({ pose: "neutral", overlays: [], line: { cue: "dialogue_pop" } });
    expect(cuesFor("angry", all, true)).toMatchObject({ pose: "talking", motion: "talking", overlays: [] });
    expect(cuesFor("angry", [])).toMatchObject({ pose: null, overlays: [] });
  });

  it("maps the ending emotions: flustered -> nervous, panicked -> shocked, defensive -> angry", () => {
    const all = availablePoses("victoria");
    expect(resolvePose("flustered", all)).toBe("nervous");
    expect(resolvePose("panicked", all)).toBe("shocked");
    expect(resolvePose("defensive", all)).toBe("angry");
  });

  it("each emotion has a badge emoji and colour", () => {
    for (const e of EmotionSchema.options) {
      expect(EMOTIONS[e].emoji.length).toBeGreaterThan(0);
      expect(EMOTIONS[e].badge).toMatch(/^bg-/);
    }
  });

  it("a reply stings when the pose changes, otherwise pops", () => {
    const all = availablePoses("gregory");
    expect(replySfx("calm", "angry", all)).toEqual({ cue: "emo_angry" });
    expect(replySfx("angry", "defensive", all)).toEqual({ cue: "dialogue_pop" }); // same pose: no repeat slam
    expect(replySfx("angry", "calm", all)).toEqual({ cue: "dialogue_pop" });
    expect(replySfx(undefined, "scared", all)).toEqual({ cue: "emo_nervous" });
    expect(replySfx("calm", "angry", [])).toEqual({ cue: "dialogue_pop" });
  });

  it("preloads every pose sprite plus the overlays those poses use", () => {
    const urls = poseAssetUrls({ portrait: "reginald", poses: availablePoses("reginald") });
    expect(urls).toContain("/assets/characters/reginald/angry.webp");
    expect(urls).toContain("/assets/effects/sweat.webp");
    expect(urls.filter((u) => u.includes("/characters/"))).toHaveLength(7);
    expect(new Set(urls).size).toBe(urls.length);
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
