/**
 * Case 001 "Murder at Blackwood Manor": loads the case through the engine's
 * loader/validator (contract v2, docs/CASE_FORMAT.md) and adds story-logic
 * checks the validator does not run: one place per checkpoint, opportunity and
 * weapon access, window presence, knowledge boundaries, relationship/belief
 * consistency and secret-reveal ordering.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase, validateCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { shouldRevealSecret } from "@/engine/secrets";
import { gameMinutes } from "@/engine/time";
import type { Character, TimelineEntry } from "@/engine/types";

let c: LoadedCase;
let toMin: (t: string) => number;
let whereabouts: Map<string, Array<[number, string]>>;
let checkpoints: number[];

const byId = (id: string): Character => {
  const ch = c.characters.find((x) => x.id === id);
  if (!ch) throw new Error(`no character ${id}`);
  return ch;
};
const factById = (id: string) => [...c.facts, ...c.timeline].find((f) => f.id === id);

/** [from, to] in game minutes for a timeline entry (points have from === to). */
const range = (e: TimelineEntry): [number, number] =>
  e.time !== undefined ? [toMin(e.time), toMin(e.time)] : [toMin(e.from!), toMin(e.to!)];

/** Where was `personId` at minute `m`? Latest point location entry at or before m. */
function locationAt(personId: string, m: number): string | undefined {
  let loc: string | undefined;
  for (const [t, l] of whereabouts.get(personId) ?? []) if (t <= m) loc = l;
  return loc;
}

/** Minutes of the entry that we can check: its endpoints plus every checkpoint inside it. */
const probeMinutes = (e: TimelineEntry): number[] => {
  const [from, to] = range(e);
  return [...new Set([from, to, ...checkpoints.filter((m) => m >= from && m <= to)])];
};

beforeAll(async () => {
  c = await loadCase("blackwood");
  toMin = (t) => gameMinutes(t, c.dayStartsAt);
  whereabouts = new Map();
  for (const e of c.timeline) {
    if (e.category !== "location" || e.time === undefined || !e.locationId) continue;
    for (const p of e.involvesCharacterIds) {
      const list = whereabouts.get(p) ?? [];
      list.push([toMin(e.time), e.locationId]);
      whereabouts.set(p, list);
    }
  }
  for (const list of whereabouts.values()) list.sort((a, b) => a[0] - b[0]);
  checkpoints = [
    ...new Set(c.timeline.filter((e) => e.category === "location" && e.time).map((e) => toMin(e.time!))),
  ].sort((a, b) => a - b);
});

describe("Blackwood loads with the engine loader (contract v2)", () => {
  it("validateCase reports no issues", async () => {
    expect((await validateCase("blackwood")).issues).toEqual([]);
  });

  it("has the agreed cast, rooms, clues and solution", () => {
    expect(c.victim.id).toBe("lord-blackwood");
    expect(c.characters.map((ch) => ch.id)).toEqual(["archibald", "gregory", "reginald", "victoria"]);
    expect(c.locations.map((l) => l.id).sort()).toEqual(["dining-room", "garden", "hall", "kitchen", "library"]);
    expect(c.evidence.map((e) => e.id).sort()).toEqual(["burned-letter", "library-key", "muddy-footprint", "silver-candlestick"]);
    expect(c.solution).toMatchObject({
      murdererId: "victoria",
      weaponId: "silver-candlestick",
      locationId: "library",
      time: "21:17",
      motiveId: "inheritance",
    });
    expect(c.solution.keyEvidenceIds.length).toBeGreaterThan(0);
  });

  it("offers red-herring motives alongside the true one", () => {
    const ids = c.motives.map((m) => m.id);
    expect(ids).toContain(c.solution.motiveId);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the public intro spoiler-free", () => {
    const publicText = `${c.tagline} ${c.intro} ${c.victim.description} ${c.victim.causeOfDeath}`.toLowerCase();
    for (const spoiler of ["victoria", "candlestick", "will", "letter", "coal scuttle", "telephone"]) {
      expect(publicText, spoiler).not.toMatch(new RegExp(`\\b${spoiler}\\b`));
    }
  });
});

describe("Blackwood timeline consistency", () => {
  it("places every suspect in exactly one place at every checkpoint", () => {
    for (const ch of c.characters) {
      for (const m of checkpoints) {
        const here = c.timeline.filter(
          (e) => e.category === "location" && e.time !== undefined && toMin(e.time) === m && e.involvesCharacterIds.includes(ch.id),
        );
        expect(here.length, `${ch.id} at minute ${m}`).toBe(1);
      }
    }
  });

  it("every located entry (point or window) only involves people who are there throughout", () => {
    for (const e of c.timeline) {
      if (!e.locationId) continue;
      for (const p of e.involvesCharacterIds) {
        if (!whereabouts.has(p)) continue;
        for (const m of probeMinutes(e)) expect(locationAt(p, m), `${e.id}: ${p} @${m}`).toBe(e.locationId);
      }
    }
  });

  it("uses windows for the time ranges", () => {
    for (const id of ["ev-victoria-argument", "ev-archibald-phone", "ev-reginald-hears-phone"]) {
      const e = c.timeline.find((t) => t.id === id)!;
      expect(e.from && e.to, id).toBeTruthy();
    }
  });

  it("the murderer is at the scene at the murder time, with prior access to the weapon", () => {
    const t = toMin(c.solution.time);
    expect(locationAt(c.solution.murdererId, t)).toBe(c.solution.locationId);
    expect(c.evidence.find((e) => e.id === c.solution.weaponId)?.locationId).toBe(c.solution.locationId);
    const delivered = c.timeline.find((e) => e.id === "ev-candlestick-delivered")!;
    expect(delivered.locationId).toBe(c.solution.locationId);
    expect(range(delivered)[0]).toBeLessThan(t);
    expect(byId(c.solution.murdererId).knownFactIds).toContain("ev-candlesticks-lit");
    const murder = c.timeline.find(
      (e) =>
        e.time === c.solution.time &&
        e.locationId === c.solution.locationId &&
        e.involvesCharacterIds.includes(c.solution.murdererId) &&
        e.involvesCharacterIds.includes(c.victim.id),
    );
    expect(murder).toBeDefined();
  });

  it("no innocent is at the scene at the murder time", () => {
    for (const ch of c.characters.filter((x) => x.id !== c.solution.murdererId)) {
      expect(locationAt(ch.id, toMin(c.solution.time)), ch.id).not.toBe(c.solution.locationId);
    }
  });

  it("the body is found where and when the victim card says", () => {
    const found = c.timeline.find((e) => e.id === "ev-body-discovered")!;
    expect(found.time).toBe(c.victim.foundAt);
    expect(found.locationId).toBe(c.victim.foundAtLocationId);
  });
});

describe("Blackwood knowledge boundaries", () => {
  it("nobody knows a located timeline entry from somewhere they weren't", () => {
    for (const ch of c.characters) {
      for (const id of ch.knownFactIds) {
        const e = c.timeline.find((t) => t.id === id);
        if (!e || !e.locationId) continue;
        for (const m of probeMinutes(e)) expect(locationAt(ch.id, m), `${ch.id} knows ${id} @${m}`).toBe(e.locationId);
      }
    }
  });

  it("everyone knows their own whereabouts", () => {
    for (const ch of c.characters) {
      for (const e of c.timeline.filter((t) => t.category === "location" && t.involvesCharacterIds.includes(ch.id))) {
        expect(ch.knownFactIds, `${ch.id} ${e.id}`).toContain(e.id);
      }
    }
  });

  it("perception facts (non-canonical source) are known only by the perceivers they involve", () => {
    const perceived = c.timeline.filter((e) => e.source !== "canonical");
    expect(perceived.length).toBeGreaterThan(0);
    for (const e of perceived) {
      const knowers = c.characters.filter((ch) => ch.knownFactIds.includes(e.id)).map((ch) => ch.id);
      expect(knowers.length, e.id).toBeGreaterThan(0);
      for (const k of knowers) expect(e.involvesCharacterIds, `${e.id} known by ${k}`).toContain(k);
      expect(e.confidence, e.id).toBeLessThan(1);
    }
  });

  const mustNotKnow: Record<string, string[]> = {
    victoria: ["ev-gregory-sees-victoria", "ev-gregory-enters-hall", "ev-gregory-hears-thud", "ev-reginald-overhears", "ev-archibald-phone", "ev-reginald-hears-phone", "ev-pantry-exchange", "f-reginald-theft"],
    archibald: ["ev-victoria-alone", "ev-victoria-admitted", "ev-murder", "ev-victoria-locks-door", "ev-letter-burned", "ev-key-hidden", "ev-victoria-argument", "f-new-will", "f-reginald-theft"],
    reginald: ["ev-murder", "ev-victoria-alone", "ev-victoria-locks-door", "ev-key-hidden", "ev-letter-burned", "ev-archibald-phone", "f-new-will", "ev-alibi-pact"],
    gregory: ["ev-murder", "ev-key-hidden", "ev-letter-burned", "ev-archibald-threat", "ev-victoria-argument", "f-new-will", "ev-body-discovered"],
  };
  it.each(Object.entries(mustNotKnow))("%s holds no knowledge they could not have", (cid, forbidden) => {
    const known = new Set(byId(cid).knownFactIds);
    for (const id of forbidden) {
      expect(factById(id), `fixture references unknown fact ${id}`).toBeDefined();
      expect(known.has(id), `${cid} must not know ${id}`).toBe(false);
    }
  });

  it("only the murderer knows the murder, the hidden key and the burned letter", () => {
    for (const id of ["ev-murder", "ev-key-hidden", "ev-letter-burned", "ev-victoria-takes-letter"]) {
      expect(c.characters.filter((ch) => ch.knownFactIds.includes(id)).map((ch) => ch.id), id).toEqual([c.solution.murdererId]);
    }
  });

  it("each intended lie is about something the liar actually knows", () => {
    for (const ch of c.characters) {
      expect(ch.intendedLies.length, ch.id).toBeGreaterThan(0);
      for (const l of ch.intendedLies) if (l.aboutFactId) expect(ch.knownFactIds, `${ch.id}/${l.id}`).toContain(l.aboutFactId);
    }
  });
});

describe("Blackwood characters: relationships, beliefs and secrets", () => {
  it("every suspect has a relationship toward every other suspect and the victim", () => {
    const people = [...c.characters.map((ch) => ch.id), c.victim.id];
    for (const ch of c.characters) {
      expect(ch.relationships.map((r) => r.targetCharacterId).sort(), ch.id).toEqual(people.filter((p) => p !== ch.id).sort());
    }
  });

  const topSuspect = (cid: string) =>
    byId(cid)
      .relationships.filter((r) => r.targetCharacterId !== c.victim.id)
      .sort((a, b) => b.suspicion - a.suspicion)[0].targetCharacterId;

  it("suspicion matches beliefs (Reginald→Archibald, Archibald→Gregory, Gregory→Victoria)", () => {
    expect(byId("reginald").beliefs.find((b) => b.id === "b-reginald-crane-did-it")?.isAccurate).toBe(false);
    expect(topSuspect("reginald")).toBe("archibald");
    expect(topSuspect("archibald")).toBe("gregory");
    expect(topSuspect("gregory")).toBe("victoria");
  });

  it("every innocent has a secret and a wrong belief; every secret is revealable by the engine", () => {
    for (const ch of c.characters) {
      if (ch.id !== c.solution.murdererId) expect(ch.beliefs.some((b) => !b.isAccurate), ch.id).toBe(true);
      for (const s of ch.secrets) expect(s.revealConditions, `${ch.id}/${s.id}`).toBeDefined();
    }
  });

  it("Gregory names Victoria only after admitting the footprint, and only when shown the key", () => {
    const g = byId("gregory");
    const saw = g.secrets.find((s) => s.id === "s-gregory-saw-victoria")!;
    const base = { stress: 0, evidenceShownIds: [] as string[], revealedSecretIds: [] as string[] };
    expect(shouldRevealSecret(saw, { ...base, evidenceShownIds: ["library-key"] })).toBe(false);
    expect(shouldRevealSecret(saw, { ...base, revealedSecretIds: ["s-gregory-in-hall"] })).toBe(false);
    expect(
      shouldRevealSecret(saw, { ...base, evidenceShownIds: ["library-key"], revealedSecretIds: ["s-gregory-in-hall"] }),
    ).toBe(true);
    const inHall = g.secrets.find((s) => s.id === "s-gregory-in-hall")!;
    expect(shouldRevealSecret(inHall, { ...base, evidenceShownIds: ["muddy-footprint"] })).toBe(true);
  });

  it("the alibi-breaking testimonies unlock from the four clues alone (no stress needed)", () => {
    const base = { stress: 0, revealedSecretIds: [] as string[] };
    const reg = byId("reginald").secrets.find((s) => s.id === "s-reginald-theft")!;
    const arch = byId("archibald").secrets.find((s) => s.id === "s-archibald-false-alibi")!;
    expect(shouldRevealSecret(reg, { ...base, evidenceShownIds: ["burned-letter"] })).toBe(true);
    expect(shouldRevealSecret(arch, { ...base, evidenceShownIds: ["library-key"] })).toBe(true);
  });

  it("Victoria's confession needs all the proof, prior cracks and high stress", () => {
    const murder = byId("victoria").secrets.find((s) => s.id === "s-victoria-murder")!;
    const all = ["silver-candlestick", "library-key", "burned-letter", "muddy-footprint"];
    const cracked = ["s-victoria-left-dining", "s-victoria-new-will"];
    expect(shouldRevealSecret(murder, { stress: 100, evidenceShownIds: all, revealedSecretIds: [] })).toBe(false);
    expect(shouldRevealSecret(murder, { stress: 50, evidenceShownIds: all, revealedSecretIds: cracked })).toBe(false);
    expect(shouldRevealSecret(murder, { stress: 90, evidenceShownIds: all, revealedSecretIds: cracked })).toBe(true);
  });
});
