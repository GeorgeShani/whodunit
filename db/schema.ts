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
 * `version` is also inside the signed token. Every write is a compare-and-swap against this row (#95): it only lands
 * when the row still holds the exact token (and version) the action started from; otherwise the request is refused and
 * the player gets this row back. RLS on, no policies: same access model as closed_games. Server-only via DATABASE_URL.
 */
export const savedGames = pgTable("saved_games", {
  gameId: text("game_id").primaryKey(),
  caseId: text("case_id").notNull(),
  stateToken: text("state_token").notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Per-game write throttle (#102), enforced inside the same conditional UPDATE as the version check (#95):
   * at most SAVE_WRITES_PER_WINDOW writes per SAVE_WRITE_WINDOW_S seconds, counted in the row itself, so a burst
   * spread across regions still hits one counter.
   */
  writeWindowStart: timestamp("write_window_start", { withTimezone: true }).defaultNow().notNull(),
  writeWindowCount: integer("write_window_count").default(0).notNull(),
}).enableRLS();

export type SavedGameRow = typeof savedGames.$inferSelect;
