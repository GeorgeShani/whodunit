/**
 * G1 against Agatha's Tallyho draft (#62, cases/_tallyho): strict two-culprit grading on the real data. It skips until
 * cases/_tallyho exists (it lands with #62), and until its solution.json, which is gitignored and regenerated locally,
 * names an accompliceId.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { gradeAccusation } from "@/engine/accusation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { buildEnding } from "@/engine/ending-payload";
import type { Accusation } from "@/engine/types";

const SOL = "cases/_tallyho/solution.json";
const READY = existsSync(SOL) && typeof JSON.parse(readFileSync(SOL, "utf8")).accompliceId === "string";

let c: LoadedCase;
let win: Accusation;
describe.skipIf(!READY)("Tallyho two-culprit grading (draft data, #62)", () => {
  beforeAll(async () => {
    c = await loadCase("_tallyho");
    const s = c.solution;
    win = {
      murdererId: s.murdererId,
      accompliceId: s.accompliceId!,
      weaponId: s.weaponId,
      motiveId: s.motiveId,
      keyEvidenceIds: s.keyEvidenceIds.slice(0, s.minKeyEvidence ?? 1),
      ...(s.keyTestimonyIds?.length ? { keyTestimonyIds: s.keyTestimonyIds.slice(0, Math.max(1, s.minKeyTestimony ?? 0)) } : {}),
    };
  });

  it("the helper is a real suspect, not the murderer, and the references still resolve", () => {
    expect(c.characters.map((ch) => ch.id)).toContain(c.solution.accompliceId);
    expect(c.solution.accompliceId).not.toBe(c.solution.murdererId);
    expect(checkCaseReferences(c).filter((i) => i.path === "accompliceId")).toEqual([]);
  });

  it("only the doer as murderer AND the stager as helper wins", () => {
    expect(gradeAccusation(c.solution, win).won).toBe(true);
    const lose = (a: Partial<Accusation>) => expect(gradeAccusation(c.solution, { ...win, ...a }).won).toBe(false);
    lose({ accompliceId: null }); // "No one helped"
    const noAnswer: Accusation = { ...win };
    delete noAnswer.accompliceId;
    expect(gradeAccusation(c.solution, noAnswer).won).toBe(false);
    lose({ murdererId: win.accompliceId!, accompliceId: win.murdererId }); // roles swapped
    for (const ch of c.characters) if (ch.id !== win.murdererId && ch.id !== win.accompliceId) lose({ accompliceId: ch.id });
  });

  it("every loss plays the accused's own ending, and no culprit has a cameo in an innocent's", () => {
    const culprits = new Set([c.solution.murdererId, c.solution.accompliceId!]);
    for (const ch of c.characters) {
      const e = buildEnding(c, { won: false }, { ...win, murdererId: ch.id, accompliceId: null });
      expect(e.accusedId).toBe(ch.id);
      if (!culprits.has(ch.id)) expect(e.beats.filter((b) => culprits.has(b.speaker))).toEqual([]);
    }
  });
});
