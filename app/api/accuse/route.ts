/**
 * POST /api/accuse: grade the player's accusation (see engine/accuse-handler.ts).
 * Request:  { caseId?, accusation: { murdererId, weaponId, motiveId, keyEvidenceIds[1..5] }, stateToken }
 * Response: { outcome, accusation, verdict, solution, ending, evidence, stateToken } or { error, line }.
 * The engine alone decides; after this the token is game-over.
 */
import { NextResponse } from "next/server";
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import { ACCUSE_LINES, handleAccuse } from "@/engine/accuse-handler";
import { resolveRequestCase } from "@/lib/request-case";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json<AccuseResponseBody>({ error: "invalid_json", line: ACCUSE_LINES.invalid }, { status: 400 });
  }
  try {
    const rc = await resolveRequestCase(json);
    if (!rc.ok) return NextResponse.json<AccuseResponseBody>({ error: rc.error, line: ACCUSE_LINES.unknownCase }, { status: 404 });
    const { status, body } = handleAccuse(json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId });
    return NextResponse.json<AccuseResponseBody>(body, { status });
  } catch (e) {
    console.error("[accuse] failed:", (e as Error).name);
    return NextResponse.json<AccuseResponseBody>({ error: "internal_error", line: ACCUSE_LINES.invalid }, { status: 500 });
  }
}
