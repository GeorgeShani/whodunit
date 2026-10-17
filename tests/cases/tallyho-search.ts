/**
 * Exhaustive searches for the Tallyho draft (cases/_tallyho), where the engine's generic searches (fastestPath,
 * accuseOpenWithoutWin) run out of budget at six suspects. Same rules as engine/progression-validation.ts (a search
 * yields every clue unlocked before it; showing the right clue cracks one secret and is an exchange with its owner;
 * confrontations never shorten anything here, since no Tallyho secret has a testimony condition), with one reduction:
 * every condition is monotone, so plain questions can always be asked first without making a path longer. Exchange
 * counts are then fixed per question vector, and the rest of the search is over clues, searches and secrets.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { accuseProgress, isUnlocked, leadStates } from "@/engine/progress";
import { GameStateSchema, type GameState } from "@/engine/types";

type Secret = LoadedCase["characters"][number]["secrets"][number];
export interface Act {
  clues: string[];
  searched: string[];
  secrets: string[];
}

/** The largest exchange count any Tallyho condition or the gate looks at. */
const CAP = 4;

function game(c: LoadedCase, a: Act, counts: Record<string, number>): GameState {
  return GameStateSchema.parse({
    caseId: c.id,
    phase: "investigating",
    turn: 0,
    discoveredEvidenceIds: a.clues,
    searchedLocationIds: a.searched,
    revealedSecretIds: a.secrets,
    characters: Object.fromEntries(c.characters.map((ch) => [ch.id, { characterId: ch.id, emotion: { ...ch.initialEmotion }, interrogationCount: counts[ch.id] ?? 0 }])),
  });
}

function crackable(s: Secret, core: ReadonlySet<string>, a: Act, stress: boolean): boolean {
  const rc = s.revealConditions;
  if (!rc || core.has(s.id) || a.secrets.includes(s.id) || !rc.afterSecretIds.every((id) => a.secrets.includes(id))) return false;
  if (stress && rc.stressThreshold !== undefined) return true;
  const conds = [...rc.evidenceIds.map((e) => a.clues.includes(e)), ...(rc.testimonyIds ?? []).map((t) => a.secrets.includes(t))];
  return conds.length > 0 && (rc.mode === "all" ? conds.every(Boolean) : conds.some(Boolean));
}

const key = (a: Act) => [[...a.clues].sort(), [...a.searched].sort(), [...a.secrets].sort()].map((x) => x.join(",")).join("|");

/** Every next act state: search an open room (state before the search decides what it yields), or crack one secret. */
function moves(c: LoadedCase, a: Act, counts: Record<string, number>, core: ReadonlySet<string>, stress: boolean): Act[] {
  const g = game(c, a, counts);
  const states = leadStates(c, g);
  const out: Act[] = [];
  for (const loc of c.locations) {
    if (!isUnlocked(loc, g, states)) continue;
    const clues = [...a.clues];
    for (const e of c.evidence) if (e.locationId === loc.id && !clues.includes(e.id) && isUnlocked(e, g, states)) clues.push(e.id);
    const searched = a.searched.includes(loc.id) ? a.searched : [...a.searched, loc.id];
    if (clues.length === a.clues.length && searched === a.searched) continue;
    out.push({ clues, searched, secrets: a.secrets });
  }
  for (const ch of c.characters) for (const s of ch.secrets) if (crackable(s, core, a, stress)) out.push({ ...a, secrets: [...a.secrets, s.id] });
  return out;
}

function winnable(c: LoadedCase, a: Act): boolean {
  const s = c.solution;
  return (
    s.keyEvidenceIds.filter((id) => a.clues.includes(id)).length >= (s.minKeyEvidence ?? 1) &&
    (s.keyTestimonyIds ?? []).filter((id) => a.secrets.includes(id)).length >= (s.minKeyTestimony ?? 0)
  );
}

/**
 * Fastest legal path to a won accusation (actions, the accusation included), with the plain questions it asks each
 * suspect. The full search takes minutes; pass `plain` to search only that question vector (seconds).
 */
export function tallyhoFastestPath(c: LoadedCase, only?: Record<string, number>): { actions: number; plain: Record<string, number> } | null {
  const core = coreGuiltSecretIds(c);
  const owner = new Map(c.characters.flatMap((ch) => ch.secrets.map((s) => [s.id, ch.id] as const)));
  const ids = c.characters.map((ch) => ch.id);
  const crackableCount = (id: string) => c.characters.find((ch) => ch.id === id)!.secrets.filter((s) => s.revealConditions && !core.has(s.id)).length;
  // The gate needs CAP exchanges each and cracks are exchanges, so nobody needs fewer than CAP - (their crackable secrets) questions.
  const ranges = ids.map((id) => Array.from({ length: CAP + 1 }, (_, k) => k).filter((k) => k >= Math.max(0, CAP - crackableCount(id))));
  let vectors: number[][] = [[]];
  for (const r of ranges) vectors = vectors.flatMap((v) => r.map((k) => [...v, k]));
  if (only) vectors = [ids.map((id) => only[id] ?? 0)];
  const sum = (v: number[]) => v.reduce((s, k) => s + k, 0);
  vectors.sort((x, y) => sum(x) - sum(y));
  let best: { actions: number; plain: Record<string, number> } | null = null;
  for (const v of vectors) {
    const talk = sum(v);
    if (best && talk + 1 >= best.actions) break;
    const plain = Object.fromEntries(ids.map((id, i) => [id, v[i]!]));
    const countsFor = (secrets: string[]) => {
      const n = { ...plain };
      for (const s of secrets) n[owner.get(s)!] = Math.min(CAP, n[owner.get(s)!]! + 1);
      return n;
    };
    const start: Act = { clues: c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id), searched: [], secrets: [] };
    const seen = new Set([key(start)]);
    let frontier = [start];
    search: for (let steps = 0; frontier.length && (!best || talk + steps + 1 < best.actions); steps++) {
      const next: Act[] = [];
      for (const a of frontier) {
        const counts = countsFor(a.secrets);
        if (winnable(c, a) && accuseProgress(c, game(c, a, counts)).unlocked) {
          best = { actions: talk + steps + 1, plain };
          break search;
        }
        for (const n of moves(c, a, counts, core, false)) {
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(n);
        }
      }
      frontier = next;
    }
  }
  return best;
}

/**
 * E1, exhaustively: a reachable state where ACCUSE is open but the win is impossible, or null. Adversarial like the
 * engine's check (a secret with a stress threshold may crack at any time). Questions only open things up and never
 * change what is held, so every suspect is taken as fully questioned from the start.
 */
export function tallyhoAccuseOpenWithoutWin(c: LoadedCase): { act: Act | null; explored: number } {
  const core = coreGuiltSecretIds(c);
  const counts = Object.fromEntries(c.characters.map((ch) => [ch.id, CAP]));
  const start: Act = { clues: c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id), searched: [], secrets: [] };
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i]!;
    if (!winnable(c, a) && accuseProgress(c, game(c, a, counts)).unlocked) return { act: a, explored: seen.size };
    for (const n of moves(c, a, counts, core, true)) {
      const k = key(n);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return { act: null, explored: seen.size };
}
