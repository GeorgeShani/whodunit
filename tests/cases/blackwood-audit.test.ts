/**
 * Blackwood consistency audit (cases/blackwood/docs/CONSISTENCY_AUDIT.md): regression tests for the loopholes the
 * audit fixed in data. Every test cites the finding id it guards.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { accuseProgress, isUnlocked, leadStates } from "@/engine/progress";
import { fastestPath } from "@/engine/progression-validation";
import type { GameState } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

type Secret = LoadedCase["characters"][number]["secrets"][number];

/** Can this secret be revealed now? Evidence/testimony per revealConditions, or (adversarially) stress at any time. */
function revealable(s: Secret, core: Set<string>, g: GameState): boolean {
  const rc = s.revealConditions;
  if (core.has(s.id) || g.revealedSecretIds.includes(s.id) || !rc) return false;
  if (!(rc.afterSecretIds ?? []).every((id) => g.revealedSecretIds.includes(id))) return false;
  if (rc.stressThreshold !== undefined) return true; // pressure alone can get there
  const conds = [...(rc.evidenceIds ?? []).map((e) => g.discoveredEvidenceIds.includes(e)), ...(rc.testimonyIds ?? []).map((t) => g.revealedSecretIds.includes(t))];
  return conds.length > 0 && (rc.mode === "all" ? conds.every(Boolean) : conds.some(Boolean));
}

/** Every state reachable by searching, talking and cracking (exchange counts capped at 2, the most any rule reads). */
function reachableStates(): GameState[] {
  const ids = c.characters.map((ch) => ch.id);
  const core = coreGuiltSecretIds(c);
  const key = (g: GameState) =>
    [[...g.discoveredEvidenceIds].sort(), [...g.searchedLocationIds].sort(), [...g.revealedSecretIds].sort(), ids.map((id) => g.characters[id].interrogationCount)].map((x) => x.join(",")).join("|");
  const clone = (g: GameState): GameState => ({
    ...g,
    discoveredEvidenceIds: [...g.discoveredEvidenceIds],
    searchedLocationIds: [...g.searchedLocationIds],
    revealedSecretIds: [...g.revealedSecretIds],
    characters: Object.fromEntries(ids.map((id) => [id, { ...g.characters[id] }])),
  });
  const start = createInitialGameState(c);
  const seen = new Map([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const g = queue.shift()!;
    const states = leadStates(c, g);
    const next: GameState[] = [];
    for (const loc of c.locations) {
      if (!isUnlocked(loc, g, states)) continue;
      const n = clone(g);
      if (!n.searchedLocationIds.includes(loc.id)) n.searchedLocationIds.push(loc.id);
      for (const e of c.evidence) if (e.locationId === loc.id && !n.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, g, states)) n.discoveredEvidenceIds.push(e.id);
      next.push(n);
    }
    for (const id of ids) {
      const n = clone(g);
      n.characters[id].interrogationCount = Math.min(2, n.characters[id].interrogationCount + 1);
      next.push(n);
    }
    for (const ch of c.characters)
      for (const s of ch.secrets) {
        if (!revealable(s, core, g)) continue;
        const n = clone(g);
        n.revealedSecretIds.push(s.id);
        n.characters[ch.id].interrogationCount = Math.min(2, n.characters[ch.id].interrogationCount + 1);
        next.push(n);
      }
    for (const n of next) {
      const k = key(n);
      if (seen.has(k)) continue;
      seen.set(k, n);
      queue.push(n);
    }
  }
  return [...seen.values()];
}

describe("CA-01: ACCUSE never opens while the win is impossible", () => {
  it("in every reachable state (stress reveals included), an open gate means both key clues and a key testimony are held", () => {
    const sol = c.solution;
    const all = reachableStates();
    expect(all.length).toBeGreaterThan(1000);
    const bad = all.filter((g) => {
      if (!accuseProgress(c, g).unlocked) return false;
      const keys = sol.keyEvidenceIds.filter((id) => g.discoveredEvidenceIds.includes(id)).length;
      const testimony = (sol.keyTestimonyIds ?? []).filter((id) => g.revealedSecretIds.includes(id)).length;
      return keys < (sol.minKeyEvidence ?? 1) || testimony < (sol.minKeyTestimony ?? 0);
    });
    expect(bad.map((g) => `${g.discoveredEvidenceIds.join("+")} / ${g.revealedSecretIds.join("+")}`).slice(0, 5)).toEqual([]);
  });

  it("the reported state: candlestick + footprint + key, two secrets, three suspects at 2, alibi lead closed: still locked, on the leads line", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("silver-candlestick", "muddy-footprint", "library-key");
    g.revealedSecretIds.push("s-archibald-false-alibi", "s-gregory-in-hall");
    for (const id of ["reginald", "archibald", "gregory"]) g.characters[id].interrogationCount = 2;
    expect(leadStates(c, g)["lead-alibi"]).toBe("closed");
    const p = accuseProgress(c, g);
    expect(p.unlocked).toBe(false);
    expect(p.line).toBe(c.accuseGate!.lockedLines!.leads);
    g.discoveredEvidenceIds.push("burned-letter");
    expect(accuseProgress(c, g).unlocked).toBe(true);
  });

  it("the fix costs no actions: the fastest legal path is still 10", () => {
    expect(fastestPath(c)).toBe(10);
  });

  it("the leads line names no clue, suspect, secret or motive", () => {
    const line = c.accuseGate!.lockedLines!.leads!;
    expect(line).not.toMatch(/letter|will|key|candlestick|footprint|inherit|Victoria|Archibald|Reginald|Gregory|telephone/i);
  });
});

describe("CA-11 / CA-12: public text agrees with the timeline", () => {
  it("the dining-room flavour counts three diners, as the timeline seats them", () => {
    const atTable = c.timeline.filter((f) => /^loc-.*-2030$/.test(f.id) && /finishing dinner/.test(f.statement)).map((f) => f.involvesCharacterIds[0]);
    expect(atTable.sort()).toEqual(["archibald", "lord-blackwood", "victoria"]);
    const dining = c.locations.find((l) => l.id === "dining-room")!;
    const text = [...dining.searchFlavor!.lines, dining.searchFlavor!.emptyLine ?? ""].join(" ");
    expect(text).toMatch(/\bthree\b/i);
    expect(text).not.toMatch(/\bfour\b/i);
  });

  it("the intro does not put the death between the port (20:45) and the coffee (20:58): he was alive at 21:12", () => {
    expect(c.intro).not.toMatch(/between the port and the coffee/i);
    const coffee = c.timeline.find((f) => f.id === "ev-reginald-serves-coffee")!;
    expect(coffee.time! < c.solution.time).toBe(true);
  });
});
