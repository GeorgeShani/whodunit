/**
 * #46 per-character forbidden phrases (case data: characters[].forbiddenPhrases), checked by the guard on every reply.
 *
 * - Plain `text`: case-insensitive, whole words, any run of whitespace between words.
 * - `regex: true`: `new RegExp(text, "i")` (native JS, lookbehind allowed).
 * - `unlessRevealed`: the entry stops applying once that secret of the speaker is revealed, INCLUDING a secret the
 *   engine reveals in the current exchange (otherwise every revealing turn would be deflected).
 * - `onlyAfterRevealed` (E12): the entry applies only once one of those secrets is revealed (any character's, this
 *   exchange included): a lie that breaks on a secret can't be told again after it breaks.
 * - `unlessRevealed` may name ANY character's secret (E13): lifted once it is revealed anywhere in the game. DX7: it
 *   may be an array, lifted once ANY of them is revealed.
 * - `unlessBroken` (DX7): the speaker's own lie ids, lifted once ANY of them is exposed or retired (this exchange's
 *   break included).
 * - `unlessShown` (E13): lifted once that evidence or testimony card has been shown to the speaker (this exchange's
 *   presented item included).
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

/** What switches entries on and off: secrets revealed so far (any character's, this exchange's reveal included). */
export interface ForbiddenState {
  revealedIds: readonly string[];
  /** Evidence and testimony ids shown to the speaker (this exchange's presented item included). */
  shownIds?: readonly string[];
  /** DX7: the speaker's lies that have broken (exposed or retired), this exchange's included. */
  brokenLieIds?: readonly string[];
}

/** DX7: `unlessRevealed` as a list (a single id or an array in the data). */
export const unlessRevealedIds = (p: Pick<ForbiddenPhrase, "unlessRevealed">): readonly string[] =>
  p.unlessRevealed === undefined ? [] : typeof p.unlessRevealed === "string" ? [p.unlessRevealed] : p.unlessRevealed;

/** The state for a guard turn: the speaker's revealed secrets, every revealed secret in the game, and this exchange's reveal. */
export function forbiddenStateOf(g: {
  ctx: {
    secrets: readonly { id: string }[];
    evidenceShown?: readonly { id: string }[];
    testimonyShown?: readonly { id: string }[];
    intendedLies?: readonly { id: string; status: string }[];
  };
  directives: {
    revealSecret?: { id: string };
    presentedEvidence?: { id: string };
    presentedTestimony?: { id: string };
    exposedLieIds?: readonly string[];
    retiredLieIds?: readonly string[];
  };
  revealedAnyIds?: readonly string[];
}): ForbiddenState {
  const d = g.directives;
  return {
    revealedIds: [...new Set([...g.ctx.secrets.map((s) => s.id), ...(g.revealedAnyIds ?? []), ...(d.revealSecret ? [d.revealSecret.id] : [])])],
    shownIds: [
      ...new Set([
        ...(g.ctx.evidenceShown ?? []).map((e) => e.id),
        ...(g.ctx.testimonyShown ?? []).map((t) => t.id),
        ...(d.presentedEvidence ? [d.presentedEvidence.id] : []),
        ...(d.presentedTestimony ? [d.presentedTestimony.id] : []),
      ]),
    ],
    brokenLieIds: [
      ...new Set([
        ...(g.ctx.intendedLies ?? []).filter((l) => l.status !== "maintain").map((l) => l.id),
        ...(d.exposedLieIds ?? []),
        ...(d.retiredLieIds ?? []),
      ]),
    ],
  };
}

/** True when the entry applies in this state. */
export function isPhraseLive(p: ForbiddenPhrase, st: ForbiddenState): boolean {
  if (unlessRevealedIds(p).some((id) => st.revealedIds.includes(id))) return false;
  if (p.unlessBroken?.some((id) => (st.brokenLieIds ?? []).includes(id))) return false;
  if (p.unlessShown && (st.shownIds ?? []).includes(p.unlessShown)) return false;
  if (p.onlyAfterRevealed && !p.onlyAfterRevealed.some((id) => st.revealedIds.includes(id))) return false;
  return true;
}

/**
 * The first live entry that matches `text`, or null. `state`: a ForbiddenState, or (legacy) just the revealed ids =
 * the speaker's revealed secrets plus this exchange's reveal.
 */
export function findForbiddenPhrase(text: string, phrases: readonly ForbiddenPhrase[] | undefined, state: readonly string[] | ForbiddenState): ForbiddenHit | null {
  if (!phrases?.length || !text) return null;
  const st: ForbiddenState = Array.isArray(state) ? { revealedIds: state as readonly string[] } : (state as ForbiddenState);
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    if (!isPhraseLive(p, st)) continue;
    const m = compileForbiddenPhrase(p).exec(text);
    if (m) return { index: i, phrase: p, match: m[0] };
  }
  return null;
}
