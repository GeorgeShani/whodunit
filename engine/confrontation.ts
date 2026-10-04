/**
 * Confrontation rules (MASTER_PLAN §32-33, Phase 11 "Character A vs Character B").
 * Pure and deterministic. The application, not the agents, controls
 * termination: each exchange is one player line, and a pair gets at most
 * MAX_CONFRONTATION_TURNS exchanges, then never faces off again. No agent
 * ever talks to another on its own.
 */
import type { LoadedCase } from "./case-schema";
import { MAX_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS } from "./constants";
import { RELIEF } from "./memory";
import { liesTouchedByTestimony, revealedSecretIds } from "./testimony";
import type { GameState } from "./types";

export { MAX_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS };

/** Engine stress each side takes per exchange for being put face to face. */
export const CONFRONTATION_PRESSURE = 3;

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export type ConfrontGate =
  | { ok: true; turnsUsed: number }
  | { ok: false; reason: "same_character" | "pair_finished" | "limit_reached" };

/** Exchanges spent in the whole game, across every pair. */
export const totalExchanges = (game: GameState) => Object.values(game.pairTurns).reduce((a, b) => a + b, 0);

/**
 * Start (or continue) the confrontation between `addressedId` and `partnerId`.
 * Each pair's used exchanges persist in game.pairTurns, so switching pairs and
 * coming back resumes the count (#24), and the whole game is capped at
 * MAX_CONFRONTATION_TOTAL exchanges. Mutates game.activeConfrontation.
 */
export function openConfrontation(game: GameState, addressedId: string, partnerId: string): ConfrontGate {
  if (addressedId === partnerId) return { ok: false, reason: "same_character" };
  const key = pairKey(addressedId, partnerId);
  if (game.confrontedPairs.includes(key) || (game.pairTurns[key] ?? 0) >= MAX_CONFRONTATION_TURNS) return { ok: false, reason: "pair_finished" };
  if (totalExchanges(game) >= MAX_CONFRONTATION_TOTAL) return { ok: false, reason: "limit_reached" };
  const used = game.pairTurns[key] ?? 0;
  const active = game.activeConfrontation;
  if (!active || pairKey(...active.characterIds) !== key) game.activeConfrontation = { characterIds: [addressedId, partnerId], turnsUsed: used };
  else active.turnsUsed = used;
  return { ok: true, turnsUsed: used };
}

/** §18 "suspicion moves elsewhere": everyone NOT in the pair relaxes a little per exchange (clamped at 0). */
export function relieveBystanders(game: GameState, pair: readonly [string, string]): void {
  for (const [id, rt] of Object.entries(game.characters)) if (!pair.includes(id)) rt.stress = Math.max(0, rt.stress - RELIEF.bystander);
}

/** Count one exchange; at the pair cap the pair is finished for good. `over` also covers the whole-game cap. */
export function spendExchange(game: GameState): { turnsUsed: number; over: boolean; totalLeft: number } {
  const active = game.activeConfrontation;
  if (!active) return { turnsUsed: 0, over: true, totalLeft: Math.max(0, MAX_CONFRONTATION_TOTAL - totalExchanges(game)) };
  const key = pairKey(...active.characterIds);
  const turnsUsed = Math.min(MAX_CONFRONTATION_TURNS, (game.pairTurns[key] ?? 0) + 1);
  game.pairTurns[key] = turnsUsed;
  active.turnsUsed = turnsUsed;
  const totalLeft = Math.max(0, MAX_CONFRONTATION_TOTAL - totalExchanges(game));
  if (turnsUsed >= MAX_CONFRONTATION_TURNS) {
    if (!game.confrontedPairs.includes(key)) game.confrontedPairs.push(key);
    game.activeConfrontation = null;
  }
  return { turnsUsed, over: turnsUsed >= MAX_CONFRONTATION_TURNS || totalLeft === 0, totalLeft };
}

/**
 * The testimony the addressed character throws in the partner's face this
 * exchange: the first of the ADDRESSED character's own revealed secrets that
 * bears on one of the partner's lies and hasn't been put to the partner yet.
 * (E.g. once A has admitted leaving the room, facing B makes A say it to B's
 * face, which breaks B's "we were together" story.) Null if none.
 */
export function testimonyToThrow(c: LoadedCase, game: GameState, addressedId: string, partnerId: string): string | null {
  const own = game.characters[addressedId]?.revealedSecretIds ?? [];
  const partner = c.characters.find((x) => x.id === partnerId);
  const heard = game.characters[partnerId]?.testimonyShownIds ?? [];
  const revealed = new Set(revealedSecretIds(game));
  if (!partner) return null;
  return own.find((s) => revealed.has(s) && !heard.includes(s) && liesTouchedByTestimony(c, partner, s).length > 0) ?? null;
}
