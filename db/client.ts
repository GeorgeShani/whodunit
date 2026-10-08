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
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let cached: { url: string; db: Db; sql: postgres.Sql } | null = null;

/** True when DATABASE_URL is set (non-empty). */
export function dbConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

/** The shared Drizzle client, or null when DATABASE_URL is unset. Never throws for a bad URL until first query. */
export function getDb(env: NodeJS.ProcessEnv = process.env): Db | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  if (cached?.url === url) return cached.db;
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 5, idle_timeout: 10, onnotice: () => {} });
  cached = { url, db: drizzle(client, { schema }), sql: client };
  return cached.db;
}

/** Close the shared client (scripts and tests). */
export async function closeDb(): Promise<void> {
  const c = cached;
  cached = null;
  if (c) await c.sql.end({ timeout: 5 });
}
