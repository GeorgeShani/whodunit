/**
 * Blackwood search flavour, discovery lines and endings.
 *
 * Reads the raw JSON because the searchFlavor / discoveryLine / endings
 * schemas are not on main yet (Dexter owns engine/). Once they land, parse with
 * the engine schemas here as well; these story checks stay.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EmotionSchema } from "@/engine/types";

const DIR = join(process.cwd(), "cases", "blackwood");
const read = (f: string): any => JSON.parse(readFileSync(join(DIR, f), "utf8"));

const caseFile = read("case.json");
const evidence: Array<{ id: string; locationId?: string; discoveryLine?: string }> = read("evidence.json");
const solution = read("solution.json");
const endings = read("endings.json");
const SUSPECTS = ["archibald", "gregory", "reginald", "victoria"];
const evidenceIds = new Set(evidence.map((e) => e.id));

interface Line { speaker: string; text: string; pauseMs?: number; emotion?: string; evidenceIds?: string[] }

function checkLines(lines: Line[], where: string) {
  expect(lines.length, where).toBeGreaterThan(0);
  for (const [i, l] of lines.entries()) {
    const at = `${where}[${i}]`;
    expect(Object.keys(l).every((k) => ["speaker", "text", "pauseMs", "emotion", "evidenceIds"].includes(k)), at).toBe(true);
    expect([...SUSPECTS, "narrator"], at).toContain(l.speaker);
    expect(l.text.trim().length, at).toBeGreaterThan(0);
    if (l.pauseMs !== undefined) expect(l.pauseMs >= 0 && l.pauseMs <= 5000, at).toBe(true);
    if (l.emotion !== undefined) expect(EmotionSchema.safeParse(l.emotion).success, at).toBe(true);
    for (const id of l.evidenceIds ?? []) expect(evidenceIds, at).toContain(id);
  }
}

describe("Blackwood location search", () => {
  it("clues are found where the solution proof puts them", () => {
    expect(Object.fromEntries(evidence.map((e) => [e.id, e.locationId]))).toEqual({
      "silver-candlestick": "library",
      "muddy-footprint": "hall",
      "burned-letter": "dining-room",
      "library-key": "dining-room",
    });
  });

  it("every location has 1-2 flavour lines; clue-less locations have an emptyLine", () => {
    const withClues = new Set(evidence.map((e) => e.locationId));
    for (const loc of caseFile.locations) {
      const f = loc.searchFlavor;
      expect(f, loc.id).toBeDefined();
      expect(f.lines.length >= 1 && f.lines.length <= 2, loc.id).toBe(true);
      if (!withClues.has(loc.id)) expect(f.emptyLine?.trim().length, `${loc.id} emptyLine`).toBeGreaterThan(0);
      else expect(f.emptyLine, `${loc.id} has clues, so no emptyLine`).toBeUndefined();
    }
  });

  it("every clue has a discovery line", () => {
    for (const e of evidence) expect(e.discoveryLine?.trim().length, e.id).toBeGreaterThan(0);
  });

  it("public flavour never names the murderer or the hidden facts", () => {
    const text = [
      ...caseFile.locations.flatMap((l: { searchFlavor: { lines: string[]; emptyLine?: string } }) => [
        ...l.searchFlavor.lines,
        l.searchFlavor.emptyLine ?? "",
      ]),
      ...evidence.map((e) => e.discoveryLine ?? ""),
    ].join(" ").toLowerCase();
    for (const s of ["victoria", "lady", "archibald", "reginald", "gregory", "will", "telephone", "inherit", "21:17"]) {
      expect(text, s).not.toMatch(new RegExp(`\\b${s}\\b`));
    }
  });
});

describe("Blackwood endings", () => {
  it("has only the agreed top-level shape", () => {
    expect(Object.keys(endings).sort()).toEqual(["correct", "escapedLine", "wrong"]);
    expect(Object.keys(endings.correct).sort()).toEqual(["confession", "recap"]);
    expect(endings.escapedLine.trim().length).toBeGreaterThan(0);
  });

  it("confession: 4-7 lines, spoken by the murderer (plus cameo), citing the weapon, key and letter", () => {
    const c: Line[] = endings.correct.confession;
    checkLines(c, "confession");
    expect(c.length >= 4 && c.length <= 7).toBe(true);
    expect(c.filter((l) => l.speaker === solution.murdererId).length).toBeGreaterThanOrEqual(4);
    const cited = new Set(c.flatMap((l) => l.evidenceIds ?? []));
    for (const id of [solution.weaponId, ...solution.keyEvidenceIds]) expect(cited, id).toContain(id);
  });

  it("recap: narrator prose stating the time and place (matching solution.json) and citing the proof", () => {
    const r: Line[] = endings.correct.recap;
    checkLines(r, "recap");
    expect(r.every((l) => l.speaker === "narrator")).toBe(true);
    const all = r.map((l) => l.text).join(" ");
    expect(all).toContain(solution.time);
    expect(all.toLowerCase()).toContain(solution.locationId);
    const cited = new Set(r.flatMap((l) => l.evidenceIds ?? []));
    for (const id of [solution.weaponId, ...solution.keyEvidenceIds]) expect(cited, id).toContain(id);
  });

  it("wrong endings cover every suspect: the accused reacts, then Victoria gloats", () => {
    expect(Object.keys(endings.wrong).sort()).toEqual(SUSPECTS);
    for (const id of SUSPECTS) {
      const lines: Line[] = endings.wrong[id];
      checkLines(lines, `wrong.${id}`);
      expect(lines[0].speaker, id).toBe(id);
      expect(lines[lines.length - 1].speaker, id).toBe(solution.murdererId);
    }
  });
});
