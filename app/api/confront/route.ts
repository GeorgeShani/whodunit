/**
 * POST /api/confront: one bounded confrontation exchange (see ai/confront-handler.ts).
 * Request:  { caseId?, characterIds: [addressed, partner], question, stateToken? }
 * Response: { lines: [addressed, partner], confrontation: { turnsUsed, max, over }, stateToken, testimonies }
 */
import { NextResponse } from "next/server";
import { handleConfront } from "@/ai/confront-handler";
import type { ConfrontResponseBody } from "@/ai/confront-schema";
import { clientIp, createModelGate } from "@/ai/model-gate";
import { resolveRequestCase } from "@/lib/request-case";
import { runWithSaveContext } from "@/lib/save-context";
import { commitSavedAction, SAVE_BUSY_LINE, syncIncomingToken } from "@/lib/saved-session";
import { savedGamesRepoFor } from "@/lib/saved-games";
import { runtimeKv } from "@/lib/runtime-kv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json<ConfrontResponseBody>({ lines: [], error }, { status });

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  try {
    const rc = await resolveRequestCase(json);
    if (!rc.ok) return fail(404, rc.error);
    const synced = await syncIncomingToken(json, rc.caseData, undefined, savedGamesRepoFor(request.headers), { headers: request.headers });
    if (synced.rateLimited) {
      // Fail closed and in character: nothing runs, the player's token is untouched (#102).
      return NextResponse.json<ConfrontResponseBody>({ lines: [], error: "rate_limited", line: SAVE_BUSY_LINE }, { status: 429, headers: { "retry-after": "5" } });
    }
    if (synced.rejectStale) {
      return NextResponse.json<ConfrontResponseBody>(
        { lines: [], error: "stale_token", line: synced.notice, notice: synced.notice },
        { status: 409 },
      );
    }
    const { status, body } = await runWithSaveContext(synced.cabinetOffline, () =>
      handleConfront(synced.json, {
        caseData: rc.caseData,
        legacyCaseId: rc.legacyCaseId,
        gate: createModelGate({ kv: runtimeKv, ip: clientIp(request.headers) }),
        claims: runtimeKv,
      }),
    );
    const c = await commitSavedAction(status, body, synced, rc.caseData);
    if (c.kind === "stale") {
      // Lost the compare-and-swap (#95): never a 200 at N+1. Hand back the winner's row, its snapshot and the notice.
      return NextResponse.json<ConfrontResponseBody>({ lines: [], ...c.stale }, { status: 409 });
    }
    if (c.kind === "throttled") {
      return NextResponse.json<ConfrontResponseBody>({ lines: [], error: "rate_limited", line: SAVE_BUSY_LINE }, { status: 429, headers: { "retry-after": "5" } });
    }
    const retryAfter = body.unavailable?.retryAfter;
    return NextResponse.json<ConfrontResponseBody>(body, { status, ...(retryAfter ? { headers: { "retry-after": String(retryAfter) } } : {}) });
  } catch (e) {
    console.error("[confront] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
