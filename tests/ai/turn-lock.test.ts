import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { resetGrokBreaker } from "@/ai/grok";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { createModelGate, type ModelGate } from "@/ai/model-gate";
import { ANSWERED_TTL_SECONDS, claimTurn, IN_FLIGHT_TTL_SECONDS, type HeldTurn } from "@/ai/turn-lock";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { memoryKv, type KvStore } from "@/lib/runtime-kv";
import { chatBody, goodReply, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const FORBIDDEN_WORDS = /\b(ai|error|server|api|request|token|state|duplicate|model|grok|http|retry|fail(ed|ure)?)\b/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A model that answers after a short delay (so parallel requests overlap). */
const slowOk = (ms = 20) => {
  const fn = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, ms));
    return json(200, chatBody(goodReply()));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};
const stateOf = (t: string | undefined) => {
  const r = decodeStateToken(t, c, TEST_ENV);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};

describe("claimTurn", () => {
  it("one claim per game+turn: a second is refused while in flight; release frees it; other turns are independent", async () => {
    const kv = memoryKv();
    const a = (await claimTurn(kv, "gameA", 4)) as HeldTurn;
    expect(a.ok).toBe(true);
    expect(await claimTurn(kv, "gameA", 4)).toEqual({ ok: false, state: "in_flight" });
    const other = (await claimTurn(kv, "gameA", 5)) as HeldTurn;
    expect(other.ok).toBe(true);
    await other.release();
    await a.release();
    await a.release(); // idempotent
    const again = (await claimTurn(kv, "gameA", 4)) as HeldTurn;
    expect(again.ok).toBe(true);
    await again.release();
  });
  it("an answered turn stays claimed with the token it produced, for 24 h", async () => {
    let t = 0;
    const kv = memoryKv(100, () => t);
    const a = (await claimTurn(kv, "gameB", 2)) as HeldTurn;
    await a.answered("v1.newer.sig");
    await a.release(); // no-op after answered
    expect(await claimTurn(kv, "gameB", 2)).toEqual({ ok: false, state: "answered", latestToken: "v1.newer.sig" });
    t += (ANSWERED_TTL_SECONDS - 1) * 1000;
    expect((await claimTurn(kv, "gameB", 2)).ok).toBe(false);
    t += 2000;
    const later = (await claimTurn(kv, "gameB", 2)) as HeldTurn;
    expect(later.ok).toBe(true);
    await later.release();
    expect(ANSWERED_TTL_SECONDS).toBe(86_400);
  });
  it("an in-flight claim whose function died expires after 90 s", async () => {
    let t = 0;
    const kv = memoryKv(100, () => t);
    // What a crashed instance leaves behind: a pending claim in the cache that nobody will release.
    await kv.set("turn:gameC:1", { s: "pending", o: "someone-else" }, IN_FLIGHT_TTL_SECONDS);
    expect(await claimTurn(kv, "gameC", 1)).toEqual({ ok: false, state: "in_flight" });
    t += IN_FLIGHT_TTL_SECONDS * 1000 + 1;
    const b = (await claimTurn(kv, "gameC", 1)) as HeldTurn;
    expect(b.ok).toBe(true);
    await b.release();
  });
  it("two instances writing in the same instant: the one whose write was overwritten backs off", async () => {
    const inner = memoryKv();
    // The read-back sees another instance's claim (it wrote after us).
    let reads = 0;
    const kv: KvStore = { ...inner, get: async (k) => (++reads === 2 ? { s: "pending", o: "other-instance" } : inner.get(k)) };
    expect(await claimTurn(kv, "gameD", 3)).toEqual({ ok: false, state: "in_flight" });
    await inner.delete("turn:gameD:3"); // (the other instance finished and released)
    const ok = (await claimTurn(inner, "gameD", 3)) as HeldTurn; // our in-process set was cleared on back-off
    expect(ok.ok).toBe(true);
    await ok.release();
  });
  it("fails OPEN (logged) when the cache cannot be read, but still catches a duplicate on the same instance", async () => {
    const log = vi.fn();
    const broken: KvStore = { get: () => Promise.reject(new Error("down")), set: () => Promise.reject(new Error("down")), delete: () => Promise.reject(new Error("down")) };
    const a = (await claimTurn(broken, "gameE", 0, log)) as HeldTurn;
    expect(a.ok).toBe(true);
    expect(log.mock.calls.some(([m]) => /fail open/.test(m))).toBe(true);
    expect((await claimTurn(broken, "gameE", 0, log)).ok).toBe(false);
    await a.release();
  });
});

const ask = { caseId: "blackwood", characterId: "reginald", question: "Where were you when the lights went out?" };
const midToken = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick");
  g.turn = 4;
  return encodeStateToken(g, TEST_ENV);
};

describe("#40 POST /api/interrogate: the same pre-turn state is spent on the model at most once", () => {
  it("3 parallel requests with one token: one answer (1 model call), two 409s in character with the held token", async () => {
    const fetchFn = slowOk();
    const claims = memoryKv();
    const token = midToken();
    const rs = await Promise.all([0, 1, 2].map((i) => handleInterrogate({ ...ask, question: `Question ${i}?`, stateToken: token }, { caseData: c, env: TEST_ENV, claims })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    for (const r of rs.filter((x) => x.status === 409)) {
      expect(r.body).toMatchObject({ source: "unavailable", error: "in_flight", stateToken: token, unavailable: { kind: "answered" } });
      expect(r.body.unavailable!.line).toMatch(/^Reginald is still answering your last question, detective\./);
      expect(r.body.unavailable!.line).not.toMatch(FORBIDDEN_WORDS);
    }
  });
  it("replaying the token later: 409 'already answered' with the NEWEST token, no model call", async () => {
    const fetchFn = slowOk(1);
    const claims = memoryKv();
    const token = midToken();
    const first = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(first.status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const dup = await handleInterrogate({ ...ask, question: "Something else?", stateToken: token }, { caseData: c, env: TEST_ENV, claims });
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({ error: "already_answered", stateToken: first.body.stateToken, unavailable: { kind: "answered" } });
      expect(dup.body.unavailable!.line).toMatch(/I've only just answered that, detective/);
      expect(dup.body.unavailable!.line).not.toMatch(FORBIDDEN_WORDS);
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The newest token carries on normally.
    const next = await handleInterrogate({ ...ask, stateToken: first.body.stateToken }, { caseData: c, env: TEST_ENV, claims });
    expect(next.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("a forked token of the same game and turn (it also searched a room) shares the claim", async () => {
    slowOk(1);
    const claims = memoryKv();
    const token = midToken();
    const fork = await handleInvestigate({ caseId: "blackwood", locationId: "library", stateToken: token }, { caseData: c, env: TEST_ENV });
    expect(stateOf(fork.body.stateToken).turn).toBe(stateOf(token).turn);
    expect((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims })).status).toBe(200);
    expect((await handleInterrogate({ ...ask, stateToken: fork.body.stateToken }, { caseData: c, env: TEST_ENV, claims })).status).toBe(409);
  });
  it("AGAIN after an unavailable turn works: a failed turn releases the claim", async () => {
    const claims = memoryKv();
    const token = midToken();
    vi.stubGlobal("fetch", vi.fn(async () => json(402, {})));
    const down = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(down.status).toBe(503);
    resetGrokBreaker();
    slowOk(1);
    const again = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(again.status).toBe(200);
  });
  it("a turn refused by the rate limit, or one that throws, also releases the claim", async () => {
    const claims = memoryKv();
    const token = midToken();
    slowOk(1);
    const refuse = createModelGate({ kv: memoryKv(), ip: "1.2.3.4", env: { MODEL_RATE_LIMIT: "0" }, log: () => {} });
    expect((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims, gate: refuse })).status).toBe(429);
    const boom: ModelGate = { open: () => Promise.reject(new Error("boom")) };
    await expect(handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims, gate: boom })).rejects.toThrow("boom");
    expect((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims })).status).toBe(200);
  });
  it("a duplicate is refused BEFORE the rate limit counts it", async () => {
    slowOk(1);
    const claims = memoryKv();
    const gate = createModelGate({ kv: memoryKv(), ip: "1.2.3.4", env: { MODEL_RATE_LIMIT: "2" }, log: () => {} });
    const token = midToken();
    const first = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims, gate });
    for (let i = 0; i < 5; i++) expect((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims, gate })).status).toBe(409);
    expect((await handleInterrogate({ ...ask, stateToken: first.body.stateToken }, { caseData: c, env: TEST_ENV, claims, gate })).status).toBe(200);
  });
  it("a brand-new game (no token) is not claimed", async () => {
    slowOk(1);
    const claims = memoryKv();
    const rs = await Promise.all([0, 1].map(() => handleInterrogate(ask, { caseData: c, env: TEST_ENV, claims })));
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
  });
});

describe("#40 POST /api/confront: the caps hold against parallel and replayed tokens", () => {
  const body = { caseId: "blackwood", characterIds: ["victoria", "archibald"], question: "Which of you is lying?" };
  const tokenAt = (pairUsed: number, extraPairs: Record<string, number> = {}) => {
    const g = createInitialGameState(c);
    g.turn = 10;
    g.pairTurns = { "archibald|victoria": pairUsed, ...extraPairs };
    return encodeStateToken(g, TEST_ENV);
  };
  it("the issue's repro: 3 parallel exchanges from a 5/6 token -> one 200 (2 model calls), two 409s", async () => {
    const fetchFn = slowOk();
    const claims = memoryKv();
    const token = tokenAt(5);
    const rs = await Promise.all([0, 1, 2].map((i) => handleConfront({ ...body, question: `Q${i}?`, stateToken: token }, { caseData: c, env: TEST_ENV, claims })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const won = rs.find((r) => r.status === 200)!;
    expect(won.body.confrontation).toMatchObject({ turnsUsed: 6, over: true });
    for (const r of rs.filter((x) => x.status === 409)) {
      expect(r.body).toMatchObject({ lines: [], error: "in_flight", stateToken: token, unavailable: { kind: "answered" } });
      expect(r.body.line).toMatch(/^Victoria and Archibald are still at it/);
    }
    // Replaying the 5/6 token afterwards: already answered, the 6/6 token comes back, no model call.
    const replay = await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ error: "already_answered", stateToken: won.body.stateToken });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("11/12 exchanges in the game: parallel requests get one exchange", async () => {
    const fetchFn = slowOk();
    const claims = memoryKv();
    const token = tokenAt(5, { "archibald|reginald": 6 });
    const rs = await Promise.all([0, 1, 2].map(() => handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("a confrontation that could not be answered releases the claim, so AGAIN works", async () => {
    const claims = memoryKv();
    const token = tokenAt(2);
    vi.stubGlobal("fetch", vi.fn(async () => json(402, {})));
    expect((await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims })).status).toBe(503);
    resetGrokBreaker();
    slowOk(1);
    expect((await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims })).status).toBe(200);
  });
});
