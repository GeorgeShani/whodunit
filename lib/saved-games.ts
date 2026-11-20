/**
 * SERVER-ONLY. In-progress game saves (`saved_games`): the latest HMAC-signed state token for a server-minted game id.
 *
 *   commitSave(): the ONLY production write, an atomic compare-and-swap against the stored row (#95):
 *                 UPDATE ... WHERE game_id = $1 AND version = $base AND state_token = $baseToken
 *                   AND (write window expired OR write_window_count < limit)          (per-game throttle, #102)
 *                 or, when the action did not start from a stored row, INSERT ... ON CONFLICT DO NOTHING.
 *                 It returns "written", "conflict" (the row moved on or diverged: the caller hands that row back)
 *                 or "throttled" (the row is unchanged but this game is writing too fast).
 *   getSave(): the row, or null.
 *   pruneSaves(): delete rows whose updated_at is older than SAVE_MAX_AGE_MS (~30 days).
 *
 * There is no last-write-wins upsert any more: a request can only replace the exact token it started from, so two
 * tabs from the same base can never both land, and a losing branch can never overwrite the winner later.
 *
 * Failures must never break play: callers catch and downgrade the issued token to offline lineage (#94).
 *
 * Only state-changing API routes, /api/save and /api/resume import this file. The URL is never logged.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { savedGames } from "@/db/schema";
import { STATE_LIMITS, STATE_TOKEN_MAX_AGE_MS } from "@/engine/state-token";
import { classifyDbError, diagnoseDatabaseUrl } from "./db-diagnostic";
import { SimulatedOutageError, simulatedDbOutage } from "./test-outage";

/** ONE structured server log line per failure: non-secret fields only (never the URL, user, password or message). */
function logSaveFailure(source: "save" | "resume", e: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.DATABASE_URL;
  const shape = raw?.trim() ? diagnoseDatabaseUrl(raw) : {};
  console.error(`[db] ${JSON.stringify({ event: "db_unreachable", source, ...shape, errorClass: classifyDbError(e) })}`);
}

/** Row retention, and the token max age: 30 days. */
export const SAVE_MAX_AGE_MS = STATE_TOKEN_MAX_AGE_MS;
/** Refuse to store a token larger than the signed-token cap (it would not decode anyway). */
export const SAVE_TOKEN_MAX_CHARS = STATE_LIMITS.tokenChars;

export interface SavedGameRecord {
  gameId: string;
  caseId: string;
  stateToken: string;
  version: number;
  updatedAt: Date;
}

/** Per-game write throttle (#102): at most this many writes per window, counted in the row. */
export const SAVE_WRITES_PER_WINDOW = 60;
export const SAVE_WRITE_WINDOW_S = 60;

export interface CommitSaveInput {
  gameId: string;
  caseId: string;
  stateToken: string;
  version: number;
  /**
   * The stored token this write was derived from. Present: the write only lands if the row still holds exactly
   * this token at this version. Absent: the write only lands if there is no row yet.
   */
  expected?: { version: number; stateToken: string };
}

export type CommitSaveResult =
  | { status: "written"; record: SavedGameRecord }
  | { status: "conflict"; record: SavedGameRecord | null }
  | { status: "throttled"; record: SavedGameRecord };

export interface SavedGamesRepo {
  getSave(gameId: string): Promise<SavedGameRecord | null>;
  commitSave(input: CommitSaveInput): Promise<CommitSaveResult>;
  pruneSaves(olderThanMs?: number): Promise<number>;
}

/** Classify a write that matched no row, from the row as it is now. Shared by both implementations. */
export function classifyMissedWrite(input: CommitSaveInput, row: SavedGameRecord | null): CommitSaveResult {
  if (row && row.stateToken === input.stateToken) return { status: "written", record: row }; // idempotent replay
  if (row && input.expected && row.version === input.expected.version && row.stateToken === input.expected.stateToken) {
    return { status: "throttled", record: row };
  }
  return { status: "conflict", record: row };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDb = PgDatabase<PgQueryResultHKT, any, any>;

const toRecord = (r: typeof savedGames.$inferSelect): SavedGameRecord => ({
  gameId: r.gameId,
  caseId: r.caseId,
  stateToken: r.stateToken,
  version: r.version,
  updatedAt: r.updatedAt,
});

export function postgresSavedGames(db: AnyPgDb, onError?: (e: unknown) => void): SavedGamesRepo {
  const inner = postgresSavedGamesRaw(db);
  if (!onError) return inner;
  const watch = <T>(p: Promise<T>) =>
    p.catch((e: unknown) => {
      onError(e);
      throw e;
    });
  return {
    getSave: (id) => watch(inner.getSave(id)),
    commitSave: (input) => watch(inner.commitSave(input)),
    pruneSaves: (ms) => watch(inner.pruneSaves(ms)),
  };
}

function postgresSavedGamesRaw(db: AnyPgDb): SavedGamesRepo {
  const getSave = async (gameId: string) => {
    const rows = await db.select().from(savedGames).where(eq(savedGames.gameId, gameId)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  };
  return {
    getSave,
    async commitSave(input) {
      const windowExpired = sql`${savedGames.writeWindowStart} < now() - ${sql.raw(`interval '${SAVE_WRITE_WINDOW_S} seconds'`)}`;
      if (input.expected && input.version > input.expected.version) {
        // One statement: the row lock serialises concurrent writers, and the loser matches zero rows.
        const updated = await db
          .update(savedGames)
          .set({
            caseId: input.caseId,
            stateToken: input.stateToken,
            version: input.version,
            updatedAt: sql`now()`,
            writeWindowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${savedGames.writeWindowStart} END`,
            writeWindowCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${savedGames.writeWindowCount} + 1 END`,
          })
          .where(
            and(
              eq(savedGames.gameId, input.gameId),
              eq(savedGames.version, input.expected.version),
              eq(savedGames.stateToken, input.expected.stateToken),
              sql`(${windowExpired} OR ${savedGames.writeWindowCount} < ${sql.raw(String(SAVE_WRITES_PER_WINDOW))})`,
            ),
          )
          .returning();
        if (updated[0]) return { status: "written", record: toRecord(updated[0]) };
      }
      // No stored base (a new game, or a row that was pruned): only a missing row can be created.
      const inserted = await db
        .insert(savedGames)
        .values({ gameId: input.gameId, caseId: input.caseId, stateToken: input.stateToken, version: input.version, writeWindowCount: 1 })
        .onConflictDoNothing({ target: savedGames.gameId })
        .returning();
      if (inserted[0]) return { status: "written", record: toRecord(inserted[0]) };
      return classifyMissedWrite(input, await getSave(input.gameId));
    },
    async pruneSaves(olderThanMs = SAVE_MAX_AGE_MS) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const gone = await db.delete(savedGames).where(lt(savedGames.updatedAt, cutoff)).returning({ gameId: savedGames.gameId });
      return gone.length;
    },
  };
}

/**
 * In-memory implementation (tests): the same compare-and-swap and throttle contract as Postgres. `upsertSave` is a
 * test-only seeding helper; production code has no unconditional write.
 */
export function memorySavedGames(
  now: () => number = Date.now,
): SavedGamesRepo & {
  rows: Map<string, SavedGameRecord>;
  windows: Map<string, { start: number; count: number }>;
  upsertSave(input: Omit<CommitSaveInput, "expected">): Promise<{ written: boolean; record: SavedGameRecord | null }>;
} {
  const rows = new Map<string, SavedGameRecord>();
  const windows = new Map<string, { start: number; count: number }>();
  return {
    rows,
    windows,
    async getSave(gameId) {
      return rows.get(gameId) ?? null;
    },
    async upsertSave(input) {
      const existing = rows.get(input.gameId);
      if (existing && existing.version >= input.version) return { written: false, record: existing };
      const record: SavedGameRecord = { ...input, updatedAt: new Date(now()) };
      rows.set(input.gameId, record);
      return { written: true, record };
    },
    async commitSave(input) {
      // Synchronous between the read and the write, so it is atomic on the JS event loop.
      const row = rows.get(input.gameId) ?? null;
      const record: SavedGameRecord = { gameId: input.gameId, caseId: input.caseId, stateToken: input.stateToken, version: input.version, updatedAt: new Date(now()) };
      const exp = input.expected;
      if (row && exp && input.version > exp.version && row.version === exp.version && row.stateToken === exp.stateToken) {
        const w = windows.get(input.gameId) ?? { start: 0, count: 0 };
        const expired = w.start < now() - SAVE_WRITE_WINDOW_S * 1000;
        if (!expired && w.count >= SAVE_WRITES_PER_WINDOW) return { status: "throttled", record: row };
        windows.set(input.gameId, expired ? { start: now(), count: 1 } : { start: w.start, count: w.count + 1 });
        rows.set(input.gameId, record);
        return { status: "written", record };
      }
      if (!row) {
        rows.set(input.gameId, record);
        windows.set(input.gameId, { start: now(), count: 1 });
        return { status: "written", record };
      }
      return classifyMissedWrite(input, row);
    },
    async pruneSaves(olderThanMs = SAVE_MAX_AGE_MS) {
      const cutoff = now() - olderThanMs;
      let n = 0;
      for (const [id, r] of rows) {
        if (r.updatedAt.getTime() < cutoff) {
          rows.delete(id);
          windows.delete(id);
          n++;
        }
      }
      return n;
    },
  };
}

let repo: { db: unknown; repo: SavedGamesRepo } | null = null;

/**
 * The production repository, or null when DATABASE_URL is unset (saves are skipped; play continues on the client token).
 * An unparseable URL is treated like a down database (every call rejects, the caller logs and carries on).
 */
export function savedGamesRepo(env: NodeJS.ProcessEnv = process.env): SavedGamesRepo | null {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb(env);
  } catch (e) {
    logSaveFailure("save", e, env);
    const reject = () => Promise.reject(e);
    return { getSave: reject, commitSave: reject, pruneSaves: reject };
  }
  if (!db) return null;
  if (repo?.db !== db) repo = { db, repo: postgresSavedGames(db as unknown as AnyPgDb, (e) => logSaveFailure("save", e, env)) };
  return repo.repo;
}

/** A repo whose every call rejects (the preview-only outage switch, lib/test-outage.ts). */
export function downSavedGames(): SavedGamesRepo {
  const reject = () => Promise.reject(new SimulatedOutageError());
  return { getSave: reject, commitSave: reject, pruneSaves: reject };
}

/** savedGamesRepo() for one request: honours the preview-only outage switch, otherwise the real repo. */
export function savedGamesRepoFor(headers: Headers | undefined | null, env: NodeJS.ProcessEnv = process.env): SavedGamesRepo | null {
  return simulatedDbOutage(headers, env) ? downSavedGames() : savedGamesRepo(env);
}

/** Test hook: drop the cached repo (so tests can swap env). */
export function resetSavedGamesRepo(): void {
  repo = null;
}
