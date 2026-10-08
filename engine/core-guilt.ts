/**
 * CORE GUILT (Agatha's rule, fix for George's live-play confession bug). Pure.
 *
 * The culprit's own guilt (the killing, the weapon used on the victim, being at
 * the scene at the murder minute, locking the door / taking the key) is NEVER
 * revealed or confessed during interrogation or confrontation. A win needs
 * evidence and testimony, not a confession; the confession lives only in
 * endings.json after a correct accusation.
 *
 * Sources, both enforced:
 *  1. Data (primary): `coreGuilt: true` on a secret (engine/types.ts SecretSchema).
 *  2. Derived from the solution (defence in depth): a secret OWNED BY THE
 *     MURDERER whose relatedFactIds include a fact covering the murder minute
 *     (solution.time) that involves the murderer or is at the murder scene.
 *
 * The engine keeps every core-guilt secret out of the revealable set, and the
 * facts it covers (relatedFactIds) out of the owner's prompt even if another
 * revealed secret also lists them (engine/knowledge-gate.ts).
 */
import type { LoadedCase } from "./case-schema";
import { gameMinutes } from "./time";
import type { Character, Fact, Secret } from "./types";

/** Without facts/timeline/solution (a partial case), only the data flag counts. */
type GuiltCase = Pick<LoadedCase, "characters"> & Partial<Pick<LoadedCase, "facts" | "timeline" | "dayStartsAt" | "solution">>;

const allFacts = (c: GuiltCase): Fact[] => [...(c.facts ?? []), ...(c.timeline ?? [])];

const range = (f: Pick<Fact, "time" | "from" | "to">, day: string): [number, number] | null =>
  f.time !== undefined ? [gameMinutes(f.time, day), gameMinutes(f.time, day)] : f.from !== undefined && f.to !== undefined ? [gameMinutes(f.from, day), gameMinutes(f.to, day)] : null;

/** Is this secret core guilt by the solution (murderer's secret covering the murder minute)? */
export function derivedCoreGuilt(
  c: GuiltCase,
  owner: Pick<Character, "id">,
  secret: Pick<Secret, "relatedFactIds">,
  byId: ReadonlyMap<string, Fact> = new Map(allFacts(c).map((f) => [f.id, f])),
): boolean {
  const sol = c.solution;
  if (!sol || owner.id !== sol.murdererId) return false;
  const day = c.dayStartsAt ?? "12:00";
  const murder = gameMinutes(sol.time, day);
  return secret.relatedFactIds.some((id) => {
    const f = byId.get(id);
    const r = f && range(f, day);
    if (!f || !r || murder < r[0] || murder > r[1]) return false;
    return f.involvesCharacterIds.includes(sol.murdererId) || f.locationId === sol.locationId;
  });
}

/** Ids of every core-guilt secret in the case (data flag OR derived from the solution). */
export function coreGuiltSecretIds(c: GuiltCase): Set<string> {
  const out = new Set<string>();
  const byId = new Map<string, Fact>(allFacts(c).map((f) => [f.id, f]));
  for (const ch of c.characters) for (const s of ch.secrets) if (s.coreGuilt === true || derivedCoreGuilt(c, ch, s, byId)) out.add(s.id);
  return out;
}

export const isCoreGuilt = (c: GuiltCase, secretId: string): boolean => coreGuiltSecretIds(c).has(secretId);

/** Facts covered by `ch`'s own core-guilt secrets: never in their prompt before the accusation. */
export function coreGuiltFactIds(c: GuiltCase, ch: Pick<Character, "secrets">): Set<string> {
  const ids = coreGuiltSecretIds(c);
  const out = new Set<string>();
  for (const s of ch.secrets) if (ids.has(s.id)) s.relatedFactIds.forEach((f) => out.add(f));
  return out;
}

/** What the post-generation guilt-leak check needs to recognise an admission of the killing (server-only). */
export interface GuiltProfile {
  murdererId: string;
  /** Lower-case ways to name the victim (name, aliases, last name). */
  victimNames: string[];
  /** Lower-case weapon nouns ("silver candlestick", "candlestick"). */
  weaponNames: string[];
  /** Lower-case names of the murder scene ("library"). */
  sceneNames: string[];
  /** Clock-minute window (minutes after midnight) of the murderer's core-guilt facts plus the murder minute. */
  window: [number, number];
}

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function guiltProfile(c: GuiltCase & Pick<LoadedCase, "victim" | "evidence" | "locations" | "solution">): GuiltProfile {
  const sol = c.solution;
  const nouns = (name: string) => {
    const full = name.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
    const last = full.split(/\s+/).pop() ?? full;
    return [...new Set([full, ...(last.length >= 4 ? [last] : [])])];
  };
  const weapon = c.evidence.find((e) => e.id === sol.weaponId);
  const scene = c.locations.find((l) => l.id === sol.locationId);
  const victimNames = [c.victim.name, ...c.victim.aliases].flatMap((n) => {
    const full = n.toLowerCase().trim();
    const parts = full.split(/\s+/).filter((w) => w.length >= 4 && !/^(lord|lady|sir|his|her|mrs?|miss|lordship|ladyship)$/.test(w));
    return [full, ...parts];
  });
  let lo = clock(sol.time);
  let hi = lo;
  const murderer = c.characters.find((ch) => ch.id === sol.murdererId);
  if (murderer) {
    const facts = coreGuiltFactIds(c, murderer);
    for (const f of allFacts(c)) {
      if (!facts.has(f.id)) continue;
      for (const t of [f.time, f.from, f.to]) {
        if (!t) continue;
        lo = Math.min(lo, clock(t));
        hi = Math.max(hi, clock(t));
      }
    }
  }
  return {
    murdererId: sol.murdererId,
    victimNames: [...new Set(victimNames)],
    weaponNames: weapon ? nouns(weapon.name) : [],
    sceneNames: scene ? nouns(scene.name) : [],
    window: [lo, hi],
  };
}
