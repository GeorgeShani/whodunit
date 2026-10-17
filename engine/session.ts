/**
 * SERVER-ONLY. The one place routes restore and persist the signed game state,
 * so every route (interrogate, investigate, later confront/accuse) shares the
 * SAME token format and reset behaviour.
 */
import { inSetting, settingOf } from "./presentation";
import type { LoadedCase } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { decodeStateToken, encodeStateToken, newGameId, type DecodeOptions, type Env } from "./state-token";
import type { GameState } from "./types";

/** In-character narrator line shown when a bad/stale token forces a reset. */
export const RESET_NOTICE =
  "A gust of wind blows the detective's notebook out of the window! The pages are gone. Best start the questioning afresh.";

/** Narrator line when a token is older than the max age (#39): a fresh start, in character. */
export const COLD_CASE_NOTICE =
  "This case file has gone cold, detective. The household has scattered and the trail with it, so it's a fresh start: the same night, the same house, a clean notebook.";

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
  if (decoded.reason === "missing") return { game };
  return { game, notice: decoded.reason === "expired" ? inSetting(COLD_CASE_NOTICE, settingOf(caseData)) : RESET_NOTICE, resetReason: decoded.reason };
}

export function saveSession(game: GameState, env?: Env): string {
  return encodeStateToken(game, env);
}

/**
 * E10: engine system lines. The defaults are neutral (no constable, police, Yard or telephone: a case's canon decides
 * those); a case overrides any of them with case.json `systemLines`.
 */
export const SYSTEM_LINES = {
  caseClosed: "The case is closed, detective. Everyone has said their piece, and I've nothing more to say.",
  caseClosedSearch: "The case is closed, detective: there's nothing left to search.",
  recordDown: "Your accusation can't be written down just now, detective. Your notes are safe: make your accusation again in a moment.",
} as const;
export type SystemLineKey = keyof typeof SYSTEM_LINES;

/** The case's own wording for a system line, else the neutral default. */
export function systemLine(c: { systemLines?: Partial<Record<SystemLineKey, string>> } | undefined, key: SystemLineKey): string {
  return c?.systemLines?.[key] ?? SYSTEM_LINES[key];
}

/** Neutral defaults (kept as named exports for callers without case data). */
export const CASE_CLOSED_LINE = SYSTEM_LINES.caseClosed;
export const CASE_CLOSED_SEARCH_LINE = SYSTEM_LINES.caseClosedSearch;

export const isCaseClosed = (game: GameState) => game.outcome !== "pending";
