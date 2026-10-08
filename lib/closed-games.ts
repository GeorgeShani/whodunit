/**
 * SERVER-ONLY. The closed-games repository (#39): Postgres is the source of truth for "this game has been accused".
 *
 *   closeGame(): INSERT ... ON CONFLICT (game_id) DO NOTHING RETURNING *; if nothing came back the game was already
 *                closed, so the existing row is selected and returned with `inserted: false`. Exactly one request per
 *                game id ever gets `inserted: true`, however many race.
 *   getClosed(): the row, or null.
 *
 * Two implementations: Postgres (Drizzle, any pg driver; production uses postgres-js via db/client.ts) and an
 * in-memory one (tests, and the reference behaviour). `closedGamesRepo()` returns the Postgres one when DATABASE_URL
 * is set, else null (the accuse route then keeps the Runtime Cache-only behaviour and this warns once per process).
 *
 * Only the accuse route and /api/health import this file (tests/lib/closed-games-isolation.test.ts).
 */
import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import { closedGames } from "@/db/schema";

export type ClosedOutcome = "won" | "lost";

export interface ClosedGameRecord {
  gameId: string;
  caseId: string;
  outcome: ClosedOutcome;
  accusedId: string | null;
  closedAt: Date | null;
}

export interface CloseGameInput {
  gameId: string;
  caseId: string;
  outcome: ClosedOutcome;
  accusedId: string | null;
}

export interface ClosedGamesRepo {
  closeGame(input: CloseGameInput): Promise<{ inserted: boolean; record: ClosedGameRecord }>;
  getClosed(gameId: string): Promise<ClosedGameRecord | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDb = PgDatabase<PgQueryResultHKT, any, any>;

const toRecord = (r: typeof closedGames.$inferSelect): ClosedGameRecord => ({
  gameId: r.gameId,
  caseId: r.caseId,
  outcome: r.outcome,
  accusedId: r.accusedId ?? null,
  closedAt: r.closedAt ?? null,
});

/** Postgres implementation over any Drizzle pg database (postgres-js in production, node-postgres/pg-mem in tests). */
export function postgresClosedGames(db: AnyPgDb): ClosedGamesRepo {
  const getClosed = async (gameId: string) => {
    const rows = await db.select().from(closedGames).where(eq(closedGames.gameId, gameId)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  };
  return {
    getClosed,
    async closeGame(input) {
      const inserted = await db
        .insert(closedGames)
        .values({ gameId: input.gameId, caseId: input.caseId, outcome: input.outcome, accusedId: input.accusedId })
        .onConflictDoNothing({ target: closedGames.gameId })
        .returning();
      if (inserted[0]) return { inserted: true, record: toRecord(inserted[0]) };
      const existing = await getClosed(input.gameId);
      // A conflict means the row exists; a missing row here would be a concurrent delete (prune): fail, never grade twice.
      if (!existing) throw new Error("closed_game_vanished");
      return { inserted: false, record: existing };
    },
  };
}

/** In-memory implementation (tests; same contract, including first-writer-wins). */
export function memoryClosedGames(): ClosedGamesRepo & { rows: Map<string, ClosedGameRecord> } {
  const rows = new Map<string, ClosedGameRecord>();
  return {
    rows,
    async getClosed(gameId) {
      return rows.get(gameId) ?? null;
    },
    async closeGame(input) {
      const existing = rows.get(input.gameId);
      if (existing) return { inserted: false, record: existing };
      const record: ClosedGameRecord = { ...input, closedAt: new Date() };
      rows.set(input.gameId, record);
      return { inserted: true, record };
    },
  };
}

let warned = false;
let repo: { db: unknown; repo: ClosedGamesRepo } | null = null;

/**
 * The production repository, or null when DATABASE_URL is unset (then: one warning per process, and the accuse route
 * keeps today's Runtime Cache-only record, so deploying before the env var exists cannot break accusations).
 */
export function closedGamesRepo(env: NodeJS.ProcessEnv = process.env, log: (msg: string) => void = console.warn): ClosedGamesRepo | null {
  const db = getDb(env);
  if (!db) {
    if (!warned) {
      warned = true;
      log("[closed-games] DATABASE_URL is not set: the one-accusation-per-game record uses the Runtime Cache only (best effort, #39).");
    }
    return null;
  }
  if (repo?.db !== db) repo = { db, repo: postgresClosedGames(db as unknown as AnyPgDb) };
  return repo.repo;
}

/** Test hook: forget the once-per-process warning. */
export function resetClosedGamesWarning(): void {
  warned = false;
}

export type DbHealth = "ok" | "unreachable" | "unconfigured";
export const DB_HEALTH_TIMEOUT_MS = 3000;

/**
 * /api/health's database state: "unconfigured" (no DATABASE_URL), "ok" (SELECT 1 answered within the timeout) or
 * "unreachable" (error or timeout). Never throws; never reports why (no URL, host or message leaves the server).
 */
export async function dbHealth(
  opts: { env?: NodeJS.ProcessEnv; ping?: () => Promise<unknown>; timeoutMs?: number } = {},
): Promise<DbHealth> {
  const env = opts.env ?? process.env;
  let ping = opts.ping;
  if (!ping) {
    const db = getDb(env);
    if (!db) return "unconfigured";
    ping = () => db.execute(sql`select 1`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), opts.timeoutMs ?? DB_HEALTH_TIMEOUT_MS);
      }),
    ]);
    return "ok";
  } catch {
    return "unreachable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
