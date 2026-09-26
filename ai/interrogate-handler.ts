/**
 * SERVER-ONLY. One interrogation exchange, end to end (the route is a thin
 * wrapper so this can be tested with any case and a mocked fetch).
 *
 *  request (Zod) -> verify signed state (bad -> reset, in character)
 *  -> engine checks (character exists, evidence discovered)
 *  -> engine effects + reveal decision (engine/interrogation.ts, secrets.ts)
 *  -> buildCharacterContext -> prompt with engine directives
 *  -> Grok (timeout, 1 retry on schema failure) -> Zod -> sanitise
 *  -> engine commits (clamped deltas, reveal only if performed) -> new token.
 * Any failure yields the in-character fallback. Logs are non-secret only.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { RESET_NOTICE, restoreSession, saveSession } from "@/engine/session";
import { cannedCharacterResponse } from "./canned-responses";
import { allowedTimes, checkTimes, findModernWord } from "./canon-check";
import { callGrok, type GrokResult } from "./grok";
import { InterrogateRequestSchema, type InterrogateResponseBody } from "./interrogate-schema";
import { buildSystemPrompt, buildUserMessage, type TurnDirectives } from "./prompts/interrogation";
import { createFallbackCharacterResponse, type CharacterResponse } from "./schemas";

type Env = Record<string, string | undefined>;

export { RESET_NOTICE };

export interface HandlerResult {
  status: number;
  body: InterrogateResponseBody;
  /** Non-secret diagnostics for logging/tests (never sent to the client). */
  diag: { grok?: Omit<GrokResult, "response">; reason?: string; revealed?: boolean };
}

export interface HandlerDeps {
  caseData: LoadedCase;
  env?: Env;
  /** Case assumed for legacy state tokens that predate caseId (the app's default case). */
  legacyCaseId?: string;
  /** Test hook: observe the exact prompt sent to the model. */
  onPrompt?: (p: { system: string; user: string }) => void;
}

const fallbackBody = (error: string, stateToken?: string, seed = 0): InterrogateResponseBody => ({
  response: createFallbackCharacterResponse({ seed }),
  source: "fallback",
  ...(stateToken ? { stateToken } : {}),
  error,
});

export async function handleInterrogate(json: unknown, deps: HandlerDeps): Promise<HandlerResult> {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = InterrogateRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: fallbackBody("invalid_request"), diag: { reason: "invalid_request" } };
  const { characterId, question, presentedEvidenceId, stateToken, caseId } = parsed.data;
  // The route resolves the case; a body naming a different one is a client bug, not a new game.
  if (caseId !== undefined && caseId !== caseData.id) {
    return { status: 404, body: fallbackBody("unknown_case"), diag: { reason: "unknown_case" } };
  }

  // 1. Signed state (absent = new game; present but invalid = reset in character).
  const { game, notice } = restoreSession(caseData, stateToken, env, { legacyCaseId });
  const withNotice = (b: InterrogateResponseBody) => (notice ? { ...b, notice } : b);
  const unchangedToken = () => saveSession(game, env);

  // 2. Engine checks.
  if (!caseData.characters.some((c) => c.id === characterId) || !game.characters[characterId]) {
    return { status: 404, body: withNotice(fallbackBody("unknown_character", unchangedToken())), diag: { reason: "unknown_character" } };
  }
  if (presentedEvidenceId && !game.discoveredEvidenceIds.includes(presentedEvidenceId)) {
    return {
      status: 400,
      body: withNotice(fallbackBody("evidence_not_discovered", unchangedToken(), game.turn)),
      diag: { reason: "evidence_not_discovered" },
    };
  }

  // 3. Engine effects + reveal decision, BEFORE the model sees anything.
  const plan = planTurn(caseData, game, characterId, presentedEvidenceId);
  const ch = caseData.characters.find((c) => c.id === characterId)!;
  const ev = presentedEvidenceId ? caseData.evidence.find((e) => e.id === presentedEvidenceId) : undefined;
  const secret = plan.revealSecretId ? ch.secrets.find((s) => s.id === plan.revealSecretId) : undefined;
  const directives: TurnDirectives = {
    exposedLieIds: plan.exposedLieIds,
    ...(secret ? { revealSecret: { id: secret.id, description: secret.description } } : {}),
    ...(ev ? { presentedEvidence: { id: ev.id, name: ev.name, description: ev.description } } : {}),
  };

  // 4. Scoped context -> prompt -> model.
  const ctx = buildCharacterContext({ caseData, game }, characterId);
  const system = buildSystemPrompt(ctx, directives);
  const user = buildUserMessage(ctx, question);
  deps.onPrompt?.({ system, user });
  // Canon post-check (#6): every clock time in the reply must come from this character's context.
  const allowed = allowedTimes(ctx, directives, question);
  // Era post-check (#13): no modern or meta vocabulary, even echoed back.
  const validate = (r: { dialogue: string; action?: string }) => {
    const said = `${r.dialogue} ${r.action ?? ""}`;
    const res = checkTimes(said, allowed);
    if (!res.ok) {
      return `You stated a time you do not know (${res.offending.map((t) => `"${t}"`).join(", ")}). Use only times from WHAT YOU KNOW or your stories, or stay vague ("I couldn't say, sir").`;
    }
    const modern = findModernWord(said);
    return modern
      ? `You used the modern word "${modern}". A 1920s character would never say or repeat it; react with period bafflement ("A what, sir?") without the word.`
      : null;
  };
  const grok = await callGrok({ system, user, env, validate });

  let response: CharacterResponse;
  let source: "model" | "fallback";
  if (grok.ok) {
    source = "model";
    // The model may only react to the clue shown THIS turn.
    response = {
      ...grok.response,
      evidenceReactions: grok.response.evidenceReactions.filter((r) => r.evidenceId === presentedEvidenceId).slice(0, 1),
    };
  } else {
    source = "fallback";
    response = cannedCharacterResponse(ctx, question, presentedEvidenceId, game.turn);
    console.warn(
      `[interrogate] fallback reason=${grok.reason}${grok.status ? ` status=${grok.status}` : ""} model=${grok.model} attempts=${grok.attempts} ms=${grok.latencyMs}`,
    );
  }

  // 5. Engine commits.
  const applied = commitTurn(game, plan, {
    playerText: question,
    dialogue: response.dialogue,
    emotion: response.emotion,
    intensity: response.intensity,
    stressDelta: response.stressDelta,
    trustDelta: response.trustDelta,
    performed: source === "model",
  });
  // Report the deltas the engine actually applied, never the raw suggestion.
  response = { ...response, stressDelta: applied.stressDelta, trustDelta: applied.trustDelta };

  const { response: _drop, ...grokDiag } = grok as GrokResult & { response?: unknown };
  void _drop;
  return {
    status: 200,
    body: withNotice({
      response,
      source,
      stateToken: saveSession(game, env),
      ...(source === "fallback" ? { error: grok.ok ? undefined : grok.reason } : {}),
    }),
    diag: { grok: grokDiag as Omit<GrokResult, "response">, revealed: applied.revealed },
  };
}
