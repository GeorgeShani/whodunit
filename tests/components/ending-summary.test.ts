import { describe, expect, it } from "vitest";
import { summaryRows } from "@/components/ending/summary";

const lookup = {
  suspects: [
    { id: "alpha", name: "Alex Alpha" },
    { id: "bravo", name: "Blair Bravo" },
  ],
  evidence: [
    { id: "note", name: "Torn Note" },
    { id: "heavy-wrench", name: "Heavy Wrench" },
  ],
  motives: [
    { id: "partnership-dispute", label: "Partnership dispute" },
    { id: "revenge", label: "Revenge" },
  ],
};
const solution = {
  murderer: { id: "alpha", name: "Alex Alpha" },
  weapon: { id: "heavy-wrench", name: "Heavy Wrench" },
  motive: { id: "partnership-dispute", label: "Partnership dispute" },
  location: { id: "workshop", name: "the workshop" },
  time: "21:00",
  keyEvidence: [{ id: "note", name: "Torn Note" }],
};

describe("end screen summary", () => {
  it("marks each field right or wrong and shows the truth only when revealed", () => {
    const r = {
      accusation: { murdererId: "bravo", weaponId: "heavy-wrench", motiveId: "revenge", keyEvidenceIds: ["note"] },
      verdict: { murdererCorrect: false, weaponCorrect: true, motiveCorrect: false, hasKeyEvidence: true, hasKeyTestimony: true, keyEvidenceCited: ["note"] },
      solution,
    };
    const rows = summaryRows(r, lookup, true);
    expect(rows.map((x) => [x.field, x.correct])).toEqual([
      ["murderer", false],
      ["weapon", true],
      ["motive", false],
      ["proof", true],
    ]);
    expect(rows[0]).toMatchObject({ yours: "Blair Bravo", truth: "Alex Alpha" });
    expect(summaryRows(r, lookup, false).every((x) => x.truth === undefined)).toBe(true);
    expect(summaryRows({ ...r, solution: undefined }, lookup, true).every((x) => x.truth === undefined)).toBe(true);
  });
});
