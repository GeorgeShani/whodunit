import { describe, expect, it } from "vitest";
import { summaryRows } from "@/components/ending/summary";

const lookup = {
  suspects: [
    { id: "victoria", name: "Lady Victoria Blackwood" },
    { id: "gregory", name: "Gregory" },
  ],
  evidence: [
    { id: "burned-letter", name: "Burned Letter" },
    { id: "silver-candlestick", name: "Silver Candlestick" },
  ],
  motives: [
    { id: "inheritance", label: "Inheritance" },
    { id: "revenge", label: "Revenge" },
  ],
};
const solution = {
  murderer: { id: "victoria", name: "Lady Victoria Blackwood" },
  weapon: { id: "silver-candlestick", name: "Silver Candlestick" },
  motive: { id: "inheritance", label: "Inheritance" },
  location: { id: "library", name: "the library" },
  time: "21:17",
  keyEvidence: [{ id: "burned-letter", name: "Burned Letter" }],
};

describe("end screen summary", () => {
  it("marks each field right or wrong and shows the truth only when revealed", () => {
    const r = {
      accusation: { murdererId: "gregory", weaponId: "silver-candlestick", motiveId: "revenge", keyEvidenceIds: ["burned-letter"] },
      verdict: { murdererCorrect: false, weaponCorrect: true, motiveCorrect: false, hasKeyEvidence: true, keyEvidenceCited: ["burned-letter"] },
      solution,
    };
    const rows = summaryRows(r, lookup, true);
    expect(rows.map((x) => [x.field, x.correct])).toEqual([
      ["murderer", false],
      ["weapon", true],
      ["motive", false],
      ["proof", true],
    ]);
    expect(rows[0]).toMatchObject({ yours: "Gregory", truth: "Lady Victoria Blackwood" });
    expect(summaryRows(r, lookup, false).every((x) => x.truth === undefined)).toBe(true);
    expect(summaryRows({ ...r, solution: undefined }, lookup, true).every((x) => x.truth === undefined)).toBe(true);
  });
});
