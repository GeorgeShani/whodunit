/**
 * Character memory rules (MASTER_PLAN §20 / Phase 6). Pure and deterministic.
 *
 * - liesTold: an intended lie counts as TOLD once, on a performed turn, the
 *   prompt told the character to MAINTAIN it and the detective's words touched
 *   its topic (questionTouchesLie). The engine never asks the model whether it
 *   told the lie: the signal is what was asked plus what the prompt ordered.
 * - playerClaims: the detective's declarative sentences to a character
 *   (extractClaims), sanitised and capped. They are untrusted assertions: the
 *   prompt marks them as such and nothing in the engine treats them as fact.
 * - Stress relief (§18 "stress may decrease when"): fixed, modest, clamped
 *   rules (RELIEF), never model-decided.
 */
import type { LoadedCase } from "./case-schema";
import { CLAIM_LIMITS } from "./constants";
import type { Character, IntendedLie } from "./types";

export { CLAIM_LIMITS };

/** Engine stress relief (subtracted, clamped at 0). */
export const RELIEF = {
  /** Evidence shown to X that bears on someone else and not on X: suspicion moves elsewhere. */
  suspicionElsewhere: 5,
  /** Per confrontation exchange, for every suspect NOT in the pair. */
  bystander: 2,
  /** The detective accepts the character's explanation. */
  explanationAccepted: 4,
} as const;

const STOP = new Set(
  (
    "about above after again against also always among another anyone anything around back been before being below between both " +
    "came come could darling dear does doing done down during each else even ever every evening from going gone have having here " +
    "into just know last like little made make many more most much must myself never night nothing once only other ought over " +
    "perhaps quite really said same shall should since some something still such sure than that their them then there these " +
    "they thing this those though through told tonight under until upon very want wants were what when which while whole will " +
    "with without would your yours yourself sir madam ma'am mister missus inspector detective tell told please well yes " +
    "okay really truth true lying lie lies story"
  ).split(/\s+/),
);

/** Lower-case content words (>= 4 letters, not stop words, not in `exclude`). */
export function contentWords(text: string, exclude: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[’']/g, "").split(/[^a-z]+/)) {
    if (w.length >= 4 && !STOP.has(w) && !exclude.has(w)) out.add(w);
  }
  return out;
}

/**
 * Same word, or a shared stem: both >= 5 letters and a common prefix of 5
 * (4 if one word has only 5 letters): "where" ~ "whereabouts", "argue" ~ "argument".
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  const n = Math.min(5, Math.min(a.length, b.length) - 1);
  return a.slice(0, n) === b.slice(0, n);
}

/** Every name word in the case (people are not a topic by themselves). */
export function nameWords(c: Pick<LoadedCase, "characters" | "victim">): Set<string> {
  const names = [c.victim.name, ...c.victim.aliases, ...c.characters.flatMap((x) => [x.name, ...x.aliases])];
  return contentWords(names.join(" "));
}

/**
 * Does `text` touch `lie`'s topic? Score = sum over DISTINCT matched words:
 * a topic word counts 2 (1 if it appears in several of the owner's lie topics,
 * e.g. "library"), a claim word counts 1. Touched at >= 2. Names never count.
 * (A lie without a topic is matched on its claim alone.)
 */
export function questionTouchesLie(c: Pick<LoadedCase, "characters" | "victim">, owner: Character, lie: IntendedLie, text: string): boolean {
  const names = nameWords(c);
  const asked = [...contentWords(text, names)];
  if (!asked.length) return false;
  const topicCount = new Map<string, number>();
  for (const l of owner.intendedLies) for (const w of contentWords(l.topic ?? "", names)) topicCount.set(w, (topicCount.get(w) ?? 0) + 1);
  const weights = new Map<string, number>();
  for (const w of contentWords(lie.claim, names)) weights.set(w, 1);
  for (const w of contentWords(lie.topic ?? "", names)) weights.set(w, (topicCount.get(w) ?? 1) > 1 ? 1 : 2);
  let score = 0;
  for (const [w, weight] of weights) if (asked.some((a) => sameWord(a, w))) score += weight;
  return score >= 2;
}

/** Strip delimiter-like tags and control characters, collapse whitespace. */
export function sanitizeClaim(text: string): string {
  return text
    .replace(/<[^>]{0,80}>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The detective's assertions in `text`: declarative sentences (not questions) of >= 3 words, sanitised and clipped. */
export function extractClaims(text: string): string[] {
  return sanitizeClaim(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.endsWith("?") && s.split(/\s+/).length >= CLAIM_LIMITS.minWords)
    .map((s) => (s.length > CLAIM_LIMITS.chars ? `${s.slice(0, CLAIM_LIMITS.chars - 1)}…` : s));
}

/** Append claims (deduped, newest last, capped). */
export function mergeClaims(prev: { text: string; turn: number }[], claims: string[], turn: number) {
  const out = prev.filter((p) => !claims.includes(p.text));
  for (const text of claims) out.push({ text, turn });
  return out.slice(-CLAIM_LIMITS.perCharacter);
}

const ACCEPT = /\b(i believe you|that makes sense|fair enough|that explains (it|everything|a lot)|i accept (that|your)|i understand now|i take your word|you('ve| have) been (very |most )?helpful|my apologies|sorry (for|to have) (doubting|troubling)|i('m| am) satisfied)\b/i;
const REJECT = /\b(don'?t|do not|can'?t|cannot|never|not|hardly|no longer)\s+(quite\s+)?(believe|accept|buy|understand|satisfied|make sense)\b|\bnot so fast\b|\bbut\b/i;

/** Does the detective accept the character's explanation? (Deterministic phrase match; any "but"/negation cancels it.) */
export function acceptsExplanation(text: string): boolean {
  return ACCEPT.test(text) && !REJECT.test(text) && !text.includes("?");
}
