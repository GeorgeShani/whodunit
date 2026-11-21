/**
 * POST /api/investigate: deterministic location search (no model).
 * Request:  { caseId?, locationId, stateToken? }   (same signed token and case resolution as /api/interrogate)
 * Response: { locationId, found: FoundEvidence[], lines, searchedLocationIds, stateToken, notice?, error? }
 */
import { NextResponse } from "next/server";
import { BAD_REQUEST_LINE, handleInvestigate, UNKNOWN_CASE_LINE } from "@/engine/investigate-handler";
import { resolveRequestCase } from "@/lib/request-case";
import { runWithSaveContext } from "@/lib/save-context";
import { commitSavedAction, SAVE_BUSY_LINE, syncIncomingToken } from "@/lib/saved-session";
import { savedGamesRepoFor } from "@/lib/saved-games";
import type { InvestigateResponseBody } from "@/engine/investigate-schema";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) =>
  NextResponse.json<InvestigateResponseBody>({ found: [], lines: [BAD_REQUEST_LINE], searchedLocationIds: [], error }, { status });

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  try {
    const rc = await resolveRequestCase(json);
    if (!rc.ok) {
      return NextResponse.json<InvestigateResponseBody>(
        { found: [], lines: [UNKNOWN_CASE_LINE], searchedLocationIds: [], error: rc.error },
        { status: 404 },
      );
    }
    const synced = await syncIncomingToken(json, rc.caseData, undefined, savedGamesRepoFor(request.headers), { headers: request.headers });
    if (synced.rateLimited) {
      // Fail closed and in character: nothing runs, the player's token is untouched (#102).
      return NextResponse.json<InvestigateResponseBody>({ found: [], lines: [SAVE_BUSY_LINE], searchedLocationIds: [], error: "rate_limited" }, { status: 429, headers: { "retry-after": "5" } });
    }
    if (synced.rejectStale) {
      return NextResponse.json<InvestigateResponseBody>(
        { found: [], lines: [synced.notice ?? ""], searchedLocationIds: [], error: "stale_token", notice: synced.notice },
        { status: 409 },
      );
    }
    const { status, body } = runWithSaveContext(synced.cabinetOffline, () =>
      handleInvestigate(synced.json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId }),
    );
    const c = await commitSavedAction(status, body, synced, rc.caseData);
    if (c.kind === "stale") {
      // Lost the compare-and-swap (#95): never a 200 at N+1. Hand back the winner's row, its snapshot and the notice.
      return NextResponse.json<InvestigateResponseBody>({ found: [], lines: [c.stale.notice], searchedLocationIds: c.stale.snapshot.searchedLocationIds, ...c.stale }, { status: 409 });
    }
    if (c.kind === "throttled") {
      return NextResponse.json<InvestigateResponseBody>({ found: [], lines: [SAVE_BUSY_LINE], searchedLocationIds: [], error: "rate_limited" }, { status: 429, headers: { "retry-after": "5" } });
    }
    return NextResponse.json<InvestigateResponseBody>(body, { status });
  } catch (e) {
    console.error("[investigate] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
