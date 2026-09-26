/**
 * POST /api/investigate: deterministic location search (no model).
 * Request:  { caseId?, locationId, stateToken? }   (same signed token and case resolution as /api/interrogate)
 * Response: { locationId, found: FoundEvidence[], lines, searchedLocationIds, stateToken, notice?, error? }
 */
import { NextResponse } from "next/server";
import { BAD_REQUEST_LINE, handleInvestigate, UNKNOWN_CASE_LINE } from "@/engine/investigate-handler";
import { resolveRequestCase } from "@/lib/request-case";
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
    const { status, body } = handleInvestigate(json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId });
    return NextResponse.json<InvestigateResponseBody>(body, { status });
  } catch (e) {
    console.error("[investigate] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
