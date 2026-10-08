import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { BUDGET_DEFAULTS, budgetConfig, clientIp, createModelGate, type GatePass, type GateRefusal } from "@/ai/model-gate";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { memoryKv, type KvStore } from "@/lib/runtime-kv";
import { chatBody, goodReply, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const FORBIDDEN_WORDS = /\b(ai|error|server|api|credit|credits|billing|quota|model|grok|xai|http|limit|rate|crash|broken|fail(ed|ure)?)\b/i;
const T0 = Date.UTC(2026, 9, 8, 10, 0, 0); // 10:00:00 UTC, on a 10-minute boundary

function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function gateFor(opts: { env?: Record<string, string | undefined>; ip?: string; kv?: KvStore; now?: () => number; log?: (m: string) => void } = {}) {
  const ck = clock();
  const kv = opts.kv ?? memoryKv(2000, opts.now ?? ck.now);
  return { gate: createModelGate({ kv, ip: opts.ip ?? "203.0.113.7", env: opts.env ?? {}, now: opts.now ?? ck.now, log: opts.log ?? (() => {}) }), kv, ck };
}

const brokenKv = (): KvStore => ({
  get: async () => {
    throw new Error("cache down");
  },
  set: async () => {
    throw new Error("cache down");
  },
  delete: async () => {
    throw new Error("cache down");
  },
});

describe("budgetConfig", () => {
  it("defaults: 20 model turns per 10 minutes per IP, 300 per UTC day, not disabled", () => {
    expect(budgetConfig({})).toEqual({ disabled: false, ratePerWindow: 20, windowSeconds: 600, dailyCap: 300 });
    expect(BUDGET_DEFAULTS).toEqual({ ratePerWindow: 20, windowSeconds: 600, dailyCap: 300 });
  });
  it("reads the env vars; nonsense falls back to the defaults; 0 means no model turns", () => {
    expect(budgetConfig({ MODEL_RATE_LIMIT: "5", MODEL_RATE_WINDOW_SECONDS: "60", MODEL_DAILY_CAP: "0" })).toEqual({ disabled: false, ratePerWindow: 5, windowSeconds: 60, dailyCap: 0 });
    expect(budgetConfig({ MODEL_RATE_LIMIT: "lots", MODEL_RATE_WINDOW_SECONDS: "0", MODEL_DAILY_CAP: "-3" })).toMatchObject({ ratePerWindow: 20, windowSeconds: 600, dailyCap: 300 });
    expect(budgetConfig({ MODEL_DAILY_CAP: "2.5" }).dailyCap).toBe(300);
  });
  it("MODEL_DISABLED accepts 1/true/yes/on (any case) and nothing else", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) expect(budgetConfig({ MODEL_DISABLED: v }).disabled).toBe(true);
    for (const v of ["", "0", "false", "no", "off"]) expect(budgetConfig({ MODEL_DISABLED: v }).disabled).toBe(false);
  });
});

describe("clientIp", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("prefers Vercel's x-real-ip, then the FIRST x-forwarded-for hop", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.2, 10.0.0.1, 10.0.0.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("anything that is not an IP (or no header) shares one 'unknown' bucket", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "<script>", "x-forwarded-for": "evil, 1.2.3.4" }))).toBe("unknown");
  });
});

describe("model gate: per-IP limit", () => {
  it("20 interrogation turns pass, the 21st is refused with the seconds left in the window", async () => {
    const { gate, ck } = gateFor();
    ck.advance(4 * 60_000 + 30_000); // 4m30s into the window
    for (let i = 0; i < 20; i++) expect((await gate.open(1)).ok).toBe(true);
    expect(await gate.open(1)).toEqual({ ok: false, reason: "rate_limited", retryAfterSec: 330 });
  });
  it("counts model turns, not requests: a confrontation exchange costs 2 (10 exchanges, then refused)", async () => {
    const { gate } = gateFor();
    for (let i = 0; i < 10; i++) expect((await gate.open(2)).ok).toBe(true);
    expect((await gate.open(2)).ok).toBe(false);
    expect((await gate.open(1)).ok).toBe(false);
  });
  it("an exchange that would cross the limit is refused whole (19 used + 2 > 20) but a single turn still fits", async () => {
    const { gate } = gateFor();
    for (let i = 0; i < 19; i++) await gate.open(1);
    expect((await gate.open(2)).ok).toBe(false);
    expect((await gate.open(1)).ok).toBe(true);
  });
  it("a refusal reserves nothing; another IP is unaffected; the next window starts fresh", async () => {
    const ck = clock();
    const kv = memoryKv(2000, ck.now);
    const a = createModelGate({ kv, ip: "203.0.113.7", env: {}, now: ck.now, log: () => {} });
    const b = createModelGate({ kv, ip: "203.0.113.8", env: {}, now: ck.now, log: () => {} });
    for (let i = 0; i < 20; i++) await a.open(1);
    for (let i = 0; i < 5; i++) expect((await a.open(1)).ok).toBe(false);
    expect((await b.open(1)).ok).toBe(true);
    ck.advance(600_000);
    for (let i = 0; i < 20; i++) expect((await a.open(1)).ok).toBe(true);
  });
  it("MODEL_RATE_LIMIT=0 refuses every turn (handy to prove the 429 path without a model call)", async () => {
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "0" } });
    expect(await gate.open(1)).toMatchObject({ ok: false, reason: "rate_limited" });
  });
  it("fails OPEN (and logs) when the counter cannot be read", async () => {
    const log = vi.fn();
    const { gate } = gateFor({ kv: brokenKv(), log });
    for (let i = 0; i < 30; i++) expect((await gate.open(1)).ok).toBe(true);
    expect(log.mock.calls.some(([m]) => /per-IP counter unreadable.*fail open/.test(m))).toBe(true);
  });
});

describe("model gate: global daily cap", () => {
  it("counts every IP together per UTC day; refused until UTC midnight, and the per-IP reservation is given back", async () => {
    const ck = clock(Date.UTC(2026, 9, 8, 23, 0, 0));
    const kv = memoryKv(2000, ck.now);
    const env = { MODEL_DAILY_CAP: "5" };
    const mk = (ip: string) => createModelGate({ kv, ip, env, now: ck.now, log: () => {} });
    expect((await mk("1.1.1.1").open(2)).ok).toBe(true);
    expect((await mk("2.2.2.2").open(2)).ok).toBe(true);
    expect((await mk("3.3.3.3").open(1)).ok).toBe(true);
    expect(await mk("4.4.4.4").open(1)).toEqual({ ok: false, reason: "daily_cap", retryAfterSec: 3600 });
    // 4.4.4.4 was refused by the cap, so its per-IP window is untouched: 20 turns once the day rolls over.
    ck.advance(3600_000);
    const g4 = mk("4.4.4.4");
    for (let i = 0; i < 5; i++) expect((await g4.open(1)).ok).toBe(true);
    expect((await g4.open(1)).ok).toBe(false); // cap 5 again, new day
  });
  it("the default cap is 300 turns", async () => {
    const ck = clock();
    const kv = memoryKv(5000, ck.now);
    let refused: GateRefusal | null = null;
    for (let i = 0; i < 400 && !refused; i++) {
      const r = await createModelGate({ kv, ip: `10.0.${i >> 8}.${i & 255}`, env: {}, now: ck.now, log: () => {} }).open(1);
      if (!r.ok) refused = r;
      else if (i >= 300) throw new Error("passed the cap");
    }
    expect(refused?.reason).toBe("daily_cap");
  });
  it("fails OPEN (and logs) when the day's counter cannot be read", async () => {
    const log = vi.fn();
    const ck = clock();
    const inner = memoryKv(2000, ck.now);
    const kv: KvStore = { ...inner, get: async (k) => (k.startsWith("day:") ? Promise.reject(new Error("down")) : inner.get(k)) };
    const gate = createModelGate({ kv, ip: "1.2.3.4", env: { MODEL_DAILY_CAP: "1" }, now: ck.now, log });
    expect((await gate.open(1)).ok).toBe(true);
    expect((await gate.open(1)).ok).toBe(true);
    expect(log.mock.calls.some(([m]) => /daily counter unreadable.*fail open/.test(m))).toBe(true);
  });
});

describe("model gate: kill switch and refunds", () => {
  it("MODEL_DISABLED refuses before touching any counter", async () => {
    const kv = memoryKv();
    const set = vi.spyOn(kv, "set");
    const { gate } = gateFor({ env: { MODEL_DISABLED: "1" }, kv });
    expect(await gate.open(1)).toEqual({ ok: false, reason: "model_disabled" });
    expect(set).not.toHaveBeenCalled();
  });
  it("settle({called:false}) gives the turns back to both counters; called:true keeps them; settle is idempotent", async () => {
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "2", MODEL_DAILY_CAP: "2" } });
    const p1 = (await gate.open(2)) as GatePass;
    expect(p1.ok).toBe(true);
    expect((await gate.open(1)).ok).toBe(false);
    await p1.settle({ called: false });
    await p1.settle({ called: false });
    const p2 = (await gate.open(2)) as GatePass;
    expect(p2.ok).toBe(true);
    await p2.settle({ called: true });
    expect((await gate.open(1)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The handlers: a refused turn never reaches fetch, keeps the token, and speaks in character.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okFetch = () => {
  const fn = vi.fn(async () => json(200, chatBody(goodReply())));
  vi.stubGlobal("fetch", fn);
  return fn;
};
const stateOf = (t: string | undefined) => {
  const r = decodeStateToken(t, c, TEST_ENV);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};
const midGame = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick");
  g.turn = 4;
  g.characters.reginald.stress = 22;
  return encodeStateToken(g, TEST_ENV);
};
const ask = { caseId: "blackwood", characterId: "reginald", question: "Where were you when the lights went out?" };

describe("POST /api/interrogate behind the gate", () => {
  it("over the per-IP limit: 429, a breather line with retryAfter, the SAME token, and no model call", async () => {
    const fetchFn = okFetch();
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "0" } });
    const token = midGame();
    const r = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, gate });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ source: "unavailable", error: "rate_limited", stateToken: token, unavailable: { kind: "breather" } });
    expect(r.body.unavailable!.line).toMatch(/^Reginald needs a breather, detective\. Give them 10 minutes, then ask again\.$/);
    expect(r.body.unavailable!.line).not.toMatch(FORBIDDEN_WORDS);
    expect(r.body.unavailable!.retryAfter).toBe(600);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(stateOf(r.body.stateToken)).toMatchObject({ turn: 4 });
  });
  it("within the limit the turn goes through and is counted; at the limit the next one is refused", async () => {
    const fetchFn = okFetch();
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "1" } });
    const first = await handleInterrogate({ ...ask, stateToken: midGame() }, { caseData: c, env: TEST_ENV, gate });
    expect(first.status).toBe(200);
    expect(first.body.source).toBe("model");
    const second = await handleInterrogate({ ...ask, stateToken: first.body.stateToken }, { caseData: c, env: TEST_ENV, gate });
    expect(second.status).toBe(429);
    expect(second.body.stateToken).toBe(first.body.stateToken);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("daily cap reached: 503 with the quiet line, token unchanged, no model call", async () => {
    const fetchFn = okFetch();
    const { gate } = gateFor({ env: { MODEL_DAILY_CAP: "0" } });
    const token = midGame();
    const r = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, gate });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ source: "unavailable", error: "daily_cap", stateToken: token, unavailable: { kind: "quiet" } });
    expect(r.body.unavailable!.line).not.toMatch(FORBIDDEN_WORDS);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("MODEL_DISABLED: 503 quiet, no model call, but the engine's deterministic contradiction beat still lands", async () => {
    const fetchFn = okFetch();
    const { gate } = gateFor({ env: { MODEL_DISABLED: "true" } });
    const r = await handleInterrogate({ ...ask, stateToken: midGame() }, { caseData: c, env: TEST_ENV, gate });
    expect(r.body).toMatchObject({ source: "unavailable", error: "model_disabled", unavailable: { kind: "quiet" } });
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("library-key");
    const beat = await handleInterrogate(
      { caseId: "blackwood", characterId: "victoria", question: "Where were you during the blackout? And the library door?", presentedEvidenceId: "library-key", stateToken: encodeStateToken(g, TEST_ENV) },
      { caseData: c, env: TEST_ENV, gate },
    );
    expect(beat.body.source).toBe(beat.body.contradiction ? "fallback" : "unavailable");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("a turn the model never saw (open breaker) is refunded, so a dead account cannot lock players out", async () => {
    const fetchFn = vi.fn(async () => json(402, {}));
    vi.stubGlobal("fetch", fetchFn);
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "2" } });
    const token = midGame();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, gate })).status);
    expect(fetchFn).toHaveBeenCalledTimes(1); // the breaker answered the rest
    expect(statuses).toEqual([503, 503, 503, 503, 503, 503]); // never 429: only the one real attempt was counted
  });
});

describe("POST /api/confront behind the gate", () => {
  const body = { caseId: "blackwood", characterIds: ["victoria", "archibald"], question: "Which of you is lying?" };
  it("an exchange costs two turns: with 3 left, one exchange runs and the next is refused (429) without a model call", async () => {
    const fetchFn = okFetch();
    const { gate } = gateFor({ env: { MODEL_RATE_LIMIT: "3" } });
    const first = await handleConfront({ ...body, stateToken: encodeStateToken(createInitialGameState(c), TEST_ENV) }, { caseData: c, env: TEST_ENV, gate });
    expect(first.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const second = await handleConfront({ ...body, stateToken: first.body.stateToken }, { caseData: c, env: TEST_ENV, gate });
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ lines: [], error: "rate_limited", stateToken: first.body.stateToken, unavailable: { kind: "breather" } });
    expect(second.body.line).toMatch(/^Victoria and Archibald need a breather, detective\./);
    expect(second.body.unavailable!.retryAfter).toBeGreaterThan(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(stateOf(second.body.stateToken).pairTurns).toEqual(stateOf(first.body.stateToken).pairTurns);
  });
  it("daily cap / kill switch: the quiet pair line, nothing spent, no model call", async () => {
    const fetchFn = okFetch();
    for (const env of [{ MODEL_DAILY_CAP: "1" }, { MODEL_DISABLED: "1" }]) {
      const { gate } = gateFor({ env });
      const token = encodeStateToken(createInitialGameState(c), TEST_ENV);
      const r = await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, gate });
      expect(r.status).toBe(503);
      expect(r.body).toMatchObject({ lines: [], stateToken: token, unavailable: { kind: "quiet" }, error: env.MODEL_DISABLED ? "model_disabled" : "daily_cap" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  const src = (p: string) => readFileSync(new URL(`../../app/api/${p}/route.ts`, import.meta.url), "utf8");
  it("interrogate and confront are gated; hint, investigate and accuse (no model) are not", () => {
    for (const p of ["interrogate", "confront"]) expect(src(p)).toMatch(/createModelGate\(\{ kv: runtimeKv, ip: clientIp\(request\.headers\) \}\)/);
    for (const p of ["hint", "investigate", "accuse"]) expect(src(p)).not.toMatch(/model-gate|createModelGate/);
  });
  it("the interrogate route answers 429 with a Retry-After header and the unchanged token (env override, no model)", async () => {
    vi.stubEnv("MODEL_RATE_LIMIT", "0");
    const fetchFn = okFetch();
    const { POST } = await import("@/app/api/interrogate/route");
    const res = await POST(new Request("http://test/api/interrogate", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "192.0.2.44" }, body: JSON.stringify(ask) }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const b = await res.json();
    expect(b.unavailable.kind).toBe("breather");
    expect(typeof b.stateToken).toBe("string");
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("the confront route answers 429 with a Retry-After header", async () => {
    vi.stubEnv("MODEL_RATE_LIMIT", "1");
    const fetchFn = okFetch();
    const { POST } = await import("@/app/api/confront/route");
    const res = await POST(new Request("http://test/api/confront", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "192.0.2.45" }, body: JSON.stringify({ caseId: "blackwood", characterIds: ["victoria", "archibald"], question: "Well?" }) }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("client reading of the reply", () => {
  it("parseUnavailable keeps breather/answered and retryAfter; downLineFor repeats the server line for them on AGAIN", async () => {
    const { parseUnavailable, downLineFor, stillDownLine } = await import("@/ai/model-down");
    const br = parseUnavailable({ kind: "breather", line: "X needs a breather", retryAfter: 120 })!;
    expect(br).toEqual({ kind: "breather", line: "X needs a breather", retryAfter: 120 });
    expect(downLineFor(br, true)).toBe("X needs a breather");
    expect(parseUnavailable({ kind: "weird", line: "l" })).toEqual({ kind: "busy", line: "l" });
    expect(downLineFor(parseUnavailable({ kind: "quiet", line: "l" })!, true)).toBe(stillDownLine("quiet"));
    expect(parseUnavailable({ kind: "busy" })).toBeNull();
    expect(parseUnavailable(null)).toBeNull();
  });
});
