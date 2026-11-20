/**
 * SERVER-ONLY. Glue between the signed token and saved_games: sync a stale client token to the newest saved
 * version, persist after a successful action (never throws to the player), and rebuild the public snapshot a
 * resume needs (no solution, no proof list, no sealed lies).
 */
import type { LoadedCase } from "@/engine/case-schema";
import type { ResumeSnapshot } from "@/engine/resume-schema";
export type { ResumeSnapshot } from "@/engine/resume-schema";
import { publicProgress } from "@/engine/progress";
import { toPublicEvidence } from "@/engine/public-view";
import { CABINET_AHEAD_NOTICE, OFFLINE_RESUME_NOTICE, STALE_TOKEN_NOTICE } from "@/engine/session";
import { publicTestimonies } from "@/engine/testimony";
import {
  decodeStateToken,
  isGameId,
  peekStateTokenGameId,
  peekStateTokenOffline,
  peekStateTokenSaveVersion,
  type Env,
} from "@/engine/state-token";
import { clientIp } from "@/ai/model-gate";
import { canonicalCaseId, caseIdsMatch } from "./cases";
import { issuedHighWater, noteIssuedVersion } from "./save-context";
import { runtimeKv, type KvStore } from "./runtime-kv";
import { SAVE_TOKEN_MAX_CHARS, savedGamesRepo, type SavedGamesRepo } from "./saved-games";

/** Public, spoiler-safe view of a restored game (Agatha's list, no solution or hidden proof). */
export function snapshotFromGame(caseData: LoadedCase, game: import("@/engine/types").GameState): ResumeSnapshot {
  const discovered = new Set([...game.discoveredEvidenceIds, ...caseData.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id)]);
  const pair = game.activeConfrontation?.characterIds;
  const caps = game.pairTurns;
  const finished = new Set(game.confrontedPairs);
  return {
    discoveredEvidenceIds: [...discovered],
    searchedLocationIds: [...game.searchedLocationIds],
    evidence: caseData.evidence.filter((e) => discovered.has(e.id)).map((e) => toPublicEvidence(e)),
    testimonies: publicTestimonies(caseData, game),
    emotions: Object.fromEntries(Object.entries(game.characters).map(([id, r]) => [id, r.emotion.emotion])),
    stress: Object.fromEntries(Object.entries(game.characters).map(([id, r]) => [id, r.stress])),
    progress: publicProgress(caseData, game),
    confront: {
      pair: pair && pair.length === 2 ? [pair[0], pair[1]] : null,
      status: Object.fromEntries(Object.entries(caps).map(([k, turnsUsed]) => [k, { turnsUsed, over: finished.has(k) }])),
    },
    outcome: game.outcome,
  };
}

const SAVE_RATE_LIMIT = 60;
const SAVE_RATE_WINDOW_S = 60;

/** Best-effort per-IP cap on the save/resume path (same idea as the other APIs). A miss fails open. */
export async function allowSavePath(headers: Headers, kv: KvStore = runtimeKv, now: () => number = Date.now): Promise<boolean> {
  const key = `whodunit:save-rate:${clientIp(headers)}`;
  try {
    const prev = (await kv.get(key)) as { n?: number; t?: number } | undefined;
    const at = now();
    const t0 = typeof prev?.t === "number" ? prev.t : at;
    const n = typeof prev?.n === "number" ? prev.n : 0;
    if (at - t0 >= SAVE_RATE_WINDOW_S * 1000) {
      await kv.set(key, { n: 1, t: at }, SAVE_RATE_WINDOW_S);
      return true;
    }
    if (n >= SAVE_RATE_LIMIT) return false;
    await kv.set(key, { n: n + 1, t: t0 }, SAVE_RATE_WINDOW_S);
    return true;
  } catch {
    return true;
  }
}

export interface SyncedIncoming {
  json: unknown;
  notice?: string;
  /**
   * True when the cabinet is unconfigured or the read threw. Tokens minted in
   * this request (and their descendants) must be signed `offline` and must
   * never be written to saved_games. Fallback play is same-tab only (#94).
   */
  cabinetOffline: boolean;
  /**
   * This instance already issued a newer version and we have no row to put
   * back in their hand: do not run the action on the older token.
   */
  rejectStale?: boolean;
}

/**
 * If the DB holds a newer version of this game, replace `stateToken` in the request body so the handler
 * runs on the latest pages (and a stale token cannot roll confrontation caps back, #40).
 *
 * An offline-lineage token never wins against a cabinet row, even if its saveVersion is higher (#94):
 * the row is truth and the leftover is ignored. When the cabinet is shut, the client token is left
 * in place so the same tab can keep playing; a best-effort in-memory high-water mark may still
 * reject a lower version on this instance. Never throws.
 */
export async function syncIncomingToken(
  json: unknown,
  caseData: LoadedCase,
  env?: Env,
  repo: SavedGamesRepo | null | undefined = savedGamesRepo(),
): Promise<SyncedIncoming> {
  if (typeof json !== "object" || json === null) return { json, cabinetOffline: repo == null };
  const body = json as Record<string, unknown>;
  const token = typeof body.stateToken === "string" ? body.stateToken : undefined;
  const decoded = token ? decodeStateToken(token, caseData, env) : null;
  const gameId = (decoded?.ok && decoded.game.gameId) || peekStateTokenGameId(token, env);
  const incoming = decoded?.ok ? (decoded.game.saveVersion ?? 0) : peekStateTokenSaveVersion(token, env);
  const incomingOffline = decoded?.ok ? decoded.game.offline === true : peekStateTokenOffline(token, env) === true;

  if (!isGameId(gameId)) return { json, cabinetOffline: repo == null };

  if (!repo) {
    return staleDuringOutage({ json, gameId, incoming });
  }
  try {
    const row = await repo.getSave(gameId);
    if (row && caseIdsMatch(row.caseId, caseData.id)) {
      noteIssuedVersion(gameId, row.version);
      // Offline leftovers never overwrite or continue past a real row, regardless of version.
      if (incomingOffline) {
        const newer = decodeStateToken(row.stateToken, caseData, env);
        if (newer.ok) return { json: { ...body, stateToken: row.stateToken }, notice: OFFLINE_RESUME_NOTICE, cabinetOffline: false };
      }
      if (incoming === undefined || row.version <= incoming) return { json, cabinetOffline: false };
      const newer = decodeStateToken(row.stateToken, caseData, env);
      if (!newer.ok) return { json, cabinetOffline: false };
      return { json: { ...body, stateToken: row.stateToken }, notice: STALE_TOKEN_NOTICE, cabinetOffline: false };
    }
    return { json, cabinetOffline: false };
  } catch {
    return staleDuringOutage({ json, gameId, incoming });
  }
}

function staleDuringOutage(opts: { json: unknown; gameId: string; incoming: number | undefined }): SyncedIncoming {
  const hw = issuedHighWater(opts.gameId);
  if (hw !== undefined && opts.incoming !== undefined && opts.incoming < hw) {
    return { json: opts.json, cabinetOffline: true, rejectStale: true, notice: CABINET_AHEAD_NOTICE };
  }
  return { json: opts.json, cabinetOffline: true };
}

/** Attach a sync notice and fire-and-forget persist (skips offline tokens). */
export function finishSavedAction<B extends { stateToken?: string; notice?: string }>(
  status: number,
  body: B,
  notice: string | undefined,
  caseId: string,
  request: Request,
  env?: Env,
): B {
  if (notice && !body.notice) body.notice = notice;
  schedulePersist(status, body, caseId, request, env);
  return body;
}

/**
 * Persist the issued token. Errors are logged and swallowed (play must not break). Skips oversized tokens and
 * rate-limited requests. Prunes rows older than ~30 days after a successful write.
 */
export async function persistSavedGame(
  opts: {
    stateToken?: string;
    caseId: string;
    headers?: Headers;
    env?: Env;
    repo?: SavedGamesRepo | null;
    kv?: KvStore;
  },
): Promise<void> {
  const token = opts.stateToken;
  if (!token || token.length > SAVE_TOKEN_MAX_CHARS) return;
  if (opts.headers && !(await allowSavePath(opts.headers, opts.kv))) return;
  const gameId = peekStateTokenGameId(token, opts.env);
  const version = peekStateTokenSaveVersion(token, opts.env);
  if (!isGameId(gameId) || version === undefined) return;
  // Never write an offline-lineage token into the cabinet, even if its version is higher (#94).
  if (peekStateTokenOffline(token, opts.env) === true) return;
  const repo = opts.repo === undefined ? savedGamesRepo() : opts.repo;
  if (!repo) return;
  try {
    await repo.upsertSave({ gameId, caseId: canonicalCaseId(opts.caseId), stateToken: token, version });
    noteIssuedVersion(gameId, version);
    await repo.pruneSaves();
  } catch {
    /* already logged by the repo; the in-hand token stays authoritative in play */
  }
}

/** Fire-and-forget persist for a successful (or 409 replay) response that carries a token; never 5xx. */
export function schedulePersist(
  status: number,
  body: { stateToken?: string },
  caseId: string,
  request: Request,
  env?: Env,
): void {
  if (status >= 500 || !body.stateToken) return;
  void persistSavedGame({ stateToken: body.stateToken, caseId, headers: request.headers, env });
}
