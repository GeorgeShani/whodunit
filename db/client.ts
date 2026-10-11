/**
 * SERVER-ONLY. Lazy Postgres client for the closed-games record (#39).
 *
 * Built from `process.env.DATABASE_URL` on first use, once per process (serverless instance). Expected: the Supabase
 * TRANSACTION pooler URI (port 6543), which hands out a connection per transaction, so:
 *   - `prepare: false`: the transaction pooler cannot keep prepared statements across transactions;
 *   - `max: 1`: one connection per instance (the pooler multiplexes; serverless instances are many);
 *   - `connect_timeout: 5`, `idle_timeout: 10`: fail fast, and let an idle instance drop its connection.
 * The URL is never logged; connection errors are reported by name only.
 *
 * Only the accuse route and /api/health import this file. Interrogate, confront, investigate and hints never do
 * (tests/lib/closed-games-isolation.test.ts).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { normalizeDatabaseUrl } from "@/lib/db-diagnostic";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let cached: { url: string; db: Db; sql: postgres.Sql } | null = null;

/** True when DATABASE_URL is set (non-empty after trimming and stripping one pair of quotes). */
export function dbConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeDatabaseUrl(env.DATABASE_URL));
}

/** A DATABASE_URL the driver could not even parse. Carries a code only: never the URL or the driver's message. */
export class DbConfigError extends Error {
  readonly code = "URL_PARSE_ERROR";
  constructor() {
    super("DATABASE_URL could not be parsed");
    this.name = "DbConfigError";
  }
}

/**
 * The shared Drizzle client, or null when DATABASE_URL is unset. The value is trimmed and one pair of matching
 * surrounding quotes stripped first (a common paste mistake). Throws DbConfigError (no details) if the driver
 * can't parse it; connection errors only surface on the first query.
 */
export function getDb(env: NodeJS.ProcessEnv = process.env): Db | null {
  const url = normalizeDatabaseUrl(env.DATABASE_URL);
  if (!url) return null;
  if (cached?.url === url) return cached.db;
  let client: postgres.Sql;
  try {
    client = postgres(url, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 10, onnotice: () => {} });
  } catch {
    throw new DbConfigError();
  }
  cached = { url, db: drizzle(client, { schema }), sql: client };
  return cached.db;
}

/** Close the shared client (scripts and tests). */
export async function closeDb(): Promise<void> {
  const c = cached;
  cached = null;
  if (c) await c.sql.end({ timeout: 5 });
}
