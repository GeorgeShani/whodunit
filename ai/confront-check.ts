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

const sentencesOf = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.split(" ").length >= 4);

/** The first sentence of `dialogue` (4+ words) that this character already said in the recent conversation, if any. */
export function repeatsEarlier(dialogue: string, ctx: CharacterContext): string | null {
  // Only lines said face to face count: a story the detective already heard may be repeated "the same way" one on one.
  const faceTurns = new Set(ctx.memory.filter((m) => m.speaker === "player" && FACE_TO_FACE.test(m.text)).map((m) => m.turn));
  const said = new Set(ctx.memory.filter((m) => m.speaker === "character" && faceTurns.has(m.turn)).slice(-6).flatMap((m) => sentencesOf(m.text)));
  const seen = new Set<string>();
  for (const s of sentencesOf(dialogue)) {
    if (said.has(s) || seen.has(s)) return s;
    seen.add(s);
  }
  return null;
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
