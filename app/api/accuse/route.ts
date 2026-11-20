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
import { closedGamesRepoFor } from "@/lib/closed-games";
import { resolveRequestCase } from "@/lib/request-case";
import { runWithSaveContext } from "@/lib/save-context";
import { commitSavedAction, SAVE_BUSY_LINE, syncIncomingToken } from "@/lib/saved-session";
import { savedGamesRepoFor } from "@/lib/saved-games";

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
    const synced = await syncIncomingToken(json, rc.caseData, undefined, savedGamesRepoFor(request.headers), { headers: request.headers });
    if (synced.rateLimited) {
      // Fail closed and in character: nothing runs, the player's token is untouched (#102).
      return NextResponse.json<AccuseResponseBody>({ error: "rate_limited", line: SAVE_BUSY_LINE }, { status: 429, headers: { "retry-after": "5" } });
    }
    if (synced.rejectStale) {
      return NextResponse.json<AccuseResponseBody>(
        { error: "stale_token", line: synced.notice ?? "", notice: synced.notice },
        { status: 409 },
      );
    }
    const { status, body } = await runWithSaveContext(synced.cabinetOffline, () =>
      handleAccuse(synced.json, { caseData: rc.caseData, legacyCaseId: rc.legacyCaseId, accused: accusedStore, closed: closedGamesRepoFor(request.headers) }),
    );
    const c = await commitSavedAction(status, body, synced, rc.caseData);
    if (c.kind === "stale") {
      // Lost the compare-and-swap (#95): never a 200 at N+1. Hand back the winner's row, its snapshot and the notice.
      return NextResponse.json<AccuseResponseBody>({ ...c.stale }, { status: 409 });
    }
    if (c.kind === "throttled") {
      return NextResponse.json<AccuseResponseBody>({ error: "rate_limited", line: SAVE_BUSY_LINE }, { status: 429, headers: { "retry-after": "5" } });
    }
    return NextResponse.json<AccuseResponseBody>(body, { status, ...(status === 503 ? { headers: { "retry-after": "5" } } : {}) });
  } catch (e) {
    console.error("[accuse] failed:", (e as Error).name);
    return NextResponse.json<AccuseResponseBody>({ error: "internal_error", line: ACCUSE_LINES.invalid }, { status: 500 });
  }
}
