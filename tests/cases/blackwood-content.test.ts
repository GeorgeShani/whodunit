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
import { handleInvestigate } from "@/engine/investigate-handler";
import { TEST_ENV } from "../helpers/grok-mock";

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
      "fireplace-poker": "library",
      "muddy-footprint": "hall",
      "letter-opener": "hall",
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

  it("search replies and lead-close copy name no one weapon when weapons are found (#117)", () => {
    const namesOneWeapon = /\bcandlesticks?\b|\bpokers?\b|\bletter[ -]?openers?\b/i;
    const lead = c.leads?.find((l) => l.id === "lead-weapon");
    expect(lead?.closesWhen).toEqual({
      mode: "any",
      evidenceIds: ["silver-candlestick", "fireplace-poker", "letter-opener"],
    });
    expect(lead?.closedLine).toBeTruthy();
    expect(lead!.closedLine, "lead-weapon closedLine").not.toMatch(namesOneWeapon);

    for (const locationId of ["library", "hall"] as const) {
      const r = handleInvestigate({ locationId }, { caseData: c, env: TEST_ENV });
      expect(r.status).toBe(200);
      expect(r.body.found.some((e) => e.weapon === true), locationId).toBe(true);
      const closeCopy = (r.body.progress?.leads ?? [])
        .filter((l) => l.state === "closed")
        .map((l) => l.closedLine ?? "")
        .join("\n");
      const reply = [...r.body.lines, closeCopy].join("\n");
      expect(reply, `${locationId} search reply / lead-close copy`).not.toMatch(namesOneWeapon);
    }
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

  it("r7 M3: every wrong ending has the same shape (two lines, spoken by the accused alone) and gives nothing away", () => {
    for (const ch of c.characters) {
      const lines = endings.wrong[ch.id];
      expect(lines.map((l) => l.speaker), ch.id).toEqual([ch.id, ch.id]);
      expect(lines.map((l) => [l.pauseMs, l.emotion === "shocked"]), ch.id).toEqual([
        [1000, true],
        [1400, false],
      ]);
      const text = lines.map((l) => l.text).join(" ");
      // no secret, alibi or verdict: the transfer, the accounts, the sighting, "right lady", the how and why
      expect(text, ch.id).not.toMatch(/transfer|midnight|money|accounts|borrowed|telephone|see nothin|DO nothin|right lady|wrong story|how and the why|fortune|inherit|monte carlo|letter|new will|candlestick|\bkey\b|library|\bshed\b|\bgin\b/i);
    }
  });
});
