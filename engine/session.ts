/**
 * SERVER-ONLY. The one place routes restore and persist the signed game state,
 * so every route (interrogate, investigate, later confront/accuse) shares the
 * SAME token format and reset behaviour.
 */
import { inSetting, settingOf } from "./presentation";
import type { LoadedCase } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { mintOfflineThisRequest, noteIssuedVersion } from "@/lib/save-context";
import { decodeStateToken, encodeStateToken, newGameId, type DecodeOptions, type Env } from "./state-token";
import type { GameState } from "./types";

/** In-character narrator line shown when a bad/stale token forces a reset. */
export const RESET_NOTICE =
  "A gust of wind blows the detective's notebook out of the window! The pages are gone. Best start the questioning afresh.";

/** Narrator line when a token is older than the max age (#39): a fresh start, in character. */
export const COLD_CASE_NOTICE =
  "This case file has gone cold, detective. The household has scattered and the trail with it, so it's a fresh start: the same night, the same house, a clean notebook.";

/** Narrator line when the client's token is behind the saved version (#40): we put the latest pages back in their hand. */
export const STALE_TOKEN_NOTICE =
  "These notes were already turned ahead, detective. I've put the latest pages back in your hand.";

/** Narrator line when an offline-lineage leftover is ignored in favour of the cabinet row (#94). */
export const OFFLINE_RESUME_NOTICE =
  "These notes were jotted while the cabinet was shut, detective. I've put the file from the cabinet back in your hand.";

/** Narrator line when this instance already issued a newer version and we cannot put those pages back (outage, best-effort). */
export const CABINET_AHEAD_NOTICE =
  "These notes were already turned ahead, detective. Keep the latest pages you already have.";

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
  // Tokens minted while the cabinet is shut, and every token derived from one,
  // carry a signed `offline` flag. They keep the same-tab game going but are
  // never written to saved_games; once the cabinet is open the row is truth (#94).
  if (game.offline || mintOfflineThisRequest()) game.offline = true;
  game.saveVersion = (game.saveVersion ?? 0) + 1;
  if (game.gameId) noteIssuedVersion(game.gameId, game.saveVersion);
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
