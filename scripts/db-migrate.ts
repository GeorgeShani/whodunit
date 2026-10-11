/**
 * `npm run db:migrate`: apply the committed SQL migrations in drizzle/ to DATABASE_URL (#39).
 *
 * Uses drizzle-orm's postgres-js migrator: applied migrations are recorded in drizzle.__drizzle_migrations, so a
 * re-run only applies what is new. The migration SQL itself is idempotent (CREATE TABLE IF NOT EXISTS; enabling RLS
 * twice is a no-op), so if the SQL was applied by hand first (Supabase SQL editor / connector), which leaves no
 * journal record, this re-applies it harmlessly and records it. The URL is never printed.
 */
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { classifyDbError, diagnoseDatabaseUrl, normalizeDatabaseUrl } from "../lib/db-diagnostic";

async function main(): Promise<number> {
  // Same env files as `next dev` (.env.local etc.); an already-exported DATABASE_URL wins. Values are never printed.
  loadEnvConfig(process.cwd(), false, { info: () => {}, error: (...a: unknown[]) => console.error(...a) });
  const url = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!url) {
    console.error(
      "db:migrate: DATABASE_URL is not set. Set it to the Supabase transaction-pooler URI (port 6543), in .env.local\n" +
        "  or the environment (`DATABASE_URL=... npm run db:migrate`), then run this again. Nothing was changed.",
    );
    return 1;
  }
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    console.log(`db:migrate: up to date (${n} migration${n === 1 ? "" : "s"} recorded).`);
    return 0;
  } catch (e) {
    // The class only (errno / SQLSTATE / fixed label): driver messages can carry the host or user.
    console.error(`db:migrate: failed (${classifyDbError(e)}); URL shape: ${JSON.stringify(diagnoseDatabaseUrl(process.env.DATABASE_URL ?? ""))}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
