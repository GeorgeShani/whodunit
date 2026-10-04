/**
 * SERVER-ONLY. The one place routes restore and persist the signed game state,
 * so every route (interrogate, investigate, later confront/accuse) shares the
 * SAME token format and reset behaviour.
 */
import type { LoadedCase } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { decodeStateToken, encodeStateToken, newGameId, type DecodeOptions, type Env } from "./state-token";
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
export function restoreSession(
  caseData: LoadedCase,
  token: string | undefined,
  env?: Env,
  options: DecodeOptions = {},
): RestoredSession {
  // A token for another case (wrong_case) resets in character like any other bad token.
  const decoded = decodeStateToken(token, caseData, env, options);
  if (decoded.ok) return { game: decoded.game };
  const game = createInitialGameState(caseData);
  game.gameId = newGameId();
  return decoded.reason === "missing" ? { game } : { game, notice: RESET_NOTICE, resetReason: decoded.reason };
}

export function saveSession(game: GameState, env?: Env): string {
  return encodeStateToken(game, env);
}

/** In-character replies once the case is closed (after the accusation). */
export const CASE_CLOSED_LINE = "The case is closed, detective. The constable has everyone's statements, and I've nothing more to say.";
export const CASE_CLOSED_SEARCH_LINE = "The constable has sealed the house. The case is closed, detective: there's nothing left to search.";

export const isCaseClosed = (game: GameState) => game.outcome !== "pending";
