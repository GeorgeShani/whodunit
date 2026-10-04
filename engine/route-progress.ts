/**
 * SERVER-ONLY. Adds the public `progress` object (docs/BLACKWOOD_PROGRESSION_PROPOSAL.md §5.6) to every route
 * response that returns a state token. `newLeadIds` is the difference between the request's state and the
 * response's state, so the routes stay stateless.
 */
import type { LoadedCase } from "./case-schema";
import { leadStates, publicProgress, type PublicProgress } from "./progress";
import { restoreSession } from "./session";
import type { Env } from "./state-token";

export function attachProgress<B extends { stateToken?: string }>(
  caseData: LoadedCase,
  requestJson: unknown,
  body: B,
  deps: { env?: Env; legacyCaseId?: string },
): B & { progress?: PublicProgress } {
  if (!body.stateToken) return body;
  const reqToken = (requestJson as { stateToken?: unknown } | null)?.stateToken;
  const options = { legacyCaseId: deps.legacyCaseId };
  const before = restoreSession(caseData, typeof reqToken === "string" ? reqToken : undefined, deps.env, options).game;
  const after = restoreSession(caseData, body.stateToken, deps.env, options).game;
  return { ...body, progress: publicProgress(caseData, after, leadStates(caseData, before)) };
}
