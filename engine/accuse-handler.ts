/**
 * SERVER-ONLY. POST /api/accuse, end to end:
 *   Zod -> verify the signed state (required) -> game already over? replay the
 *   ORIGINAL verdict (409) -> every cited id exists and is discovered ->
 *   gradeAccusation (engine only) -> mark the game over in the token ->
 *   outcome + verdict + solution reveal + ending payload.
 * This is the only place solution or ending data leaves the server.
 */
import { AccuseRequestSchema, type AccuseResponseBody } from "./accuse-schema";
import { gradeAccusation } from "./accusation";
import type { LoadedCase } from "./case-schema";
import { buildEnding, buildSolutionReveal, endingEvidence, toVerdict } from "./ending-payload";
import { isCaseClosed, restoreSession, saveSession } from "./session";
import type { Env } from "./state-token";
import type { Accusation, GameState } from "./types";

export const ACCUSE_LINES = {
  invalid: "You clear your throat for the big accusation... and forget what you were going to say. Try that again, detective.",
  unknownCase: "You knock at the door of a house that isn't there. Wrong address, detective.",
  badState: "Your notebook has gone missing! You can't accuse anyone without your notes. Start the questioning afresh.",
  unknownSuspect: "You point dramatically at... a hat stand. Nobody by that name is in this house.",
  unknownMotive: "That's not a motive anyone here could have, detective.",
  notDiscovered: "You can't cite a clue you haven't found, detective. Check your notebook.",
  caseClosed: "You've already named your culprit, detective. The case is closed.",
} as const;

export interface AccuseResult {
  status: number;
  body: AccuseResponseBody;
}

function verdictBody(caseData: LoadedCase, game: GameState, accusation: Accusation, env?: Env): AccuseResponseBody {
  const grade = gradeAccusation(caseData.solution, accusation);
  const ending = buildEnding(caseData, grade, accusation);
  const solution = buildSolutionReveal(caseData);
  return {
    outcome: grade.won ? "won" : "lost",
    accusation,
    verdict: toVerdict(grade),
    solution,
    ending,
    evidence: endingEvidence(caseData, ending, solution, accusation),
    stateToken: saveSession(game, env),
  };
}

export function handleAccuse(json: unknown, deps: { caseData: LoadedCase; env?: Env; legacyCaseId?: string }): AccuseResult {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = AccuseRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "invalid_request", line: ACCUSE_LINES.invalid } };
  const { accusation, stateToken, caseId } = parsed.data;
  if (caseId !== undefined && caseId !== caseData.id) return { status: 404, body: { error: "unknown_case", line: ACCUSE_LINES.unknownCase } };

  const { game, notice } = restoreSession(caseData, stateToken, env, { legacyCaseId });
  if (notice) return { status: 400, body: { error: "invalid_state", line: ACCUSE_LINES.badState, notice, stateToken: saveSession(game, env) } };

  // Game over: one accusation per game. Replays get the ORIGINAL verdict back; the new guess is ignored.
  if (isCaseClosed(game) && game.accusation) {
    return { status: 409, body: { ...verdictBody(caseData, game, game.accusation, env), error: "case_closed", line: ACCUSE_LINES.caseClosed } };
  }

  const reject = (error: string, line: string): AccuseResult => ({ status: 400, body: { error, line, stateToken: saveSession(game, env) } });
  if (!caseData.characters.some((c) => c.id === accusation.murdererId)) return reject("unknown_suspect", ACCUSE_LINES.unknownSuspect);
  if (!caseData.motives.some((m) => m.id === accusation.motiveId)) return reject("unknown_motive", ACCUSE_LINES.unknownMotive);
  const discovered = new Set(game.discoveredEvidenceIds);
  const cited = [...new Set(accusation.keyEvidenceIds)];
  if (!discovered.has(accusation.weaponId) || !cited.every((id) => discovered.has(id))) return reject("evidence_not_discovered", ACCUSE_LINES.notDiscovered);

  const clean: Accusation = { ...accusation, keyEvidenceIds: cited };
  const grade = gradeAccusation(caseData.solution, clean);
  game.accusation = clean;
  game.outcome = grade.won ? "won" : "lost";
  game.phase = "resolved";
  return { status: 200, body: verdictBody(caseData, game, clean, env) };
}
