/**
 * POST /api/interrogate: live Grok interrogation (see ai/interrogate-handler.ts).
 * Request:  { caseId?, characterId, question, presentedEvidenceId?, stateToken? }
 * The case comes from caseId (allowlisted), else the signed token's case, else the default (lib/request-case.ts).
 * Response: { response: CharacterResponse, source: "model"|"fallback", stateToken, notice?, error? }
 * Engine is truth, AI is performance: the solution never leaves the server.
 */
import { NextResponse } from "next/server";
import { handleInterrogate } from "@/ai/interrogate-handler";
import type { InterrogateResponseBody } from "@/ai/interrogate-schema";
import { createFallbackCharacterResponse } from "@/ai/schemas";
import { clientIp, createModelGate } from "@/ai/model-gate";
import { resolveRequestCase } from "@/lib/request-case";
import { schedulePersist, syncIncomingToken } from "@/lib/saved-session";
import { runtimeKv } from "@/lib/runtime-kv";

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
    const rc = await resolveRequestCase(json);
    if (!rc.ok) return fallback(404, rc.error);
    const synced = await syncIncomingToken(json, rc.caseData);
    const { status, body } = await handleInterrogate(synced.json, {
      caseData: rc.caseData,
      legacyCaseId: rc.legacyCaseId,
      gate: createModelGate({ kv: runtimeKv, ip: clientIp(request.headers) }),
      claims: runtimeKv,
    });
    schedulePersist(status, body, rc.caseData.id, request);
    const retryAfter = body.unavailable?.retryAfter;
    return NextResponse.json<InterrogateResponseBody>(body, { status, ...(retryAfter ? { headers: { "retry-after": String(retryAfter) } } : {}) });
  } catch (e) {
    console.error("[interrogate] failed:", (e as Error).name);
    return fallback(500, "internal_error");
  }
}
