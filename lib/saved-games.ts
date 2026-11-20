/**
 * SERVER-ONLY. In-progress game saves (`saved_games`): the latest HMAC-signed state token for a server-minted game id.
 *
 *   upsertSave(): INSERT ... ON CONFLICT (game_id) DO UPDATE SET ... WHERE saved_games.version < EXCLUDED.version
 *                 (optimistic last-write-wins). A lost race returns `written: false` and is not a gameplay error.
 *   getSave(): the row, or null.
 *   pruneSaves(): delete rows whose updated_at is older than SAVE_MAX_AGE_MS (~30 days).
 *
 * Failures must never break play: callers log and carry on; the in-hand token stays the source of truth until the
 * DB is back, at which point the newest version it holds wins.
 *
 * Only state-changing API routes and /api/resume import this file. The URL is never logged.
 */
import { eq, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { savedGames } from "@/db/schema";
import { STATE_LIMITS, STATE_TOKEN_MAX_AGE_MS } from "@/engine/state-token";
import { classifyDbError, diagnoseDatabaseUrl } from "./db-diagnostic";

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

export interface UpsertSaveInput {
  gameId: string;
  caseId: string;
  stateToken: string;
  version: number;
}

export interface SavedGamesRepo {
  getSave(gameId: string): Promise<SavedGameRecord | null>;
  upsertSave(input: UpsertSaveInput): Promise<{ written: boolean; record: SavedGameRecord | null }>;
  pruneSaves(olderThanMs?: number): Promise<number>;
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
    upsertSave: (input) => watch(inner.upsertSave(input)),
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
    async upsertSave(input) {
      const inserted = await db
        .insert(savedGames)
        .values({
          gameId: input.gameId,
          caseId: input.caseId,
          stateToken: input.stateToken,
          version: input.version,
        })
        .onConflictDoUpdate({
          target: savedGames.gameId,
          set: {
            caseId: input.caseId,
            stateToken: input.stateToken,
            version: input.version,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${savedGames.version} < ${input.version}`,
        })
        .returning();
      if (inserted[0]) return { written: true, record: toRecord(inserted[0]) };
      return { written: false, record: await getSave(input.gameId) };
    },
    async pruneSaves(olderThanMs = SAVE_MAX_AGE_MS) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const gone = await db.delete(savedGames).where(lt(savedGames.updatedAt, cutoff)).returning({ gameId: savedGames.gameId });
      return gone.length;
    },
  };
}

/** In-memory implementation (tests; same last-write-wins contract). */
export function memorySavedGames(): SavedGamesRepo & { rows: Map<string, SavedGameRecord> } {
  const rows = new Map<string, SavedGameRecord>();
  return {
    rows,
    async getSave(gameId) {
      return rows.get(gameId) ?? null;
    },
    async upsertSave(input) {
      const existing = rows.get(input.gameId);
      if (existing && existing.version >= input.version) return { written: false, record: existing };
      const record: SavedGameRecord = { ...input, updatedAt: new Date() };
      rows.set(input.gameId, record);
      return { written: true, record };
    },
    async pruneSaves(olderThanMs = SAVE_MAX_AGE_MS) {
      const cutoff = Date.now() - olderThanMs;
      let n = 0;
      for (const [id, r] of rows) {
        if (r.updatedAt.getTime() < cutoff) {
          rows.delete(id);
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
    return { getSave: reject, upsertSave: reject, pruneSaves: reject };
  }
  if (!db) return null;
  if (repo?.db !== db) repo = { db, repo: postgresSavedGames(db as unknown as AnyPgDb, (e) => logSaveFailure("save", e, env)) };
  return repo.repo;
}

/** Test hook: drop the cached repo (so tests can swap env). */
export function resetSavedGamesRepo(): void {
  repo = null;
}
