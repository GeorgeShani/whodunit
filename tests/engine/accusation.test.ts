import { describe, expect, it } from "vitest";
import { gradeAccusation } from "@/engine/accusation";
import type { CaseSolution } from "@/engine/solution";

const solution: CaseSolution = {
  murdererId: "victoria",
  weaponId: "silver-candlestick",
  locationId: "library",
  time: "21:17",
  motiveId: "inheritance",
  keyEvidenceIds: ["library-key", "burned-letter"],
};
const right = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key"] };

describe("gradeAccusation", () => {
  it("wins with murderer + weapon + motive + one key evidence", () => {
    const g = gradeAccusation(solution, right);
    expect(g.won).toBe(true);
    expect(g.keyEvidenceCited).toEqual(["library-key"]);
  });

  it("extra non-key evidence is fine", () => {
    const g = gradeAccusation(solution, { ...right, keyEvidenceIds: ["muddy-footprint", "burned-letter", "burned-letter"] });
    expect(g.won).toBe(true);
    expect(g.otherEvidenceCited).toEqual(["muddy-footprint"]);
    expect(g.keyEvidenceCited).toEqual(["burned-letter"]);
  });

  it.each([
    ["wrong murderer", { murdererId: "archibald" }, "murdererCorrect"],
    ["wrong weapon", { weaponId: "library-key" }, "weaponCorrect"],
    ["wrong motive", { motiveId: "revenge" }, "motiveCorrect"],
    ["no key evidence", { keyEvidenceIds: ["muddy-footprint", "silver-candlestick"] }, "hasKeyEvidence"],
  ] as Array<[string, Partial<typeof right>, "murdererCorrect" | "weaponCorrect" | "motiveCorrect" | "hasKeyEvidence"]>)("loses with %s", (_l, patch, flag) => {
    const g = gradeAccusation(solution, { ...right, ...patch });
    expect(g.won).toBe(false);
    expect(g[flag]).toBe(false);
  });

  it("returns time and place for the recap without grading them", () => {
    expect(gradeAccusation(solution, right).recap).toEqual({
      murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", locationId: "library", time: "21:17",
    });
  });
});
