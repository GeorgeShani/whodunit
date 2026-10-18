/**
 * Tallyho draft (cases/_tallyho, docs/cases/TALLYHO_DESIGN.md): the data validates, the gate is the approved one, the
 * fastest legal path is 32 actions, no reachable state opens ACCUSE while the win is impossible, and only the doer
 * named as murderer with the stager named as helper wins (G1). The engine's own
 * searches run out of budget at six suspects, so this uses the exhaustive searches in ./tallyho-search.
 *
 * solution.json is kept out of git while the case is a draft (no solution files committed), so this suite skips when
 * it is absent. Regenerate it locally from the design doc (section 4.1) to run it. The culprits are read from it, so this
 * file names neither.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { gradeAccusation } from "@/engine/accusation";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import type { Accusation } from "@/engine/types";
import { fastestPath, fastestPlan } from "@/engine/progression-validation";
import { tallyhoAccuseOpenWithoutWin, tallyhoFastestPath } from "./tallyho-search";

const HAS_SOLUTION = existsSync("cases/_tallyho/solution.json");
/** The full fastest-path search takes about ten minutes, so CI checks the known 32-action vector and opts into the rest. */
const FULL = process.env.TALLYHO_FULL_SEARCH === "1";
/** Plain questions per suspect on the fastest path found by the full search. */
const FASTEST_PLAIN = { bilge: 3, boris: 2, gherkina: 2, ottilie: 2, percy: 2, zippelli: 2 };

let c: LoadedCase;
describe.skipIf(!HAS_SOLUTION)("Tallyho progression (draft)", () => {
  beforeAll(async () => {
    c = await loadCase("_tallyho");
  });

  it("references resolve and there are zero design warnings", { timeout: 120_000 }, () => {
    expect(checkCaseReferences(c)).toEqual([]);
    expect(checkCaseWarnings(c)).toEqual([]);
  });

  it("the gate, the caps and the weapons are the approved ones", () => {
    expect(c.accuseGate).toMatchObject({
      minEvidence: 8,
      minSuspectsQuestioned: { count: 6, minExchanges: 4 },
      minRevealedSecrets: 10,
      closedLeadIds: ["lead-time", "lead-alibi", "lead-stager", "lead-motive"],
    });
    for (const line of Object.values(c.accuseGate!.lockedLines!)) expect(line.length).toBeLessThanOrEqual(160);
    expect(c.confrontation).toEqual({ perPair: 4, total: 16 });
    expect(c.evidence.filter((e) => e.weapon).map((e) => e.id).sort()).toEqual(["crock-13", "orange-lightning"]);
  });

  it("no reachable state opens ACCUSE while the win is impossible", { timeout: 120_000 }, () => {
    expect(tallyhoAccuseOpenWithoutWin(c).act).toBeNull();
  });

  it("the engine's simulator proves 32 within budget (full-gate search), with a plan the smoke run can play", { timeout: 60_000 }, () => {
    const p = fastestPlan(c);
    expect(p).toMatchObject({ actions: 32, exact: true, atLeast: 32 });
    expect(p!.steps.filter((s) => s.kind === "search")).toHaveLength(7);
    expect(fastestPath(c)).toBe(32);
  });
  it("a 32-action winning path exists", { timeout: 300_000 }, () => {
    expect(tallyhoFastestPath(c, FASTEST_PLAIN)?.actions).toBe(32);
  });

  it.skipIf(!FULL)("and nothing shorter does (TALLYHO_FULL_SEARCH=1)", { timeout: 1_200_000 }, () => {
    expect(tallyhoFastestPath(c)?.actions).toBe(32);
  });

  describe("two-culprit grading (G1)", () => {
    let full: Accusation;
    const won = (a: Accusation) => gradeAccusation(c.solution, a).won;
    beforeAll(() => {
      const s = c.solution;
      full = {
        murdererId: s.murdererId,
        accompliceId: s.accompliceId!,
        weaponId: s.weaponId,
        motiveId: s.motiveId,
        keyEvidenceIds: s.keyEvidenceIds.slice(0, s.minKeyEvidence ?? 1),
        keyTestimonyIds: (s.keyTestimonyIds ?? []).slice(0, Math.max(1, s.minKeyTestimony ?? 0)),
      };
    });

    it("the solution names a helper who is a suspect and not the murderer", () => {
      expect(c.characters.map((ch) => ch.id)).toContain(c.solution.accompliceId);
      expect(c.solution.accompliceId).not.toBe(c.solution.murdererId);
    });

    it("the murderer plus the helper, with the proof, wins", () => {
      expect(won(full)).toBe(true);
    });

    it("the murderer alone (no helper answer) is not a full win", () => {
      const alone: Accusation = { ...full };
      delete alone.accompliceId;
      const g = gradeAccusation(c.solution, alone);
      expect(g.murdererCorrect).toBe(true);
      expect(g.won).toBe(false);
    });

    it('the murderer plus "no one helped" loses', () => {
      expect(won({ ...full, accompliceId: null })).toBe(false);
    });

    it("the murderer plus any wrong helper loses", () => {
      const wrong = c.characters.map((ch) => ch.id).filter((id) => id !== c.solution.murdererId && id !== c.solution.accompliceId);
      expect(wrong).toHaveLength(4);
      for (const id of wrong) expect(won({ ...full, accompliceId: id })).toBe(false);
    });

    it("swapped roles lose", () => {
      expect(won({ ...full, murdererId: full.accompliceId!, accompliceId: full.murdererId })).toBe(false);
    });
  });

  it("lie-keyed phrases lift on their owner's own broken lie (DX7), with no shown-clue stand-ins left", () => {
    const owners: string[] = [];
    for (const ch of c.characters) {
      const lies = new Set(ch.intendedLies.map((l) => l.id));
      for (const p of ch.forbiddenPhrases) {
        expect(p.unlessShown).toBeUndefined();
        for (const id of p.unlessBroken ?? []) expect(lies.has(id)).toBe(true);
        if (p.unlessBroken) owners.push(ch.id);
      }
    }
    expect([...new Set(owners)].sort()).toEqual(["bilge", "boris", "gherkina", "ottilie", "percy"]);
  });

  it("features: both modules declared, the proof only in solution.json, the marmalade diagram wired to Toon's frames", () => {
    expect(c.features).toEqual(["time-misdirection", "ship-list"]);
    const tm = c.featureConfig!["time-misdirection"] as Record<string, unknown>;
    expect(Object.keys(tm).sort()).toEqual(["appearanceWords", "stagedClaims"]);
    expect(JSON.stringify(c.featureConfig)).not.toContain("provedBy");
    expect((c.solution.featureProof?.["time-misdirection"] as { provedBy?: string[] } | undefined)?.provedBy?.length).toBeGreaterThan(0);
    const sl = c.featureConfig!["ship-list"] as { flipShownBy: string; diagrams?: { evidenceId: string; frames: { label: string; image: string }[] }[] };
    expect(sl.flipShownBy).toBe("heel-chart");
    expect(sl.diagrams?.map((d) => d.evidenceId)).toEqual(["marmalade-run"]);
    const frames = sl.diagrams![0].frames;
    expect(frames.map((f) => f.image)).toEqual([
      "/assets/cases/_tallyho/ship-list-marmalade-run-before.webp",
      "/assets/cases/_tallyho/ship-list-marmalade-run-after.webp",
    ]);
    for (const f of frames) {
      expect(existsSync(`assets${f.image.slice("/assets".length)}`)).toBe(true);
      // T-61: neutral labels, no "before/after the Lurch" and no death time.
      expect(f.label).not.toMatch(/\b(?:before|after)\s+the\s+Lurch\b|21[:.]5\d|22[:.]4[01]|\b(?:died|dead|death|body)\b/i);
    }
    expect(c.locations.every((l) => l.background === `/assets/cases/_tallyho/backgrounds/${l.id}.webp`)).toBe(true);
    expect(c.theme?.logo).toBe("/assets/cases/_tallyho/logo.webp");
    // Toon option A: suspect selection reuses the ballroom background.
    expect(c.backdrops?.suspects).toBe("/assets/cases/_tallyho/backgrounds/ballroom.webp");
    expect(existsSync("assets/cases/_tallyho/backgrounds/ballroom.webp")).toBe(true);
  });
});
