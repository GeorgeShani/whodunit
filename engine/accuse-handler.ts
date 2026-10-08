/**
 * SERVER-ONLY. POST /api/accuse, end to end:
 *   Zod -> verify the signed state (required) -> game already over? replay the
 *   ORIGINAL verdict (409) -> every cited id exists and is discovered ->
 *   gradeAccusation (engine only) -> COMMIT the closed-game row (Postgres, #39)
 *   -> mark the game over in the token -> outcome + verdict + solution reveal + ending payload.
 * This is the only place solution or ending data leaves the server (and only
 * on a win: a loss never carries the solution or per-field verdict).
 */
import { AccuseRequestSchema, type AccuseResponseBody } from "./accuse-schema";
import { gradeAccusation } from "./accusation";
import type { LoadedCase } from "./case-schema";
import { buildEnding, buildSolutionReveal, endingEvidence, toVerdict } from "./ending-payload";
import { accuseProgress } from "./progress";
import { attachProgress } from "./route-progress";
import { isCaseClosed, restoreSession, saveSession } from "./session";
import { ensureGameId, type Env } from "./state-token";
import type { Accusation, GameState } from "./types";

export const ACCUSE_LINES = {
  invalid: "You clear your throat for the big accusation... and forget what you were going to say. Try that again, detective.",
  unknownCase: "You knock at the door of a house that isn't there. Wrong address, detective.",
  badState: "Your notebook has gone missing! You can't accuse anyone without your notes. Start the questioning afresh.",
  unknownSuspect: "You point dramatically at... a hat stand. Nobody by that name is in this house.",
  unknownMotive: "That's not a motive anyone here could have, detective.",
  notDiscovered: "You can't cite a clue you haven't found, detective. Check your notebook.",
  testimonyNotRevealed: "You can't cite a confession nobody has made, detective. Check the testimony in your notebook.",
  locked: "The case isn't ready yet, detective.",
  caseClosed: "You've already named your culprit, detective. The case is closed.",
  /** The closed-games record could not be written (#39): nothing was decided, ask again shortly. */
  recordDown:
    "The telephone line to the Yard is down, detective, and the inspector won't hear an accusation he can't write down. Your notes are safe: make your accusation again in a moment.",
} as const;

export interface AccuseResult {
  status: number;
  body: AccuseResponseBody;
}

/**
 * A WIN carries the verdict and the full solution. A LOSS carries neither (#22):
 * not the per-field right/wrong, not the solution, not the real murderer. The
 * player only learns that the case went unsolved.
 */
function verdictBody(caseData: LoadedCase, game: GameState, accusation: Accusation, env?: Env): AccuseResponseBody {
  const grade = gradeAccusation(caseData.solution, accusation);
  const ending = buildEnding(caseData, grade, accusation);
  const stateToken = saveSession(game, env);
  if (!grade.won) return { outcome: "lost", accusation, ending, evidence: endingEvidence(caseData, ending, undefined, accusation), stateToken };
  const solution = buildSolutionReveal(caseData);
  return { outcome: "won", accusation, verdict: toVerdict(grade), solution, ending, evidence: endingEvidence(caseData, ending, solution, accusation), stateToken };
}

/**
 * One accusation per GAME, not per token (#22). Tokens are stateless, so an
 * older token could otherwise be replayed to guess again. The accuser's game id
 * is recorded here when it accuses; any later token carrying the same id gets
 * the original verdict back and its new guess ignored.
 */
export interface AccusedStore {
  get(gameId: string): Promise<Accusation | null>;
  put(gameId: string, accusation: Accusation): Promise<void>;
}

/**
 * The permanent closed-games record (#39; lib/closed-games.ts, Postgres). When present it is the source of truth:
 * only the request whose insert creates the row gets a fresh verdict, and a failed insert fails the accusation
 * CLOSED (503, token unchanged, nothing consumed). When absent (DATABASE_URL unset) only the cache record applies.
 * Structural so the engine stays free of database code.
 */
export interface ClosedGamesStore {
  closeGame(input: { gameId: string; caseId: string; outcome: "won" | "lost"; accusedId: string | null }): Promise<{
    inserted: boolean;
    record: StoredClose;
  }>;
  getClosed(gameId: string): Promise<StoredClose | null>;
}
export interface StoredClose {
  outcome: "won" | "lost";
  accusedId: string | null;
}

interface AccuseDeps {
  caseData: LoadedCase;
  env?: Env;
  legacyCaseId?: string;
  accused?: AccusedStore;
  closed?: ClosedGamesStore | null;
}

/**
 * The reply for a game the closed-games record already holds, when the full accusation is not at hand (the cache
 * record missed). Same 409 "case_closed" as a cached replay. A WIN replays the win with the solution (it was earned
 * in this game); the accusation shown is the solution's, since only the outcome and the accused are stored. A LOSS
 * carries the stored outcome and the accused's reaction only: no solution, no verdict, no cited clues.
 */
function storedOutcomeBody(caseData: LoadedCase, game: GameState, stored: StoredClose, sentToken: string, env?: Env): AccuseResponseBody {
  const closed = { error: "case_closed", line: ACCUSE_LINES.caseClosed } as const;
  if (stored.outcome === "won") {
    const s = caseData.solution;
    const accusation: Accusation = {
      murdererId: s.murdererId,
      weaponId: s.weaponId,
      motiveId: s.motiveId,
      keyEvidenceIds: s.keyEvidenceIds.slice(0, 5),
      ...(s.keyTestimonyIds?.length ? { keyTestimonyIds: s.keyTestimonyIds.slice(0, 3) } : {}),
    };
    game.accusation = accusation;
    game.outcome = "won";
    game.phase = "resolved";
    return { ...verdictBody(caseData, game, accusation, env), ...closed };
  }
  // A game-over token must carry a full accusation (engine/state-token.ts), which a stored loss doesn't have, so the
  // token goes back exactly as sent: it can still never accuse again (every try lands here), and nothing is revealed.
  if (!stored.accusedId || !caseData.characters.some((c) => c.id === stored.accusedId)) return { outcome: "lost", stateToken: sentToken, ...closed };
  // The loss reaction is built from the accused alone: no weapon or clue of theirs is known, so none is flashed.
  const ending = buildEnding(caseData, { won: false }, { murdererId: stored.accusedId, weaponId: "", motiveId: "", keyEvidenceIds: [] });
  const bare = { ...ending, beats: ending.beats.map((b) => ({ ...b, evidenceIds: [] })) };
  return { outcome: "lost", ending: bare, stateToken: sentToken, ...closed };
}

export async function handleAccuse(json: unknown, deps: AccuseDeps): Promise<AccuseResult> {
  const r = await handleAccuseCore(json, deps);
  return { ...r, body: attachProgress(deps.caseData, json, r.body, deps) };
}

async function handleAccuseCore(json: unknown, deps: AccuseDeps): Promise<AccuseResult> {
  const { caseData, env, legacyCaseId, accused, closed } = deps;
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

  const gameId = ensureGameId(game);
  // Same game, older token: replay the recorded verdict. The cache record is the fast pre-check (it holds the full
  // accusation); a cache outage fails open here because the closed-games record below still decides.
  const earlier = accused ? await accused.get(gameId).catch(() => null) : null;
  if (earlier) {
    game.accusation = earlier;
    game.outcome = gradeAccusation(caseData.solution, earlier).won ? "won" : "lost";
    game.phase = "resolved";
    return { status: 409, body: { ...verdictBody(caseData, game, earlier, env), error: "case_closed", line: ACCUSE_LINES.caseClosed } };
  }
  // The permanent record (#39). A read error is not trusted either way: the insert below decides (and fails closed).
  const stored = closed ? await closed.getClosed(gameId).catch(() => null) : null;
  if (stored) return { status: 409, body: storedOutcomeBody(caseData, game, stored, stateToken, env) };

  // Progression: the gate is recomputed from the signed token. A refusal leaves the token unchanged.
  const gate = accuseProgress(caseData, game);
  if (!gate.unlocked) return { status: 403, body: { error: "accuse_locked", line: gate.line ?? ACCUSE_LINES.locked, stateToken: saveSession(game, env) } };

  const reject = (error: string, line: string): AccuseResult => ({ status: 400, body: { error, line, stateToken: saveSession(game, env) } });
  if (!caseData.characters.some((c) => c.id === accusation.murdererId)) return reject("unknown_suspect", ACCUSE_LINES.unknownSuspect);
  if (!caseData.motives.some((m) => m.id === accusation.motiveId)) return reject("unknown_motive", ACCUSE_LINES.unknownMotive);
  const discovered = new Set(game.discoveredEvidenceIds);
  const cited = [...new Set(accusation.keyEvidenceIds)];
  if (!discovered.has(accusation.weaponId) || !cited.every((id) => discovered.has(id))) return reject("evidence_not_discovered", ACCUSE_LINES.notDiscovered);

  const citedTestimony = [...new Set(accusation.keyTestimonyIds ?? [])];
  if (!citedTestimony.every((id) => game.revealedSecretIds.includes(id))) return reject("testimony_not_revealed", ACCUSE_LINES.testimonyNotRevealed);

  const clean: Accusation = { ...accusation, keyEvidenceIds: cited, ...(citedTestimony.length ? { keyTestimonyIds: citedTestimony } : {}) };
  const grade = gradeAccusation(caseData.solution, clean);
  const outcome = grade.won ? "won" : "lost";
  // Commit BEFORE any verdict leaves: only the request that creates the row gets a fresh verdict. If the record can't
  // be written, nothing is decided: 503, the token exactly as sent, no cache write (FAIL CLOSED).
  if (closed) {
    let committed: Awaited<ReturnType<ClosedGamesStore["closeGame"]>>;
    try {
      committed = await closed.closeGame({ gameId, caseId: caseData.id, outcome, accusedId: clean.murdererId });
    } catch {
      return { status: 503, body: { error: "record_unavailable", line: ACCUSE_LINES.recordDown, stateToken } };
    }
    if (!committed.inserted) return { status: 409, body: storedOutcomeBody(caseData, game, committed.record, stateToken, env) };
  }
  game.accusation = clean;
  game.outcome = outcome;
  game.phase = "resolved";
  // Write-through to the cache record (best effort; with Postgres configured it is only the fast pre-check).
  if (accused) await accused.put(gameId, clean).catch(() => undefined);
  return { status: 200, body: verdictBody(caseData, game, clean, env) };
}
