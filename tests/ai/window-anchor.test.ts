/** E15b: relative anchors ("once the candles were lit", "before the thud") place a culprit's scene act in the window. */
import { beforeAll, describe, expect, it } from "vitest";
import { findGuiltLeak, windowAnchor } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { guiltProfile, type GuiltProfile } from "@/engine/core-guilt";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let p: GuiltProfile;
beforeAll(async () => {
  c = await loadCase("blackwood");
  p = guiltProfile(c);
});
const m = () => c.solution.murdererId;

describe("E15b anchor events from case data", () => {
  it("timed events only, no whereabouts entries, no people's names", () => {
    expect(p.anchorEvents!.length).toBeGreaterThan(5);
    const all = p.anchorEvents!.flatMap((e) => e.words);
    expect(all).not.toContain("victoria");
    expect(all).not.toContain("reginald");
    expect(all.some((w) => /^\d/.test(w))).toBe(false);
  });
  it("after-type anchors inside the window; before-type only when the event itself is inside", () => {
    expect(windowAnchor("once the candles were lit", p)).toBe(true);
    expect(windowAnchor("before the thud", p)).toBe(true);
    expect(windowAnchor("before the scream", p)).toBe(false); // after the window: an earlier exit is also "before the scream"
    expect(windowAnchor("after the argument", p)).toBe(false);
    expect(windowAnchor("when the body was discovered", p)).toBe(false);
    expect(windowAnchor("after dinner", p)).toBe(false);
  });
});

describe("E15b culprit scene check", () => {
  const LEAK = ["I went into the library once the candles were lit.", "I left the library once the candles were lit.", "I went back to the library after Reginald lit the candles.", "I was in the library before the thud."];
  const PASS = [
    "I left the library before the scream.",
    "I slipped into the library before the scream.",
    "I left the dining room to see my husband.",
    "I came out of the library before the blackout.",
    "I went into the library after the argument.",
    "I was in the dining room once the candles were lit.",
  ];
  for (const l of LEAK) it(`leak: "${l}"`, () => expect(findGuiltLeak(l, p, m())?.kind).toBe("scene"));
  for (const l of PASS) it(`ambiguous or outside the window, passes: "${l}"`, () => expect(findGuiltLeak(l, p, m())).toBeNull());
  it("innocents are untouched by the culprit rule (their first person)", () => {
    expect(findGuiltLeak("I went into the library once the candles were lit.", p, "reginald")).toBeNull();
  });
  it("the over-claim scene rule uses the same anchor", () => {
    expect(findGuiltLeak("She went into the library once the candles were lit.", p, "archibald", { overClaim: { covered: new Set() } })?.overClaim).toBe(true);
  });
  it("case-agnostic: a second case builds its own anchors", async () => {
    const hl = await loadCase("harbor-light", FIXTURES_DIR);
    expect(Array.isArray(guiltProfile(hl).anchorEvents)).toBe(true);
  });
});
