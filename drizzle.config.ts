/**
 * drizzle-kit config. `npx drizzle-kit generate` writes SQL migrations to drizzle/ from db/schema.ts (no database
 * needed). Apply them with `npm run db:migrate` (scripts/db-migrate.ts), never with `drizzle-kit push`.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
