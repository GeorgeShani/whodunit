/**
 * POST /api/interrogate: live Grok interrogation (see ai/interrogate-handler.ts).
 * Request:  { characterId, question, presentedEvidenceId?, stateToken? }
 * Response: { response: CharacterResponse, source: "model"|"fallback", stateToken, notice?, error? }
 * Engine is truth, AI is performance: the solution never leaves the server.
 */
import { NextResponse } from "next/server";
import { handleInterrogate } from "@/ai/interrogate-handler";
import type { InterrogateResponseBody } from "@/ai/interrogate-schema";
import { createFallbackCharacterResponse } from "@/ai/schemas";
import { ACTIVE_CASE_ID } from "@/engine/active-case";
import { getCase } from "@/engine/case-loader";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fallback = (status: number, error: string) =>
  NextResponse.json<InterrogateResponseBody>(
    { response: createFallbackCharacterResponse(), source: "fallback", error },
    { status },
  );

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fallback(400, "invalid_json");
  }
  try {
    const caseData = await getCase(ACTIVE_CASE_ID);
    const { status, body } = await handleInterrogate(json, { caseData });
    return NextResponse.json<InterrogateResponseBody>(body, { status });
  } catch (e) {
    console.error("[interrogate] failed:", (e as Error).name);
    return fallback(500, "internal_error");
  }
}
