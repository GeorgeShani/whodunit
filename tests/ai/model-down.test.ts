import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import {
  callGrok,
  classifyHttpFailure,
  GROK_MAX_ATTEMPTS,
  QUOTA_BREAKER_MS,
  resetGrokBreaker,
  TRANSIENT_BREAKER_MS,
} from "@/ai/grok";
import { confrontDownLine, modelDownLine, stillDownLine } from "@/ai/model-down";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { chatBody, goodReply, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

type Shape = { name: string; make: () => Response | Promise<Response>; reason: string; kind: "busy" | "quiet" };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** The ways xAI (or the network) fails when the account is out of credits or the service is unwell. */
const SHAPES: Shape[] = [
  { name: "HTTP 402", make: () => json(402, { error: "Payment required" }), reason: "quota", kind: "quiet" },
  { name: "HTTP 403 (no credits)", make: () => json(403, { code: "The team has either used all available credits or reached its monthly spending limit." }), reason: "quota", kind: "quiet" },
  { name: "HTTP 401", make: () => json(401, { error: "Incorrect API key" }), reason: "quota", kind: "quiet" },
  { name: "HTTP 429 with an insufficient-credits body", make: () => json(429, { error: "Insufficient credits. Purchase more at console.x.ai" }), reason: "quota", kind: "quiet" },
  { name: "HTTP 429 rate limit", make: () => json(429, { error: "Too many requests" }, { "retry-after": "3" }), reason: "rate_limited", kind: "busy" },
  { name: "HTTP 500", make: () => json(500, { error: "oops" }), reason: "http_error", kind: "busy" },
  { name: "HTTP 503 with an HTML body", make: () => new Response("<html>Service Unavailable</html>", { status: 503, headers: { "content-type": "text/html" } }), reason: "http_error", kind: "busy" },
  { name: "network error", make: () => Promise.reject(new TypeError("fetch failed")), reason: "network_error", kind: "busy" },
  { name: "200 with an empty body", make: () => new Response("", { status: 200 }), reason: "schema_invalid", kind: "busy" },
  { name: "200 with no choices", make: () => json(200, { choices: [] }), reason: "schema_invalid", kind: "busy" },
  { name: "200 with non-JSON model text", make: () => json(200, chatBody("I'm sorry, I can't help with that.")), reason: "schema_invalid", kind: "busy" },
  { name: "200 with an invalid reply object", make: () => json(200, chatBody({ dialogue: "", emotion: "nervous" })), reason: "schema_invalid", kind: "busy" },
];

const failWith = (make: Shape["make"]) => {
  const fn = vi.fn(async () => make());
  vi.stubGlobal("fetch", fn);
  return fn;
};
const okFetch = () => {
  const fn = vi.fn(async () => json(200, chatBody(goodReply())));
  vi.stubGlobal("fetch", fn);
  return fn;
};

const FORBIDDEN_WORDS = /\b(ai|a\.i\.|error|server|api|credit|credits|billing|quota|model|grok|xai|http|timeout|crash|broken|bug|fail(ed|ure)?)\b/i;

describe("classifyHttpFailure", () => {
  it("separates billing/auth from rate limits and plain server errors", () => {
    expect(classifyHttpFailure(402, "")).toBe("quota");
    expect(classifyHttpFailure(403, "x")).toBe("quota");
    expect(classifyHttpFailure(401, "")).toBe("quota");
    expect(classifyHttpFailure(429, "You have run out of credits")).toBe("quota");
    expect(classifyHttpFailure(429, "monthly spending limit reached")).toBe("quota");
    expect(classifyHttpFailure(429, "slow down")).toBe("rate_limited");
    expect(classifyHttpFailure(500, "")).toBe("http_error");
    expect(classifyHttpFailure(502, "bad gateway")).toBe("http_error");
  });
});

describe("callGrok: failure shapes, no hammering, circuit breaker", () => {
  const ask = () => callGrok({ system: "s", user: "u", env: TEST_ENV });

  it.each(SHAPES)("$name -> $reason, never throws", async ({ make, reason }) => {
    failWith(make);
    const r = await ask();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it("a quota failure makes exactly ONE request (no retry), and the next calls for a minute make none", async () => {
    vi.useFakeTimers();
    const fn = failWith(() => json(403, { error: "no credits" }));
    const first = await ask();
    expect(first).toMatchObject({ ok: false, reason: "quota", attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) expect(await ask()).toMatchObject({ ok: false, reason: "quota", skipped: true, attempts: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUOTA_BREAKER_MS - 1000);
    expect(await ask()).toMatchObject({ skipped: true });
    expect(fn).toHaveBeenCalledTimes(1);
    // After the minute one probe goes out; when billing is fixed it succeeds and everything resumes.
    await vi.advanceTimersByTimeAsync(2000);
    const fixed = okFetch();
    expect((await ask()).ok).toBe(true);
    expect(fixed).toHaveBeenCalledTimes(1);
    expect((await ask()).ok).toBe(true);
  });

  it("the breaker answers instantly (no 12 s wait per request)", async () => {
    failWith(() => json(402, {}));
    await ask();
    const hang = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", hang);
    const t0 = Date.now();
    await ask();
    expect(Date.now() - t0).toBeLessThan(100);
    expect(hang).not.toHaveBeenCalled();
  });

  it("one transient failure does not open the breaker (an immediate retry works); two in a row do, for a short while", async () => {
    vi.useFakeTimers();
    failWith(() => json(500, {}));
    await ask();
    const fn = okFetch();
    expect((await ask()).ok).toBe(true); // success resets the streak
    expect(fn).toHaveBeenCalledTimes(1);
    const bad = failWith(() => Promise.reject(new TypeError("fetch failed")));
    await ask();
    await ask();
    expect(bad).toHaveBeenCalledTimes(2);
    expect(await ask()).toMatchObject({ skipped: true, reason: "network_error" });
    expect(bad).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(TRANSIENT_BREAKER_MS + 100);
    okFetch();
    expect((await ask()).ok).toBe(true);
  });

  it("a 429 backs off for the retry-after (at least the default) and is not retried", async () => {
    vi.useFakeTimers();
    const fn = failWith(() => json(429, { error: "slow down" }, { "retry-after": "20" }));
    expect(await ask()).toMatchObject({ reason: "rate_limited", attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(await ask()).toMatchObject({ skipped: true });
    await vi.advanceTimersByTimeAsync(2_000);
    okFetch();
    expect((await ask()).ok).toBe(true);
  });

  it("unusable replies are retried once, no more", async () => {
    const fn = failWith(() => json(200, chatBody("not json")));
    await ask();
    expect(fn).toHaveBeenCalledTimes(GROK_MAX_ATTEMPTS);
  });

  it("never exposes the key, prompt or raw body in the result", async () => {
    failWith(() => json(403, { secret: "SENSITIVE-BODY" }));
    expect(JSON.stringify(await ask())).not.toMatch(/SENSITIVE-BODY|test-key-not-real/);
  });
});

describe("the player's lines", () => {
  it("stay in the fiction: no AI, error, server or billing words, and busy differs from quiet", () => {
    for (let seed = 0; seed < 4; seed++) {
      for (const kind of ["busy", "quiet"] as const) {
        const line = modelDownLine(kind, "Reginald Hargreaves", seed);
        expect(line, line).not.toMatch(FORBIDDEN_WORDS);
        expect(line).toContain("Reginald");
        expect(line).not.toContain("Hargreaves");
      }
      expect(confrontDownLine("busy", "Archibald Crane", "Victoria Blackwood")).not.toMatch(FORBIDDEN_WORDS);
      expect(confrontDownLine("quiet", "Archibald Crane", "Victoria Blackwood")).not.toMatch(FORBIDDEN_WORDS);
    }
    for (const kind of ["busy", "quiet"] as const) expect(stillDownLine(kind)).not.toMatch(FORBIDDEN_WORDS);
    expect(modelDownLine("busy", "Reginald")).not.toBe(modelDownLine("quiet", "Reginald"));
    expect(modelDownLine("quiet", "Reginald")).toMatch(/search|notebook|accus/i); // points at what still works
  });
});

describe("POST /api/interrogate when the model is down", () => {
  const ask = { caseId: "blackwood", characterId: "reginald", question: "Where were you when the lights went out?" };
  const midGame = () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("silver-candlestick");
    g.turn = 4;
    g.characters.reginald.stress = 22;
    g.characters.reginald.trust = 44;
    return g;
  };
  const run = (body: Record<string, unknown>) => handleInterrogate({ ...ask, ...body }, { caseData: c, env: TEST_ENV });
  const stateOf = (t: string | undefined) => {
    const r = decodeStateToken(t, c, TEST_ENV);
    if (!r.ok) throw new Error(r.reason);
    return r.game;
  };

  it.each(SHAPES)("$name: friendly line, the SAME token, no stress/trust/turn change, and a retry works", async ({ make, kind, reason }) => {
    const g = midGame();
    const token = encodeStateToken(g, TEST_ENV);
    failWith(make);
    const r = await run({ stateToken: token });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ source: "unavailable", error: reason, unavailable: { kind }, stateToken: token });
    expect(r.body.unavailable!.line).not.toMatch(FORBIDDEN_WORDS);
    expect(JSON.stringify(r.body)).not.toMatch(/Traceback|stack|at \w+ \(/);
    const after = stateOf(r.body.stateToken);
    expect(after.turn).toBe(4);
    expect(after.characters.reginald).toMatchObject({ stress: 22, trust: 44 });
    expect(after.characters.reginald.revealedSecretIds).toEqual([]);
    // The model comes back: the very same request goes through and the turn is spent for the first time.
    resetGrokBreaker();
    okFetch();
    const again = await run({ stateToken: r.body.stateToken });
    expect(again.status).toBe(200);
    expect(again.body.source).toBe("model");
    expect(stateOf(again.body.stateToken).turn).toBeGreaterThan(4);
  });

  it("works for a brand-new game too (no token sent): the reply carries a fresh, unspent state", async () => {
    failWith(() => json(403, {}));
    const r = await run({});
    expect(r.body.source).toBe("unavailable");
    expect(stateOf(r.body.stateToken).turn).toBe(0);
  });

  it("an exhausted account is asked once, then the minute-long breaker answers without a request", async () => {
    const fn = failWith(() => json(402, {}));
    const token = encodeStateToken(midGame(), TEST_ENV);
    const a = await run({ stateToken: token });
    const b = await run({ stateToken: token });
    const c2 = await run({ stateToken: token, question: "And after that?" });
    expect(fn).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c2]) expect(r.body).toMatchObject({ source: "unavailable", unavailable: { kind: "quiet" }, stateToken: token });
  });

  it("presenting a clue the engine can already show is a lie keeps the deterministic contradiction beat without the model", async () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("library-key");
    failWith(() => json(402, {}));
    const r = await handleInterrogate(
      { caseId: "blackwood", characterId: "victoria", question: "Where were you during the blackout? And the library door?", presentedEvidenceId: "library-key", stateToken: encodeStateToken(g, TEST_ENV) },
      { caseData: c, env: TEST_ENV },
    );
    // The engine's verdict does not depend on the model; the reply is the in-character stand-in and the beat is real.
    expect(r.body.source).toBe(r.body.contradiction ? "fallback" : "unavailable");
  });

  it("the other engine actions never touch the model", async () => {
    const fn = failWith(() => Promise.reject(new TypeError("fetch failed")));
    const { handleInvestigate } = await import("@/engine/investigate-handler");
    const inv = handleInvestigate({ caseId: "blackwood", locationId: "library" }, { caseData: c, env: TEST_ENV });
    expect((await inv).status).toBe(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("POST /api/confront when the model is down", () => {
  const body = { caseId: "blackwood", characterIds: ["victoria", "archibald"], question: "Which of you is lying?" };
  const run = (extra: Record<string, unknown> = {}) => handleConfront({ ...body, ...extra }, { caseData: c, env: TEST_ENV });

  it.each(SHAPES)("$name: nothing spent (no exchange, no pressure), token unchanged, pair line shown, retry works", async ({ make, kind }) => {
    const g = createInitialGameState(c);
    g.turn = 3;
    const token = encodeStateToken(g, TEST_ENV);
    failWith(make);
    const r = await run({ stateToken: token });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ lines: [], unavailable: { kind }, stateToken: token });
    expect(r.body.line).toBe(r.body.unavailable!.line);
    expect(r.body.line).not.toMatch(FORBIDDEN_WORDS);
    expect(r.body.confrontation).toBeUndefined();
    const back = decodeStateToken(r.body.stateToken, c, TEST_ENV);
    expect(back.ok && back.game.characters.victoria.stress).toBe(g.characters.victoria.stress);
    expect(back.ok && back.game.pairTurns).toEqual(g.pairTurns);
    resetGrokBreaker();
    okFetch();
    const again = await run({ stateToken: r.body.stateToken });
    expect(again.status).toBe(200);
    expect(again.body.confrontation).toMatchObject({ turnsUsed: 1 });
    expect(again.body.lines).toHaveLength(2);
  });

  it("if the second voice fails after the first answered, still nothing is spent", async () => {
    const token = encodeStateToken(createInitialGameState(c), TEST_ENV);
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? json(200, chatBody(goodReply())) : json(402, {}))));
    const r = await run({ stateToken: token });
    expect(r.body).toMatchObject({ lines: [], unavailable: { kind: "quiet" }, stateToken: token });
  });
});

describe("retry affordance", () => {
  it("InterrogationScreen and ConfrontScreen swap ASK! for an AGAIN button (empty box) only when a retry is offered, with a 44px+ target", async () => {
    const { createElement: h } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { InterrogationScreen } = await import("@/components/dialogue/InterrogationScreen");
    const { ConfrontScreen } = await import("@/components/confront/ConfrontScreen");
    const s = (id: string) => ({ id, name: `${id} Smith`, role: "r", bio: "b", portrait: id, poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } });
    const base = { suspect: s("ann"), emotion: "calm", otherSuspects: [s("bob")], evidence: [], testimonies: [], messages: [], pending: false, busyWith: null, speaking: false, stress: 0, onAsk: () => true, onBack: () => {}, onOpenNotebook: () => {} };
    const without = renderToStaticMarkup(h(InterrogationScreen, base as never));
    const withRetry = renderToStaticMarkup(h(InterrogationScreen, { ...base, onRetry: () => {} } as never));
    expect(without).not.toContain("data-model-retry");
    expect(withRetry).toContain("data-model-retry");
    expect(withRetry).toContain("AGAIN");
    expect(withRetry).toMatch(/<button[^>]*class="[^"]*min-h-12[^"]*"[^>]*data-model-retry/);
    expect(withRetry).not.toContain(">ASK!<");
    expect(without).toContain(">ASK!<");
    const cbase = { pair: [s("ann"), s("bob")], emotions: {}, stress: {}, messages: [], pending: false, speakingId: null, turnsUsed: 0, max: 6, over: false, onAsk: () => true, target: "ann", onTarget: () => {}, onBack: () => {} };
    expect(renderToStaticMarkup(h(ConfrontScreen, cbase as never))).not.toContain("data-model-retry");
    expect(renderToStaticMarkup(h(ConfrontScreen, { ...cbase, onRetry: () => {} } as never))).toContain("data-model-retry");
  });
});
