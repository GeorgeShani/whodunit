/**
 * POST /api/accuse: grade the player's accusation (see engine/accuse-handler.ts).
 * Request:  { caseId?, accusation: { murdererId, weaponId, motiveId, keyEvidenceIds[1..5] }, stateToken }
 * Response: { outcome, accusation, verdict, solution, ending, evidence, stateToken } or { error, line }.
 * The engine alone decides; after this the token is game-over, and the game id is recorded so older tokens of the same game can't guess again.
 * A loss never carries `solution` or `verdict`.
 * #39: with DATABASE_URL set, the closed_games row in Postgres is the source of truth (committed before any verdict;
 * a failed write is a 503 with the token unchanged). Without it, the Runtime Cache record alone (one warning per process).
 */
import { NextResponse } from "next/server";
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import { ACCUSE_LINES, handleAccuse } from "@/engine/accuse-handler";
import { accusedStore } from "@/lib/accused-store";
import { closedGamesRepo } from "@/lib/closed-games";
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
    const { status, body } = await handleAccuse(json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId, accused: accusedStore, closed: closedGamesRepo() });
    return NextResponse.json<AccuseResponseBody>(body, { status, ...(status === 503 ? { headers: { "retry-after": "5" } } : {}) });
  } catch (e) {
    console.error("[accuse] failed:", (e as Error).name);
    return NextResponse.json<AccuseResponseBody>({ error: "internal_error", line: ACCUSE_LINES.invalid }, { status: 500 });
  }
}
