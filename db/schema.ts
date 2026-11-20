/**
 * SERVER-ONLY. Postgres schema (Supabase), managed with Drizzle (#39).
 *
 * Two tables: the permanent record that a game has been accused, and the in-progress save (`saved_games`). The game id is the signed state token's random id
 * (engine/state-token.ts), so a row says nothing about who played: no IP, no account, no personal data.
 * Migrations are generated into drizzle/ (`npx drizzle-kit generate`) and applied with `npm run db:migrate`.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const closedGames = pgTable(
  "closed_games",
  {
    gameId: text("game_id").primaryKey(),
    caseId: text("case_id").notNull(),
    outcome: text("outcome", { enum: ["won", "lost"] }).notNull(),
    accusedId: text("accused_id"),
    /** G1: the helper the player named (null: "no one helped", and every row from before 0001). */
    accompliceId: text("accomplice_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [check("closed_games_outcome_check", sql`${t.outcome} in ('won', 'lost')`)],
  // Row Level Security on, with NO policies: Supabase's Data API (anon/authenticated keys) can't touch the table;
  // the server connects as postgres, which bypasses RLS.
).enableRLS();

export type ClosedGameRow = typeof closedGames.$inferSelect;

/**
 * In-progress (and recently closed) games: the latest HMAC-signed state token, keyed by the server-minted game id.
 * `version` is also inside the signed token; the server refuses any token whose version is lower than this row's
 * (optimistic last-write-wins, #40). RLS on, no policies: same access model as closed_games. Server-only via DATABASE_URL.
 */
export const savedGames = pgTable("saved_games", {
  gameId: text("game_id").primaryKey(),
  caseId: text("case_id").notNull(),
  stateToken: text("state_token").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export type SavedGameRow = typeof savedGames.$inferSelect;
