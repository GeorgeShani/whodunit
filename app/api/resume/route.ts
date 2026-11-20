/**
 * POST /api/resume: return the latest verified token for a game already in the client's hand.
 * Request body: { gameId, caseId, stateToken? }  — never a query string or path (the game id must not appear in a URL).
 * Response: { stateToken, gameId, caseId, snapshot } or { closed } for a finished game; errors are in character.
 */
import { NextResponse } from "next/server";
import { handleResume, RESUME_LINES, type ResumeResponseBody } from "@/engine/resume-handler";
import { resolveRequestCase } from "@/lib/request-case";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string, line: string) =>
  NextResponse.json<ResumeResponseBody>({ error, line }, { status });

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json", RESUME_LINES.invalid);
  }
  try {
    const rc = await resolveRequestCase(json);
    if (!rc.ok) return fail(404, rc.error, RESUME_LINES.unknownCase);
    const { status, body } = await handleResume(json, { caseData: rc.caseData, headers: request.headers });
    return NextResponse.json<ResumeResponseBody>(body, { status, ...(status === 429 || status === 503 ? { headers: { "retry-after": "5" } } : {}) });
  } catch (e) {
    console.error("[resume] failed:", (e as Error).name);
    return fail(500, "internal_error", RESUME_LINES.invalid);
  }
}
