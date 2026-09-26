/**
 * SERVER-ONLY. Which case an API request is about.
 *
 * 1. `caseId` in the body (the page route's case) must be allowlisted, else 404.
 * 2. Otherwise the case a VERIFIED state token was issued for (legacy tokens
 *    without caseId mean the default case), if allowlisted.
 * 3. Otherwise the default case (a new game on "/").
 * The handler then decodes the token against that case; a token for another
 * case resets in character (wrong_case).
 */
import { getPublicCase, isPublicCaseId } from "@/engine/case-registry";
import type { LoadedCase } from "@/engine/case-schema";
import { peekStateTokenCaseId, type Env } from "@/engine/state-token";
import { DEFAULT_CASE_ID } from "./cases";

export type RequestCase = { ok: true; caseData: LoadedCase; legacyCaseId: string } | { ok: false; error: "unknown_case" };

export async function resolveRequestCase(json: unknown, env: Env = process.env): Promise<RequestCase> {
  const body = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  let caseId: string;
  if (body.caseId !== undefined) {
    if (!isPublicCaseId(body.caseId)) return { ok: false, error: "unknown_case" };
    caseId = body.caseId;
  } else {
    const fromToken = typeof body.stateToken === "string" ? peekStateTokenCaseId(body.stateToken, env, { legacyCaseId: DEFAULT_CASE_ID }) : undefined;
    caseId = isPublicCaseId(fromToken) ? fromToken : DEFAULT_CASE_ID;
  }
  return { ok: true, caseData: await getPublicCase(caseId), legacyCaseId: DEFAULT_CASE_ID };
}
