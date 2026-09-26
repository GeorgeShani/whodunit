import { describe, expect, it } from "vitest";
import { ANCHORS, CANVAS_W, overlayPlacement } from "@/components/characters/sprite-meta";
import {
  contactShadowPct,
  figureHeightPct,
  FEET_LINE_PCT,
  SPRITE_BOX_HEIGHT_PCT,
  SPRITE_BOX_TOP_PCT,
  spriteBoxStyle,
  stageSlots,
} from "@/components/stage/layout";
import { FlashGuard, maxFlashesInWindow, MIN_STORM_GAP_MS, nextStormDelay, STORM_FRAMES, thunderDelay } from "@/components/stage/lightning";

describe("stage layout (ART_BIBLE §7 sprite placement)", () => {
  it("puts the feet line at 74% with a 64% sprite box (top ≈ 11.25%)", () => {
    expect(SPRITE_BOX_HEIGHT_PCT).toBe(64);
    expect(SPRITE_BOX_TOP_PCT).toBeCloseTo(11.25, 1);
    // canvas y=1200 inside the box lands on the feet line
    expect(SPRITE_BOX_TOP_PCT + (SPRITE_BOX_HEIGHT_PCT * 1200) / 1224).toBeCloseTo(FEET_LINE_PCT, 6);
  });

  it("a single suspect stands at x 50%, unmirrored", () => {
    expect(stageSlots(1)).toEqual([{ xPct: 50, mirrored: false }]);
    expect(spriteBoxStyle(stageSlots(1)[0])).toMatchObject({ left: "50%", height: "64%", transform: "translateX(-50%)" });
  });

  it("split-screen is 28% / 72% with the LEFT sprite mirrored so they face each other", () => {
    const [l, r] = stageSlots(2);
    expect(l).toEqual({ xPct: 28, mirrored: true });
    expect(r).toEqual({ xPct: 72, mirrored: false });
    expect(spriteBoxStyle(l).left).toBe("28%");
  });

  it("uses fluid (percentage) units only", () => {
    for (const slot of [...stageSlots(1), ...stageSlots(2)]) {
      const st = spriteBoxStyle(slot);
      for (const v of [st.left, st.top, st.height]) expect(v).toMatch(/%$/);
    }
  });

  it("Reginald stands ≈61.3% of frame height; the others follow the scale baked into the sprites", () => {
    expect(figureHeightPct("reginald")).toBeCloseTo(61.3, 1);
    expect(figureHeightPct("victoria")!).toBeGreaterThan(53);
    expect(figureHeightPct("victoria")!).toBeLessThan(58);
    expect(figureHeightPct("archibald")!).toBeGreaterThan(45);
    expect(figureHeightPct("archibald")!).toBeLessThan(51);
    expect(figureHeightPct("gregory")!).toBeGreaterThan(35);
    expect(figureHeightPct("gregory")!).toBeLessThan(41);
    expect(figureHeightPct("nobody")).toBeNull();
  });

  it("contact shadow ≈32% of the box, ≈68% for wide Archibald", () => {
    expect(contactShadowPct("reginald")).toBeCloseTo(32, 5);
    expect(contactShadowPct("archibald")).toBeGreaterThan(60);
    expect(contactShadowPct("archibald")).toBeLessThanOrEqual(72);
    expect(contactShadowPct("nobody")).toBe(32);
  });

  it("the mirrored left actor gets mirrored overlay offsets (sweat/anger swap sides)", () => {
    const [left] = stageSlots(2);
    const normal = overlayPlacement("victoria", "angry", "anger")!;
    const mirrored = overlayPlacement("victoria", "angry", "anger", { mirrored: left.mirrored })!;
    expect(mirrored.leftPct).toBeCloseTo(100 - normal.leftPct - normal.widthPct);
    expect(mirrored.flip).toBe(true);
    const headTopX = (ANCHORS.sprites.victoria.angry.headTop[0] / CANVAS_W) * 100;
    expect(mirrored.leftPct + mirrored.widthPct / 2).toBeLessThan(100 - headTopX);
  });
});

describe("lightning (ART_BIBLE §7.1) and photosensitivity", () => {
  it("one storm is the 33 ms / 90 ms / 1-frame swap", () => {
    expect(STORM_FRAMES.map(([t]) => t)).toEqual([0, 33, 123, 140]);
    expect(STORM_FRAMES.filter(([, on]) => on)).toHaveLength(2);
  });

  it("thunder follows 300-600 ms later; storms are at least 9 s apart", () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(thunderDelay(() => r)).toBeGreaterThanOrEqual(300);
      expect(thunderDelay(() => r)).toBeLessThan(600);
      expect(nextStormDelay(() => r)).toBeGreaterThanOrEqual(MIN_STORM_GAP_MS);
    }
  });

  it("the real schedule never exceeds 3 flashes in any second", () => {
    const onsets: number[] = [];
    let t = 2500;
    for (let i = 0; i < 200; i++) {
      for (const [at, on] of STORM_FRAMES) if (on) onsets.push(t + at);
      t += nextStormDelay(() => (i * 7919) % 100 / 100);
    }
    expect(maxFlashesInWindow(onsets)).toBeLessThanOrEqual(3);
  });

  it("the guard refuses a 4th flash inside one second, then allows again", () => {
    const g = new FlashGuard();
    expect([0, 100, 200, 300].map((t) => g.allow(t))).toEqual([true, true, true, false]);
    expect(g.allow(999)).toBe(false);
    expect(g.allow(1001)).toBe(true);
    expect(maxFlashesInWindow([0, 100, 200, 300])).toBe(4);
  });
});
