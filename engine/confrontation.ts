/**
 * Confrontation rules (MASTER_PLAN §32-33, Phase 11 "Character A vs Character B").
 * Pure and deterministic. The application, not the agents, controls
 * termination: each exchange is one player line, and a pair gets at most
 * MAX_CONFRONTATION_TURNS exchanges, then never faces off again. No agent
 * ever talks to another on its own.
 */
import type { LoadedCase } from "./case-schema";
import { MAX_CONFRONTATION_TURNS } from "./constants";
import { RELIEF } from "./memory";
import { liesTouchedByTestimony, revealedSecretIds } from "./testimony";
import type { GameState } from "./types";

export { MAX_CONFRONTATION_TURNS };

/** Engine stress each side takes per exchange for being put face to face. */
export const CONFRONTATION_PRESSURE = 3;

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export type ConfrontGate =
  | { ok: true; turnsUsed: number }
  | { ok: false; reason: "same_character" | "pair_finished" };

/**
 * Start (or continue) the confrontation between `addressedId` and `partnerId`.
 * Switching to another pair abandons the old one (its used exchanges stay
 * spent if it is resumed later). Mutates game.activeConfrontation.
 */
export function openConfrontation(game: GameState, addressedId: string, partnerId: string): ConfrontGate {
  if (addressedId === partnerId) return { ok: false, reason: "same_character" };
  const key = pairKey(addressedId, partnerId);
  if (game.confrontedPairs.includes(key)) return { ok: false, reason: "pair_finished" };
  const active = game.activeConfrontation;
  if (!active || pairKey(...active.characterIds) !== key) {
    game.activeConfrontation = { characterIds: [addressedId, partnerId], turnsUsed: 0 };
  }
  return { ok: true, turnsUsed: game.activeConfrontation!.turnsUsed };
}

/** §18 "suspicion moves elsewhere": everyone NOT in the pair relaxes a little per exchange (clamped at 0). */
export function relieveBystanders(game: GameState, pair: readonly [string, string]): void {
  for (const [id, rt] of Object.entries(game.characters)) if (!pair.includes(id)) rt.stress = Math.max(0, rt.stress - RELIEF.bystander);
}

/** Count one exchange; at the cap the pair is finished for good. Returns whether it is over. */
export function spendExchange(game: GameState): { turnsUsed: number; over: boolean } {
  const active = game.activeConfrontation;
  if (!active) return { turnsUsed: 0, over: true };
  const turnsUsed = Math.min(MAX_CONFRONTATION_TURNS, active.turnsUsed + 1);
  if (turnsUsed >= MAX_CONFRONTATION_TURNS) {
    game.confrontedPairs.push(pairKey(...active.characterIds));
    game.activeConfrontation = null;
    return { turnsUsed, over: true };
  }
  active.turnsUsed = turnsUsed;
  return { turnsUsed, over: false };
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
