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
 *    by the usual testimony rules, with the contradiction beat).
 */
import type { LoadedCase } from "@/engine/case-schema";
import { CONFRONTATION_PRESSURE, MAX_CONFRONTATION_TURNS, openConfrontation, relieveBystanders, spendExchange, testimonyToThrow } from "@/engine/confrontation";
import { clampStress } from "@/engine/stress";
import { CASE_CLOSED_LINE, isCaseClosed, restoreSession, saveSession } from "@/engine/session";
import { publicTestimonies } from "@/engine/testimony";
import { ConfrontRequestSchema, type ConfrontLine, type ConfrontResponseBody } from "./confront-schema";
import { performTurn } from "./perform-turn";
import { buildUserMessage } from "./prompts/interrogation";

type Env = Record<string, string | undefined>;

export interface ConfrontDeps {
  caseData: LoadedCase;
  env?: Env;
  legacyCaseId?: string;
  onPrompt?: (p: { system: string; user: string; characterId: string }) => void;
}

export const CONFRONT_LINES = {
  pair_finished: "The two of them fold their arms and turn their backs on each other. They have said all they are going to say to each other tonight.",
  same_character: "You can't very well sit someone down opposite themselves, detective.",
  unknown_character: "You glance around the hall. There's nobody here by that name.",
} as const;

export async function handleConfront(json: unknown, deps: ConfrontDeps): Promise<{ status: number; body: ConfrontResponseBody }> {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = ConfrontRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { lines: [], error: "invalid_request" } };
  const { caseId, characterIds, question, stateToken } = parsed.data;
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
  const gate = openConfrontation(game, aId, bId);
  if (!gate.ok) return { status: gate.reason === "pair_finished" ? 409 : 400, body: base({ lines: [], line: CONFRONT_LINES[gate.reason], error: gate.reason, stateToken: saveSession(game, env) }) };

  // Face-to-face pressure (engine rule), before either side's reveal is decided.
  for (const id of [aId, bId]) game.characters[id].stress = clampStress(game.characters[id].stress + CONFRONTATION_PRESSURE);
  relieveBystanders(game, [aId, bId]);
  const thrown = testimonyToThrow(caseData, game, aId, bId);
  const thrownCard = thrown ? publicTestimonies(caseData, game).find((t) => t.id === thrown) : undefined;
  const onPrompt = (id: string) => (deps.onPrompt ? (p: { system: string; user: string }) => deps.onPrompt!({ ...p, characterId: id }) : undefined);

  // 1. A answers the detective, in front of B.
  const first = await performTurn({
    caseData,
    game,
    characterId: aId,
    question,
    confrontation: { partnerName: b.name, role: "addressed", ...(thrownCard ? { throwTestimony: { summary: thrownCard.summary } } : {}) },
    memoryText: `(Face to face with ${b.name}) ${question}`,
    env,
    ...(onPrompt(aId) ? { onPrompt: onPrompt(aId) } : {}),
  });

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
      buildUserMessage(ctx, question)
        .replace("THE DETECTIVE NOW SAYS:", `THE DETECTIVE, questioning ${a.name} in front of you, says:`)
        .replace(`Respond as ${ctx.persona.name}`, `${a.name} answered (see the directive). Now react to ${a.name} as ${ctx.persona.name}`),
    env,
    ...(onPrompt(bId) ? { onPrompt: onPrompt(bId) } : {}),
  });

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
      confrontation: { characterIds: [aId, bId], turnsUsed: spent.turnsUsed, max: MAX_CONFRONTATION_TURNS, over: spent.over },
      stateToken: saveSession(game, env),
      testimonies: publicTestimonies(caseData, game),
    }),
  };
}
