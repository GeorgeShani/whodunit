/**
 * #39: the closed-games repository against the in-memory fake and against PGlite (real Postgres compiled to WASM,
 * in-process) running the committed migration SQL, plus the migration itself (RLS, idempotent re-apply).
 *
 * Why PGlite and not pg-mem: pg-mem fought this schema. Its `INSERT ... ON CONFLICT DO NOTHING RETURNING` returns the
 * EXISTING row (real Postgres returns nothing), which would make every duplicate look like a fresh insert; it can't
 * parse `ENABLE ROW LEVEL SECURITY`; and it rejects re-running `CREATE TABLE IF NOT EXISTS` with a constraint.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { memoryClosedGames, postgresClosedGames, type ClosedGamesRepo } from "@/lib/closed-games";

const MIGRATION = "drizzle/0000_closed_games.sql";
const migrationSql = readFileSync(MIGRATION, "utf8");
/** PGlite boots a WASM Postgres per instance: give those tests room. */
const SLOW = { timeout: 60_000 };

const contract = (name: string, make: () => ClosedGamesRepo | Promise<ClosedGamesRepo>) =>
  describe(`closed-games repository contract: ${name}`, SLOW, () => {
    it("the first close inserts; later closes return the stored record untouched", async () => {
      const repo = await make();
      expect(await repo.getClosed("game-aaaa")).toBeNull();
      const first = await repo.closeGame({ gameId: "game-aaaa", caseId: "case-x", outcome: "won", accusedId: "suspect-1" });
      expect(first.inserted).toBe(true);
      expect(first.record).toMatchObject({ gameId: "game-aaaa", caseId: "case-x", outcome: "won", accusedId: "suspect-1" });
      expect(first.record.closedAt).toBeInstanceOf(Date);
      const again = await repo.closeGame({ gameId: "game-aaaa", caseId: "case-x", outcome: "lost", accusedId: "suspect-2" });
      expect(again.inserted).toBe(false);
      expect(again.record).toMatchObject({ outcome: "won", accusedId: "suspect-1" });
      expect(await repo.getClosed("game-aaaa")).toMatchObject({ outcome: "won", accusedId: "suspect-1" });
    });
    it("concurrent closes of one game: exactly one insert, everyone sees the same record", async () => {
      const repo = await make();
      const rs = await Promise.all(
        (["won", "lost", "lost", "won", "lost"] as const).map((outcome, i) => repo.closeGame({ gameId: "game-race", caseId: "case-x", outcome, accusedId: `s${i}` })),
      );
      expect(rs.filter((r) => r.inserted)).toHaveLength(1);
      const winner = rs.find((r) => r.inserted)!.record;
      for (const r of rs) expect(r.record).toMatchObject({ outcome: winner.outcome, accusedId: winner.accusedId });
    });
    it("a null accused id is allowed; other games are independent", async () => {
      const repo = await make();
      expect((await repo.closeGame({ gameId: "game-b", caseId: "c", outcome: "lost", accusedId: null })).record.accusedId).toBeNull();
      expect((await repo.closeGame({ gameId: "game-c", caseId: "c", outcome: "won", accusedId: "x" })).inserted).toBe(true);
    });
  });

contract("in-memory", () => memoryClosedGames());
contract("PGlite + committed migration SQL", async () => {
  const pg = new PGlite();
  await pg.exec(migrationSql);
  return postgresClosedGames(drizzlePglite(pg) as never);
});

describe("migration SQL", SLOW, () => {
  it("creates closed_games idempotently, with the outcome check and RLS on and NO policies", () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS "closed_games"/);
    expect(migrationSql).toMatch(/ALTER TABLE "closed_games" ENABLE ROW LEVEL SECURITY;/);
    expect(migrationSql).not.toMatch(/CREATE POLICY/i);
    expect(migrationSql).toMatch(/CHECK \("closed_games"\."outcome" in \('won', 'lost'\)\)/);
    // No IP or personal data columns.
    expect(migrationSql).not.toMatch(/\b(ip|email|user|name)\b"/i);
  });
  it("PGlite enforces the outcome check and the NOT NULLs", async () => {
    const pg = new PGlite();
    await pg.exec(migrationSql);
    await expect(pg.query(`insert into closed_games (game_id, case_id, outcome) values ('g', 'c', 'draw')`)).rejects.toThrow(/closed_games_outcome_check/);
    await expect(pg.query(`insert into closed_games (game_id, outcome) values ('g', 'won')`)).rejects.toThrow(/null/);
  });
  it("PGlite: a manual apply, then the drizzle migrator (what `npm run db:migrate` does), then again: all succeed", async () => {
    const pg = new PGlite();
    await pg.exec(migrationSql); // Marvin's manual apply: no journal record
    const db = drizzlePglite(pg);
    await migratePglite(db, { migrationsFolder: "drizzle" }); // re-applies 0000 harmlessly and records it
    await migratePglite(db, { migrationsFolder: "drizzle" }); // nothing new
    const n = await pg.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(n.rows[0].n).toBe(1);
    const t = await pg.query<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls, (select count(*)::int from pg_policies where tablename = 'closed_games') as policies from pg_class c where c.relname = 'closed_games'`,
    );
    expect(t.rows[0]).toEqual({ rls: true, policies: 0 });
  });
  it("PGlite: with RLS and no policies, a Data-API-style role sees no rows and cannot insert, even with table grants", async () => {
    const pg = new PGlite();
    await pg.exec(migrationSql);
    await pg.exec(`insert into closed_games (game_id, case_id, outcome) values ('g1', 'c', 'won');
      create role anon nologin; grant select, insert on closed_games to anon;`);
    await pg.exec(`set role anon`);
    expect((await pg.query(`select * from closed_games`)).rows).toHaveLength(0);
    await expect(pg.query(`insert into closed_games (game_id, case_id, outcome) values ('g2', 'c', 'lost')`)).rejects.toThrow(/row-level security/);
    await pg.exec(`reset role`);
    expect((await pg.query(`select * from closed_games`)).rows).toHaveLength(1);
  });
  it("the Drizzle schema and the committed snapshot agree (drizzle-kit would generate nothing new)", async () => {
    const snap = JSON.parse(readFileSync("drizzle/meta/0000_snapshot.json", "utf8"));
    const t = snap.tables["public.closed_games"];
    expect(Object.keys(t.columns)).toEqual(["game_id", "case_id", "outcome", "accused_id", "closed_at"]);
    expect(t.isRLSEnabled).toBe(true);
  });
});
