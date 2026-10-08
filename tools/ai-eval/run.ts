/**
 * The eval runner. RECORD calls xAI for real (budget-capped, every response's usage priced and kept in a ledger)
 * and writes one fixture per scenario; REPLAY feeds the recorded responses back through the full pipeline (handlers,
 * engine, guard) with fetch stubbed, so it is free and deterministic (CI, npm test).
 *
 * BEFORE = the assertions on each turn's raw first model output. AFTER = the assertions on the line the player sees.
 */
import { createHash } from "node:crypto";
import { handleConfront } from "@/ai/confront-handler";
import { resetGrokBreaker, XAI_CHAT_URL } from "@/ai/grok";
import type { GuardInput, GuardVerdict } from "@/ai/guard";
import { handleInterrogate } from "@/ai/interrogate-handler";
import type { LoadedCase } from "@/engine/case-schema";
import { coreGuiltSecretIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { GameState } from "@/engine/types";
import { assertLine, type Check, type Line } from "./assertions";
import type { Scenario, SetupHelpers } from "./scenarios";

/** xAI list prices for grok-4.20-0309-non-reasoning, prompts under 200k tokens (docs.x.ai/docs/models, 2026-10-08). */
export const PRICE_PER_M = { input: 1.25, cachedInput: 0.2, output: 2.5 };

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  /** xAI's own billed cost, in 1e-10 USD ticks (authoritative when present). */
  cost_in_usd_ticks?: number;
}

export function usageCost(u: Usage | undefined): number {
  if (!u) return 0;
  const prompt = u.prompt_tokens ?? 0;
  const cached = Math.min(prompt, u.prompt_tokens_details?.cached_tokens ?? 0);
  const out = (u.completion_tokens ?? 0) + (u.completion_tokens_details?.reasoning_tokens ?? 0);
  const priced = ((prompt - cached) * PRICE_PER_M.input + cached * PRICE_PER_M.cachedInput + out * PRICE_PER_M.output) / 1e6;
  // Keep the larger of our pricing and xAI's own figure, so the ledger never under-counts.
  return Math.max(priced, typeof u.cost_in_usd_ticks === "number" ? u.cost_in_usd_ticks / 1e10 : 0);
}

export interface RecordedCall {
  /** sha256 of the request messages (to spot a stale fixture). */
  promptHash: string;
  /** 1 = first attempt of a turn, 2 = the corrective retry. */
  attempt: number;
  status: number;
  /** The xAI response body as returned (choices, usage). Never request headers. */
  body: unknown;
  usage?: Usage;
  costUsd: number;
}

export interface Fixture {
  scenarioId: string;
  model: string;
  recordedAt: string;
  calls: RecordedCall[];
}

export interface Ledger {
  spentUsd: number;
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  /** Per-round spend (e.g. "gremlin-5"), so a round can carry its own cap alongside the cumulative one. */
  rounds?: Record<string, { spentUsd: number; calls: number }>;
}

export class BudgetExceeded extends Error {}

/** A round's cap: the round's id and its own USD ceiling (checked in addition to the cumulative cap). */
export interface RoundBudget {
  id: string;
  capUsd: number;
}

/**
 * Throw BudgetExceeded if a call whose worst case is `worstUsd` could push the cumulative ledger past `capUsd` or
 * the round's spend past its own cap. Pure (testable); the caller sends nothing when it throws.
 */
export function assertBudget(ledger: Ledger, worstUsd: number, capUsd: number, round?: RoundBudget): void {
  if (ledger.spentUsd + worstUsd > capUsd) throw new BudgetExceeded(`budget: $${ledger.spentUsd.toFixed(4)} spent, next call could cost $${worstUsd.toFixed(4)}, cap $${capUsd}`);
  if (round) {
    const r = ledger.rounds?.[round.id]?.spentUsd ?? 0;
    if (r + worstUsd > round.capUsd) throw new BudgetExceeded(`round budget (${round.id}): $${r.toFixed(4)} spent this round, next call could cost $${worstUsd.toFixed(4)}, round cap $${round.capUsd}`);
  }
}

/** Charge one call to the ledger (cumulative and, when given, the round). */
export function chargeLedger(ledger: Ledger, cost: number, usage: Usage | undefined, round?: RoundBudget): void {
  ledger.spentUsd += cost;
  ledger.calls += 1;
  ledger.promptTokens += usage?.prompt_tokens ?? 0;
  ledger.cachedTokens += usage?.prompt_tokens_details?.cached_tokens ?? 0;
  ledger.completionTokens += usage?.completion_tokens ?? 0;
  if (round) {
    ledger.rounds ??= {};
    const r = (ledger.rounds[round.id] ??= { spentUsd: 0, calls: 0 });
    r.spentUsd += cost;
    r.calls += 1;
  }
}

export interface TurnResult {
  characterId: string;
  before: Check[] | null;
  beforeReason?: string;
  after: Check[];
  source: string;
  rejects: string[];
}

export interface ScenarioResult {
  id: string;
  group: string;
  turns: TurnResult[];
  engine: string[];
  notes: string[];
}

const EVAL_ENV_SECRET = "eval-state-secret-0123456789abcdef";

function helpers(g: GameState, c: LoadedCase): SetupHelpers {
  return {
    discoverAll: () => {
      g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
    },
    discover: (...ids) => {
      g.discoveredEvidenceIds = [...new Set([...g.discoveredEvidenceIds, ...ids])];
    },
    showTestimony: (ch, ...ids) => {
      g.characters[ch].testimonyShownIds = [...new Set([...g.characters[ch].testimonyShownIds, ...ids])];
    },
    reveal: (ch, ...ids) => {
      for (const id of ids) {
        if (!g.revealedSecretIds.includes(id)) g.revealedSecretIds.push(id);
        if (!g.characters[ch].revealedSecretIds.includes(id)) g.characters[ch].revealedSecretIds.push(id);
      }
    },
    stress: (ch, v) => {
      g.characters[ch].stress = v;
    },
    shown: (ch, ...ids) => {
      g.characters[ch].evidenceShownIds = [...new Set([...g.characters[ch].evidenceShownIds, ...ids])];
    },
  };
}

const hashMessages = (body: string) => {
  try {
    return createHash("sha256").update(JSON.stringify((JSON.parse(body) as { messages: unknown }).messages)).digest("hex").slice(0, 16);
  } catch {
    return "unparsed";
  }
};
const attemptOf = (body: string) => {
  try {
    return Math.ceil((JSON.parse(body) as { messages: unknown[] }).messages.length / 2);
  } catch {
    return 1;
  }
};

export interface RunOptions {
  mode: "record" | "replay";
  /** Record: the real key (never logged or stored). */
  apiKey?: string;
  fixture?: Fixture;
  ledger?: Ledger;
  capUsd?: number;
  /** Record: an optional per-round cap, enforced alongside capUsd. */
  round?: RoundBudget;
  onFixture?: (f: Fixture) => void;
}

export async function runScenario(c: LoadedCase, s: Scenario, o: RunOptions): Promise<ScenarioResult> {
  const env = { XAI_API_KEY: o.mode === "record" ? o.apiKey : "replay-key-not-real", GAME_STATE_SECRET: EVAL_ENV_SECRET };
  const g = createInitialGameState(c);
  s.setup?.(g, helpers(g, c));
  const beforeRevealed = Object.fromEntries(c.characters.map((ch) => [ch.id, [...g.characters[ch.id].revealedSecretIds]]));
  const stateToken = encodeStateToken(g, env);

  const calls: RecordedCall[] = [];
  const notes: string[] = [];
  const realFetch = globalThis.fetch;
  let replayIdx = 0;
  let craftedIdx = 0;
  const stub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url) !== XAI_CHAT_URL) throw new Error(`eval: unexpected fetch to ${String(url)}`);
    const reqBody = String(init?.body ?? "");
    if (s.crafted) {
      // Crafted replay: scripted model output, free in both modes, nothing recorded.
      const r = s.crafted.replies[Math.min(craftedIdx++, s.crafted.replies.length - 1)];
      const content = JSON.stringify({ emotion: "nervous", intensity: 0.6, action: "", evidenceReactions: [], wantsToLeave: false, stressDelta: 0, trustDelta: 0, admits: [], ...r });
      const body = { id: `crafted-${s.id}-${craftedIdx}`, object: "chat.completion", model: "crafted", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (o.mode === "replay") {
      const rec = o.fixture?.calls[replayIdx++];
      if (!rec) {
        notes.push("replay exhausted: the pipeline asked for a call the recording does not have (treated as a model failure)");
        return new Response(JSON.stringify({ error: "replay exhausted" }), { status: 503 });
      }
      if (rec.promptHash !== hashMessages(reqBody) && !notes.includes("prompt changed since recording")) notes.push("prompt changed since recording");
      return new Response(JSON.stringify(rec.body), { status: rec.status, headers: { "content-type": "application/json" } });
    }
    // RECORD: refuse the call if its worst case could cross the cap (prompt chars/3 tokens + the full max_tokens).
    const ledger = o.ledger!;
    const worst = ((reqBody.length / 3) * PRICE_PER_M.input + 400 * PRICE_PER_M.output) / 1e6;
    assertBudget(ledger, worst, o.capUsd ?? 1.4, o.round);
    const res = await realFetch(url, init);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const usage = (body as { usage?: Usage })?.usage;
    const cost = usageCost(usage);
    chargeLedger(ledger, cost, usage, o.round);
    calls.push({ promptHash: hashMessages(reqBody), attempt: attemptOf(reqBody), status: res.status, body, ...(usage ? { usage } : {}), costUsd: cost });
    return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  };

  const attempts: { characterId: string; attempt: number; reply: Line; verdict: GuardVerdict | null; guard: GuardInput }[] = [];
  const onAttempt = (a: (typeof attempts)[number]) => attempts.push(a);
  const warn = console.warn;
  const rejects: { characterId: string; reason: string }[] = [];
  console.warn = (...args: unknown[]) => {
    const m = String(args[0]);
    if (m.startsWith("{")) {
      try {
        const j = JSON.parse(m) as { character: string; reason: string };
        rejects.push({ characterId: j.character, reason: j.reason });
      } catch {
        /* ignore */
      }
    }
  };
  globalThis.fetch = stub as typeof fetch;
  resetGrokBreaker();
  let lines: { characterId: string; response: Line; source: string }[] = [];
  let token: string | undefined;
  try {
    const t = s.turn;
    const item = { ...(t.presentedEvidenceId ? { presentedEvidenceId: t.presentedEvidenceId } : {}), ...(t.presentedTestimonyId ? { presentedTestimonyId: t.presentedTestimonyId } : {}) };
    if (t.kind === "interrogate") {
      const r = await handleInterrogate({ characterId: t.characterId, question: t.question, stateToken, ...item }, { caseData: c, env, onAttempt });
      if (!("response" in r.body) || !r.body.response) throw new Error(`eval ${s.id}: no response (${r.status} ${JSON.stringify(r.body).slice(0, 200)})`);
      lines = [{ characterId: t.characterId, response: r.body.response, source: r.body.source ?? "?" }];
      token = r.body.stateToken;
    } else {
      const r = await handleConfront({ characterIds: t.characterIds, question: t.question, stateToken, ...item }, { caseData: c, env, onAttempt });
      lines = r.body.lines.map((l) => ({ characterId: l.characterId, response: l.response, source: l.source }));
      token = r.body.stateToken;
      if (!lines.length) throw new Error(`eval ${s.id}: confrontation refused (${r.status} ${r.body.error})`);
    }
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
  if (o.mode === "record" && !s.crafted) o.onFixture?.({ scenarioId: s.id, model: "grok-4.20-0309-non-reasoning", recordedAt: new Date().toISOString(), calls });

  const heard = s.turn.question;
  const turns: TurnResult[] = lines.map((l) => {
    const mine = attempts.filter((a) => a.characterId === l.characterId);
    const first = mine.find((a) => a.attempt === 1);
    const guard = (first ?? mine[0])?.guard;
    const opts = { noSolution: s.noSolution, heard, ...(s.forbidden ? { forbidden: s.forbidden } : {}), ...(s.mustAddress ? { mustAddress: s.mustAddress } : {}), ...(s.mustConfess ? { mustConfess: s.mustConfess } : {}) };
    const before = first ? assertLine(first.reply, first.guard, c, opts) : null;
    const after = guard ? assertLine(l.response, guard, c, opts) : [];
    return {
      characterId: l.characterId,
      before,
      ...(first ? {} : { beforeReason: "no usable model output (schema-invalid or failed call)" }),
      after,
      source: l.source,
      rejects: rejects.filter((r) => r.characterId === l.characterId).map((r) => r.reason),
    };
  });

  // Engine assertions: at most one new secret per character turn, never a core-guilt secret.
  const engine: string[] = [];
  if (token) {
    const d = decodeStateToken(token, c, env);
    if (d.ok) {
      const core = coreGuiltSecretIds(c);
      for (const ch of c.characters) {
        const fresh = d.game.characters[ch.id].revealedSecretIds.filter((x) => !beforeRevealed[ch.id].includes(x));
        if (fresh.length > 1) engine.push(`${ch.id}: ${fresh.length} secrets in one exchange`);
        for (const x of fresh) if (core.has(x)) engine.push(`${ch.id}: core-guilt secret ${x} revealed`);
        if (s.expectReveal && ch.id in s.expectReveal) {
          const want = s.expectReveal[ch.id];
          if ((fresh[0] ?? null) !== want) engine.push(`${ch.id}: revealed ${fresh[0] ?? "nothing"}, expected ${want ?? "nothing"}`);
        }
      }
    }
  }
  if (s.expectAssertFail?.length) {
    for (const t of turns) {
      const missing = s.expectAssertFail.filter((x) => !t.after.includes(x as Check));
      if (missing.length) engine.push(`eval: ${t.characterId}'s line was expected to fail ${missing.join(",")} (negative control)`);
      t.after = t.after.filter((x) => !s.expectAssertFail!.includes(x));
      if (t.before) t.before = t.before.filter((x) => !s.expectAssertFail!.includes(x));
    }
  }
  if (s.crafted) {
    const firstRejects = attempts.filter((a) => a.attempt === 1).map((a) => (a.verdict ? a.verdict.reason : null));
    if (s.crafted.rejectFirst && !firstRejects.some((r) => r && s.crafted!.rejectFirst!.includes(r)))
      engine.push(`guard: crafted line not rejected with ${s.crafted.rejectFirst.join("|")} (got ${firstRejects.map((r) => r ?? "accepted").join(",")})`);
    if (s.crafted.acceptFirst && firstRejects.some((r) => r)) engine.push(`guard: crafted control line rejected (${firstRejects.filter(Boolean).join(",")})`);
  }
  return { id: s.id, group: s.group, turns, engine, notes };
}

export function summarize(results: ScenarioResult[]) {
  const turns = results.flatMap((r) => r.turns);
  const withBefore = turns.filter((t) => t.before !== null);
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
  const beforePass = withBefore.filter((t) => t.before!.length === 0).length;
  const afterPass = turns.filter((t) => t.after.length === 0).length;
  const scenBefore = results.filter((r) => r.turns.every((t) => t.before !== null && t.before.length === 0)).length;
  const scenAfter = results.filter((r) => r.turns.every((t) => t.after.length === 0) && r.engine.length === 0).length;
  const byCheck = (k: "before" | "after") => {
    const m: Record<string, number> = {};
    for (const t of turns) for (const f of t[k] ?? []) m[f] = (m[f] ?? 0) + 1;
    return m;
  };
  return {
    scenarios: results.length,
    turns: turns.length,
    before: { turnPass: `${beforePass}/${withBefore.length} (${pct(beforePass, withBefore.length)})`, scenarioPass: `${scenBefore}/${results.length} (${pct(scenBefore, results.length)})`, failures: byCheck("before") },
    after: { turnPass: `${afterPass}/${turns.length} (${pct(afterPass, turns.length)})`, scenarioPass: `${scenAfter}/${results.length} (${pct(scenAfter, results.length)})`, failures: byCheck("after") },
    fallbacks: turns.filter((t) => t.source === "fallback").length,
    rejects: turns.reduce((n, t) => n + t.rejects.length, 0),
    engineFailures: results.flatMap((r) => r.engine.map((e) => `${r.id}: ${e}`)),
  };
}
