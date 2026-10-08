/**
 * GET /api/health: a non-secret liveness probe that never touches the model.
 * `runtimeCache` says whether the cost limits and the accusation record (docs/OPERATIONS.md) are shared across
 * instances ("vercel") or only per instance ("memory").
 */
import { NextResponse } from "next/server";
import { runtimeCacheBackend } from "@/lib/runtime-kv";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, runtimeCache: runtimeCacheBackend() }, { headers: { "cache-control": "no-store" } });
}
