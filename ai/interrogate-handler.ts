/**
 * SERVER-ONLY. One interrogation exchange, end to end (the route is a thin
 * wrapper so this can be tested with any case and a mocked fetch).
 *
 *  request (Zod) -> verify signed state (bad -> reset, in character)
 *  -> engine checks (character exists, evidence discovered, testimony revealed)
 *  -> engine effects + reveal decision (engine/interrogation.ts, secrets.ts)
 *  -> buildCharacterContext -> prompt with engine directives
 *  -> Grok (timeout, 1 retry on schema failure) -> Zod -> sanitise
 *  -> engine commits (clamped deltas, reveal only if performed) -> new token.
 * Any failure yields the in-character fallback. Logs are non-secret only.
 */
import type { LoadedCase } from "@/engine/case-schema";
import { attachProgress } from "@/engine/route-progress";
import { CASE_CLOSED_LINE, isCaseClosed, RESET_NOTICE, restoreSession, saveSession } from "@/engine/session";
import { publicTestimonies, revealedSecretIds } from "@/engine/testimony";
import type { GrokResult } from "./grok";
import { performTurn } from "./perform-turn";
import { InterrogateRequestSchema, type InterrogateResponseBody } from "./interrogate-schema";
import { createFallbackCharacterResponse } from "./schemas";

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
  const r = await handleInterrogateCore(json, deps);
  return { ...r, body: attachProgress(deps.caseData, json, r.body, deps) };
}

async function handleInterrogateCore(json: unknown, deps: HandlerDeps): Promise<HandlerResult> {
  const { caseData, env, legacyCaseId } = deps;
  const parsed = InterrogateRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: fallbackBody("invalid_request"), diag: { reason: "invalid_request" } };
  const { characterId, question, presentedEvidenceId, presentedTestimonyId, stateToken, caseId } = parsed.data;
  // The route resolves the case; a body naming a different one is a client bug, not a new game.
  if (caseId !== undefined && caseId !== caseData.id) {
    return { status: 404, body: fallbackBody("unknown_case"), diag: { reason: "unknown_case" } };
  }

  // 1. Signed state (absent = new game; present but invalid = reset in character).
  const { game, notice } = restoreSession(caseData, stateToken, env, { legacyCaseId });
  const withNotice = (b: InterrogateResponseBody) => (notice ? { ...b, notice } : b);
  const unchangedToken = () => saveSession(game, env);
  // Game over: everyone has gone quiet (no model call, state unchanged).
  if (isCaseClosed(game)) {
    return {
      status: 409,
      body: {
        response: { ...createFallbackCharacterResponse({ seed: game.turn }), dialogue: CASE_CLOSED_LINE, emotion: "calm", evidenceReactions: [], stressDelta: 0, trustDelta: 0 },
        source: "fallback",
        stateToken: unchangedToken(),
        error: "case_closed",
      },
      diag: { reason: "case_closed" },
    };
  }
  if (presentedEvidenceId && presentedTestimonyId) {
    return { status: 400, body: withNotice(fallbackBody("present_one_item", unchangedToken(), game.turn)), diag: { reason: "present_one_item" } };
  }

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

  // Testimony must be a secret the engine has revealed in THIS signed game.
  if (presentedTestimonyId && !revealedSecretIds(game).includes(presentedTestimonyId)) {
    return {
      status: 400,
      body: withNotice(fallbackBody("testimony_not_revealed", unchangedToken(), game.turn)),
      diag: { reason: "testimony_not_revealed" },
    };
  }

  // 3-5. Engine effects + reveal decision, prompt, model (or fallback), engine commit (ai/perform-turn.ts).
  const { response, source, grok, revealed, stress, contradiction } = await performTurn({
    caseData,
    game,
    characterId,
    question,
    move: { presentedEvidenceId, presentedTestimonyId },
    env,
    ...(deps.onPrompt ? { onPrompt: deps.onPrompt } : {}),
  });

  const { response: _drop, ...grokDiag } = grok as GrokResult & { response?: unknown };
  void _drop;
  return {
    status: 200,
    body: withNotice({
      response,
      source,
      stateToken: saveSession(game, env),
      testimonies: publicTestimonies(caseData, game),
      stress,
      ...(contradiction ? { contradiction } : {}),
      ...(source === "fallback" ? { error: grok.ok ? undefined : grok.reason } : {}),
    }),
    diag: { grok: grokDiag as Omit<GrokResult, "response">, revealed },
  };
}
