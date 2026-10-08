/**
 * Delivery variety (#52): suspects must not open every reply the same way, repeat the same stage direction, or reuse a
 * whole sentence (a deflection template) word for word. Pure and deterministic; no model calls.
 *
 * Three layers, cheapest first:
 *  1. Prompt (`deliveryBlock`, user message, only once the character has replied before): the openers and actions of
 *     their last replies as "do not reuse", their recent sentences as "do not repeat word for word", and, when the case
 *     authors `voice` variants, a few unused openers/actions to pick from (rotated by turn).
 *  2. Deterministic rewrite of an accepted reply (`varyDelivery`), no extra call:
 *     - an opener (the first clause, up to 5 words) used by each of the last OPENER_RUN replies is trimmed off;
 *     - an action that nearly repeats the previous reply's action is swapped for a rotated one (voice.actions, then
 *       quirks and tells) that is not near any recent action, or dropped if none is left;
 *     - a sentence (6+ words) nearly said in the last RECENT replies is dropped if the rest still says something.
 *  3. Guard (`repeatsRecentReply`, reason `repeat`, a performance reason): only when the WHOLE reply is a near copy of a
 *     recent reply (nothing new is left after layer 2), retry once. Never on a reveal or breakdown turn.
 *  Fallback deflections rotate too (`freshPick`): authored voice.deflections first, never a line said recently.
 */
import type { CharacterContext } from "@/engine/context-builder";
import { nearDuplicate } from "./confront-check";

/** Trim an opener that every one of the last N replies also used (N in a row -> the N+1th loses it). */
export const OPENER_RUN = 2;
/** Replies looked back over for sentence repeats, recent actions and the prompt's do-not-reuse lists. */
export const RECENT = 3;

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/\b([a-z])-(?=\1)/g, "") // stutter: "w-well" -> "well"
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The opening clause of a reply: up to the first clause break after 2+ words, at most 5 words. Normalised. */
export function openerOf(dialogue: string): string {
  const text = dialogue.trim().replace(/^["“'(]+/, "");
  const re = /(?:,|\.{3}|…|—|–|--|!|\?|;|:|\.(?=\s|$))/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const words = norm(text.slice(0, m.index)).split(" ").filter(Boolean);
    if (words.length >= 2) return words.slice(0, 5).join(" ");
  }
  return norm(text).split(" ").slice(0, 5).join(" ");
}

/** The raw opening clause (with its punctuation), for trimming and quoting; null if the reply has nothing after it. */
function openerSpan(dialogue: string): { raw: string; rest: string } | null {
  const text = dialogue.trim();
  const re = /(?:,|\.{3}|…|—|–|--|!|\?|;|:|\.(?=\s|$))+\s*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const words = norm(text.slice(0, m.index)).split(" ").filter(Boolean);
    if (words.length < 2) continue;
    if (words.length > 5) return null;
    const rest = text.slice(m.index + m[0].length).trim();
    return rest ? { raw: text.slice(0, m.index + m[0].length).trim(), rest } : null;
  }
  return null;
}

const sentences = (t: string) =>
  t
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
const longEnough = (s: string, n: number) => norm(s).split(" ").filter(Boolean).length >= n;

/** The character's own recent replies (newest last), with their actions when the token recorded them. */
export function recentReplies(ctx: Pick<CharacterContext, "memory">, n = RECENT): { text: string; action?: string }[] {
  return ctx.memory
    .filter((m) => m.speaker === "character")
    .slice(-n)
    .map((m) => ({ text: m.text, ...(m.action ? { action: m.action } : {}) }));
}

/** Two stage directions say nearly the same thing ("wrings his cap and glances at the hall door" twice). */
export function sameAction(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || nearDuplicate(x, y)) return true;
  const stop = new Set(["his", "her", "the", "a", "an", "and", "at", "of", "on", "with", "to", "in", "while", "their"]);
  const wx = new Set(x.split(" ").filter((w) => !stop.has(w)));
  const wy = new Set(y.split(" ").filter((w) => !stop.has(w)));
  let both = 0;
  for (const w of wx) if (wy.has(w)) both++;
  return both / Math.max(1, Math.min(wx.size, wy.size)) >= 0.75;
}

/** Deterministic rotation: the first item from index `seed` on that `ok` accepts (null if none). */
export function freshPick<T>(items: readonly T[], seed: number, ok: (x: T) => boolean): T | null {
  for (let k = 0; k < items.length; k++) {
    const x = items[(Math.abs(seed) + k) % items.length]!;
    if (ok(x)) return x;
  }
  return null;
}

/** Sentences said in the last `n` replies (for deflection rotation and the prompt). */
export function recentSentences(ctx: Pick<CharacterContext, "memory">, n = RECENT): string[] {
  return recentReplies(ctx, n).flatMap((r) => sentences(r.text));
}

/** A candidate line nearly repeats something said recently. */
export function saidRecently(line: string, ctx: Pick<CharacterContext, "memory">, n = 6): boolean {
  const said = recentSentences(ctx, n).map(norm);
  return sentences(line).some((s) => said.some((x) => nearDuplicate(x, norm(s))));
}

export interface VoiceSource {
  persona: Pick<CharacterContext["persona"], "personality">;
  voice?: { openers: string[]; actions: string[]; deflections: string[] };
}
const actionPool = (v: VoiceSource) => [...(v.voice?.actions ?? []), ...(v.persona.personality.quirks ?? []), ...(v.persona.personality.tells ?? [])];

/** Prompt block (user message) once the character has replied before; "" otherwise (first replies are unchanged). */
export function deliveryBlock(ctx: CharacterContext, turn: number, opts: { sentences?: boolean } = {}): string {
  const recent = recentReplies(ctx);
  if (!recent.length) return "";
  const openers = [...new Set(recent.map((r) => openerSpan(r.text)?.raw.replace(/[\s,.;:!?…—–-]+$/, "")).filter((x): x is string => Boolean(x)))];
  const actions = [...new Set(recent.map((r) => r.action).filter((x): x is string => Boolean(x)))];
  const lines = [...new Set(recent.slice(-2).flatMap((r) => sentences(r.text)).filter((s) => longEnough(s, 6)))].slice(-6);
  const used = (o: string) => openers.some((x) => norm(x) === norm(o)) || recent.some((r) => openerOf(r.text) === norm(o));
  const freshOpeners = (ctx.voice?.openers ?? []).filter((o) => !used(o));
  const freshActions = actionPool(ctx).filter((a) => !actions.some((x) => sameAction(x, a)));
  const rot = <T,>(xs: T[], k: number) => xs.map((_, i) => xs[(Math.abs(turn) + i) % xs.length]!).slice(0, k);
  const out = ["VARY YOUR DELIVERY (your recent replies; say it differently this time, and keep every fact and story exactly the same):"];
  if (openers.length) out.push(`- Do not open with: ${openers.map((o) => `"${o}"`).join(" / ")}. Start some other way, or straight in.`);
  if (actions.length) out.push(`- Do not reuse these actions: ${actions.map((a) => `"${a}"`).join(" / ")}.`);
  if (lines.length && opts.sentences !== false) out.push(`- Do not repeat these sentences word for word: ${lines.map((l) => `"${l}"`).join(" / ")}.`);
  if (freshOpeners.length) out.push(`- Openers in your voice you have not used lately: ${rot(freshOpeners, 3).map((o) => `"${o}"`).join(" / ")}.`);
  if (freshActions.length) out.push(`- Actions you have not used lately: ${rot(freshActions, 3).map((a) => `"${a}"`).join(" / ")}.`);
  return out.length > 1 ? `${out.join("\n")}\n` : "";
}

export interface DeliveryFix {
  dialogue: string;
  action?: string;
  /** What was changed (for the log; empty = untouched). */
  changes: string[];
}

/**
 * Layer 2: deterministic rewrite of an accepted reply. Only removes or swaps delivery (opener, action, a repeated
 * sentence); never adds a fact. `safeAction` filters replacement actions (the guard's action check).
 */
export function varyDelivery(reply: { dialogue: string; action?: string }, ctx: CharacterContext, turn: number, safeAction: (a: string) => boolean = () => true): DeliveryFix {
  const recent = recentReplies(ctx);
  const changes: string[] = [];
  let dialogue = reply.dialogue.trim();
  let action = reply.action;
  if (!recent.length) return { dialogue, ...(action !== undefined ? { action } : {}), changes };

  // Opener used by each of the last OPENER_RUN replies: trim it (only a short lead clause with something after it).
  const last = recent.slice(-OPENER_RUN);
  const op = openerOf(dialogue);
  const span = openerSpan(dialogue);
  if (span && last.length === OPENER_RUN && last.every((r) => openerOf(r.text) === op)) {
    dialogue = span.rest.replace(/^[a-z]/, (c) => c.toUpperCase());
    changes.push(`opener:${span.raw}`);
  }

  // Sentences nearly said in the recent replies: drop them while something new remains.
  const all = recent.flatMap((r) => sentences(r.text)).map(norm);
  const said = recent.flatMap((r) => sentences(r.text)).filter((s) => longEnough(s, 6)).map(norm);
  const parts = sentences(dialogue);
  // A long sentence nearly said before goes; so does a short one said verbatim right after it ("Nothing out of the ordinary.").
  let dropped = false;
  const keep = parts.filter((s) => {
    const n = norm(s);
    const drop = longEnough(s, 6) ? said.some((x) => nearDuplicate(x, n)) : dropped && all.includes(n);
    dropped = drop;
    return !drop;
  });
  if (keep.length < parts.length && keep.some((s) => longEnough(s, 4))) {
    changes.push(`sentences:-${parts.length - keep.length}`);
    dialogue = keep.join(" ");
  }

  // Action nearly the same as the previous reply's: swap for a rotated, unused one (or drop it).
  const prev = recent[recent.length - 1]?.action;
  if (action && prev && sameAction(action, prev)) {
    const recentActions = recent.map((r) => r.action).filter((x): x is string => Boolean(x));
    const alt = freshPick(actionPool(ctx), turn, (a) => !sameAction(a, action!) && !recentActions.some((x) => sameAction(x, a)) && safeAction(a));
    changes.push(`action:${alt ? "swapped" : "dropped"}`);
    action = alt ?? undefined;
  }
  return { dialogue, ...(action ? { action } : {}), changes };
}

/** Layer 3: the whole reply is a near copy of one of the last replies (every sentence of it repeats). */
export function repeatsRecentReply(dialogue: string, ctx: Pick<CharacterContext, "memory">): string | null {
  const said = recentReplies(ctx).flatMap((r) => sentences(r.text)).map(norm);
  const parts = sentences(dialogue).filter((s) => longEnough(s, 4));
  if (!parts.length || !said.length) return null;
  return parts.every((s) => said.some((x) => nearDuplicate(x, norm(s)))) ? dialogue.slice(0, 120) : null;
}

/** What a line repeats from the character's recent replies (eval assertion `fresh_delivery`; [] = fresh). */
export function deliveryRepeats(reply: { dialogue: string; action?: string }, ctx: Pick<CharacterContext, "memory">): string[] {
  const recent = recentReplies(ctx);
  if (!recent.length) return [];
  const out: string[] = [];
  const last = recent.slice(-OPENER_RUN);
  if (last.length === OPENER_RUN && last.every((r) => openerOf(r.text) === openerOf(reply.dialogue))) out.push(`opener:${openerOf(reply.dialogue)}`);
  const prev = recent[recent.length - 1]?.action;
  if (reply.action && prev && sameAction(reply.action, prev)) out.push(`action:${reply.action}`);
  const said = recent.flatMap((r) => sentences(r.text)).filter((s) => longEnough(s, 6)).map(norm);
  for (const s of sentences(reply.dialogue)) if (longEnough(s, 6) && said.some((x) => nearDuplicate(x, norm(s)))) out.push(`sentence:${s.slice(0, 60)}`);
  return out;
}
