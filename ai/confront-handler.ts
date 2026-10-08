/**
 * SERVER-ONLY. One confrontation exchange (MASTER_PLAN §32-33): the detective
 * speaks to A in front of B; A answers (engine turn + model), then B reacts to
 * A (engine turn + model). Exactly two model calls, then control returns to
 * the player. The engine caps a pair at MAX_CONFRONTATION_TURNS exchanges.
 *
 * Engine rules on top of an interrogation turn:
 *  - both sides take CONFRONTATION_PRESSURE stress per exchange;
 *  - if A has admitted something that bears on one of B's lies, A says it to
 *    B's face, and it counts as that testimony being presented to B (lies break
 *    by the usual testimony rules, with the contradiction beat);
 *  - the detective may hold up one discovered clue or revealed testimony to A
 *    in the same exchange (the ordinary present rules; it still counts as one).
 */
import type { LoadedCase } from "@/engine/case-schema";
import { CONFRONTATION_PRESSURE, MAX_CONFRONTATION_TURNS, openConfrontation, relieveBystanders, spendExchange, testimonyToThrow } from "@/engine/confrontation";
import { clampStress } from "@/engine/stress";
import { attachProgress } from "@/engine/route-progress";
import { CASE_CLOSED_LINE, isCaseClosed, restoreSession, saveSession } from "@/engine/session";
import { publicTestimonies, revealedSecretIds } from "@/engine/testimony";
import { ConfrontRequestSchema, type ConfrontLine, type ConfrontResponseBody } from "./confront-schema";
import { isTurnUnavailable, performTurn } from "./perform-turn";
import { confrontBreatherLine, confrontDownLine } from "./model-down";
import type { ModelGate } from "./model-gate";
import { buildUserMessage } from "./prompts/interrogation";

type Env = Record<string, string | undefined>;

export interface ConfrontDeps {
  caseData: LoadedCase;
  env?: Env;
  legacyCaseId?: string;
  onPrompt?: (p: { system: string; user: string; characterId: string }) => void;
  /** Cost protection (ai/model-gate.ts). Absent = unlimited (tests, scripts). */
  gate?: ModelGate;
}

/** Model turns per confrontation exchange (A answers, B reacts). */
export const CONFRONT_MODEL_TURNS = 2;

export const CONFRONT_LINES = {
  pair_finished: "The two of them fold their arms and turn their backs on each other. They have said all they are going to say to each other tonight.",
  limit_reached: "The household has had quite enough shouting for one night. Nobody will face anybody else again, detective: put your questions to them one at a time.",
  same_character: "You can't very well sit someone down opposite themselves, detective.",
  present_one_item: "One thing at a time, detective: a clue or a testimony, not both.",
  evidence_not_discovered: "You pat your pockets. You haven't found that yet, detective.",
  testimony_not_revealed: "Nobody has admitted any such thing, detective.",
  unknown_character: "You glance around the hall. There's nobody here by that name.",
} as const;

export async function handleConfront(json: unknown, deps: ConfrontDeps): Promise<{ status: number; body: ConfrontResponseBody }> {
  const r = await handleConfrontCore(json, deps);
  return { ...r, body: attachProgress(deps.caseData, json, r.body, deps) };
}

async function handleConfrontCore(json: unknown, deps: ConfrontDeps): Promise<{ status: number; body: ConfrontResponseBody }> {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = ConfrontRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { lines: [], error: "invalid_request" } };
  const { caseId, characterIds, question, stateToken, presentedEvidenceId, presentedTestimonyId } = parsed.data;
  if (caseId !== undefined && caseId !== caseData.id) return { status: 404, body: { lines: [], error: "unknown_case" } };
  const [aId, bId] = characterIds;

  const { game, notice } = restoreSession(caseData, stateToken, env, { legacyCaseId });
  const base = (b: ConfrontResponseBody): ConfrontResponseBody => ({ ...b, ...(notice ? { notice } : {}) });
  if (isCaseClosed(game)) return { status: 409, body: base({ lines: [], line: CASE_CLOSED_LINE, error: "case_closed", stateToken: saveSession(game, env) }) };
  const a = caseData.characters.find((c) => c.id === aId);
  const b = caseData.characters.find((c) => c.id === bId);
  if (!a || !b || !game.characters[aId] || !game.characters[bId]) {
    return { status: 404, body: base({ lines: [], line: CONFRONT_LINES.unknown_character, error: "unknown_character" }) };
  }
  // Presenting in a confrontation: the same checks as in an interrogation, before anything is spent.
  const presentError =
    presentedEvidenceId && presentedTestimonyId
      ? "present_one_item"
      : presentedEvidenceId && !game.discoveredEvidenceIds.includes(presentedEvidenceId)
        ? "evidence_not_discovered"
        : presentedTestimonyId && !revealedSecretIds(game).includes(presentedTestimonyId)
          ? "testimony_not_revealed"
          : null;
  if (presentError) return { status: 400, body: base({ lines: [], line: CONFRONT_LINES[presentError], error: presentError, stateToken: saveSession(game, env) }) };
  // The state to hand back if the model cannot answer: exactly what the client sent (taken before anything below touches `game`).
  const heldToken = notice ? saveSession(game, env) : (stateToken ?? saveSession(game, env));
  const gate = openConfrontation(game, aId, bId);
  if (!gate.ok) return { status: gate.reason === "same_character" ? 400 : 409, body: base({ lines: [], line: CONFRONT_LINES[gate.reason], error: gate.reason, stateToken: saveSession(game, env) }) };

  // Cost protection, before anything is spent: an exchange is two model turns (ai/model-gate.ts).
  const pass = deps.gate ? await deps.gate.open(CONFRONT_MODEL_TURNS) : null;
  if (pass && !pass.ok && pass.reason === "rate_limited") {
    const line = confrontBreatherLine(a.name, b.name, pass.retryAfterSec);
    return { status: 429, body: base({ lines: [], line, unavailable: { kind: "breather", line, retryAfter: pass.retryAfterSec }, error: pass.reason, stateToken: heldToken }) };
  }
  // Daily cap or kill switch: both turns run without the model (the "quiet" line; nothing is spent).
  const offline = pass && !pass.ok ? pass.reason : null;
  const skip = offline ? { skipModel: "quota" as const } : {};
  let called = false;
  const exchange = async (): Promise<{ status: number; body: ConfrontResponseBody }> => {
    // Face-to-face pressure (engine rule), before either side's reveal is decided.
    for (const id of [aId, bId]) game.characters[id].stress = clampStress(game.characters[id].stress + CONFRONTATION_PRESSURE);
    relieveBystanders(game, [aId, bId]);
    const thrown = testimonyToThrow(caseData, game, aId, bId);
    const thrownCard = thrown ? publicTestimonies(caseData, game).find((t) => t.id === thrown) : undefined;
    const onPrompt = (id: string) => (deps.onPrompt ? (p: { system: string; user: string }) => deps.onPrompt!({ ...p, characterId: id }) : undefined);

    // Face-to-face pressure was applied to the in-memory game above; if the model cannot answer it is all thrown away.
    const down = (kind: "busy" | "quiet", reason: string): { status: number; body: ConfrontResponseBody } => ({
      status: 503,
      body: base({ lines: [], line: confrontDownLine(kind, a.name, b.name), unavailable: { kind, line: confrontDownLine(kind, a.name, b.name) }, error: offline ?? reason, stateToken: heldToken }),
    });

    // 1. A answers the detective, in front of B.
    const first = await performTurn({
      caseData,
      game,
      characterId: aId,
      question,
      move: { ...(presentedEvidenceId ? { presentedEvidenceId } : {}), ...(presentedTestimonyId ? { presentedTestimonyId } : {}) },
      confrontation: { partnerName: b.name, role: "addressed", ...(thrownCard ? { throwTestimony: { summary: thrownCard.summary } } : {}) },
      memoryText: `(Face to face with ${b.name}) ${question}`,
      env,
      ...skip,
      ...(onPrompt(aId) ? { onPrompt: onPrompt(aId) } : {}),
    });
    called ||= first.grok.attempts > 0;

    if (isTurnUnavailable(first)) return down(first.kind, first.reason);

    // 2. B reacts to A. If A threw an admission, the engine counts it as presented to B.
    const aLine = first.response.dialogue;
    const second = await performTurn({
      caseData,
      game,
      characterId: bId,
      question,
      ...(thrown ? { move: { presentedTestimonyId: thrown } } : {}),
      confrontation: { partnerName: a.name, role: "reacting", partnerLine: aLine },
      memoryText: `(Face to face with ${a.name}) The detective asked ${a.name}: "${question}" ${a.name} said: "${aLine}"`,
      userMessage: (ctx) =>
        buildUserMessage(ctx, question, { partnerName: a.name })
          .replace("THE DETECTIVE NOW SAYS:", `THE DETECTIVE, questioning ${a.name} in front of you, says:`)
          .replace(`Respond as ${ctx.persona.name}`, `${a.name} answered (see the directive). Now react to ${a.name} as ${ctx.persona.name}`),
      env,
      ...skip,
      ...(onPrompt(bId) ? { onPrompt: onPrompt(bId) } : {}),
    });
    called ||= second.grok.attempts > 0;

    if (isTurnUnavailable(second)) return down(second.kind, second.reason);

    const spent = spendExchange(game);
    const line = (id: string, name: string, t: typeof first): ConfrontLine => ({
      characterId: id,
      characterName: name,
      response: t.response,
      source: t.source,
      stress: t.stress,
      ...(t.contradiction ? { contradiction: t.contradiction } : {}),
    });
    return {
      status: 200,
      body: base({
        lines: [line(aId, a.name, first), line(bId, b.name, second)],
        confrontation: { characterIds: [aId, bId], turnsUsed: spent.turnsUsed, max: MAX_CONFRONTATION_TURNS, over: spent.over, totalLeft: spent.totalLeft },
        stateToken: saveSession(game, env),
        testimonies: publicTestimonies(caseData, game),
      }),
    };
  };
  try {
    return await exchange();
  } finally {
    if (pass?.ok) await pass.settle({ called });
  }
}
