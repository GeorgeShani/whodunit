/**
 * Blackwood progression (docs/BLACKWOOD_PROGRESSION_PROPOSAL.md, cases/blackwood/docs/SOLUTION_PROOF.md §12):
 * gated rooms and clues, the nine leads, the accuse gate and the key-testimony win rule, played through the real
 * engine functions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { handleAccuse } from "@/engine/accuse-handler";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { searchLocation } from "@/engine/investigation";
import { accuseProgress, leadStates } from "@/engine/progress";
import { fastestPath } from "@/engine/progression-validation";
import { getPublicCaseView } from "@/engine/public-view";
import { encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const fresh = (): GameState => createInitialGameState(c);
const talk = (g: GameState, id: string, n = 1) => void (g.characters[id].interrogationCount += n);
/** A secret revealed: recorded on its owner and in the case-wide set, as commitTurn does. */
const revealOnly = (g: GameState, owner: string, secretId: string) => {
  g.characters[owner].revealedSecretIds.push(secretId);
  g.revealedSecretIds.push(secretId);
};
const reveal = (g: GameState, owner: string, secretId: string) => {
  revealOnly(g, owner, secretId);
  g.characters[owner].interrogationCount += 1; // showing a clue is an exchange too
};
const found = (r: { newlyFound: { id: string }[] }) => r.newlyFound.map((e) => e.id);

describe("Blackwood progression: the data validates", () => {
  it("references resolve, zero design warnings, and the fastest legal path is 10 actions", () => {
    expect(checkCaseReferences(c)).toEqual([]);
    expect(checkCaseWarnings(c)).toEqual([]);
    expect(fastestPath(c)).toBe(10);
  });

  it("the win rule: two key clues and one key testimony out of three", () => {
    expect(c.solution.minKeyEvidence).toBe(2);
    expect(c.solution.minKeyTestimony).toBe(1);
    expect(c.solution.keyTestimonyIds).toEqual(["s-reginald-theft", "s-archibald-false-alibi", "s-gregory-saw-victoria"]);
  });

  it("the gate is the approved one", () => {
    expect(c.accuseGate).toMatchObject({ minEvidence: 3, minSuspectsQuestioned: { count: 3, minExchanges: 2 }, minRevealedSecrets: 2, closedLeadIds: ["lead-alibi"] });
    for (const line of Object.values(c.accuseGate!.lockedLines!)) expect(line.length).toBeLessThanOrEqual(160);
  });

  it("nine leads with the approved ids, no empty hint, nothing past the schema limits", () => {
    expect((c.leads ?? []).map((l) => l.id)).toEqual([
      "lead-weapon", "lead-motive", "lead-keyhole", "lead-fireplace", "lead-letter", "lead-lantern", "lead-boots", "lead-alibi", "lead-eyewitness",
    ]);
    for (const l of c.leads!) {
      expect(l.title.length, l.id).toBeLessThanOrEqual(70);
      expect(l.hint.length, l.id).toBeLessThanOrEqual(240);
      expect(l.closedLine, l.id).toBeTruthy();
    }
  });
});

describe("Blackwood progression: gated rooms and clues", () => {
  it("the library is open and finds the candlestick; the dining room is locked until then", () => {
    const g = fresh();
    expect(g.discoveredEvidenceIds).toEqual([]);
    const locked = searchLocation(c, g, "dining-room");
    expect(locked.locked).toBe(true);
    expect(locked.lines[0]).toMatch(/Crime scene first, detective! Procedure!/);
    expect(g.searchedLocationIds).toEqual([]);
    expect(found(searchLocation(c, g, "library"))).toEqual(["silver-candlestick"]);
    expect(searchLocation(c, g, "dining-room").locked).toBeUndefined();
  });

  it("dining room, first visit: no lead yet, so no key, and a nag line", () => {
    const g = fresh();
    searchLocation(c, g, "library");
    const r = searchLocation(c, g, "dining-room");
    expect(found(r)).toEqual([]);
    expect(r.lines.join(" ")).toContain("The hearth is still holding out on you.");
    expect(r.lines.join(" ")).not.toMatch(/nothing new/i);
  });

  it.each([
    ["Reginald x2", (g: GameState) => talk(g, "reginald", 2)],
    ["Archibald x2", (g: GameState) => talk(g, "archibald", 2)],
    ["Victoria x2", (g: GameState) => talk(g, "victoria", 2)],
  ])("the key has a route through %s, and the letter never comes in the same search", (_n, route) => {
    const g = fresh();
    searchLocation(c, g, "library");
    route(g);
    expect(found(searchLocation(c, g, "dining-room"))).toEqual(["library-key"]);
    // the letter needs the key AND Reginald's lead, checked against the state before each search
    talk(g, "reginald", 2);
    expect(found(searchLocation(c, g, "dining-room"))).toEqual(["burned-letter"]);
  });

  it("the letter needs Reginald's lead even once the key is found", () => {
    const g = fresh();
    searchLocation(c, g, "library");
    talk(g, "victoria", 2);
    searchLocation(c, g, "dining-room"); // key
    const r = searchLocation(c, g, "dining-room");
    expect(found(r)).toEqual([]);
    expect(g.discoveredEvidenceIds).toEqual(["silver-candlestick", "library-key"]);
    expect(r.lines.join(" ")).toMatch(/second helping/);
  });

  it("a single exchange opens nothing", () => {
    const g = fresh();
    searchLocation(c, g, "library");
    talk(g, "reginald", 1);
    expect(found(searchLocation(c, g, "dining-room"))).toEqual([]);
  });

  it("the footprint needs the lantern lead (garden searched) or the boots lead (Gregory x2)", () => {
    const a = fresh();
    const none = searchLocation(c, a, "hall");
    expect(found(none)).toEqual([]);
    expect(none.lines.join(" ")).toMatch(/don't yet know what to ask/);
    expect(found(searchLocation(c, a, "garden"))).toEqual([]);
    expect(found(searchLocation(c, a, "hall"))).toEqual(["muddy-footprint"]);

    const b = fresh();
    talk(b, "gregory", 2);
    expect(found(searchLocation(c, b, "hall"))).toEqual(["muddy-footprint"]);
  });

  it("the garden and the kitchen give leads, not clues", () => {
    const g = fresh();
    expect(found(searchLocation(c, g, "garden"))).toEqual([]);
    expect(found(searchLocation(c, g, "kitchen"))).toEqual([]);
    const st = leadStates(c, g);
    expect(st["lead-lantern"]).toBe("open");
    expect(st["lead-alibi"]).toBe("open");
    expect(c.evidence.filter((e) => e.locationId === "garden" || e.locationId === "kitchen")).toEqual([]);
  });

  it("every lead opens and closes on the approved conditions", () => {
    const g = fresh();
    expect(leadStates(c, g)).toMatchObject({ "lead-weapon": "open", "lead-motive": "open", "lead-keyhole": "hidden", "lead-fireplace": "hidden", "lead-letter": "hidden", "lead-lantern": "hidden", "lead-boots": "hidden", "lead-alibi": "hidden", "lead-eyewitness": "hidden" });
    talk(g, "reginald", 2);
    expect(leadStates(c, g)).toMatchObject({ "lead-keyhole": "open", "lead-letter": "open", "lead-fireplace": "hidden" });
    talk(g, "victoria", 2);
    expect(leadStates(c, g)).toMatchObject({ "lead-fireplace": "open", "lead-alibi": "open" });
    talk(g, "gregory", 2);
    expect(leadStates(c, g)["lead-boots"]).toBe("open");
    searchLocation(c, g, "hall");
    expect(leadStates(c, g)["lead-eyewitness"]).toBe("open");
    g.discoveredEvidenceIds.push("silver-candlestick", "library-key", "burned-letter", "muddy-footprint");
    expect(leadStates(c, g)).toMatchObject({ "lead-weapon": "closed", "lead-motive": "closed", "lead-keyhole": "closed", "lead-fireplace": "closed", "lead-letter": "closed", "lead-lantern": "closed", "lead-boots": "closed" });
    revealOnly(g, "gregory", "s-gregory-saw-victoria");
    expect(leadStates(c, g)).toMatchObject({ "lead-eyewitness": "closed", "lead-alibi": "closed" });
  });

  it("lead-alibi closes on any one of the three alibi-breaking secrets", () => {
    for (const [owner, sid] of [["reginald", "s-reginald-theft"], ["archibald", "s-archibald-false-alibi"], ["gregory", "s-gregory-saw-victoria"]] as const) {
      const g = fresh();
      revealOnly(g, owner, sid);
      expect(leadStates(c, g)["lead-alibi"], sid).toBe("closed");
    }
    const g = fresh();
    revealOnly(g, "victoria", "s-victoria-left-dining");
    revealOnly(g, "victoria", "s-victoria-new-will");
    expect(leadStates(c, g)["lead-alibi"]).not.toBe("closed");
  });
});

describe("Blackwood progression: the accuse gate and the win rule", () => {
  /** The fastest legal path from SOLUTION_PROOF §12, played against the real functions. */
  function fastest(): GameState {
    const g = fresh();
    expect(found(searchLocation(c, g, "library"))).toEqual(["silver-candlestick"]); // 1
    talk(g, "reginald", 2); // 2-3
    expect(found(searchLocation(c, g, "dining-room"))).toEqual(["library-key"]); // 4
    expect(found(searchLocation(c, g, "dining-room"))).toEqual(["burned-letter"]); // 5
    reveal(g, "archibald", "s-archibald-false-alibi"); // 6: key shown to Archibald
    expect(accuseProgress(c, g).unlocked).toBe(false);
    reveal(g, "victoria", "s-victoria-left-dining"); // 7: key shown to Victoria
    reveal(g, "victoria", "s-victoria-new-will"); // 8: letter shown to Victoria
    expect(accuseProgress(c, g).unlocked).toBe(false); // Archibald is at 1 exchange
    talk(g, "archibald", 1); // 9
    return g;
  }

  it("the fastest path is 9 actions plus the accusation (10), and the gate opens exactly then", () => {
    const g = fastest();
    expect(accuseProgress(c, g)).toMatchObject({ unlocked: true });
  });

  it("each part of the gate holds ACCUSE shut on its own, with the matching line", () => {
    const base = fastest();
    const clone = (): GameState => structuredClone(base);
    const a = clone();
    a.discoveredEvidenceIds = ["silver-candlestick", "library-key"];
    expect(accuseProgress(c, a)).toMatchObject({ unlocked: false, line: c.accuseGate!.lockedLines!.evidence });
    const b = clone();
    b.characters.victoria.interrogationCount = 1;
    expect(accuseProgress(c, b)).toMatchObject({ unlocked: false, line: c.accuseGate!.lockedLines!.suspects });
    const s = clone();
    for (const ch of Object.values(s.characters)) ch.revealedSecretIds = [];
    s.revealedSecretIds = ["s-victoria-left-dining"];
    s.characters.victoria.revealedSecretIds = ["s-victoria-left-dining"];
    expect(accuseProgress(c, s)).toMatchObject({ unlocked: false, line: c.accuseGate!.lockedLines!.secrets });
    const l = clone();
    for (const ch of Object.values(l.characters)) ch.revealedSecretIds = [];
    l.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will"];
    l.characters.victoria.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will"];
    expect(accuseProgress(c, l)).toMatchObject({ unlocked: false, line: c.accuseGate!.lockedLines!.leads });
  });

  it("no lucky guess: all four clues found, nobody questioned, ACCUSE stays shut and /api/accuse says 403", async () => {
    const g = fresh();
    g.discoveredEvidenceIds.push("silver-candlestick", "library-key", "burned-letter", "muddy-footprint");
    expect(accuseProgress(c, g).unlocked).toBe(false);
    const r = await handleAccuse(
      { accusation: { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "burned-letter"], keyTestimonyIds: [] }, stateToken: encodeStateToken(g, TEST_ENV) },
      { caseData: c, env: TEST_ENV },
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("accuse_locked");
    expect(r.body.outcome).toBeUndefined();
  });

  const accuse = (g: GameState, over: Record<string, unknown>) =>
    handleAccuse(
      { accusation: { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "burned-letter"], keyTestimonyIds: ["s-archibald-false-alibi"], ...over }, stateToken: encodeStateToken(g, TEST_ENV) },
      { caseData: c, env: TEST_ENV },
    );

  it("WIN: right answer, both key clues and a revealed key testimony", async () => {
    const r = await accuse(fastest(), {});
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("won");
    expect(r.body.verdict).toMatchObject({ hasKeyEvidence: true, hasKeyTestimony: true });
  });

  it("LOSS: citing only one key clue", async () => {
    const r = await accuse(fastest(), { keyEvidenceIds: ["library-key"] });
    expect(r.body.outcome).toBe("lost");
  });

  it("LOSS: citing no key testimony (it is mandatory), and a non-key secret does not count", async () => {
    expect((await accuse(fastest(), { keyTestimonyIds: [] })).body.outcome).toBe("lost");
    expect((await accuse(fastest(), { keyTestimonyIds: ["s-victoria-new-will"] })).body.outcome).toBe("lost");
  });

  it("citing testimony that was never revealed is rejected and does not spend the accusation", async () => {
    const r = await accuse(fastest(), { keyTestimonyIds: ["s-gregory-saw-victoria"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("testimony_not_revealed");
    expect(r.body.outcome).toBeUndefined();
  });

  it("the starting progress shown to the player: two open leads, a locked dining room, ACCUSE locked", () => {
    const v = getPublicCaseView(c).progress!;
    expect(v.leads.map((l) => l.id)).toEqual(["lead-weapon", "lead-motive"]);
    expect(v.lockedLocationIds).toEqual(["dining-room"]);
    expect(v.accuse.unlocked).toBe(false);
    expect(v.accuse.citeTestimony).toBe(true);
    expect(JSON.stringify(getPublicCaseView(c))).not.toContain('"requires"');
  });
});

describe("Blackwood progression: provable from evidence alone, and nothing leaks early", () => {
  it("every key testimony is cracked by evidence only: no stress route", () => {
    for (const id of c.solution.keyTestimonyIds!) {
      const s = c.characters.flatMap((ch) => ch.secrets).find((x) => x.id === id)!;
      expect(s.revealConditions?.stressThreshold, id).toBeUndefined();
      expect(s.revealConditions?.evidenceIds.length, id).toBeGreaterThan(0);
    }
  });

  it("both key clues are reachable at zero stress through the leads", () => {
    const g = fresh();
    searchLocation(c, g, "library");
    talk(g, "reginald", 2);
    searchLocation(c, g, "dining-room");
    searchLocation(c, g, "dining-room");
    for (const id of c.solution.keyEvidenceIds) expect(g.discoveredEvidenceIds).toContain(id);
    expect(g.characters.victoria.stress).toBe(0);
  });

  it("no public text before a clue is found names it or where it is", () => {
    // Everything visible with no clue found: room cards, search flavour, locked lines, open lead hints, accuse lines.
    const texts = [
      ...c.locations.flatMap((l) => [l.description, l.lockedLine ?? "", ...(l.searchFlavor?.lines ?? []), l.searchFlavor?.emptyLine ?? ""]),
      ...c.evidence.map((e) => e.lockedLine ?? ""),
      ...c.leads!.flatMap((l) => [l.title, l.hint]),
      ...Object.values(c.accuseGate!.lockedLines!),
    ].join(" ");
    for (const banned of [/scuttle/i, /\bashes\b/i, /footprint/i, /hobnail/i, /solicitor/i, /new will/i, /burn(ed|t)/i, /\bcharred\b/i, /coal scuttle/i]) expect(texts).not.toMatch(banned);
    // The dining-room card does not describe the hearth furniture, and the hall card does not measure the alcove.
    expect(c.locations.find((l) => l.id === "dining-room")!.description).not.toMatch(/scuttle|coal/i);
    expect(c.locations.find((l) => l.id === "hall")!.description).not.toMatch(/paces/i);
  });

  it("f-letter-gone: Reginald alone knows it, at 21:32 in the library, after the letter was taken and burned", () => {
    const f = c.facts.find((x) => x.id === "f-letter-gone")!;
    expect(f).toMatchObject({ time: "21:32", locationId: "library", source: "witnessed", confidence: 0.8, involvesCharacterIds: ["reginald"] });
    expect(c.characters.filter((ch) => ch.knownFactIds.includes("f-letter-gone")).map((ch) => ch.id)).toEqual(["reginald"]);
    const t = (id: string) => c.timeline.find((e) => e.id === id)!.time!;
    expect(t("ev-victoria-takes-letter") < f.time!).toBe(true); // 21:18
    expect(t("ev-letter-burned") < f.time!).toBe(true); // 21:20
    expect(c.timeline.find((e) => e.id === "loc-reginald-2132")!.locationId).toBe("library");
  });
});
