/**
 * SERVER-ONLY. Glue between the signed token and saved_games.
 *
 *   syncIncomingToken(): before an action, put the stored row in the player's hand whenever their token is older
 *                        than, or diverged from, the row (STALE_TOKEN_NOTICE, #40/#96).
 *   commitSavedAction(): after the action, write the new token with ONE compare-and-swap against the row the action
 *                        started from (#95). A lost race is refused (409 stale_token + the winner's row and snapshot),
 *                        never a 200 at N+1, so two tabs can never fork the save. A write that throws downgrades the
 *                        issued token to offline lineage (#94) so it can never overwrite the row later.
 *   persistSavedGame():  the quiet tab-close flush (/api/save): it can only create a missing row, never replace one.
 *   snapshotFromGame():  the public view a resume needs (no solution, no proof list, no sealed lies).
 */
import type { LoadedCase } from "@/engine/case-schema";
import type { ResumeSnapshot } from "@/engine/resume-schema";
export type { ResumeSnapshot } from "@/engine/resume-schema";
import { publicProgress } from "@/engine/progress";
import { toPublicEvidence } from "@/engine/public-view";
import { CABINET_AHEAD_NOTICE, OFFLINE_RESUME_NOTICE, STALE_TOKEN_NOTICE } from "@/engine/session";
import type { GameState } from "@/engine/types";
import { publicTestimonies } from "@/engine/testimony";
import {
  decodeStateToken,
  encodeStateToken,
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
import { SAVE_TOKEN_MAX_CHARS, savedGamesRepo, type SavedGameRecord, type SavedGamesRepo } from "./saved-games";

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

/** In-character line when the save path refuses a request (rate cap, per-game throttle, or the limiter itself failing). */
export const SAVE_BUSY_LINE = "Easy, detective — the cabinet needs a moment. Try again shortly.";

/**
 * Best-effort per-IP cap on the save/resume path. Fails CLOSED: if the limiter itself errors, the request is refused
 * (quietly, in character) rather than let through. The counter is per region (#102); the per-game throttle inside
 * the conditional UPDATE (lib/saved-games.ts) is the cross-region backstop.
 */
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
    return false;
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
  /** The save path refused this request (rate cap or limiter error): answer SAVE_BUSY_LINE, run nothing. */
  rateLimited?: boolean;
  /** The repo used for the read (so the write after the action uses the same one, incl. the preview outage switch). */
  repo?: SavedGamesRepo | null;
}

/**
 * Before an action: if the cabinet holds this game and the player's token is not exactly the stored one, the action
 * runs on the stored row instead, with STALE_TOKEN_NOTICE (or OFFLINE_RESUME_NOTICE for an offline leftover, #94).
 * That covers a token that is behind the row (#40) and one that has the same or a higher version but a different
 * lineage (a losing tab, #95/#96). When the cabinet is shut, the client token is left in place so the same tab can
 * keep playing; a best-effort in-memory high-water mark may still reject a lower version on this instance. Never
 * throws. With `headers`, the per-IP save cap is checked first (only when a cabinet is configured).
 */
export async function syncIncomingToken(
  json: unknown,
  caseData: LoadedCase,
  env?: Env,
  repo: SavedGamesRepo | null | undefined = savedGamesRepo(),
  opts: { headers?: Headers; kv?: KvStore } = {},
): Promise<SyncedIncoming> {
  const r = repo ?? null;
  if (r && opts.headers && !(await allowSavePath(opts.headers, opts.kv))) {
    return { json, cabinetOffline: false, rateLimited: true, notice: SAVE_BUSY_LINE, repo: r };
  }
  if (typeof json !== "object" || json === null) return { json, cabinetOffline: r == null, repo: r };
  const body = json as Record<string, unknown>;
  const token = typeof body.stateToken === "string" ? body.stateToken : undefined;
  const decoded = token ? decodeStateToken(token, caseData, env) : null;
  const gameId = (decoded?.ok && decoded.game.gameId) || peekStateTokenGameId(token, env);
  const incoming = decoded?.ok ? (decoded.game.saveVersion ?? 0) : peekStateTokenSaveVersion(token, env);
  const incomingOffline = decoded?.ok ? decoded.game.offline === true : peekStateTokenOffline(token, env) === true;

  if (!isGameId(gameId)) return { json, cabinetOffline: r == null, repo: r };

  if (!r) {
    return { ...staleDuringOutage({ json, gameId, incoming }), repo: r };
  }
  try {
    const row = await r.getSave(gameId);
    if (row && caseIdsMatch(row.caseId, caseData.id)) {
      noteIssuedVersion(gameId, row.version);
      if (row.stateToken === token) return { json, cabinetOffline: false, repo: r };
      const stored = decodeStateToken(row.stateToken, caseData, env);
      if (!stored.ok) return { json, cabinetOffline: false, repo: r };
      // Offline leftovers never overwrite or continue past a real row, regardless of version (#94).
      if (incomingOffline) return { json: { ...body, stateToken: row.stateToken }, notice: OFFLINE_RESUME_NOTICE, cabinetOffline: false, repo: r };
      // Behind, or diverged at any version: the row is the one true lineage (#40, #95, #96).
      if (incoming !== undefined) return { json: { ...body, stateToken: row.stateToken }, notice: STALE_TOKEN_NOTICE, cabinetOffline: false, repo: r };
    }
    return { json, cabinetOffline: false, repo: r };
  } catch {
    return { ...staleDuringOutage({ json, gameId, incoming }), repo: r };
  }
}

function staleDuringOutage(opts: { json: unknown; gameId: string; incoming: number | undefined }): SyncedIncoming {
  const hw = issuedHighWater(opts.gameId);
  if (hw !== undefined && opts.incoming !== undefined && opts.incoming < hw) {
    return { json: opts.json, cabinetOffline: true, rejectStale: true, notice: CABINET_AHEAD_NOTICE };
  }
  return { json: opts.json, cabinetOffline: true };
}

/** The refusal a losing tab gets instead of a 200 at N+1 (#95): the winner's row, its snapshot and the notice. */
export interface StaleCommit {
  error: "stale_token";
  notice: string;
  line: string;
  stateToken: string;
  gameId: string;
  saveVersion: number;
  snapshot: ResumeSnapshot;
}

export type CommitOutcome =
  | { kind: "ok" }
  /** Lost the compare-and-swap: answer 409 with this body (merged into the route's own error shape). */
  | { kind: "stale"; stale: StaleCommit }
  /** The per-game throttle refused the write: answer 429 SAVE_BUSY_LINE, keep the player's current token. */
  | { kind: "throttled" };

function staleFromRow(caseData: LoadedCase, row: SavedGameRecord, env?: Env): StaleCommit | null {
  const d = decodeStateToken(row.stateToken, caseData, env);
  if (!d.ok) return null;
  return {
    error: "stale_token",
    notice: STALE_TOKEN_NOTICE,
    line: STALE_TOKEN_NOTICE,
    stateToken: row.stateToken,
    gameId: row.gameId,
    saveVersion: row.version,
    snapshot: snapshotFromGame(caseData, d.game),
  };
}

/** Re-sign an issued token as offline lineage (#94): it keeps this tab playing but can never be written. */
function downgradeToOffline<B extends { stateToken?: string; offline?: boolean }>(body: B, caseData: LoadedCase, env?: Env): void {
  if (!body.stateToken) return;
  const d = decodeStateToken(body.stateToken, caseData, env);
  if (!d.ok) return;
  const game: GameState = { ...d.game, offline: true };
  body.stateToken = encodeStateToken(game, env);
  body.offline = true;
}

/**
 * After an action: attach the sync notice and write the issued token with one compare-and-swap against the token the
 * action started from (`synced.json.stateToken`). Awaited before the response, so a lost race is never a 200.
 * Never throws: a failing write downgrades the issued token to offline lineage instead.
 */
export async function commitSavedAction<B extends { stateToken?: string; notice?: string; offline?: boolean }>(
  status: number,
  body: B,
  synced: SyncedIncoming,
  caseData: LoadedCase,
  env?: Env,
): Promise<CommitOutcome> {
  if (synced.notice && !body.notice) body.notice = synced.notice;
  const token = body.stateToken;
  if (status >= 500 || !token) return { kind: "ok" };
  const baseToken = typeof (synced.json as { stateToken?: unknown } | null)?.stateToken === "string" ? ((synced.json as { stateToken: string }).stateToken) : undefined;
  if (token === baseToken) return { kind: "ok" }; // nothing new was minted
  if (synced.cabinetOffline || token.length > SAVE_TOKEN_MAX_CHARS) return { kind: "ok" };
  if (peekStateTokenOffline(token, env) === true) return { kind: "ok" };
  const repo = synced.repo === undefined ? savedGamesRepo() : synced.repo;
  if (!repo) return { kind: "ok" };
  const gameId = peekStateTokenGameId(token, env);
  const version = peekStateTokenSaveVersion(token, env);
  if (!isGameId(gameId) || version === undefined) return { kind: "ok" };
  const baseId = baseToken ? peekStateTokenGameId(baseToken, env) : undefined;
  const baseVersion = baseToken ? peekStateTokenSaveVersion(baseToken, env) : undefined;
  const expected = baseToken && baseId === gameId && baseVersion !== undefined ? { version: baseVersion, stateToken: baseToken } : undefined;
  try {
    const res = await repo.commitSave({ gameId, caseId: canonicalCaseId(caseData.id), stateToken: token, version, ...(expected ? { expected } : {}) });
    if (res.status === "written") {
      noteIssuedVersion(gameId, version);
      void repo.pruneSaves().catch(() => {});
      return { kind: "ok" };
    }
    if (res.status === "throttled") return { kind: "throttled" };
    if (res.record) {
      noteIssuedVersion(gameId, res.record.version);
      const stale = staleFromRow(caseData, res.record, env);
      if (stale) return { kind: "stale", stale };
    }
    // The row vanished or will not decode: never hand out an unstored online token.
    downgradeToOffline(body, caseData, env);
    return { kind: "ok" };
  } catch {
    // Read worked but the write failed (a blip): keep this tab playing, but on offline lineage only (#94).
    downgradeToOffline(body, caseData, env);
    return { kind: "ok" };
  }
}

/**
 * The quiet tab-close flush (/api/save). Every online token is already written by its own action, so this can only
 * create a MISSING row (e.g. one that was pruned); it never replaces a row, so a stale or losing tab's beacon cannot
 * roll anything back (#95). Offline-lineage, oversized and rate-limited flushes are skipped. Never throws; the
 * result is for tests only (the route always answers 204).
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
): Promise<"written" | "skipped" | "refused"> {
  const token = opts.stateToken;
  if (!token || token.length > SAVE_TOKEN_MAX_CHARS) return "skipped";
  const repo = opts.repo === undefined ? savedGamesRepo() : opts.repo;
  if (!repo) return "skipped";
  if (opts.headers && !(await allowSavePath(opts.headers, opts.kv))) return "refused";
  const gameId = peekStateTokenGameId(token, opts.env);
  const version = peekStateTokenSaveVersion(token, opts.env);
  if (!isGameId(gameId) || version === undefined) return "skipped";
  // Never write an offline-lineage token into the cabinet, even if its version is higher (#94).
  if (peekStateTokenOffline(token, opts.env) === true) return "skipped";
  try {
    const res = await repo.commitSave({ gameId, caseId: canonicalCaseId(opts.caseId), stateToken: token, version });
    if (res.status !== "written") return "refused";
    noteIssuedVersion(gameId, version);
    void repo.pruneSaves().catch(() => {});
    return "written";
  } catch {
    return "skipped";
  }
}
