import { describe, expect, it } from "vitest";
import { validateAccusationDraft } from "@/engine/accuse-schema";
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

describe("gradeAccusation: progression win rule (minKeyEvidence / keyTestimonyIds / minKeyTestimony)", () => {
  const strict: CaseSolution = { ...solution, minKeyEvidence: 2, keyTestimonyIds: ["s-a", "s-b"], minKeyTestimony: 1 };
  const both = { ...right, keyEvidenceIds: ["library-key", "burned-letter"], keyTestimonyIds: ["s-a"] };
  it("defaults keep today's rule: one key clue, no testimony", () => {
    const g = gradeAccusation(solution, right);
    expect(g).toMatchObject({ won: true, hasKeyEvidence: true, hasKeyTestimony: true, keyTestimonyCited: [] });
  });
  it("wins with both key clues and one key testimony", () => {
    expect(gradeAccusation(strict, both)).toMatchObject({ won: true, keyTestimonyCited: ["s-a"], hasKeyTestimony: true });
  });
  it.each([
    ["one key clue only", { keyEvidenceIds: ["library-key"] }, "hasKeyEvidence"],
    ["no testimony", { keyTestimonyIds: [] }, "hasKeyTestimony"],
    ["testimony that is not key", { keyTestimonyIds: ["s-z"] }, "hasKeyTestimony"],
    ["testimony omitted", { keyTestimonyIds: undefined }, "hasKeyTestimony"],
  ])("loses with %s", (_n, over, flag) => {
    const g = gradeAccusation(strict, { ...both, ...over });
    expect(g.won).toBe(false);
    expect((g as unknown as Record<string, boolean>)[flag]).toBe(false);
  });
  it("duplicate citations count once", () => {
    expect(gradeAccusation(strict, { ...both, keyEvidenceIds: ["library-key", "library-key"] }).won).toBe(false);
  });
});

describe("validateAccusationDraft: citing testimony", () => {
  const opts = { suspectIds: ["victoria"], evidenceIds: ["library-key"], motiveIds: ["inheritance"], testimonyIds: ["s-a", "s-b"] };
  const draft = { murdererId: "victoria", weaponId: "library-key", motiveId: "inheritance", keyEvidenceIds: ["library-key"] };
  it("is required when the case says so", () => {
    expect(validateAccusationDraft(draft, { ...opts, requireTestimony: true })).toMatchObject({ ok: false });
    const ok = validateAccusationDraft({ ...draft, keyTestimonyIds: ["s-a", "s-a"] }, { ...opts, requireTestimony: true });
    expect(ok).toMatchObject({ ok: true, accusation: { keyTestimonyIds: ["s-a"] } });
  });
  it("is optional otherwise, and only real notebook testimony may be cited", () => {
    expect(validateAccusationDraft(draft, opts)).toMatchObject({ ok: true });
    expect(validateAccusationDraft({ ...draft, keyTestimonyIds: ["s-x"] }, opts)).toMatchObject({ ok: false });
  });
});
