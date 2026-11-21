/**
 * POST /api/save: quiet flush of a token the client already holds (tab hidden or closing).
 * Body: { caseId, gameId?, stateToken } — never a query string or path.
 * Accepts JSON and beacon text/plain bodies. No new token is minted.
 */
import { NextResponse } from "next/server";
import { handleSave, SAVE_LINES } from "@/engine/save-handler";
import { resolveRequestCase } from "@/lib/request-case";
import { savedGamesRepoFor } from "@/lib/saved-games";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string, line: string) => NextResponse.json({ error, line }, { status });

/** Beacons may arrive as application/json or text/plain; parse the text either way. */
export async function readSaveBody(request: Request): Promise<{ ok: true; json: unknown } | { ok: false }> {
  try {
    const text = await request.text();
    return { ok: true, json: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false };
  }
}

export async function POST(request: Request) {
  const parsed = await readSaveBody(request);
  if (!parsed.ok) return fail(400, "invalid_json", SAVE_LINES.invalid);
  try {
    const rc = await resolveRequestCase(parsed.json);
    if (!rc.ok) return fail(404, rc.error, SAVE_LINES.invalid);
    const { status, body } = await handleSave(parsed.json, { caseData: rc.caseData, headers: request.headers, saves: savedGamesRepoFor(request.headers) });
    if (status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(body ?? {}, { status });
  } catch (e) {
    console.error("[save] failed:", (e as Error).name);
    return fail(500, "internal_error", SAVE_LINES.invalid);
  }
}
