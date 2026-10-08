/**
 * SERVER-ONLY. One character's turn, engine first: plan (engine effects +
 * reveal decision) -> scoped context -> prompt with engine directives -> Grok
 * (canon/era/breakdown post-checks, one retry) or the in-character fallback ->
 * engine commit. Shared by /api/interrogate and /api/confront so both follow
 * exactly the same rules. Mutates `game`.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, type CharacterContext } from "@/engine/context-builder";
import { guiltProfile } from "@/engine/core-guilt";
import { commitTurn, planTurn, type PresentMove, type TurnPlan } from "@/engine/interrogation";
import { stressBand, type StressReading } from "@/engine/stress";
import { publicTestimonies } from "@/engine/testimony";
import type { GameState } from "@/engine/types";
import { cannedCharacterResponse } from "./canned-responses";
import { fixArticles } from "./text-fixes";
import { canonTimes } from "./canon-check";
import { findGuiltLeak } from "./guilt-check";
import { checkReply, CONTRACT_REASONS, logReject, safeDeflection, type GuardInput, type GuardVerdict } from "./guard";
import { variedConfrontationFallback } from "./confront-check";
import { callGrok, isModelDown, isQuotaFailure, type GrokFailure, type GrokResult } from "./grok";
import type { ModelDownKind } from "./model-down";
import type { Contradiction } from "./interrogate-schema";
import { buildSystemPrompt, buildUserMessage, type ConfrontDirective, type TurnDirectives } from "./prompts/interrogation";
import type { CharacterResponse } from "./schemas";

type Env = Record<string, string | undefined>;

export interface TurnInput {
  caseData: LoadedCase;
  game: GameState;
  characterId: string;
  /** What the detective said (for the prompt and the canon check). */
  question: string;
  move?: PresentMove;
  /** Confrontation staging (who else is in the room, what they just said). */
  confrontation?: ConfrontDirective;
  /** Text recorded in the character's memory for the player's side (defaults to `question`). */
  memoryText?: string;
  /** Custom user message (confrontation); defaults to buildUserMessage(ctx, question). */
  userMessage?: (ctx: CharacterContext) => string;
  env?: Env;
  onPrompt?: (p: { system: string; user: string }) => void;
  /** Do not call the model; treat it as this failure (the cost gate's daily cap or kill switch). */
  skipModel?: GrokFailure;
}

export interface TurnOutput {
  response: CharacterResponse;
  source: "model" | "fallback";
  grok: GrokResult;
  plan: TurnPlan;
  revealed: boolean;
  stress: StressReading;
  contradiction?: Contradiction;
}

/** The model could not answer. Nothing was committed: the caller must return the state it was given. */
export interface TurnUnavailable {
  unavailable: true;
  kind: ModelDownKind;
  reason: GrokFailure;
  grok: GrokResult;
}

export const isTurnUnavailable = (o: TurnOutput | TurnUnavailable): o is TurnUnavailable => "unavailable" in o;

/** Everything the model sees for one turn, and the contract its reply is checked against. Mutates `game` (planTurn). */
export interface PreparedTurn {
  plan: TurnPlan;
  ctx: CharacterContext;
  directives: TurnDirectives;
  system: string;
  user: string;
  guard: GuardInput;
}

/**
 * Plan the turn and build the exact prompt (shared by performTurn, scripts/audit-prompts and scripts/eval-ai, so the
 * audit and the eval see the real thing). Mutates `game` the way planTurn does.
 */
export function prepareTurn(t: Omit<TurnInput, "env" | "onPrompt" | "skipModel">): PreparedTurn {
  const { caseData, game, characterId, question, move = {} } = t;
  const { presentedEvidenceId, presentedTestimonyId } = move;
  const plan = planTurn(caseData, game, characterId, { ...move, playerText: question, addressed: t.confrontation?.role !== "reacting" });
  const ch = caseData.characters.find((c) => c.id === characterId)!;
  const ev = presentedEvidenceId ? caseData.evidence.find((e) => e.id === presentedEvidenceId) : undefined;
  const secret = plan.revealSecretId ? ch.secrets.find((s) => s.id === plan.revealSecretId) : undefined;
  const testimony = presentedTestimonyId ? publicTestimonies(caseData, game).find((x) => x.id === presentedTestimonyId) : undefined;
  const directives: TurnDirectives = {
    exposedLieIds: plan.exposedLieIds,
    ...(plan.retiredLieIds.length ? { retiredLieIds: plan.retiredLieIds } : {}),
    ...(plan.breakdown ? { breakdown: true } : {}),
    ...(secret ? { revealSecret: { id: secret.id, description: secret.description } } : {}),
    ...(ev ? { presentedEvidence: { id: ev.id, name: ev.name, description: ev.description } } : {}),
    ...(testimony ? { presentedTestimony: { id: testimony.id, characterName: testimony.characterName, summary: testimony.summary } } : {}),
    ...(t.confrontation ? { confrontation: t.confrontation } : {}),
  };

  const ctx = buildCharacterContext({ caseData, game }, characterId);
  // Guilt-leak check (ai/guilt-check.ts): nobody confesses the murder before the accusation. A token from before this
  // rule may still hold such a line in the conversation; it is not replayed to the model.
  const guilt = guiltProfile(caseData);
  const scrub = <T extends { text: string }>(m: T): T => (findGuiltLeak(m.text, guilt, characterId) ? { ...m, text: "(I have nothing more to say about that.)" } : m);
  ctx.memory = ctx.memory.map((m) => (m.speaker === "character" ? scrub(m) : m));
  ctx.statements = ctx.statements.map(scrub);
  const system = buildSystemPrompt(ctx, directives);
  const user = t.userMessage ? t.userMessage(ctx) : buildUserMessage(ctx, question, t.confrontation ? { partnerName: t.confrontation.partnerName } : {});
  // Canon post-check (#6): every clock time must come from this character's context (or what was just said to them).
  const heard = [question, t.confrontation?.partnerLine ?? ""].join(" ");
  const guard: GuardInput = {
    caseData,
    characterId,
    ctx,
    directives,
    guilt,
    allowedTimes: canonTimes(ctx, directives, heard),
    heard,
    promptText: `${system}\n${user}`,
    ...(t.confrontation ? { confrontation: t.confrontation } : {}),
  };
  return { plan, ctx, directives, system, user, guard };
}

export async function performTurn(t: TurnInput): Promise<TurnOutput | TurnUnavailable> {
  const { caseData, game, characterId, question, move = {}, env } = t;
  const { presentedEvidenceId, presentedTestimonyId } = move;
  const { plan, ctx, system, user, guard } = prepareTurn(t);
  const ch = caseData.characters.find((c) => c.id === characterId)!;
  if (!t.skipModel) t.onPrompt?.({ system, user });
  // The output contract (ai/guard.ts): every attempt is checked; each rejection is logged as one JSON line.
  let attempt = 0;
  let lastReject: GuardVerdict | null = null;
  const validate = (r: { dialogue: string; action?: string; admits?: string[] }) => {
    attempt += 1;
    lastReject = checkReply(r, guard);
    if (lastReject) logReject({ gameId: game.gameId, characterId, reason: lastReject.reason, attempt, detail: lastReject.detail });
    return lastReject?.note ?? null;
  };
  // skipModel: the cost gate (ai/model-gate.ts) has the model switched off; behave exactly as if the call had failed.
  const grok: GrokResult = t.skipModel
    ? { ok: false, reason: t.skipModel, model: "none", attempts: 0, latencyMs: 0, skipped: true }
    : await callGrok({ system, user, env, validate });

  let response: CharacterResponse;
  let source: "model" | "fallback";
  if (grok.ok) {
    source = "model";
    // The model may only react to the clue shown THIS turn.
    const { admits: _admits, ...reply } = grok.response;
    void _admits;
    response = { ...reply, dialogue: fixArticles(grok.response.dialogue), ...(grok.response.action ? { action: fixArticles(grok.response.action) } : {}), evidenceReactions: grok.response.evidenceReactions.filter((r) => r.evidenceId === presentedEvidenceId).slice(0, 1) };
  } else if (isModelDown(grok.reason) && !(plan.newlyExposedLieIds.length > 0 && (presentedEvidenceId || presentedTestimonyId))) {
    // Model out of reach: no improvised line, nothing committed (stress, trust, turn count, reveals all stay as they were).
    console.warn(`[turn] unavailable reason=${grok.reason}${grok.status ? ` status=${grok.status}` : ""}${grok.skipped ? " (breaker)" : ""} model=${grok.model} attempts=${grok.attempts} ms=${grok.latencyMs}`);
    return { unavailable: true, kind: isQuotaFailure(grok.reason) ? "quiet" : "busy", reason: grok.reason, grok };
  } else {
    // Either the model answered but broke the canon rules twice (the engine's own wording stands in), or the player held up
    // a clue/testimony that the ENGINE has just proved a lie: that contradiction beat does not need the model, so it is shown.
    source = "fallback";
    response = cannedCharacterResponse(ctx, question, presentedEvidenceId, game.turn);
    const rejected = lastReject as GuardVerdict | null;
    if (!grok.ok && grok.reason === "canon_check_failed" && rejected && CONTRACT_REASONS.has(rejected.reason)) {
      // The model broke the output contract twice (a guilt leak, an unlocked secret, an invented person): a safe
      // deflection keyed to the character and their stress, no third call.
      const d = safeDeflection(ctx, rejected.reason, game.turn);
      response = { ...response, dialogue: d.dialogue, action: d.action, emotion: d.emotion, intensity: 0.6 };
    } else if (t.confrontation && !presentedEvidenceId) {
      // Face to face the generic one-on-one lines read oddly and repeat: pick a varied line aimed at the partner (#27).
      const v = variedConfrontationFallback(ctx, t.confrontation.partnerName, game.turn);
      response = { ...response, dialogue: v.dialogue, action: v.action, emotion: "defensive", intensity: 0.5 };
    }
    console.warn(`[turn] fallback reason=${grok.reason}${grok.status ? ` status=${grok.status}` : ""} model=${grok.model} attempts=${grok.attempts} ms=${grok.latencyMs}`);
  }

  const applied = commitTurn(
    game,
    plan,
    {
      playerText: t.memoryText ?? question,
      dialogue: response.dialogue,
      emotion: response.emotion,
      intensity: response.intensity,
      stressDelta: response.stressDelta,
      trustDelta: response.trustDelta,
      performed: source === "model",
    },
    t.confrontation ? "confrontation" : "interrogation",
  );
  // Report what the engine applied, never the raw suggestion, and the emotion after the stress floor.
  response = { ...response, emotion: applied.emotion, stressDelta: applied.stressDelta, trustDelta: applied.trustDelta };
  const stress: StressReading = { value: applied.stress, band: stressBand(applied.stress), breakdown: applied.brokeDown };
  // Deterministic verdict from the engine's plan (independent of the model's performance).
  const contradiction: Contradiction | undefined =
    plan.newlyExposedLieIds.length > 0 && (presentedEvidenceId || presentedTestimonyId)
      ? {
          characterId,
          characterName: ch.name,
          item: presentedEvidenceId ? { kind: "evidence", id: presentedEvidenceId } : { kind: "testimony", id: presentedTestimonyId! },
          lieCount: plan.newlyExposedLieIds.length,
        }
      : undefined;
  return { response, source, grok, plan, revealed: applied.revealed, stress, ...(contradiction ? { contradiction } : {}) };
}
