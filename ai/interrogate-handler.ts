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
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { cannedCharacterResponse } from "./canned-responses";
import { callGrok, type GrokResult } from "./grok";
import { InterrogateRequestSchema, type InterrogateResponseBody } from "./interrogate-schema";
import { buildSystemPrompt, buildUserMessage, type TurnDirectives } from "./prompts/interrogation";
import { createFallbackCharacterResponse, type CharacterResponse } from "./schemas";

type Env = Record<string, string | undefined>;

export const RESET_NOTICE =
  "A gust of wind blows the detective's notebook out of the window! The pages are gone. Best start the questioning afresh.";

export interface HandlerResult {
  status: number;
  body: InterrogateResponseBody;
  /** Non-secret diagnostics for logging/tests (never sent to the client). */
  diag: { grok?: Omit<GrokResult, "response">; reason?: string; revealed?: boolean };
}

export interface HandlerDeps {
  caseData: LoadedCase;
  env?: Env;
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
  const { caseData, env } = deps;
  const parsed = InterrogateRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: fallbackBody("invalid_request"), diag: { reason: "invalid_request" } };
  const { characterId, question, presentedEvidenceId, stateToken } = parsed.data;

  // 1. Signed state (absent = new game; present but invalid = reset in character).
  let game: GameState;
  let notice: string | undefined;
  const decoded = decodeStateToken(stateToken, caseData, env);
  if (decoded.ok) game = decoded.game;
  else {
    game = createInitialGameState(caseData);
    if (decoded.reason !== "missing") notice = RESET_NOTICE;
  }
  const withNotice = (b: InterrogateResponseBody) => (notice ? { ...b, notice } : b);
  const unchangedToken = () => encodeStateToken(game, env);

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
  const grok = await callGrok({ system, user, env });

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
      stateToken: encodeStateToken(game, env),
      ...(source === "fallback" ? { error: grok.ok ? undefined : grok.reason } : {}),
    }),
    diag: { grok: grokDiag as Omit<GrokResult, "response">, revealed: applied.revealed },
  };
}
