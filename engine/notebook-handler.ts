/**
 * SERVER-ONLY. POST /api/notebook: rebuild the notebook for a verified state token, read-only (no new token, no model).
 * A restored client uses it to replace stored evidence objects (which may predate a public field such as `weapon`)
 * with the case's current public view of exactly the clues the token has found; nothing undiscovered is returned.
 */
import type { PlayableCase } from "./case-schema";
import { NotebookRequestSchema, type NotebookResponseBody } from "./notebook-schema";
import { initialDiscoveredEvidenceIds, notebookEvidence } from "./public-view";
import { restoreSession } from "./session";
import type { Env } from "./state-token";

export function handleNotebook(
  json: unknown,
  deps: { caseData: PlayableCase; env?: Env; legacyCaseId?: string },
): { status: number; body: NotebookResponseBody } {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = NotebookRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { evidence: [], error: "invalid_request" } };
  if (parsed.data.caseId !== undefined && parsed.data.caseId !== caseData.id) return { status: 404, body: { evidence: [], error: "unknown_case" } };
  const { game, notice } = restoreSession(caseData, parsed.data.stateToken, env, { legacyCaseId });
  // A rejected token: say so and send nothing; the next real action resets in character as usual.
  if (notice) return { status: 409, body: { evidence: [], error: "stale_token" } };
  return { status: 200, body: { evidence: notebookEvidence(caseData, [...initialDiscoveredEvidenceIds(caseData), ...game.discoveredEvidenceIds]) } };
}
