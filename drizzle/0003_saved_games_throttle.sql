-- Per-game write throttle for saved_games (#102), checked inside the same conditional UPDATE as the
-- compare-and-swap (#95). Made idempotent by hand (IF NOT EXISTS) like 0002, so it is safe to apply manually
-- (Supabase SQL editor / apply_migration) AND to have `npm run db:migrate` apply it again afterwards.
-- Additive with defaults: code from before this migration keeps working against the new columns.
-- MUST be applied to production at merge time, before the new code serves traffic.
ALTER TABLE "saved_games" ADD COLUMN IF NOT EXISTS "write_window_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_games" ADD COLUMN IF NOT EXISTS "write_window_count" integer DEFAULT 0 NOT NULL;
