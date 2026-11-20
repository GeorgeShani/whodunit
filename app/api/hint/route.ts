/**
 * POST /api/hint: one spoiler-safe POSSIBLE CONTRADICTION hint (engine/hint-handler.ts, no model call).
 * Request:  { caseId?, stateToken? }
 * Response: { hint: { characterId, characterName } | null, line, readyInTurns, cooldownTurns, stateToken }
 */
import { NextResponse } from "next/server";
import { handleHint, type HintResponseBody } from "@/engine/hint-handler";
import { resolveRequestCase } from "@/lib/request-case";
import { schedulePersist, syncIncomingToken } from "@/lib/saved-session";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => NextResponse.json<HintResponseBody>({ hint: null, line: "", readyInTurns: 0, cooldownTurns: 0, error }, { status });

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
    const synced = await syncIncomingToken(json, rc.caseData);
    const { status, body } = handleHint(synced.json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId });
    schedulePersist(status, body, rc.caseData.id, request);
    return NextResponse.json<HintResponseBody>(body, { status });
  } catch (e) {
    console.error("[hint] failed:", (e as Error).name);
    return fail(500, "internal_error");
  }
}
