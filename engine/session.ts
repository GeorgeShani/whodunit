/**
 * SERVER-ONLY. The one place routes restore and persist the signed game state,
 * so every route (interrogate, investigate, later confront/accuse) shares the
 * SAME token format and reset behaviour.
 */
import type { LoadedCase } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { decodeStateToken, encodeStateToken, type Env } from "./state-token";
import type { GameState } from "./types";

/** In-character narrator line shown when a bad/stale token forces a reset. */
export const RESET_NOTICE =
  "A gust of wind blows the detective's notebook out of the window! The pages are gone. Best start the questioning afresh.";

export interface RestoredSession {
  game: GameState;
  /** Set when a token was supplied but rejected (tampered, stale, other case). */
  notice?: string;
  /** Why the token was rejected (non-secret; for logs/tests). */
  resetReason?: string;
}

/** No token = new game. Invalid token = reset + in-character notice. */
export function restoreSession(caseData: LoadedCase, token: string | undefined, env?: Env): RestoredSession {
  const decoded = decodeStateToken(token, caseData, env);
  if (decoded.ok) return { game: decoded.game };
  const game = createInitialGameState(caseData);
  return decoded.reason === "missing" ? { game } : { game, notice: RESET_NOTICE, resetReason: decoded.reason };
}

export function saveSession(game: GameState, env?: Env): string {
  return encodeStateToken(game, env);
}
