import { describe, expect, it } from "vitest";
import { validateAccusationDraft } from "@/engine/accuse-schema";
import { gradeAccusation } from "@/engine/accusation";
import type { CaseSolution } from "@/engine/solution";

const solution: CaseSolution = {
  murdererId: "alpha",
  weaponId: "heavy-wrench",
  locationId: "workshop",
  time: "21:00",
  motiveId: "partnership-dispute",
  keyEvidenceIds: ["note", "ledger"],
};
const right = { murdererId: "alpha", weaponId: "heavy-wrench", motiveId: "partnership-dispute", keyEvidenceIds: ["note"] };

describe("gradeAccusation", () => {
  it("wins with murderer + weapon + motive + one key evidence", () => {
    const g = gradeAccusation(solution, right);
    expect(g.won).toBe(true);
    expect(g.keyEvidenceCited).toEqual(["note"]);
  });

  it("extra non-key evidence is fine", () => {
    const g = gradeAccusation(solution, { ...right, keyEvidenceIds: ["boot-print", "ledger", "ledger"] });
    expect(g.won).toBe(true);
    expect(g.otherEvidenceCited).toEqual(["boot-print"]);
    expect(g.keyEvidenceCited).toEqual(["ledger"]);
  });

  it.each([
    ["wrong murderer", { murdererId: "bravo" }, "murdererCorrect"],
    ["wrong weapon", { weaponId: "note" }, "weaponCorrect"],
    ["wrong motive", { motiveId: "revenge" }, "motiveCorrect"],
    ["no key evidence", { keyEvidenceIds: ["boot-print", "heavy-wrench"] }, "hasKeyEvidence"],
  ] as Array<[string, Partial<typeof right>, "murdererCorrect" | "weaponCorrect" | "motiveCorrect" | "hasKeyEvidence"]>)("loses with %s", (_l, patch, flag) => {
    const g = gradeAccusation(solution, { ...right, ...patch });
    expect(g.won).toBe(false);
    expect(g[flag]).toBe(false);
  });

  it("returns time and place for the recap without grading them", () => {
    expect(gradeAccusation(solution, right).recap).toEqual({
      murdererId: "alpha", weaponId: "heavy-wrench", motiveId: "partnership-dispute", locationId: "workshop", time: "21:00",
    });
  });
});

describe("gradeAccusation: progression win rule (minKeyEvidence / keyTestimonyIds / minKeyTestimony)", () => {
  const strict: CaseSolution = { ...solution, minKeyEvidence: 2, keyTestimonyIds: ["s-a", "s-b"], minKeyTestimony: 1 };
  const both = { ...right, keyEvidenceIds: ["note", "ledger"], keyTestimonyIds: ["s-a"] };
  it("defaults keep today's rule: one key clue, no testimony", () => {
    const g = gradeAccusation(solution, right);
    expect(g).toMatchObject({ won: true, hasKeyEvidence: true, hasKeyTestimony: true, keyTestimonyCited: [] });
  });
  it("wins with both key clues and one key testimony", () => {
    expect(gradeAccusation(strict, both)).toMatchObject({ won: true, keyTestimonyCited: ["s-a"], hasKeyTestimony: true });
  });
  it.each([
    ["one key clue only", { keyEvidenceIds: ["note"] }, "hasKeyEvidence"],
    ["no testimony", { keyTestimonyIds: [] }, "hasKeyTestimony"],
    ["testimony that is not key", { keyTestimonyIds: ["s-z"] }, "hasKeyTestimony"],
    ["testimony omitted", { keyTestimonyIds: undefined }, "hasKeyTestimony"],
  ])("loses with %s", (_n, over, flag) => {
    const g = gradeAccusation(strict, { ...both, ...over });
    expect(g.won).toBe(false);
    expect((g as unknown as Record<string, boolean>)[flag]).toBe(false);
  });
  it("duplicate citations count once", () => {
    expect(gradeAccusation(strict, { ...both, keyEvidenceIds: ["note", "note"] }).won).toBe(false);
  });
});

describe("validateAccusationDraft: citing testimony", () => {
  const opts = { suspectIds: ["alpha"], evidenceIds: ["note"], motiveIds: ["partnership-dispute"], testimonyIds: ["s-a", "s-b"] };
  const draft = { murdererId: "alpha", weaponId: "note", motiveId: "partnership-dispute", keyEvidenceIds: ["note"] };
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
