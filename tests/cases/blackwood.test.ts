/**
 * Case 001 "Murder at Blackwood Manor": parses every authored file with the
 * engine's Zod schemas and runs cross-reference / logic checks that the
 * schemas alone cannot express.
 *
 * NOTE (schema gap): engine/types.ts has no schema for the case.json envelope
 * (id, title, victim, locations, facts). `CaseEnvelopeSchema` below is a
 * TEST-LOCAL, provisional wrapper built only from engine schemas. Replace it
 * with the engine's case-file schema once one lands on main.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CharacterSchema,
  EvidenceSchema,
  FactSchema,
  GameTimeSchema,
  IdSchema,
  LocationSchema,
  type Character,
  type Evidence,
  type Fact,
} from "@/engine";
import { CaseSolutionSchema } from "@/engine/solution";

const CASE_DIR = join(process.cwd(), "cases", "blackwood");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(CASE_DIR, rel), "utf8"));

const CaseEnvelopeSchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1),
  victimId: IdSchema,
  locations: z.array(LocationSchema).min(1),
  facts: z.array(FactSchema).default([]),
});

const caseFile = CaseEnvelopeSchema.parse(readJson("case.json"));
const timeline: Fact[] = z.array(FactSchema).parse(readJson("timeline.json"));
const evidence: Evidence[] = z.array(EvidenceSchema).parse(readJson("evidence.json"));
const solution = CaseSolutionSchema.parse(readJson("solution.json"));
const characterFiles = readdirSync(join(CASE_DIR, "characters")).filter((f) => f.endsWith(".json")).sort();
const characters: Character[] = characterFiles.map((f) => CharacterSchema.parse(readJson(join("characters", f))));

const allFacts: Fact[] = [...caseFile.facts, ...timeline];
const factById = new Map(allFacts.map((f) => [f.id, f]));
const locationIds = new Set(caseFile.locations.map((l) => l.id));
const evidenceIds = new Set(evidence.map((e) => e.id));
const characterIds = new Set(characters.map((c) => c.id));
const personIds = new Set([...characterIds, caseFile.victimId]);
const byId = (id: string) => {
  const c = characters.find((ch) => ch.id === id);
  if (!c) throw new Error(`no character ${id}`);
  return c;
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Ground-truth whereabouts from `location` facts: person -> sorted [minute, locationId]. */
const whereabouts = new Map<string, Array<[number, string]>>();
for (const f of timeline) {
  if (f.category !== "location" || !f.time || !f.locationId) continue;
  for (const p of f.involvesCharacterIds) {
    const list = whereabouts.get(p) ?? [];
    list.push([toMin(f.time), f.locationId]);
    whereabouts.set(p, list);
  }
}
for (const list of whereabouts.values()) list.sort((a, b) => a[0] - b[0]);

/** Where was `personId` at `time`? (latest location fact at or before that time) */
function locationAt(personId: string, time: string): string | undefined {
  const list = whereabouts.get(personId);
  if (!list) return undefined;
  let loc: string | undefined;
  for (const [m, l] of list) if (m <= toMin(time)) loc = l;
  return loc;
}

describe("Blackwood case files parse with the engine schemas", () => {
  it("parses case.json, timeline.json, evidence.json, solution.json and all characters", () => {
    expect(caseFile.id).toBe("blackwood");
    expect(caseFile.victimId).toBe("lord-blackwood");
    expect(timeline.length).toBeGreaterThan(0);
    expect(characters.map((c) => c.id).sort()).toEqual(["archibald", "gregory", "reginald", "victoria"]);
  });

  it("character file names match their ids", () => {
    characterFiles.forEach((f, i) => expect(f).toBe(`${characters[i].id}.json`));
  });

  it("keeps locations to the agreed five", () => {
    expect([...locationIds].sort()).toEqual(["dining-room", "garden", "hall", "kitchen", "library"]);
  });

  it("has exactly the four agreed clues", () => {
    expect([...evidenceIds].sort()).toEqual(["burned-letter", "library-key", "muddy-footprint", "silver-candlestick"]);
  });

  it("uses HH:MM times everywhere", () => {
    for (const f of allFacts) if (f.time) expect(GameTimeSchema.safeParse(f.time).success).toBe(true);
    expect(GameTimeSchema.safeParse(solution.time).success).toBe(true);
  });
});

describe("Blackwood cross-references", () => {
  it("has globally unique fact, evidence, belief and secret ids", () => {
    const ids = [
      ...allFacts.map((f) => f.id),
      ...evidence.map((e) => e.id),
      ...characters.flatMap((c) => [...c.beliefs.map((b) => b.id), ...c.secrets.map((s) => s.id)]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("victim id does not collide with a character id", () => {
    expect(characterIds.has(caseFile.victimId)).toBe(false);
  });

  it("facts reference existing locations and people", () => {
    for (const f of allFacts) {
      if (f.locationId) expect(locationIds, `${f.id}.locationId`).toContain(f.locationId);
      for (const p of f.involvesCharacterIds) expect(personIds, `${f.id} involves ${p}`).toContain(p);
    }
  });

  it("evidence references existing locations and facts", () => {
    for (const e of evidence) {
      if (e.locationId) expect(locationIds).toContain(e.locationId);
      expect(e.relatedFactIds.length).toBeGreaterThan(0);
      for (const id of e.relatedFactIds) expect(factById.has(id), `${e.id} -> ${id}`).toBe(true);
    }
  });

  it("characters reference existing facts, evidence and people", () => {
    for (const c of characters) {
      for (const id of c.knownFactIds) expect(factById.has(id), `${c.id} knows ${id}`).toBe(true);
      for (const b of c.beliefs) if (b.aboutFactId) expect(factById.has(b.aboutFactId), `${c.id}/${b.id}`).toBe(true);
      for (const s of c.secrets) {
        for (const e of s.pressuredByEvidenceIds) expect(evidenceIds, `${c.id}/${s.id}`).toContain(e);
        for (const f of s.relatedFactIds) expect(factById.has(f), `${c.id}/${s.id} -> ${f}`).toBe(true);
      }
      for (const r of c.relationships) {
        expect(personIds, `${c.id} -> ${r.characterId}`).toContain(r.characterId);
        expect(r.characterId).not.toBe(c.id);
      }
    }
  });

  it("solution points at a real character, evidence item (weapon) and location", () => {
    expect(characterIds).toContain(solution.murdererId);
    expect(evidenceIds).toContain(solution.weaponId);
    expect(locationIds).toContain(solution.locationId);
    expect(solution).toEqual({ murdererId: "victoria", weaponId: "silver-candlestick", locationId: "library", time: "21:17" });
  });

  it("every innocent has at least one secret and at least one wrong belief", () => {
    for (const c of characters.filter((ch) => ch.id !== solution.murdererId)) {
      expect(c.secrets.length, c.id).toBeGreaterThan(0);
      expect(c.beliefs.some((b) => !b.isAccurate), c.id).toBe(true);
    }
    expect(byId("reginald").beliefs.find((b) => b.id === "b-reginald-crane-did-it")?.isAccurate).toBe(false);
  });
});

describe("Blackwood timeline consistency", () => {
  const checkpoints = [
    ...new Set(timeline.filter((f) => f.category === "location" && f.time).map((f) => f.time as string)),
  ].sort((a, b) => toMin(a) - toMin(b));

  it("places every suspect somewhere at every checkpoint, never in two places at once", () => {
    for (const c of characters) {
      for (const t of checkpoints) {
        const here = timeline.filter(
          (f) => f.category === "location" && f.time === t && f.involvesCharacterIds.includes(c.id),
        );
        expect(here.length, `${c.id} at ${t}`).toBe(1);
      }
    }
  });

  it("every time+place fact only involves people who are there at that time", () => {
    for (const f of timeline) {
      if (!f.time || !f.locationId) continue;
      for (const p of f.involvesCharacterIds) {
        if (!whereabouts.has(p)) continue;
        expect(locationAt(p, f.time), `${f.id}: ${p} at ${f.time}`).toBe(f.locationId);
      }
    }
  });

  it("the murderer is at the scene at the murder time and had access to the weapon there", () => {
    expect(locationAt(solution.murdererId, solution.time)).toBe(solution.locationId);
    const weapon = evidence.find((e) => e.id === solution.weaponId);
    expect(weapon?.locationId).toBe(solution.locationId);
    // The weapon was brought into the scene before the murder, while the murderer watched it go.
    const delivered = factById.get("ev-candlestick-delivered");
    expect(delivered?.locationId).toBe(solution.locationId);
    expect(toMin(delivered!.time!)).toBeLessThan(toMin(solution.time));
    expect(byId(solution.murdererId).knownFactIds).toContain("ev-candlesticks-lit");
    const murder = timeline.find(
      (f) =>
        f.time === solution.time &&
        f.locationId === solution.locationId &&
        f.involvesCharacterIds.includes(solution.murdererId) &&
        f.involvesCharacterIds.includes(caseFile.victimId),
    );
    expect(murder, "a murder fact at the solution time/place").toBeDefined();
  });

  it("no innocent is at the scene at the murder time", () => {
    for (const c of characters.filter((ch) => ch.id !== solution.murdererId)) {
      expect(locationAt(c.id, solution.time), c.id).not.toBe(solution.locationId);
    }
  });

  it("the victim is alive in the library before the murder (seen at 21:12)", () => {
    expect(locationAt(caseFile.victimId, "21:12")).toBe("library");
    expect(byId("reginald").knownFactIds).toContain("ev-candlestick-delivered");
  });
});

describe("Blackwood knowledge boundaries", () => {
  it("nobody knows a time+place fact from a place they weren't in at that time", () => {
    for (const c of characters) {
      for (const id of c.knownFactIds) {
        const f = factById.get(id)!;
        if (!f.time || !f.locationId) continue;
        expect(locationAt(c.id, f.time), `${c.id} knows ${id} (${f.time} @ ${f.locationId})`).toBe(f.locationId);
      }
    }
  });

  it("everyone knows their own whereabouts", () => {
    for (const c of characters) {
      const own = timeline.filter((f) => f.category === "location" && f.involvesCharacterIds.includes(c.id));
      for (const f of own) expect(c.knownFactIds, `${c.id} ${f.id}`).toContain(f.id);
    }
  });

  // Facts a character was physically near but must NOT know (hidden, behind a door, or another's secret).
  const mustNotKnow: Record<string, string[]> = {
    victoria: ["ev-gregory-sees-victoria", "ev-gregory-enters-hall", "ev-gregory-hears-thud", "ev-reginald-overhears", "ev-archibald-phone", "ev-reginald-hears-phone", "ev-pantry-exchange", "f-reginald-theft"],
    archibald: ["ev-victoria-alone", "ev-victoria-admitted", "ev-murder", "ev-victoria-locks-door", "ev-letter-burned", "ev-key-hidden", "ev-victoria-argument", "f-new-will", "f-reginald-theft"],
    reginald: ["ev-murder", "ev-victoria-alone", "ev-victoria-locks-door", "ev-key-hidden", "ev-letter-burned", "ev-archibald-phone", "f-new-will", "ev-alibi-pact"],
    gregory: ["ev-murder", "ev-key-hidden", "ev-letter-burned", "ev-archibald-threat", "ev-victoria-argument", "f-new-will", "ev-body-discovered"],
  };
  it.each(Object.entries(mustNotKnow))("%s does not hold knowledge they could not have", (cid, forbidden) => {
    const known = new Set(byId(cid).knownFactIds);
    for (const id of forbidden) {
      expect(factById.has(id), `fixture references unknown fact ${id}`).toBe(true);
      expect(known.has(id), `${cid} must not know ${id}`).toBe(false);
    }
  });

  it("only the murderer knows the murder itself, the hidden key and the burned letter", () => {
    for (const id of ["ev-murder", "ev-key-hidden", "ev-letter-burned", "ev-victoria-takes-letter"]) {
      const knowers = characters.filter((c) => c.knownFactIds.includes(id)).map((c) => c.id);
      expect(knowers, id).toEqual([solution.murdererId]);
    }
  });

  it("the witness who saw the murderer leave is present in the hall at 21:19", () => {
    expect(locationAt("gregory", "21:19")).toBe("hall");
    expect(locationAt("victoria", "21:19")).toBe("hall");
    expect(byId("gregory").knownFactIds).toContain("ev-gregory-sees-victoria");
  });
});
