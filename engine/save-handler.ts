/**
 * SERVER-ONLY. POST /api/save: a quiet flush of a token the client already holds
 * (tab hidden or closing). Does not mint a new token or bump the version. Every
 * online token is already written by its own action (compare-and-swap, #95), so
 * this can only create a MISSING row; it never replaces one, so a losing or stale
 * tab cannot roll the save back. Offline-lineage tokens are refused, oversized
 * tokens are skipped, and a refusal (row exists, rate cap, limiter error, per-game
 * throttle) is a silent 204: nothing is ever shown to the player.
 */
import type { LoadedCase } from "./case-schema";
import { decodeStateToken, isGameId, peekStateTokenGameId, type Env } from "./state-token";
import { caseIdsMatch } from "@/lib/cases";
import { persistSavedGame } from "@/lib/saved-session";
import { SAVE_TOKEN_MAX_CHARS, savedGamesRepo, type SavedGamesRepo } from "@/lib/saved-games";

export const SAVE_LINES = {
  invalid: "I can't make out these notes, detective. Let's try that again.",
} as const;

export interface SaveRequest {
  gameId?: string;
  caseId?: string;
  stateToken?: string;
}

export interface SaveDeps {
  caseData: LoadedCase;
  env?: Env;
  saves?: SavedGamesRepo | null;
  headers?: Headers;
}

export async function handleSave(json: unknown, deps: SaveDeps): Promise<{ status: number; body?: { error?: string; line?: string } }> {
  if (typeof json !== "object" || json === null) return { status: 400, body: { error: "invalid_json", line: SAVE_LINES.invalid } };
  const body = json as SaveRequest;
  const token = typeof body.stateToken === "string" ? body.stateToken : undefined;
  if (!token || token.length > SAVE_TOKEN_MAX_CHARS) return { status: 400, body: { error: "invalid_request", line: SAVE_LINES.invalid } };

  const decoded = decodeStateToken(token, deps.caseData, deps.env);
  if (!decoded.ok) return { status: 400, body: { error: "invalid_state", line: SAVE_LINES.invalid } };
  if (!caseIdsMatch(decoded.game.caseId, deps.caseData.id)) return { status: 400, body: { error: "swapped", line: SAVE_LINES.invalid } };

  const tokenId = decoded.game.gameId ?? peekStateTokenGameId(token, deps.env);
  if (!isGameId(tokenId)) return { status: 400, body: { error: "invalid_request", line: SAVE_LINES.invalid } };
  if (typeof body.gameId === "string" && body.gameId !== tokenId) return { status: 400, body: { error: "swapped", line: SAVE_LINES.invalid } };

  // Offline-lineage and rate-limited / oversized writes are skipped inside persist (204, silent).
  const repo = deps.saves === undefined ? savedGamesRepo() : deps.saves;
  await persistSavedGame({ stateToken: token, caseId: deps.caseData.id, env: deps.env, repo, headers: deps.headers });
  return { status: 204 };
}
