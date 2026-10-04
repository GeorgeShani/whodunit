/**
 * Engine-wide constants. The engine is the source of truth; these values are
 * never negotiated with (or decided by) the LLM.
 */

/** Maximum number of player turns in a single confrontation before it ends. */
export const MAX_CONFRONTATION_TURNS = 6;

/** Maximum confrontation exchanges in a whole game, across every pair (#24). Each one costs two model calls. */
export const MAX_CONFRONTATION_TOTAL = 12;

/** Caps on the detective's recorded claims per character (engine/memory.ts). */
export const CLAIM_LIMITS = { perCharacter: 6, chars: 160, minWords: 3 } as const;
