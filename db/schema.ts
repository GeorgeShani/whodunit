/**
 * SERVER-ONLY. Postgres schema (Supabase), managed with Drizzle (#39).
 *
 * One table: the permanent record that a game has been accused. The game id is the signed state token's random id
 * (engine/state-token.ts), so a row says nothing about who played: no IP, no account, no personal data.
 * Migrations are generated into drizzle/ (`npx drizzle-kit generate`) and applied with `npm run db:migrate`.
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const closedGames = pgTable(
  "closed_games",
  {
    gameId: text("game_id").primaryKey(),
    caseId: text("case_id").notNull(),
    outcome: text("outcome", { enum: ["won", "lost"] }).notNull(),
    accusedId: text("accused_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [check("closed_games_outcome_check", sql`${t.outcome} in ('won', 'lost')`)],
  // Row Level Security on, with NO policies: Supabase's Data API (anon/authenticated keys) can't touch the table;
  // the server connects as postgres, which bypasses RLS.
).enableRLS();

export type ClosedGameRow = typeof closedGames.$inferSelect;
