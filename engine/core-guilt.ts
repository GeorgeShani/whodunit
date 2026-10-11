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
import { contentWords, nameWords } from "./memory";
import { keepNameToken } from "./name-tokens";
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
  /**
   * Lower-case nouns that only the murderer's core-guilt facts and secrets mention as things handled in the killing
   * or the cover-up ("handkerchief", "coal scuttle", "desk"). Nouns the culprit may legitimately talk about (anything
   * in her revealable secrets, e.g. "letter"), places, people and the weapon (its own rule) are left out.
   */
  coreObjects: string[];
  /** For each clock minute in the window: the location ids the culprit's core facts put her in (alibi check). */
  coreWhereabouts: Record<number, string[]>;
  /** Lower-case names of every location (for "I was in the dining room at 21:16"). */
  locationNames: { id: string; names: string[] }[];
  /**
   * Lower-case ways to name the witnesses of the culprit's core guilt: other characters with a secret whose facts
   * include one of her core-guilt facts (name, first name, aliases, role without "the"). "The gardener saw me" (#45).
   */
  witnessNames?: string[];
  /**
   * The act the murder was meant to stop, as gerunds taken from the core-guilt secrets ("to stop him signing the new
   * will" gives "signing"). "I stopped him signing" (#45).
   */
  motiveActs?: string[];
  /**
   * E8: the murderer as somebody ELSE's subject (lower-case name, first name, aliases; any form that is also a victim
   * name is left out) and their subject pronoun, for the third-person over-claim check on non-culprit speakers.
   */
  murdererNames?: string[];
  murdererPronoun?: "she" | "he";
  /** R3: the murderer's object pronoun ("saw her lock it"), only when it can't mean the victim. */
  murdererObject?: "her" | "him";
  /**
   * E8: per secret (any character's, never the murderer's own) whose facts touch the murderer's core guilt: which acts
   * its facts describe. Holding that secret (own revealed, or its card shown/presented) covers saying those acts.
   */
  coverActs?: Record<string, CulpritAct[]>;
  /**
   * E15b: timed events a speaker can use as a relative anchor ("once the candles were lit", "before the thud"): the
   * event's id words (people's names, prefixes and numbers left out) and its clock range. Whereabouts entries (loc-*)
   * are left out.
   */
  anchorEvents?: { words: string[]; range: [number, number] }[];
}

/** E8: the culprit-act families of the over-claim check. */
export type CulpritAct = "killing" | "weapon" | "key" | "scene" | "object";

/** E8: a character's subject pronoun (data, else a guess from titles in the name and aliases). */
export function pronounOf(ch: Pick<Character, "name" | "aliases"> & { pronoun?: "she" | "he" | "they" }): "she" | "he" | undefined {
  if (ch.pronoun) return ch.pronoun === "they" ? undefined : ch.pronoun;
  const all = [ch.name, ...(ch.aliases ?? [])].join(" | ");
  const she = /\b(?:lady|mrs|miss|ms|madam|madame|dame|duchess|countess|baroness|her\s+ladyship|mother|aunt|sister)\b/i.test(all);
  const he = /\b(?:lord|mr|sir|master|duke|count|baron|his\s+lordship|father|uncle|brother)\b/i.test(all);
  return she && !he ? "she" : he && !she ? "he" : undefined;
}

/** Generic nouns never worth treating as a core-guilt object. */
const NOT_OBJECTS = new Set(["head", "room", "way", "time", "night", "evening", "minute", "moment", "side", "back", "front", "inside", "outside", "floor", "hand", "hands", "face", "door", "lock", "fire", "light", "dark", "storm", "rain", "house", "chair", "table", "lit", "candle", "new", "old", "same", "other", "own", "few", "little", "with", "from", "into", "onto", "upon", "over", "under", "beside", "behind", "after", "before", "then", "there", "that", "this", "husband", "wife", "master", "lord", "lady", "body", "blow", "death"]);

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function guiltProfile(c: GuiltCase & Pick<LoadedCase, "victim" | "evidence" | "locations" | "solution"> & Partial<Pick<LoadedCase, "guiltCheck">>): GuiltProfile {
  const sol = c.solution;
  // C3: a single word split from a multi-word name only counts if it is not an ordinary word (engine/name-tokens.ts).
  const token = (w: string) => keepNameToken(w, c.guiltCheck ?? {});
  const nouns = (name: string, head = false) => {
    const full = name.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
    const last = full.split(/\s+/).pop() ?? full;
    // `head`: the weapon's head noun ("candlestick") is the point of the weapon rule and always counts.
    return [...new Set([full, ...(last.length >= 4 && last !== full && (head || token(last)) ? [last] : [])])];
  };
  const weapon = c.evidence.find((e) => e.id === sol.weaponId);
  const scene = c.locations.find((l) => l.id === sol.locationId);
  const victimNames = [c.victim.name, ...c.victim.aliases].flatMap((n) => {
    const full = n.toLowerCase().trim();
    const words = full.split(/\s+/);
    const parts = words.length > 1 ? words.filter((w) => w.length >= 4 && !/^(lord|lady|sir|his|her|mrs?|miss|lordship|ladyship)$/.test(w) && token(w)) : [];
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
  // Core objects: nouns after a determiner in the core facts / core secrets, minus everything the culprit may say.
  const coreObjects = new Set<string>();
  const coreWhereabouts: Record<number, string[]> = {};
  if (murderer) {
    const core = coreGuiltSecretIds(c);
    const facts = coreGuiltFactIds(c, murderer);
    const coreTexts = [...allFacts(c).filter((f) => facts.has(f.id)).map((f) => f.statement), ...murderer.secrets.filter((s) => core.has(s.id)).map((s) => s.description)];
    const norm = (w: string | undefined) => w?.replace(/['’]s$/, "").replace(/['’]/g, "");
    const words = (t: string) => (t.toLowerCase().replace(/-/g, " ").match(/[a-z][a-z'’]*/g) ?? []).map((w) => norm(w)!);
    const banned = new Set([
      ...murderer.secrets.filter((s) => !core.has(s.id)).flatMap((s) => words(s.description)),
      ...c.locations.flatMap((l) => words(l.name)),
      ...c.characters.flatMap((ch) => [...words(ch.name), ...(ch.aliases ?? []).flatMap(words)]),
      ...[c.victim.name, ...c.victim.aliases].flatMap(words),
      ...(weapon ? words(weapon.name) : []),
    ]);
    const ok = (w: string | undefined): w is string => !!w && w.length >= 4 && !banned.has(w) && !NOT_OBJECTS.has(w) && !/(?:ly|ing|ed)$/.test(w);
    for (const t of coreTexts) {
      for (const m of t.toLowerCase().replace(/-/g, " ").matchAll(/\b(?:the|her|his|its|a|an)\s+([a-z'’]+)(?:\s+([a-z'’]+))?/g)) {
        const a = norm(m[1]);
        const b = norm(m[2]);
        if (ok(a) && ok(b)) coreObjects.add(`${a} ${b}`).add(b);
        else if (ok(a)) coreObjects.add(a);
        else if (ok(b)) coreObjects.add(b);
      }
    }
    for (const f of allFacts(c)) {
      if (!facts.has(f.id) || !f.locationId) continue;
      const from = clock(f.time ?? f.from ?? sol.time);
      const to = clock(f.time ?? f.to ?? f.from ?? sol.time);
      for (let m = from; m <= to; m++) (coreWhereabouts[m] ??= []).push(f.locationId);
    }
  }
  const witnessNames = new Set<string>();
  const motiveActs = new Set<string>();
  if (murderer) {
    const facts = coreGuiltFactIds(c, murderer);
    for (const ch of c.characters) {
      if (ch.id === murderer.id || !ch.secrets.some((s) => s.relatedFactIds.some((f) => facts.has(f)))) continue;
      const role = (ch as { role?: string }).role;
      const first = ch.name.split(/\s+/)[0];
      for (const n of [ch.name, ...(first !== ch.name && token(first.toLowerCase()) ? [first] : []), ...(ch.aliases ?? []), ...(role ? [role] : [])]) {
        const v = n.toLowerCase().replace(/^(the|a|an)\s+/, "").trim();
        if (v.length >= 3) witnessNames.add(v);
      }
    }
    const core = coreGuiltSecretIds(c);
    for (const s of murderer.secrets.filter((x) => core.has(x.id)))
      for (const m of s.description.toLowerCase().matchAll(/\b(?:stop|stopped|prevent|prevented|keep|kept)\s+(?:him|her|them|[a-z]+)\s+(?:from\s+)?([a-z]{3,}ing)\b/g)) motiveActs.add(m[1]);
  }
  // E8: the murderer as a third-person subject, and which acts each covering secret's facts describe.
  const murdererNames = new Set<string>();
  const coverActs: Record<string, CulpritAct[]> = {};
  if (murderer) {
    const victimSet = new Set(victimNames);
    const first = murderer.name.split(/\s+/)[0]!;
    for (const n of [murderer.name, first, ...(murderer.aliases ?? [])]) {
      const v = n.toLowerCase().trim();
      if (v.length >= 3 && !victimSet.has(v) && ![...victimSet].some((x) => x.includes(v) && x !== v && v.split(/\s+/).length === 1)) murdererNames.add(v);
    }
    // R10 / E18: the forms people use without the authored aliases, all derived from data: title + surname or initial
    // ("Mrs Doe", "Lady D."), the address form of a title ("milady"), the household's words for the house's lady or
    // master (from a title or a spouse role), and, when the case marks the victim as their spouse, "his wife"/"the widow".
    const pron = pronounOf(murderer as Character & { pronoun?: "she" | "he" | "they" });
    const all = [murderer.name, ...(murderer.aliases ?? [])].join(" | ").toLowerCase();
    const parts = murderer.name.trim().split(/\s+/);
    const surname = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
    const titles = new Set<string>([...(all.match(/\b(?:lady|lord|mrs|mr|miss|sir|dame)\b/g) ?? []), ...(pron === "she" ? ["mrs"] : pron === "he" ? ["mr"] : [])]);
    const extra: string[] = [];
    if (surname) for (const t of titles) extra.push(`${t} ${surname}`, `${t} ${surname[0]}.`);
    if (/\b(?:lady|ladyship)\b/.test(all)) extra.push("milady", "m'lady", "m’lady", "my lady");
    if (/\b(?:lord|lordship)\b/.test(all)) extra.push("milord", "m'lord", "m’lord", "my lord");
    const spouse = murderer.relationships?.some((r) => r.targetCharacterId === c.victim.id && /\b(?:husband|wife|spouse)\b/i.test(r.kind ?? ""));
    const victimAll = [c.victim.name, ...(c.victim.aliases ?? [])].join(" | ").toLowerCase();
    const victimHe = /\b(?:lord|lordship|mr|sir|master)\b/.test(victimAll);
    if (pron === "she" && (spouse || /\b(?:lady|ladyship)\b/.test(all))) extra.push("the mistress", "the missus", "the lady of the house");
    if (pron === "he" && !victimHe && (spouse || /\b(?:lord|lordship)\b/.test(all))) extra.push("the master", "the master of the house");
    if (spouse && pron === "she") extra.push("his wife", "the widow");
    if (spouse && pron === "he") extra.push("her husband", "the widower");
    const taken = new Set(c.characters.filter((x) => x.id !== murderer.id).flatMap((x) => [x.name, ...(x.aliases ?? [])].map((n) => n.toLowerCase())));
    for (const v of extra) if (!victimSet.has(v) && !taken.has(v)) murdererNames.add(v);
    const facts = coreGuiltFactIds(c, murderer);
    const factText = new Map(allFacts(c).map((f) => [f.id, f.statement]));
    const objects = [...coreObjects];
    const has = (t: string, words: readonly string[]) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
    for (const ch of c.characters) {
      if (ch.id === murderer.id) continue;
      for (const s of ch.secrets) {
        if (!s.relatedFactIds.some((f) => facts.has(f))) continue;
        const text = [s.description, ...s.relatedFactIds.map((f) => factText.get(f) ?? "")].join(" ");
        const acts: CulpritAct[] = [];
        if (/\b(?:kill|kills|killed|strike|strikes|struck|murder|blow)\b/i.test(text)) acts.push("killing");
        if (weapon && has(text, nouns(weapon.name, true))) acts.push("weapon");
        if (/\b(?:lock|locks|locked|key|bolt|bolts|bolted)\b/i.test(text)) acts.push("key");
        if (scene && has(text, nouns(scene.name))) acts.push("scene");
        if (objects.length && has(text, objects)) acts.push("object");
        coverActs[s.id] = acts;
      }
    }
  }
  const people = nameWords(c);
  const anchorEvents: { words: string[]; range: [number, number] }[] = [];
  for (const f of allFacts(c)) {
    if (/^loc-/.test(f.id)) continue;
    const from = f.time ?? f.from;
    const to = f.time ?? f.to;
    if (!from || !to) continue;
    const words = [...contentWords(f.id.replace(/^(?:ev|f|fact|evt)-/, "").replace(/-/g, " "), people)].filter((w) => !/\d/.test(w));
    if (words.length) anchorEvents.push({ words, range: [clock(from), clock(to)] });
  }
  const murdererPronoun = murderer ? pronounOf(murderer as Character & { pronoun?: "she" | "he" | "they" }) : undefined;
  const victimPronoun = pronounOf(c.victim as Pick<Character, "name" | "aliases">);
  const murdererObject = murdererPronoun === "she" && victimPronoun !== "she" ? "her" : murdererPronoun === "he" && victimPronoun !== "he" ? "him" : undefined;
  return {
    murdererNames: [...murdererNames],
    ...(murdererPronoun ? { murdererPronoun } : {}),
    ...(murdererObject ? { murdererObject } : {}),
    coverActs,
    anchorEvents,
    witnessNames: [...witnessNames],
    motiveActs: [...motiveActs],
    murdererId: sol.murdererId,
    victimNames: [...new Set(victimNames)],
    weaponNames: weapon ? nouns(weapon.name, true) : [],
    sceneNames: scene ? nouns(scene.name) : [],
    window: [lo, hi],
    coreObjects: [...coreObjects],
    coreWhereabouts,
    locationNames: c.locations.map((l) => ({ id: l.id, names: nouns(l.name) })),
  };
}
