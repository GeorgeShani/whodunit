/**
 * POST /api/notebook: the found clues for a state token, rebuilt from the case (read-only, deterministic, no model).
 * Request:  { caseId?, stateToken }
 * Response: { evidence: PublicEvidence[], error? }
 */
import { NextResponse } from "next/server";
import { handleNotebook } from "@/engine/notebook-handler";
import { resolveRequestCase } from "@/lib/request-case";
import type { NotebookResponseBody } from "@/engine/notebook-schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json<NotebookResponseBody>({ evidence: [], error: "invalid_json" }, { status: 400 });
  }
  try {
    const rc = await resolveRequestCase(json);
    if (!rc.ok) return NextResponse.json<NotebookResponseBody>({ evidence: [], error: rc.error }, { status: 404 });
    const { status, body } = handleNotebook(json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId });
    return NextResponse.json<NotebookResponseBody>(body, { status });
  } catch (e) {
    console.error("[notebook] failed:", (e as Error).name);
    return NextResponse.json<NotebookResponseBody>({ evidence: [], error: "internal_error" }, { status: 500 });
  }
}
