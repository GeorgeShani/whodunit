/**
 * SERVER-ONLY. POST /api/investigate, end to end: validate -> restore the
 * shared signed state -> deterministic search -> public fields only -> new token.
 */
import { inSetting, settingOf } from "./presentation";
import { UNKNOWN_CASE_LINE } from "./error-copy";
import type { LoadedCase, PlayableCase } from "./case-schema";
import { InvestigateRequestSchema, type FoundEvidence, type InvestigateResponseBody } from "./investigate-schema";
import { clueFeatures } from "./features/registry";
import { toPublicEvidence } from "./public-view";
import { searchLocation } from "./investigation";
import { attachProgress } from "./route-progress";
import { isCaseClosed, systemLine, restoreSession, saveSession } from "./session";
import type { Env } from "./state-token";
import type { Evidence } from "./types";

export const UNKNOWN_LOCATION_LINE =
  "You march off confidently... straight into a broom cupboard. There's no such place in this house, detective.";
export { UNKNOWN_CASE_LINE } from "./error-copy";
export const BAD_REQUEST_LINE = "You scribble in your notebook, but even you can't read it. Try that again, detective.";

const toFound = (c: PlayableCase, e: Evidence): FoundEvidence => toPublicEvidence(e, clueFeatures(c, e.id));

export function handleInvestigate(
  json: unknown,
  deps: { caseData: PlayableCase; env?: Env; legacyCaseId?: string },
): { status: number; body: InvestigateResponseBody } {
  const r = handleInvestigateCore(json, deps);
  return { ...r, body: attachProgress(deps.caseData, json, r.body, deps) };
}

function handleInvestigateCore(
  json: unknown,
  deps: { caseData: PlayableCase; env?: Env; legacyCaseId?: string },
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
      body: { found: [], lines: [systemLine(caseData, "caseClosedSearch")], searchedLocationIds: [...game.searchedLocationIds], stateToken: saveSession(game, env), error: "case_closed" },
    };
  }

  if (!caseData.locations.some((l) => l.id === parsed.data.locationId)) {
    return {
      status: 400,
      body: withNotice({
        found: [],
        lines: [inSetting(UNKNOWN_LOCATION_LINE, settingOf(caseData))],
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
      found: r.newlyFound.map((e) => toFound(caseData, e)),
      lines: r.lines,
      searchedLocationIds: [...game.searchedLocationIds],
      ...(r.locked ? { locked: true } : {}),
      stateToken: saveSession(game, env),
    }),
  };
}
