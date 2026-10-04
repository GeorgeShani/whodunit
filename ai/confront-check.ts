/**
 * Confrontation hygiene (#27). Pure and deterministic.
 *  - scrubStalePartners: memory lines from a face-to-face with someone ELSE no longer carry that person's
 *    name (the model used to address the previous partner while facing the current one).
 *  - repeatsEarlier: a confrontation turn must not re-use a sentence already said in this conversation.
 *  - addressesWrongPerson: a vocative ("Name," / ", Name!") at someone who is neither the partner nor the detective.
 */
import type { CharacterContext } from "@/engine/context-builder";
import { buildSubjects } from "./canon-check";

const OTHER = "the other person";
const FACE_TO_FACE = /^\(Face to face with ([^)]+)\)/;

export type Memory = CharacterContext["memory"];

function personRegex(ctx: CharacterContext, name: string): RegExp | null {
  const s = buildSubjects(ctx).find((x) => !x.key.startsWith("loc:") && x.key !== ctx.persona.id && x.re.test(name));
  return s ? new RegExp(s.re.source, "gi") : null;
}

/** Memory with the names of previous (different) face-to-face partners blanked, for the confrontation turn with `partnerName`. */
export function scrubStalePartners(ctx: CharacterContext, partnerName: string): Memory {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // turn -> the other person that exchange was held in front of
  const stale = new Map<number, string>();
  for (const m of ctx.memory) {
    const f = m.speaker === "player" ? FACE_TO_FACE.exec(m.text) : null;
    if (f && !same(f[1], partnerName)) stale.set(m.turn, f[1]);
  }
  if (stale.size === 0) return ctx.memory;
  const current = personRegex(ctx, partnerName);
  return ctx.memory.map((m) => {
    const who = stale.get(m.turn);
    if (who === undefined) return m;
    const re = personRegex(ctx, who);
    // Never blank a name the current partner shares (a family surname).
    const text = (re ? m.text.replace(re, (hit) => (current && new RegExp(current.source, "i").test(hit) ? hit : OTHER)) : m.text).replace(FACE_TO_FACE, "(Earlier, in front of someone else)");
    return { ...m, text };
  });
}

const normWords = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/** Sentences (4+ words) as normalised strings. */
const sentencesOf = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map(normWords)
    .filter((s) => s.split(" ").length >= 4);

/** The same, un-normalised, for quoting back to the model. */
const rawSentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => normWords(s).split(" ").length >= 4);

const grams = (words: string[], n: number) => {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
};

/**
 * Two normalised sentences say it "almost word for word" (#27): identical, or high word-trigram overlap, or
 * (for longer ones) the shorter is nearly contained in the other. Reworded replies about the same fact stay legal.
 */
export function nearDuplicate(a: string, b: string): boolean {
  if (a === b) return true;
  const wa = a.split(" ");
  const wb = b.split(" ");
  if (jaccard(grams(wa, 3), grams(wb, 3)) >= 0.45) return true;
  const ua = new Set(wa);
  const ub = new Set(wb);
  if (jaccard(ua, ub) >= 0.7) return true;
  if (Math.min(ua.size, ub.size) >= 6) {
    let both = 0;
    for (const x of ua) if (ub.has(x)) both++;
    if (both / Math.min(ua.size, ub.size) >= 0.9) return true;
  }
  return false;
}

const faceTurnsOf = (ctx: CharacterContext) => new Set(ctx.memory.filter((m) => m.speaker === "player" && FACE_TO_FACE.test(m.text)).map((m) => m.turn));

/** The first sentence of `dialogue` (4+ words) that this character already said, word for word or nearly, in the recent face-to-face exchanges, or twice within `dialogue` itself. */
export function repeatsEarlier(dialogue: string, ctx: CharacterContext): string | null {
  // Only lines said face to face count: a story the detective already heard may be repeated "the same way" one on one.
  const faceTurns = faceTurnsOf(ctx);
  const said = ctx.memory.filter((m) => m.speaker === "character" && faceTurns.has(m.turn)).slice(-6).flatMap((m) => sentencesOf(m.text));
  const seen: string[] = [];
  for (const sentence of sentencesOf(dialogue)) {
    if (said.some((x) => nearDuplicate(x, sentence)) || seen.some((x) => nearDuplicate(x, sentence))) return sentence;
    seen.push(sentence);
  }
  return null;
}

/** This character's own earlier lines, for the "do not reuse these phrasings" block: face-to-face ones and the last few one-on-one replies. */
export function ownPriorLines(ctx: CharacterContext): { confrontation: string[]; interrogation: string[] } {
  const faceTurns = faceTurnsOf(ctx);
  const mine = ctx.memory.filter((m) => m.speaker === "character");
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    confrontation: uniq(mine.filter((m) => faceTurns.has(m.turn)).slice(-4).flatMap((m) => rawSentences(m.text))).slice(-8),
    interrogation: uniq(mine.filter((m) => !faceTurns.has(m.turn)).slice(-3).flatMap((m) => rawSentences(m.text))).slice(-6),
  };
}

/** Prompt block for confrontation turns (empty when there is nothing to avoid). */
export function avoidPhrasingsBlock(ctx: CharacterContext): string {
  const { confrontation, interrogation } = ownPriorLines(ctx);
  const all = [...confrontation, ...interrogation];
  if (all.length === 0) return "";
  return [
    "DO NOT REUSE these phrasings (your own earlier lines). If you must come back to the same fact, say it in different words, from a different angle, or answer the other person's last point instead:",
    ...all.map((l) => `- "${l}"`),
    "",
  ].join("\n");
}

const FALLBACKS: readonly { dialogue: string; action: string }[] = [
  { dialogue: "I'll thank you not to put words in my mouth, {p}. Say it plainly, if you have something to say.", action: "folds arms and glares" },
  { dialogue: "You may think what you like of me, {p}. The detective has the facts; ask him.", action: "lifts chin" },
  { dialogue: "That is a very odd thing to say in front of the detective, {p}. I wonder what you hope to gain by it.", action: "raises one eyebrow" },
  { dialogue: "Careful, {p}. People who accuse others in a storm tend to be hiding something themselves.", action: "narrows eyes" },
  { dialogue: "I have nothing more to add on that, {p}. Nothing that I haven't already told the detective.", action: "straightens collar" },
  { dialogue: "Is that the best you can do, {p}? I expected better from you.", action: "gives a thin smile" },
];

/**
 * A varied in-character line for a confrontation turn when the model failed or kept repeating (#27):
 * picks one that does not echo anything already said, addressed to the partner, revealing nothing.
 */
export function variedConfrontationFallback(ctx: CharacterContext, partnerName: string, seed: number): { dialogue: string; action: string } {
  const first = partnerName.split(" ")[0] ?? partnerName;
  const said = [...ownPriorLines(ctx).confrontation, ...ownPriorLines(ctx).interrogation].map(normWords);
  const lines = FALLBACKS.map((f) => ({ ...f, dialogue: f.dialogue.replaceAll("{p}", first) }));
  const fresh = lines.filter((f) => !said.some((x) => nearDuplicate(x, normWords(f.dialogue))));
  const pool = fresh.length ? fresh : lines;
  return pool[Math.abs(seed) % pool.length]!;
}

/** A vocative at a third person while facing `partnerName`. */
export function addressesWrongPerson(dialogue: string, ctx: CharacterContext, partnerName: string): string | null {
  for (const s of buildSubjects(ctx)) {
    if (s.key.startsWith("loc:") || s.key === ctx.persona.id || s.re.test(partnerName)) continue;
    const n = s.re.source;
    const voc = new RegExp(`(?:(?:^|[.!?"]\\s*)(?:${n}),|,\\s*(?:${n})\\s*[!?.])`, "i").exec(dialogue);
    if (voc) return voc[0].replace(/^[.!?"\s,]+/, "").trim();
  }
  return null;
}
