/** Validator warnings for leak paths around coreGuilt (engine/case-validation.ts checkGuiltLeakPaths). */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseWarnings, checkGuiltLeakPaths } from "@/engine/case-validation";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const victoria = (x: LoadedCase) => x.characters.find((ch) => ch.id === "victoria")!;

describe("guilt leak-path warnings", () => {
  it("case one (after #43) is clean", () => {
    expect(checkGuiltLeakPaths(c)).toEqual([]);
    expect(checkCaseWarnings(c).filter((w) => /murder window|names the culprit/.test(w.message))).toEqual([]);
  });

  it("(a) warns when a murder-window fact about the culprit is unhidden by a non-core secret (the pre-#43 letter burning)", () => {
    const x = structuredClone(c);
    victoria(x).secrets.find((s) => s.id === "s-victoria-new-will")!.relatedFactIds.push("ev-letter-burned");
    const w = checkGuiltLeakPaths(x);
    expect(w).toHaveLength(1);
    expect(w[0].path).toContain("ev-letter-burned");
    expect(w[0].message).toContain("s-victoria-new-will");
  });

  it("(a) warns on hiddenUntil pointing at her own lie or non-core secret; a coreGuilt secret or a witness's card is fine", () => {
    const x = structuredClone(c);
    const f = x.timeline.find((t) => t.id === "ev-key-hidden")!;
    f.hiddenUntil = { secretIds: ["s-victoria-murder"], lieIds: [] };
    expect(checkGuiltLeakPaths(x)).toEqual([]);
    f.hiddenUntil = { secretIds: ["s-victoria-left-dining"], lieIds: ["l-victoria-locked-in"] };
    expect(checkGuiltLeakPaths(x)[0].message).toMatch(/s-victoria-left-dining.*l-victoria-locked-in/);
    f.hiddenUntil = { secretIds: ["s-gregory-saw-victoria"], lieIds: [] };
    expect(checkGuiltLeakPaths(x)).toEqual([]);
  });

  it("(a) ignores facts outside the window and facts about other people", () => {
    const x = structuredClone(c);
    victoria(x).secrets.find((s) => s.id === "s-victoria-left-dining")!.relatedFactIds.push("ev-blackout", "ev-archibald-phone");
    expect(checkGuiltLeakPaths(x)).toEqual([]);
  });

  it("(b) warns when an innocent's always-visible text names the culprit as the killer; suspicion and denial pass", () => {
    const x = structuredClone(c);
    const g = x.characters.find((ch) => ch.id === "gregory")!;
    g.goals = [...g.goals, "He knows Lady Victoria killed his lordship and means to hint at it."];
    expect(checkGuiltLeakPaths(x)).toHaveLength(1);
    g.goals = [...c.characters.find((ch) => ch.id === "gregory")!.goals, "He wonders whether Victoria killed him.", "Victoria never murdered anyone, he tells himself."];
    expect(checkGuiltLeakPaths(x)).toEqual([]);
  });

  it("(b) the culprit's own text and every secret are not 'always visible'", () => {
    const x = structuredClone(c);
    x.characters.find((ch) => ch.id === "gregory")!.secrets[0].description = "He saw that Victoria killed him.";
    victoria(x).goals = [...victoria(x).goals, "Nobody must learn Victoria killed Edmund."];
    expect(checkGuiltLeakPaths(x)).toEqual([]);
  });
});
