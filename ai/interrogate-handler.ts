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
import { isTurnUnavailable, performTurn, type AttemptHook } from "./perform-turn";
import { answeredLine, breatherLine, stillAnsweringLine, unavailable, type Unavailable } from "./model-down";
import type { ModelGate } from "./model-gate";
import { claimTurn } from "./turn-lock";
import type { KvStore } from "@/lib/runtime-kv";
import { ensureGameId } from "@/engine/state-token";
import { InterrogateRequestSchema, type InterrogateResponseBody } from "./interrogate-schema";
import { createFallbackCharacterResponse } from "./schemas";
import { parseStoredReply, toPublicReply, type StoredReply } from "./public-reply";

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
  /** Cost protection (ai/model-gate.ts): kill switch, per-IP limit, daily cap. Absent = unlimited (tests, scripts). */
  gate?: ModelGate;
  /** One model turn per pre-turn state (#40, ai/turn-lock.ts). Absent = no duplicate check (tests, scripts). */
  claims?: KvStore;
  /** Tooling hook (scripts/eval-ai): every model reply and its guard verdict. */
  onAttempt?: AttemptHook;
}

/** The per-IP limit refused the turn: HTTP 429, nothing spent, the token is unchanged. */
export function breather(refusal: { retryAfterSec: number }, name: string): Unavailable {
  return { kind: "breather", line: breatherLine(name, refusal.retryAfterSec), retryAfter: refusal.retryAfterSec };
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
  const heldToken = notice ? unchangedToken() : (stateToken ?? unchangedToken());
  const name = caseData.characters.find((c) => c.id === characterId)?.name ?? "They";

  // #40: this exact state may be spent on the model once. A duplicate (parallel or replayed) costs nothing.
  const held = deps.claims && stateToken && !notice ? await claimTurn(deps.claims, ensureGameId(game), game.turn) : null;
  if (held && !held.ok) {
    // #49: an answered duplicate is handed the answer the player missed (public fields only) with the newest token.
    const stored = held.state === "answered" ? parseStoredReply(held.latestReply) : null;
    const replay = stored?.kind === "interrogate" && stored.characterId === characterId ? stored.response : null;
    return {
      status: 409,
      body: {
        response: createFallbackCharacterResponse({ seed: game.turn }),
        source: "unavailable",
        unavailable: { kind: "answered", line: held.state === "answered" ? answeredLine(name) : stillAnsweringLine(name) },
        ...(replay ? { answered: replay } : {}),
        stateToken: held.latestToken ?? heldToken,
        error: held.state === "answered" ? "already_answered" : "in_flight",
      },
      diag: { reason: "duplicate_turn" },
    };
  }
  const runTurn = async (): Promise<HandlerResult> => {
    // Cost protection, before anything is spent: one model turn (ai/model-gate.ts).
    const pass = deps.gate ? await deps.gate.open(1) : null;
    if (pass && !pass.ok && pass.reason === "rate_limited") {
      return {
        status: 429,
        body: withNotice({ response: createFallbackCharacterResponse({ seed: game.turn }), source: "unavailable", unavailable: breather(pass, name), stateToken: heldToken, error: pass.reason }),
        diag: { reason: pass.reason },
      };
    }
    // Daily cap or kill switch: the turn runs WITHOUT the model, exactly as if credits were out (the "quiet" line,
    // nothing spent), so the engine's deterministic contradiction beat still lands.
    const offline = pass && !pass.ok ? pass.reason : null;
    let called = true;
    let extra = 0;
    let turn: Awaited<ReturnType<typeof performTurn>>;
    try {
      turn = await performTurn({
        ...(deps.onAttempt ? { onAttempt: deps.onAttempt } : {}),
        caseData,
        game,
        characterId,
        question,
        move: { presentedEvidenceId, presentedTestimonyId },
        env,
        ...(offline ? { skipModel: "quota" as const } : {}),
        ...(deps.onPrompt ? { onPrompt: deps.onPrompt } : {}),
      });
      called = turn.grok.attempts > 0;
      // A rejected reply's single retry (canon / guilt-leak check) is a second paid call: it counts too.
      extra = Math.max(0, turn.grok.attempts - 1);
    } finally {
      if (pass?.ok) await pass.settle({ called, extra });
    }

    if (isTurnUnavailable(turn)) {
      // The model is out of reach: say so in character, spend nothing, hand back the state the client already holds.
      const { response: _r, ...down } = turn.grok as GrokResult & { response?: unknown };
      void _r;
      return {
        status: 503,
        body: withNotice({
          response: createFallbackCharacterResponse({ seed: game.turn }),
          source: "unavailable",
          unavailable: unavailable(turn.kind, name, game.turn),
          stateToken: heldToken,
          error: offline ?? turn.reason,
        }),
        diag: { grok: down as Omit<GrokResult, "response">, reason: offline ?? "model_unavailable" },
      };
    }
    const { response, source, grok, revealed, stress, contradiction } = turn;
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
  };
  try {
    const r = await runTurn();
    if (r.status === 200 && r.body.stateToken && held?.ok) {
      const stored: StoredReply = { kind: "interrogate", characterId, response: toPublicReply(r.body.response) };
      await held.answered(r.body.stateToken, stored);
    }
    return r;
  } finally {
    if (held?.ok) await held.release(); // no-op once answered
  }
}
