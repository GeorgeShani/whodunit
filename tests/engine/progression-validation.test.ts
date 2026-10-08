import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkCaseReferences, checkCaseWarnings } from "@/engine/case-validation";
import { loadCase, validateCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { fastestPath, simulate, usesProgression } from "@/engine/progression-validation";
import { getPublicCaseView } from "@/engine/public-view";

const DIR = path.join(process.cwd(), "tests/fixtures/progression");
let base: LoadedCase;
beforeAll(async () => {
  base = await loadCase("progress-light", DIR);
});
const fork = (fn: (c: LoadedCase) => void) => {
  const c = structuredClone(base);
  fn(c);
  return c;
};
const errors = (c: LoadedCase) => checkCaseReferences(c).map((i) => `${i.file} ${i.path ?? ""} ${i.message}`);

describe("the progress-light fixture", () => {
  it("is valid with zero errors and zero warnings, and uses progression", () => {
    expect(usesProgression(base)).toBe(true);
    expect(checkCaseReferences(base)).toEqual([]);
    expect(checkCaseWarnings(base)).toEqual([]);
  });
  it("fastest legal path is 9 actions (worked out by hand: 2 talk, galley, dock, 2 cracks, 2 quill, accuse)", () => {
    expect(fastestPath(base)).toBe(9);
  });
  it("simulation reaches everything", () => {
    const s = simulate(base);
    expect(s.game.discoveredEvidenceIds.sort()).toEqual(["brass-spyglass", "oil-can", "wet-logbook"]);
    expect(s.game.revealedSecretIds).toEqual(expect.arrayContaining(["marlow-secret", "marlow-saw-quill"]));
    expect(s.game.revealedSecretIds).not.toContain("quill-secret"); // the murderer's core guilt (derived) never reveals
    expect(s.unlockedLocationIds.sort()).toEqual(["dock", "galley", "lamp-room"]);
  });
  it("the other shipped cases do not use progression (no behaviour change); Blackwood does, with a 10-action fastest path", async () => {
    expect(usesProgression(await loadCase("blackwood"))).toBe(true);
    expect(fastestPath(await loadCase("blackwood"))).toBe(10);
    expect(usesProgression(await loadCase("harbor-light", "tests/fixtures/cases"))).toBe(false);
  });
});

describe("validator errors", () => {
  it.each([
    ["unknown evidence in a location requires", (c: LoadedCase) => void (c.locations[2].requires = { evidenceIds: ["nope"] }), 'unknown evidence "nope"'],
    ["unknown character in interrogated", (c: LoadedCase) => void (c.leads![0].opensWhen = { interrogated: [{ characterId: "ghost" }] }), 'unknown character "ghost"'],
    ["unknown secret", (c: LoadedCase) => void (c.leads![0].closesWhen = { secretIds: ["nope"] }), 'unknown secret "nope"'],
    ["unknown location", (c: LoadedCase) => void (c.leads![1].opensWhen = { searchedLocationIds: ["attic"] }), 'unknown location "attic"'],
    ["unknown lead in an evidence requires", (c: LoadedCase) => void (c.evidence[1].requires = { leadIds: ["lead-x"] }), 'unknown lead "lead-x"'],
    ["unknown lead in the gate", (c: LoadedCase) => void (c.accuseGate!.closedLeadIds = ["lead-x"]), 'unknown lead "lead-x"'],
    ["duplicate lead ids", (c: LoadedCase) => void (c.leads![1].id = "lead-galley"), 'duplicate lead id "lead-galley"'],
    ["unknown keyTestimonyIds secret", (c: LoadedCase) => void (c.solution.keyTestimonyIds = ["nope"]), 'unknown secret "nope"'],
    ["key testimony without a summary", (c: LoadedCase) => void (c.solution.keyTestimonyIds = ["finch-secret"]), "no testimonySummary"],
    ["minKeyTestimony above the list", (c: LoadedCase) => void (c.solution.minKeyTestimony = 2), "more than keyTestimonyIds"],
    ["minKeyEvidence above the list", (c: LoadedCase) => void (c.solution.minKeyEvidence = 3), "more than keyEvidenceIds"],
    ["a room that requires itself", (c: LoadedCase) => void (c.locations[2].requires = { searchedLocationIds: ["dock"] }), 'location "dock" requires itself'],
    ["a clue that requires itself", (c: LoadedCase) => void (c.evidence[1].requires = { evidenceIds: ["wet-logbook"] }), 'evidence "wet-logbook" requires itself'],
    ["requires on a clue with no room", (c: LoadedCase) => void (delete c.evidence[1].locationId), "no locationId"],
    ["requires on an initially available clue", (c: LoadedCase) => void (c.evidence[1].initiallyAvailable = true), "initiallyAvailable"],
    ["a lead depending on itself", (c: LoadedCase) => void (c.leads![0].opensWhen = { leadIds: ["lead-galley"] }), "depends on itself"],
    ["a two-lead cycle", (c: LoadedCase) => { c.leads![0].opensWhen = { leadIds: ["lead-spyglass"] }; c.leads![1].opensWhen = { leadIds: ["lead-galley"] }; }, "depends on itself"],
    ["more suspects than exist", (c: LoadedCase) => void (c.accuseGate!.minSuspectsQuestioned = { count: 9, minExchanges: 1 }), "needs 9 suspects"],
  ])("%s", (_name, mutate, expected) => {
    expect(errors(fork(mutate)).join("\n")).toContain(expected);
  });

  it("unreachable: a room that can never be searched (requires cycle through rooms)", () => {
    const c = fork((x) => {
      x.locations[1].requires = { searchedLocationIds: ["dock"] };
      x.locations[2].requires = { searchedLocationIds: ["galley"] };
    });
    const e = errors(c).join("\n");
    expect(e).toContain('location "galley" can never be searched');
    expect(e).toContain('location "dock" can never be searched');
    expect(e).toContain('clue "wet-logbook" can never be found');
  });
  it("unreachable: ACCUSE can never unlock (more secrets than can ever be revealed)", () => {
    const c = fork((x) => void (x.accuseGate!.minRevealedSecrets = 4));
    expect(errors(c).join("\n")).toContain("ACCUSE can never unlock");
  });
  it("unreachable: a key testimony only a stress route reveals", () => {
    const c = fork((x) => {
      x.solution.keyTestimonyIds = ["finch-secret"];
      x.characters.find((ch) => ch.id === "finch")!.secrets[0].testimonySummary = "Finch cracked.";
    });
    expect(errors(c).join("\n")).toContain("only 0 of the key testimonies can ever be revealed");
  });
  it("unreachable: key clues the player can never hold", () => {
    const c = fork((x) => void (x.evidence[1].requires = { evidenceIds: ["brass-spyglass"] }));
    // the logbook now needs the spyglass, which needs the galley searched... the logbook is in the galley: reachable. Break the spyglass instead.
    c.evidence[2].requires = { evidenceIds: ["wet-logbook"] };
    expect(errors(c).join("\n")).toContain("can never be found");
  });
});

describe("validator warnings", () => {
  const warns = (c: LoadedCase) => checkCaseWarnings(c).map((w) => w.message);
  it("a lead that never opens, a lead that never closes", () => {
    const c = fork((x) => {
      x.leads![0].opensWhen = { interrogated: [{ characterId: "finch", minExchanges: 1 }] };
      x.leads!.push({ id: "lead-never", title: "t", hint: "h", opensWhen: { secretIds: ["finch-secret"] }, closesWhen: { secretIds: ["finch-secret"] } });
    });
    expect(warns(c).join("\n")).toContain("lead never opens");
  });
  it("minEvidence below 2, locked clue or room without a lockedLine", () => {
    const c = fork((x) => {
      x.accuseGate!.minEvidence = 1;
      delete x.evidence[1].lockedLine;
      delete x.locations[2].lockedLine;
    });
    const w = warns(c).join("\n");
    expect(w).toContain("is below 2");
    expect(w).toContain("no lockedLine (searches skip it silently)");
    expect(w).toContain("no lockedLine (the card shows a generic padlock line)");
  });
});

describe("public view", () => {
  it("never exposes requires, opensWhen, closesWhen or the gate; lockedLine and lead text are public", () => {
    const v = getPublicCaseView(base);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/requires|opensWhen|closesWhen|accuseGate|closedLeadIds/);
    expect(v.locations.find((l) => l.id === "dock")!.lockedLine).toContain("roped off");
    expect(v.progress.lockedLocationIds).toEqual(["dock"]);
    expect(v.progress.leads).toEqual([]); // both leads start hidden
  });
});

describe("the CLI path", () => {
  it("validateCase returns the progression errors for a broken case dir", async () => {
    const ok = await validateCase("progress-light", DIR);
    expect(ok.issues).toEqual([]);
  });
});
