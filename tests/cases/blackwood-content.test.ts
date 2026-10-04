/**
 * Blackwood search flavour, discovery lines and endings: story checks on top
 * of the engine loader/validator. Shape, speaker ids, emotions, pauseMs ranges,
 * evidence references and "wrong covers every suspect" are already enforced by
 * validateCase (engine/case-validation.ts), so they are not repeated here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import type { Endings } from "@/engine/endings";

let c: LoadedCase;
let endings: Endings;

beforeAll(async () => {
  c = await loadCase("blackwood");
  if (!c.endings) throw new Error("blackwood must ship endings.json");
  endings = c.endings;
});

describe("Blackwood location search", () => {
  it("clues are found where the solution proof puts them", () => {
    expect(Object.fromEntries(c.evidence.map((e) => [e.id, e.locationId]))).toEqual({
      "silver-candlestick": "library",
      "muddy-footprint": "hall",
      "burned-letter": "dining-room",
      "library-key": "dining-room",
    });
  });

  it("every location has search flavour and a repeat-search emptyLine", () => {
    for (const loc of c.locations) {
      expect(loc.searchFlavor, loc.id).toBeDefined();
      expect(loc.searchFlavor?.emptyLine, loc.id).toBeTruthy();
    }
    const withClues = new Set(c.evidence.map((e) => e.locationId));
    expect(c.locations.filter((l) => !withClues.has(l.id)).map((l) => l.id).sort()).toEqual(["garden", "kitchen"]);
  });

  it("the candlestick is not in the notebook at the start; searching the library finds it", () => {
    const candlestick = c.evidence.find((e) => e.id === "silver-candlestick")!;
    expect(candlestick.initiallyAvailable).toBe(false);
    expect(candlestick.locationId).toBe("library");
    expect(candlestick.discoveryLine).toBeTruthy();
    expect(c.evidence.filter((e) => e.initiallyAvailable)).toEqual([]);
  });

  it("every clue has a discovery line", () => {
    for (const e of c.evidence) expect(e.discoveryLine, e.id).toBeDefined();
  });

  it("public flavour never names a suspect or the hidden facts", () => {
    const text = [
      ...c.locations.flatMap((l) => [...(l.searchFlavor?.lines ?? []), l.searchFlavor?.emptyLine ?? ""]),
      ...c.evidence.map((e) => e.discoveryLine ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    for (const s of ["victoria", "lady", "archibald", "reginald", "gregory", "will", "inherit", c.solution.time]) {
      expect(text, s).not.toMatch(new RegExp(`\\b${s}\\b`));
    }
  });
});

describe("Blackwood endings", () => {
  const proof = () => [c.solution.weaponId, ...c.solution.keyEvidenceIds];

  it("confession: 4-7 lines, mostly the murderer, citing the weapon and the key evidence", () => {
    const conf = endings.correct.confession;
    expect(conf.length).toBeGreaterThanOrEqual(4);
    expect(conf.length).toBeLessThanOrEqual(7);
    expect(conf.filter((l) => l.speaker === c.solution.murdererId).length).toBeGreaterThanOrEqual(4);
    const cited = new Set(conf.flatMap((l) => l.evidenceIds ?? []));
    for (const id of proof()) expect(cited, id).toContain(id);
  });

  it("recap: narrator prose whose time and place match solution.json, citing the proof", () => {
    const recap = endings.correct.recap;
    expect(recap.every((l) => l.speaker === "narrator")).toBe(true);
    const text = recap.map((l) => l.text).join(" ");
    expect(text).toContain(c.solution.time);
    expect(text.toLowerCase()).toContain(c.solution.locationId);
    const cited = new Set(recap.flatMap((l) => l.evidenceIds ?? []));
    for (const id of proof()) expect(cited, id).toContain(id);
  });

  it("each wrong ending opens with the accused and closes with the murderer's gloat", () => {
    for (const ch of c.characters) {
      const lines = endings.wrong[ch.id];
      expect(lines[0].speaker, ch.id).toBe(ch.id);
      expect(lines[lines.length - 1].speaker, ch.id).toBe(c.solution.murdererId);
    }
  });
});
