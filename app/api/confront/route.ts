/**
 * POST /api/confront: one bounded confrontation exchange (see ai/confront-handler.ts).
 * Request:  { caseId?, characterIds: [addressed, partner], question, stateToken? }
 * Response: { lines: [addressed, partner], confrontation: { turnsUsed, max, over }, stateToken, testimonies }
 */
import { NextResponse } from "next/server";
import { handleConfront } from "@/ai/confront-handler";
import type { ConfrontResponseBody } from "@/ai/confront-schema";
import { resolveRequestCase } from "@/lib/request-case";

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
    const { status, body } = await handleConfront(json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId });
    return NextResponse.json<ConfrontResponseBody>(body, { status });
  } catch (e) {
    console.error("[confront] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
