/**
 * SERVER-ONLY. POST /api/investigate, end to end: validate -> restore the
 * shared signed state -> deterministic search -> public fields only -> new token.
 */
import type { LoadedCase } from "./case-schema";
import { InvestigateRequestSchema, type FoundEvidence, type InvestigateResponseBody } from "./investigate-schema";
import { searchLocation } from "./investigation";
import { CASE_CLOSED_SEARCH_LINE, isCaseClosed, restoreSession, saveSession } from "./session";
import type { Env } from "./state-token";
import type { Evidence } from "./types";

export const UNKNOWN_LOCATION_LINE =
  "You march off confidently... straight into a broom cupboard. There's no such place in this house, detective.";
export const UNKNOWN_CASE_LINE =
  "You knock at the door of a house that isn't there. Wrong address, detective.";
export const BAD_REQUEST_LINE = "You scribble in your notebook, but even you can't read it. Try that again, detective.";

const toFound = (e: Evidence): FoundEvidence => ({
  id: e.id,
  name: e.name,
  description: e.description,
  kind: e.kind,
  ...(e.image ? { image: e.image } : {}),
  ...(e.discoveryLine ? { discoveryLine: e.discoveryLine } : {}),
});

export function handleInvestigate(
  json: unknown,
  deps: { caseData: LoadedCase; env?: Env; legacyCaseId?: string },
): { status: number; body: InvestigateResponseBody } {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = InvestigateRequestSchema.safeParse(json);
  if (!parsed.success) {
    return { status: 400, body: { found: [], lines: [BAD_REQUEST_LINE], searchedLocationIds: [], error: "invalid_request" } };
  }
  if (parsed.data.caseId !== undefined && parsed.data.caseId !== caseData.id) {
    return { status: 404, body: { found: [], lines: [UNKNOWN_CASE_LINE], searchedLocationIds: [], error: "unknown_case" } };
  }
  const { game, notice } = restoreSession(caseData, parsed.data.stateToken, env, { legacyCaseId });
  const withNotice = (b: InvestigateResponseBody) => (notice ? { ...b, notice } : b);

  if (isCaseClosed(game)) {
    return {
      status: 409,
      body: { found: [], lines: [CASE_CLOSED_SEARCH_LINE], searchedLocationIds: [...game.searchedLocationIds], stateToken: saveSession(game, env), error: "case_closed" },
    };
  }

  if (!caseData.locations.some((l) => l.id === parsed.data.locationId)) {
    return {
      status: 400,
      body: withNotice({
        found: [],
        lines: [UNKNOWN_LOCATION_LINE],
        searchedLocationIds: [...game.searchedLocationIds],
        stateToken: saveSession(game, env),
        error: "unknown_location",
      }),
    };
  }

  const r = searchLocation(caseData, game, parsed.data.locationId);
  return {
    status: 200,
    body: withNotice({
      locationId: r.locationId,
      found: r.newlyFound.map(toFound),
      lines: r.lines,
      searchedLocationIds: [...game.searchedLocationIds],
      stateToken: saveSession(game, env),
    }),
  };
}
