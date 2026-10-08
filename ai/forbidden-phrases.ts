/**
 * #46 per-character forbidden phrases (case data: characters[].forbiddenPhrases), checked by the guard on every reply.
 *
 * - Plain `text`: case-insensitive, whole words, any run of whitespace between words.
 * - `regex: true`: `new RegExp(text, "i")` (native JS, lookbehind allowed).
 * - `unlessRevealed`: the entry stops applying once that secret of the speaker is revealed, INCLUDING a secret the
 *   engine reveals in the current exchange (otherwise every revealing turn would be deflected).
 * The entry's `note` is for authors and never reaches the model.
 */
import type { ForbiddenPhrase } from "@/engine/types";

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cache = new WeakMap<ForbiddenPhrase, RegExp>();

/** The compiled matcher for one entry (cached per entry object). */
export function compileForbiddenPhrase(p: ForbiddenPhrase): RegExp {
  let re = cache.get(p);
  if (!re) {
    re = p.regex ? new RegExp(p.text, "i") : new RegExp(`(?<![\\p{L}\\p{N}_])${esc(p.text.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
    cache.set(p, re);
  }
  return re;
}

export interface ForbiddenHit {
  index: number;
  phrase: ForbiddenPhrase;
  /** The matched fragment of the reply. */
  match: string;
}

/** The first live entry that matches `text`, or null. `revealedIds` = the speaker's revealed secrets plus this exchange's reveal. */
export function findForbiddenPhrase(text: string, phrases: readonly ForbiddenPhrase[] | undefined, revealedIds: readonly string[]): ForbiddenHit | null {
  if (!phrases?.length || !text) return null;
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    if (p.unlessRevealed && revealedIds.includes(p.unlessRevealed)) continue;
    const m = compileForbiddenPhrase(p).exec(text);
    if (m) return { index: i, phrase: p, match: m[0] };
  }
  return null;
}
