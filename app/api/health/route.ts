/**
 * GET /api/health: a non-secret liveness probe that never touches the model.
 * `runtimeCache` says whether the cost limits and the accusation cache record (docs/OPERATIONS.md) are shared across
 * instances ("vercel") or only per instance ("memory").
 * `db` is the closed-games database (#39): "ok" (SELECT 1 answered within ~3 s), "unreachable" (error or timeout:
 * accusations fail closed with a 503 until it's back; e.g. a paused Supabase project) or "unconfigured" (no
 * DATABASE_URL: the cache-only record applies). Always 200: health reports the state, it doesn't fail on it.
 * `dbDiagnostic` (when DATABASE_URL is set): the URL's non-secret shape (host kind, port, user shape, paste-mistake
 * booleans) and the connection error class, see lib/db-diagnostic.ts. Never the URL, user or password.
 * Also the target of the daily keep-awake cron in vercel.json (docs/OPERATIONS.md).
 */
import { NextResponse } from "next/server";
import { dbHealthReport } from "@/lib/closed-games";
import { runtimeCacheBackend } from "@/lib/runtime-kv";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await dbHealthReport();
  return NextResponse.json({ ok: true, runtimeCache: runtimeCacheBackend(), ...report }, { headers: { "cache-control": "no-store" } });
}
