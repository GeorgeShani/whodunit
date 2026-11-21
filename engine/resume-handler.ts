/**
 * SERVER-ONLY. POST /api/resume: hand back the latest verified token for a game id the client already holds.
 * The client sends gameId + caseId (and, for migration or a DB outage, the leftover stateToken) in the body,
 * never in a URL. A swapped id or case is refused. A closed game replays the stored verdict (#39). An offline leftover is ignored when a row exists (#94); fallback without a row is same-tab only.
 */
import type { ResumeResponseBody } from "./resume-schema";
export type { ResumeResponseBody } from "./resume-schema";
import { storedOutcomeBody } from "./accuse-handler";
import type { PlayableCase } from "./case-schema";
import { COLD_CASE_NOTICE, CABINET_AHEAD_NOTICE, OFFLINE_RESUME_NOTICE, RESET_NOTICE, STALE_TOKEN_NOTICE, restoreSession } from "./session";
import { inSetting, settingOf } from "./presentation";
import {
  decodeStateToken,
  isGameId,
  peekStateTokenGameId,
  peekStateTokenOffline,
  peekStateTokenSaveVersion,
  type Env,
} from "./state-token";
import { caseIdsMatch, canonicalCaseId } from "@/lib/cases";
import { closedGamesRepo, type ClosedGamesRepo } from "@/lib/closed-games";
import { allowSavePath, snapshotFromGame } from "@/lib/saved-session";
import { issuedHighWater, noteIssuedVersion } from "@/lib/save-context";
import { savedGamesRepo, type SavedGameRecord, type SavedGamesRepo } from "@/lib/saved-games";

export const RESUME_LINES = {
  invalid: "I can't make out these notes, detective. Let's try that again.",
  unknownCase: "There's no such case on the books.",
  swapped: "Those notes don't belong to this case file, detective.",
  cabinetStuck: "The cabinet is stuck, detective. If you still have the file in hand, try again in a moment.",
  rate: "Easy, detective — the cabinet needs a moment. Try again shortly.",
} as const;

export interface ResumeRequest {
  gameId?: string;
  caseId?: string;
  stateToken?: string;
}

export interface ResumeDeps {
  caseData: PlayableCase;
  env?: Env;
  saves?: SavedGamesRepo | null;
  closed?: ClosedGamesRepo | null;
  headers?: Headers;
}

function pickNewer(clientToken: string | undefined, row: SavedGameRecord | null, env?: Env): { token: string; source: "db" | "client"; notice?: string } | null {
  const clientOffline = clientToken ? peekStateTokenOffline(clientToken, env) === true : false;
  // An offline leftover never beats a cabinet row, even with a pumped version (#94).
  if (row && clientOffline && clientToken) {
    return { token: row.stateToken, source: "db", notice: OFFLINE_RESUME_NOTICE };
  }
  // The row is the one true lineage (#95): a leftover that is behind it, or diverged from it at any version, is
  // replaced, and the player is told so in character (#96).
  if (row && clientToken && clientToken !== row.stateToken) return { token: row.stateToken, source: "db", notice: STALE_TOKEN_NOTICE };
  if (row) return { token: row.stateToken, source: "db" };
  if (clientToken) return { token: clientToken, source: "client" };
  return null;
}

export async function handleResume(json: unknown, deps: ResumeDeps): Promise<{ status: number; body: ResumeResponseBody }> {
  const { caseData, env, headers } = deps;
  if (typeof json !== "object" || json === null) return { status: 400, body: { error: "invalid_json", line: RESUME_LINES.invalid } };
  const body = json as ResumeRequest;
  const clientToken = typeof body.stateToken === "string" ? body.stateToken : undefined;
  const requestedId = typeof body.gameId === "string" ? body.gameId : peekStateTokenGameId(clientToken, env);
  if (!isGameId(requestedId)) return { status: 400, body: { error: "invalid_request", line: RESUME_LINES.invalid } };

  // A leftover token is only used if it verifies. A swapped id or case is refused; a bad signature or
  // an expired leftover is ignored so a good saved row can still resume (or we fall through to "cabinet stuck").
  let usableClient = clientToken;
  if (clientToken) {
    const tokenId = peekStateTokenGameId(clientToken, env);
    if (tokenId && tokenId !== requestedId) return { status: 400, body: { error: "swapped", line: RESUME_LINES.swapped } };
    const decoded = decodeStateToken(clientToken, caseData, env);
    if (decoded.ok && !caseIdsMatch(decoded.game.caseId, caseData.id)) return { status: 400, body: { error: "swapped", line: RESUME_LINES.swapped } };
    if (!decoded.ok && decoded.reason === "wrong_case") return { status: 400, body: { error: "swapped", line: RESUME_LINES.swapped } };
    if (!decoded.ok) usableClient = undefined;
  }

  // Fail closed (#102): over the cap, or the limiter itself failing, is a quiet in-character "wait a moment".
  if (headers && !(await allowSavePath(headers))) {
    return { status: 429, body: { error: "rate_limited", line: RESUME_LINES.rate } };
  }

  const saves = deps.saves === undefined ? savedGamesRepo() : deps.saves;
  let row: SavedGameRecord | null = null;
  let dbDown = false;
  if (saves) {
    try {
      row = await saves.getSave(requestedId);
      if (row && !caseIdsMatch(row.caseId, caseData.id)) {
        // A row for a different case under this id: treat as a swap, never return it.
        row = null;
        return { status: 400, body: { error: "swapped", line: RESUME_LINES.swapped } };
      }
    } catch {
      dbDown = true;
    }
  } else {
    dbDown = false; // unconfigured: not "down", just no row
  }

  if (row) noteIssuedVersion(requestedId, row.version);

  // Same-tab fallback: a leftover is allowed while the cabinet is shut, but this
  // instance will not resume an older token than one it already issued (#94).
  if (!row && usableClient) {
    const v = peekStateTokenSaveVersion(usableClient, env);
    const hw = issuedHighWater(requestedId);
    if (hw !== undefined && v !== undefined && v < hw) {
      return { status: 409, body: { error: "stale_token", line: CABINET_AHEAD_NOTICE, notice: CABINET_AHEAD_NOTICE } };
    }
  }

  const picked = pickNewer(usableClient, row, env);
  if (!picked) {
    return { status: dbDown ? 503 : 404, body: { error: dbDown ? "cabinet_stuck" : "not_found", line: dbDown ? RESUME_LINES.cabinetStuck : RESUME_LINES.invalid } };
  }

  const decoded = decodeStateToken(picked.token, caseData, env);
  if (!decoded.ok) {
    const line = decoded.reason === "expired" ? inSetting(COLD_CASE_NOTICE, settingOf(caseData)) : RESET_NOTICE;
    return { status: 400, body: { error: decoded.reason, line, notice: line } };
  }
  if (decoded.game.gameId && decoded.game.gameId !== requestedId) return { status: 400, body: { error: "swapped", line: RESUME_LINES.swapped } };

  const game = decoded.game;
  const snapshot = snapshotFromGame(caseData, game);
  const out: ResumeResponseBody = {
    stateToken: picked.token,
    gameId: requestedId,
    caseId: canonicalCaseId(caseData.id),
    snapshot,
    saveVersion: game.saveVersion ?? 0,
    ...(game.offline ? { offline: true } : {}),
    ...(picked.notice ? { notice: picked.notice } : {}),
  };

  const closedRepo = deps.closed === undefined ? closedGamesRepo() : deps.closed;
  if (closedRepo) {
    try {
      const stored = await closedRepo.getClosed(requestedId);
      if (stored && caseIdsMatch(stored.caseId, caseData.id)) {
        out.closed = storedOutcomeBody(caseData, game, stored, picked.token, env);
        // A loss replay must not grow a solution or verdict; storedOutcomeBody already guarantees that.
      }
    } catch {
      /* closed_games down: still return the in-progress snapshot (or a game-over token's own outcome) */
    }
  }
  return { status: 200, body: out };
}

/** For tests: wrap restoreSession so a missing token is a miss, not a new game. */
export function peekResumeSession(caseData: PlayableCase, token: string, env?: Env) {
  return restoreSession(caseData, token, env);
}
