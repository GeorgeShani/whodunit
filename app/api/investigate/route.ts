/**
 * POST /api/investigate: deterministic location search (no model).
 * Request:  { locationId, stateToken? }   (same signed token as /api/interrogate)
 * Response: { locationId, found: FoundEvidence[], lines, searchedLocationIds, stateToken, notice?, error? }
 */
import { NextResponse } from "next/server";
import { ACTIVE_CASE_ID } from "@/engine/active-case";
import { getCase } from "@/engine/case-loader";
import { BAD_REQUEST_LINE, handleInvestigate } from "@/engine/investigate-handler";
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
    const caseData = await getCase(ACTIVE_CASE_ID);
    const { status, body } = handleInvestigate(json, { caseData });
    return NextResponse.json<InvestigateResponseBody>(body, { status });
  } catch (e) {
    console.error("[investigate] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
