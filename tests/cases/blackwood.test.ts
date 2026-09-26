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
import { knowledgeGate } from "@/engine/knowledge-gate";
import { shouldRevealSecret } from "@/engine/secrets";
import { isLieBroken } from "@/engine/testimony";
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

/**
 * QA #7 / #6: the engine withholds a character's known facts only when they are
 * linked to one of that character's LOCKED secrets (relatedFactIds) or UNEXPOSED
 * lies (aboutFactId); everything else reaches the model as-is (engine/knowledge-gate.ts).
 */
describe("Blackwood knowledge gating (QA #6, #7)", () => {
  /** Known facts that would give a secret away or contradict a lie if the model saw them unguarded. */
  const SENSITIVE: Record<string, string[]> = {
    victoria: [
      "ev-murder", "ev-victoria-admitted", "ev-victoria-takes-letter", "ev-victoria-locks-door", "ev-victoria-alone",
      "ev-key-hidden", "ev-letter-burned", "ev-archibald-leaves-dining", "ev-archibald-returns", "ev-alibi-pact",
      "ev-victoria-argument", "f-new-will", "f-inheritance-motive", "f-letter-accuses-butler",
      "loc-victoria-2050", "loc-victoria-2054", "ev-victoria-passes-reginald",
      ...["13", "14", "15", "16", "17", "18", "19", "20", "21", "22"].map((m) => `loc-victoria-21${m}`),
    ],
    archibald: [
      "f-archibald-embezzlement", "ev-archibald-threat", "loc-archibald-2040", "ev-archibald-leaves-dining", "ev-archibald-phone",
      "ev-archibald-notices-pantry", "ev-pantry-exchange", "ev-archibald-returns", "ev-alibi-pact",
      ...["13", "14", "15", "16", "17", "18", "19", "20", "21", "22"].map((m) => `loc-archibald-21${m}`),
    ],
    reginald: [
      "f-reginald-theft", "ev-reginald-hears-phone", "ev-pantry-exchange", "ev-reginald-overhears", "loc-reginald-2054",
      ...["14", "15", "16", "17", "18", "19", "20", "21", "22"].map((m) => `loc-reginald-21${m}`),
    ],
    gregory: [
      "ev-gregory-enters-hall", "ev-gregory-hears-thud", "ev-gregory-sees-victoria", "ev-victoria-locks-door",
      "f-footprint-gregory", "f-no-mud-beyond-alcove",
      ...["14", "15", "16", "17", "18", "19", "20", "21", "22"].map((m) => `loc-gregory-21${m}`),
    ],
  };
  /** Known, character-involving entries inside the blackout window (21:13-21:22) that are safe to show: they match the cover story. */
  const SAFE_IN_WINDOW: Record<string, string[]> = {
    victoria: [],
    archibald: [],
    reginald: ["loc-reginald-2113", "ev-lord-relocks"],
    gregory: ["loc-gregory-2113"],
  };
  /** Facts gated for this character: own secrets' relatedFactIds, own lies' aboutFactId, or hiddenUntil naming an own secret/lie. */
  const covered = (ch: Character) => {
    const own = new Set([...ch.secrets.map((s) => s.id), ...ch.intendedLies.map((l) => l.id)]);
    const explicit = [...c.facts, ...c.timeline]
      .filter((f) => f.hiddenUntil && [...f.hiddenUntil.secretIds, ...f.hiddenUntil.lieIds].some((id) => own.has(id)))
      .map((f) => f.id);
    return new Set([
      ...ch.secrets.flatMap((s) => s.relatedFactIds),
      ...ch.intendedLies.flatMap((l) => (l.aboutFactId ? [l.aboutFactId] : [])),
      ...explicit,
    ]);
  };
  const locked = { evidenceShownIds: [], revealedSecretIds: [] };

  it("every incriminating or secret-related fact a character knows is linked to their own secret or lie", () => {
    for (const ch of c.characters) {
      const cov = covered(ch);
      for (const id of SENSITIVE[ch.id]) {
        if (!ch.knownFactIds.includes(id)) continue;
        expect(cov.has(id), `${ch.id}: ${id} is not linked to any of their secrets/lies`).toBe(true);
      }
      // Anything they know about themselves during the blackout must be linked explicitly or listed as safe.
      for (const id of ch.knownFactIds) {
        const e = c.timeline.find((t) => t.id === id);
        if (!e || !e.involvesCharacterIds.includes(ch.id)) continue;
        const [from, to] = range(e);
        if (to < toMin("21:13") || from > toMin("21:22")) continue;
        expect(cov.has(id) || SAFE_IN_WINDOW[ch.id].includes(id), `${ch.id}: unclassified blackout entry ${id}`).toBe(true);
      }
    }
  });

  it("with nothing shown or revealed, the gate withholds every sensitive fact and the beliefs about them", () => {
    for (const ch of c.characters) {
      const gate = knowledgeGate(c, ch, locked);
      for (const id of SENSITIVE[ch.id]) {
        if (ch.knownFactIds.includes(id)) expect(gate.withheldFactIds.has(id), `${ch.id}: ${id} leaks`).toBe(true);
      }
    }
    const withheld = (id: string) => knowledgeGate(c, byId(id), locked).withheldBeliefIds;
    expect([...withheld("victoria")].sort()).toEqual([
      "b-victoria-archibald-loyal", "b-victoria-brandy-errand", "b-victoria-letter-gone", "b-victoria-reginald-deaf", "b-victoria-unseen",
    ]);
    expect([...withheld("archibald")].sort()).toEqual(["b-archibald-butler-spy", "b-archibald-victoria-stayed"]);
    expect([...withheld("reginald")]).toEqual(["b-reginald-will"]);
    // Red-herring beliefs must still reach the model.
    expect(withheld("reginald").has("b-reginald-crane-did-it")).toBe(false);
    expect(withheld("archibald").has("b-archibald-gregory-did-it")).toBe(false);
    expect(withheld("gregory").has("b-gregory-will-hang")).toBe(false);
    expect(withheld("reginald").has("b-reginald-lady-stayed")).toBe(false);
  });

  it("uses the explicit gate; every fact the proximity rule used to hide was reviewed", () => {
    expect(c.knowledgeGate).toBe("explicit");
    // Reviewed and deliberately visible: they match the cover story and nobody learns anything they couldn't know.
    const VISIBLE_AFTER_REVIEW: Record<string, string[]> = {
      victoria: ["loc-victoria-2057", "loc-victoria-2058", "loc-victoria-2112", "loc-victoria-2140"],
      archibald: ["loc-archibald-2112", "loc-archibald-2140"],
      reginald: ["b-reginald-lady-stayed"],
      gregory: [],
    };
    for (const ch of c.characters) {
      const prox = knowledgeGate({ ...c, knowledgeGate: "proximity" }, ch, locked);
      const expl = knowledgeGate(c, ch, locked);
      const nowVisible = [
        ...ch.knownFactIds.filter((id) => prox.withheldFactIds.has(id) && !expl.withheldFactIds.has(id)),
        ...ch.beliefs.filter((b) => prox.withheldBeliefIds.has(b.id) && !expl.withheldBeliefIds.has(b.id)).map((b) => b.id),
      ];
      expect(nowVisible.sort(), ch.id).toEqual(VISIBLE_AFTER_REVIEW[ch.id].sort());
    }
    // Explicit per-fact hiding, including Reginald's 21:14 pantry entry (his 21:13 lock-turn stays visible).
    expect(factById("loc-reginald-2114")!.hiddenUntil).toEqual({ secretIds: ["s-reginald-theft"], lieIds: [] });
    expect(factById("loc-gregory-2114")!.hiddenUntil).toEqual({ secretIds: ["s-gregory-in-hall"], lieIds: [] });
    expect(factById("loc-archibald-2040")!.hiddenUntil).toEqual({ secretIds: [], lieIds: ["l-archibald-racehorse"] });
    const reg = knowledgeGate(c, byId("reginald"), locked);
    expect(reg.withheldFactIds.has("loc-reginald-2114")).toBe(true);
    expect(reg.withheldFactIds.has("loc-reginald-2113")).toBe(false);
    expect(reg.withheldFactIds.has("ev-lord-relocks")).toBe(false);
    expect(knowledgeGate(c, byId("reginald"), { ...locked, revealedSecretIds: ["s-reginald-theft"] }).withheldFactIds.has("loc-reginald-2114")).toBe(false);
  });

  it("visible false beliefs are red herrings that don't contradict what the believer witnessed", () => {
    // Reginald: 'her ladyship stayed in the dining room'. He last saw her there at 21:11 and saw nobody after 21:13.
    const reg = byId("reginald");
    expect(reg.knownFactIds).toContain("loc-reginald-2111");
    expect(reg.knownFactIds).not.toContain("ev-victoria-alone");
    expect(reg.knownFactIds).not.toContain("ev-gregory-sees-victoria");
    // Reginald's and Archibald's culprit beliefs name people they never saw during the blackout.
    for (const [who, target] of [["reginald", "archibald"], ["archibald", "gregory"]] as const) {
      const seen = byId(who).knownFactIds
        .map((id) => c.timeline.find((t) => t.id === id))
        .filter((t): t is TimelineEntry => Boolean(t) && t!.involvesCharacterIds.includes(target) && !t!.id.startsWith(`loc-${target}`))
        .filter((t) => { const [a, b] = range(t); return b >= toMin("21:13") && a <= toMin("21:22"); })
        .map((t) => t.id);
      // Reginald did hear Crane at 21:15-21:20 (behind his theft secret), which only supports his suspicion.
      expect(seen.filter((id) => id !== "ev-pantry-exchange"), `${who} on ${target}`).toEqual([]);
    }
  });

  it("revealing the secrets releases the facts again (each is gated by a real, reachable secret)", () => {
    for (const ch of c.characters) {
      const gate = knowledgeGate(c, ch, {
        evidenceShownIds: c.evidence.map((e) => e.id),
        revealedSecretIds: ch.secrets.map((s) => s.id),
      });
      expect(ch.knownFactIds.filter((id) => gate.withheldFactIds.has(id)), ch.id).toEqual([]);
    }
  });

  it("Reginald saw nobody at the library door in the blackout, and the model is told so (#6)", () => {
    const reg = byId("reginald");
    const gate = knowledgeGate(c, reg, locked);
    const fact = factById("f-reginald-saw-no-one")!;
    expect(fact.source).toBe("witnessed");
    expect(reg.knownFactIds).toContain("f-reginald-saw-no-one");
    expect(gate.withheldFactIds.has("f-reginald-saw-no-one")).toBe(false);
    const belief = reg.beliefs.find((b) => b.aboutFactId === "f-reginald-saw-no-one")!;
    expect(belief.isAccurate).toBe(true);
    expect(gate.withheldBeliefIds.has(belief.id)).toBe(false);
    // His only sighting of Victoria is 20:57; nothing he knows puts her in the hall or library during the blackout.
    for (const id of reg.knownFactIds) {
      const e = c.timeline.find((t) => t.id === id);
      if (!e || !e.involvesCharacterIds.includes("victoria") || !["hall", "library"].includes(e.locationId ?? "")) continue;
      const [, to] = range(e);
      expect(to < toMin("21:10") || range(e)[0] >= toMin("21:30"), `${id} puts Victoria in the ${e.locationId}`).toBe(true);
    }
    // And the model still gets the times he does know: 20:57, 21:12, 21:13.
    for (const id of ["ev-victoria-passes-reginald", "ev-candlestick-delivered", "ev-lord-relocks"]) expect(gate.withheldFactIds.has(id), id).toBe(false);
  });
});

/** QA #7: free text reaches the model verbatim, so it must read as the cover story, never the truth. */
describe("Blackwood free text tells no secrets", () => {
  const TELLTALE = /\b(alibi|secret|theft|steal|stole|embezzl|telephon|phone|hidden money|what he saw|overheard|new will|prison|never left|hated him)\b/i;
  it("goals, personality and relationship notes contain no giveaway wording", () => {
    for (const ch of c.characters) {
      const p = ch.personality;
      const texts = [
        ...ch.goals,
        ...p.traits,
        p.speechStyle,
        ...ch.relationships.flatMap((r) => [r.kind ?? "", r.description ?? ""]),
      ];
      for (const t of texts) expect(t, `${ch.id}: "${t}"`).not.toMatch(TELLTALE);
    }
  });
});

/** Testimony: revealed secrets become notebook cards that break other suspects' lies (docs/CASE_FORMAT.md). */
describe("Blackwood testimony", () => {
  const secretOf = (id: string) => c.characters.flatMap((ch) => ch.secrets.map((s) => ({ s, owner: ch }))).find((x) => x.s.id === id)!;

  it("has public summaries for every testimony secret, none for the murder or the locked-door admission", () => {
    for (const id of ["s-reginald-theft", "s-archibald-false-alibi", "s-gregory-saw-victoria", "s-reginald-overheard", "s-gregory-in-hall"]) {
      expect(secretOf(id).s.testimonySummary, id).toBeTruthy();
    }
    expect(secretOf("s-victoria-murder").s.testimonySummary).toBeUndefined();
    expect(secretOf("s-victoria-locked-door").s.testimonySummary).toBeUndefined();
    for (const ch of c.characters) for (const s of ch.secrets) if (s.testimonySummary) expect(s.testimonySummary.length, s.id).toBeLessThanOrEqual(240);
  });

  it("each summary's clock times come from the owner's own knowledge", () => {
    for (const ch of c.characters) {
      const known = new Set<number>();
      for (const id of ch.knownFactIds) {
        const f = factById(id)!;
        if (f.time) known.add(toMin(f.time));
        if (f.from && f.to) for (let m = toMin(f.from); m <= toMin(f.to); m++) known.add(m);
      }
      for (const s of ch.secrets) {
        for (const t of s.testimonySummary?.match(/\b\d{2}:\d{2}\b/g) ?? []) expect(known.has(toMin(t)), `${s.id} says ${t}`).toBe(true);
      }
    }
  });

  it("each testimony breaks exactly the lies it contradicts in canon", () => {
    const revealable = c.characters.flatMap((ch) => ch.secrets.filter((s) => s.testimonySummary).map((s) => s.id));
    const matrix: Record<string, string[]> = {};
    for (const ch of c.characters) {
      for (const l of ch.intendedLies) {
        const by = revealable.filter((sid) => isLieBroken(c, l, { evidenceShownIds: [], testimonyShownIds: [sid] }));
        if (by.length) matrix[l.id] = by.sort();
      }
    }
    expect(matrix).toEqual({
      "l-victoria-together": ["s-archibald-false-alibi", "s-gregory-saw-victoria", "s-reginald-theft"],
      "l-victoria-locked-in": ["s-gregory-saw-victoria"],
      "l-victoria-never-in-hall": ["s-gregory-saw-victoria"],
      "l-victoria-menu": ["s-reginald-overheard"],
      "l-archibald-together": ["s-reginald-theft"],
      "l-reginald-heard-nothing": ["s-archibald-false-alibi"],
    });
    // The canon behind each break is inside the breaking secret (what the card says the witness knows).
    const has = (sid: string, fid: string) => expect(secretOf(sid).s.relatedFactIds, `${sid} -> ${fid}`).toContain(fid);
    has("s-reginald-theft", "ev-reginald-hears-phone"); // Crane on the servants' telephone 21:15-21:20
    expect(factById("ev-reginald-hears-phone")).toMatchObject({ from: "21:15", to: "21:20", locationId: "kitchen", source: "heard" });
    expect(factById("ev-reginald-hears-phone")!.statement).toContain("Mr Crane");
    has("s-archibald-false-alibi", "ev-archibald-leaves-dining"); // left Victoria at 21:13
    has("s-archibald-false-alibi", "ev-pantry-exchange"); // the butler called out to him: Reginald heard something
    has("s-gregory-saw-victoria", "ev-gregory-sees-victoria"); // Victoria in the hall at 21:19, locking the door
    has("s-reginald-overheard", "ev-reginald-overhears");
    expect(factById("ev-reginald-overhears")!.statement).toContain("new will");
  });

  it("the dinner-row and Gregory lies stay evidence-only", () => {
    const lies = c.characters.flatMap((ch) => ch.intendedLies);
    for (const id of ["l-archibald-racehorse", "l-gregory-shed", "l-gregory-saw-nothing"]) {
      const l = lies.find((x) => x.id === id)!;
      expect(l.breaksOnSecretIds, id).toEqual([]);
      expect(l.breaksOnFactIds, id).toEqual([]);
      expect(l.brokenByEvidenceIds.length, id).toBeGreaterThan(0);
    }
  });
});

describe("Blackwood reveal paths: stress and evidence", () => {
  const secret = (id: string) => byId("victoria").secrets.find((s) => s.id === id)!;
  const st = (stress: number, evidenceShownIds: string[] = [], revealedSecretIds: string[] = []) => ({ stress, evidenceShownIds, revealedSecretIds });

  it("enough pressure makes Victoria admit she left the dining room, but nothing more", () => {
    expect(secret("s-victoria-left-dining").revealConditions?.stressThreshold).toBe(70);
    expect(shouldRevealSecret(secret("s-victoria-left-dining"), st(69))).toBe(false);
    expect(shouldRevealSecret(secret("s-victoria-left-dining"), st(70))).toBe(true);
    // Stress never unlocks the library visit or the murder on its own.
    expect(shouldRevealSecret(secret("s-victoria-locked-door"), st(100, [], ["s-victoria-left-dining"]))).toBe(false);
    expect(shouldRevealSecret(secret("s-victoria-murder"), st(100, [], ["s-victoria-left-dining", "s-victoria-new-will"]))).toBe(false);
    expect(secret("s-victoria-left-dining").description).not.toMatch(/library|key|candlestick|killed/i);
  });

  it("with the four clues and zero stress every non-confession secret unlocks and every lie breaks", () => {
    const all = c.evidence.map((e) => e.id);
    for (const ch of c.characters) {
      const revealed: string[] = [];
      for (let pass = 0; pass < ch.secrets.length; pass++) {
        for (const s of ch.secrets) if (!revealed.includes(s.id) && shouldRevealSecret(s, st(0, all, revealed))) revealed.push(s.id);
      }
      const expected = ch.secrets.filter((s) => s.id !== "s-victoria-murder").map((s) => s.id);
      expect(revealed.sort(), ch.id).toEqual(expected.sort());
      for (const l of ch.intendedLies) expect(isLieBroken(c, l, { evidenceShownIds: all }), l.id).toBe(true);
    }
  });
});
