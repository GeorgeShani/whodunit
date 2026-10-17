/**
 * Confrontation caps per case (case.json `confrontation`, optional) and the "N left" counter. Dependency-free so the
 * client can import it. Defaults: MAX_CONFRONTATION_TURNS (6) per pair, MAX_CONFRONTATION_TOTAL (12) per game. A case
 * may set 1..6 per pair and 1..MAX_CASE_CONFRONTATION_TOTAL (20) per game; the per-IP and daily model caps stay the
 * cost guard.
 */
import { MAX_CASE_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS } from "./constants";

export interface ConfrontationCaps {
  /** Exchanges one pair may have, ever. */
  perPair: number;
  /** Exchanges in the whole game, across every pair. */
  total: number;
}

export const DEFAULT_CONFRONTATION_CAPS: ConfrontationCaps = { perPair: MAX_CONFRONTATION_TURNS, total: MAX_CONFRONTATION_TOTAL };

/** The case's caps (defaults for what it leaves out; a per-pair cap above the total is clamped to it, and validate:case warns). */
export function confrontationCaps(c?: { confrontation?: { perPair?: number | undefined; total?: number | undefined } | undefined }): ConfrontationCaps {
  const total = Math.min(c?.confrontation?.total ?? MAX_CONFRONTATION_TOTAL, MAX_CASE_CONFRONTATION_TOTAL);
  return { perPair: Math.min(c?.confrontation?.perPair ?? MAX_CONFRONTATION_TURNS, MAX_CONFRONTATION_TURNS, total), total };
}

/** What the client needs for every pair's counter (all public: suspect ids and counts). */
export interface PublicConfrontProgress extends ConfrontationCaps {
  /** Exchanges spent in the whole game. */
  totalUsed: number;
  /** Exchanges spent per pair ("a|b", ids sorted). */
  pairUsed: Record<string, number>;
  /** Pairs that will never face off again. */
  finished: string[];
}

/** "N left" for a pair: whichever runs out first, this pair's exchanges or the whole game's (also before the first). */
export function confrontLeft(p: PublicConfrontProgress, key: string): number {
  if (p.finished.includes(key)) return 0;
  return Math.max(0, Math.min(p.perPair - (p.pairUsed[key] ?? 0), p.total - p.totalUsed));
}

/**
 * The confrontation screen's counter for a pair. With progress (every route returns it), "left" is right from the
 * first look, before any exchange. `over` from a server refusal (pair_finished / limit_reached) always wins.
 * Without progress (a session saved before it existed) it falls back to the per-pair default.
 */
export function confrontCounter(p: PublicConfrontProgress | undefined, key: string, status?: { turnsUsed: number; over: boolean }): { left: number; max: number; over: boolean } {
  if (!p) {
    const left = status?.over ? 0 : Math.max(0, MAX_CONFRONTATION_TURNS - (status?.turnsUsed ?? 0));
    return { left, max: MAX_CONFRONTATION_TURNS, over: left === 0 };
  }
  const left = status?.over ? 0 : confrontLeft(p, key);
  return { left, max: p.perPair, over: left === 0 };
}

/** Phase 7 (3.6): one pair's chip in the "Confront…" menu ("2/4 used", "finished": disabled). */
export interface ConfrontPairChip {
  used: number;
  max: number;
  left: number;
  finished: boolean;
}

/**
 * The "Confront…" menu: a chip per pair and the game-wide counter ("Face-offs left: 9 of 16"). `status` is the
 * client's own record of server refusals (Game.tsx confrontStatus), which always wins, as in confrontCounter.
 */
export function confrontMenu(
  p: PublicConfrontProgress,
  pairKeyOf: (otherId: string) => string,
  otherIds: readonly string[],
  status: Record<string, { turnsUsed: number; over: boolean }> = {},
): { totalLeft: number; total: number; pairs: Record<string, ConfrontPairChip> } {
  const pairs: Record<string, ConfrontPairChip> = {};
  for (const id of otherIds) {
    const key = pairKeyOf(id);
    const c = confrontCounter(p, key, status[key]);
    pairs[id] = { used: Math.min(p.perPair, Math.max(p.pairUsed[key] ?? 0, status[key]?.turnsUsed ?? 0)), max: c.max, left: c.left, finished: c.over };
  }
  return { totalLeft: Math.max(0, p.total - p.totalUsed), total: p.total, pairs };
}
