/**
 * POST /api/interrogate  (Phase 1 stub: canned responses, no LLM)
 *
 * Flow: validate request (Zod) -> load case (server-side) -> build engine state
 * -> engine checks (character exists, evidence discovered) -> build the
 * character's scoped context -> performer (canned for now) -> validated
 * CharacterResponse. Any failure returns the safe in-character fallback.
 *
 * NOTE: there is no persistence yet; the state is rebuilt per request from the
 * case's initial state. Discovery is therefore limited to initially available
 * evidence until the engine owns sessions.
 */
import { NextResponse } from "next/server";
import { cannedCharacterResponse } from "@/ai/canned-responses";
import { InterrogateRequestSchema } from "@/ai/interrogate-schema";
import { createFallbackCharacterResponse, type CharacterResponse } from "@/ai/schemas";
import { ACTIVE_CASE_ID } from "@/engine/active-case";
import { getCase } from "@/engine/case-loader";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";

export const dynamic = "force-dynamic";

type Body = { response: CharacterResponse; error?: string };

function fallback(status: number, error: string, seed = 0) {
  return NextResponse.json<Body>({ response: createFallbackCharacterResponse({ seed }), error }, { status });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fallback(400, "invalid_json");
  }
  const parsed = InterrogateRequestSchema.safeParse(json);
  if (!parsed.success) return fallback(400, "invalid_request");
  const { characterId, action, turn } = parsed.data;

  try {
    const caseData = await getCase(ACTIVE_CASE_ID);
    const game = createInitialGameState(caseData);
    const runtime = game.characters[characterId];
    if (!runtime) return fallback(404, "unknown_character", turn);

    if (action.type === "about_suspect" && (action.suspectId === characterId || !game.characters[action.suspectId])) {
      return fallback(400, "unknown_suspect", turn);
    }
    if (action.type === "present_evidence") {
      if (!game.discoveredEvidenceIds.includes(action.evidenceId)) return fallback(400, "evidence_not_discovered", turn);
      runtime.evidenceShownIds.push(action.evidenceId);
    }

    const ctx = buildCharacterContext({ caseData, game }, characterId);
    return NextResponse.json<Body>({ response: cannedCharacterResponse(ctx, action, turn) });
  } catch (e) {
    console.error("[interrogate] failed:", (e as Error).message);
    return fallback(500, "internal_error", turn);
  }
}
