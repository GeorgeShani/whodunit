/**
 * #49: a breather (429) disables AGAIN with a countdown; an already-answered duplicate (409) shows the stored answer.
 * The runtime cache keeps only the minimal public reply the player already saw.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { createModelGate } from "@/ai/model-gate";
import { formatRetryWait, parseUnavailable, retryOffer, retryWaitSeconds } from "@/ai/model-down";
import { parsePublicConfrontLines, parsePublicReply, parseStoredReply, toPublicReply } from "@/ai/public-reply";
import { claimTurn, type HeldTurn } from "@/ai/turn-lock";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken } from "@/engine/state-token";
import { memoryKv, type KvStore } from "@/lib/runtime-kv";
import { chatBody, goodReply, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okFetch = () => {
  const fn = vi.fn(async () => json(200, chatBody(goodReply())));
  vi.stubGlobal("fetch", fn);
  return fn;
};
/** Every value the claims store holds, as raw JSON (what a runtime cache dump would show). */
const kvDump = (kv: KvStore) => {
  const seen: unknown[] = [];
  const spy: KvStore = {
    ...kv,
    set: (k, v, ttl) => {
      seen.push(v);
      return kv.set(k, v, ttl);
    },
  } as KvStore;
  return { spy, seen };
};
const PUBLIC_KEYS = new Set(["dialogue", "emotion", "intensity", "action"]);
const ask = { caseId: "blackwood", characterId: "reginald", question: "Where were you when the lights went out?" };
const midToken = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick");
  g.turn = 4;
  return encodeStateToken(g, TEST_ENV);
};

describe("turn lock keeps the minimal public reply", () => {
  it("answered(token, reply) is returned to a duplicate; an oversized reply is dropped but the token kept", async () => {
    const kv = memoryKv();
    const a = (await claimTurn(kv, "g1", 3)) as HeldTurn;
    const reply = { kind: "interrogate", characterId: "x", response: { dialogue: "Hello.", emotion: "calm", intensity: 0.3 } };
    await a.answered("v1.t.sig", reply);
    expect(await claimTurn(kv, "g1", 3)).toEqual({ ok: false, state: "answered", latestToken: "v1.t.sig", latestReply: reply });
    const b = (await claimTurn(kv, "g2", 3)) as HeldTurn;
    await b.answered("v1.u.sig", { kind: "interrogate", characterId: "x", response: { dialogue: "x".repeat(5000), emotion: "calm", intensity: 0.3 } });
    expect(await claimTurn(kv, "g2", 3)).toEqual({ ok: false, state: "answered", latestToken: "v1.u.sig" });
  });
});

describe("#49 POST /api/interrogate: 409 already_answered carries the stored answer and the newest token", () => {
  it("the duplicate gets exactly the public fields of the first answer, and the cache holds nothing more", async () => {
    const fetchFn = okFetch();
    const { spy, seen } = kvDump(memoryKv());
    const token = midToken();
    const first = await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims: spy });
    expect(first.status).toBe(200);
    const dup = await handleInterrogate({ ...ask, question: "Again?", stateToken: token }, { caseData: c, env: TEST_ENV, claims: spy });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ error: "already_answered", stateToken: first.body.stateToken, unavailable: { kind: "answered" } });
    expect(dup.body.answered).toEqual(toPublicReply(first.body.response));
    expect(Object.keys(dup.body.answered!).every((k) => PUBLIC_KEYS.has(k))).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The stored value: the token plus one public reply; no secret ids, stress, testimony or engine state.
    const done = seen.filter((v) => (v as { s?: string }).s === "done") as { t: string; r: unknown }[];
    expect(done).toHaveLength(1);
    expect(Object.keys(done[0]).sort()).toEqual(["r", "s", "t"]);
    expect(parseStoredReply(done[0].r)).toEqual({ kind: "interrogate", characterId: "reginald", response: toPublicReply(first.body.response) });
    const raw = JSON.stringify(done[0].r);
    for (const s of c.characters.flatMap((ch) => ch.secrets)) expect(raw).not.toContain(`"${s.id}"`);
    expect(raw).not.toMatch(/stress|trust|testimon|secret|reveal/i);
  });
  it("a duplicate addressed to someone else (same state) gets the token but not another suspect's answer", async () => {
    okFetch();
    const claims = memoryKv();
    const token = midToken();
    expect((await handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims })).status).toBe(200);
    const other = await handleInterrogate({ ...ask, characterId: "victoria", stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe("already_answered");
    expect(other.body.answered).toBeUndefined();
  });
  it("in_flight duplicates carry no answer (there is none yet) and keep AGAIN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return json(200, chatBody(goodReply())); }));
    const claims = memoryKv();
    const token = midToken();
    const rs = await Promise.all([0, 1].map(() => handleInterrogate({ ...ask, stateToken: token }, { caseData: c, env: TEST_ENV, claims })));
    const dup = rs.find((r) => r.status === 409)!;
    expect(dup.body.error).toBe("in_flight");
    expect(dup.body.answered).toBeUndefined();
    expect(retryOffer(parseUnavailable(dup.body.unavailable)!, dup.body.error)).toBe("again");
  });
});

describe("#49 POST /api/confront: 409 already_answered carries both stored lines", () => {
  it("the duplicate gets the two public lines, in order", async () => {
    okFetch();
    const claims = memoryKv();
    const g = createInitialGameState(c);
    g.turn = 10;
    const token = encodeStateToken(g, TEST_ENV);
    const body = { caseId: "blackwood", characterIds: ["victoria", "archibald"], question: "Which of you is lying?" };
    const first = await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(first.status).toBe(200);
    const dup = await handleConfront({ ...body, stateToken: token }, { caseData: c, env: TEST_ENV, claims });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ error: "already_answered", stateToken: first.body.stateToken, lines: [] });
    expect(dup.body.answered).toEqual(first.body.lines.map((l) => ({ characterId: l.characterId, characterName: l.characterName, response: toPublicReply(l.response) })));
    expect(parsePublicConfrontLines(dup.body.answered)).toHaveLength(2);
  });
});

describe("#49 breather: the wait comes from the body or the Retry-After header", () => {
  it("a rate-limited interrogation carries retryAfter, which the client reads as a countdown", async () => {
    okFetch();
    const refuse = createModelGate({ kv: memoryKv(), ip: "1.2.3.4", env: { MODEL_RATE_LIMIT: "0" }, log: () => {} });
    const r = await handleInterrogate({ ...ask, stateToken: midToken() }, { caseData: c, env: TEST_ENV, claims: memoryKv(), gate: refuse });
    expect(r.status).toBe(429);
    const down = parseUnavailable(r.body.unavailable)!;
    const wait = retryWaitSeconds(down, null);
    expect(wait).toBeGreaterThan(0);
    expect(retryOffer(down, r.body.error, wait)).toBe("wait");
  });
  it("retryWaitSeconds: body first, then delta-seconds or HTTP-date header; only for breathers", () => {
    const now = Date.parse("2026-10-08T10:00:00Z");
    expect(retryWaitSeconds({ kind: "breather", line: "x", retryAfter: 42.2 }, "7", now)).toBe(43);
    expect(retryWaitSeconds({ kind: "breather", line: "x" }, "7", now)).toBe(7);
    expect(retryWaitSeconds({ kind: "breather", line: "x" }, "Thu, 08 Oct 2026 10:01:30 GMT", now)).toBe(90);
    expect(retryWaitSeconds({ kind: "breather", line: "x" }, "Thu, 08 Oct 2026 09:59:00 GMT", now)).toBeUndefined();
    expect(retryWaitSeconds({ kind: "breather", line: "x" }, "soon", now)).toBeUndefined();
    expect(retryWaitSeconds({ kind: "busy", line: "x", retryAfter: 9 }, "9", now)).toBeUndefined();
  });
  it("formatRetryWait and retryOffer", () => {
    expect(formatRetryWait(45)).toBe("45s");
    expect(formatRetryWait(59.2)).toBe("1:00");
    expect(formatRetryWait(65)).toBe("1:05");
    expect(formatRetryWait(-3)).toBe("0s");
    expect(retryOffer({ kind: "answered", line: "x" }, "already_answered")).toBe("none");
    expect(retryOffer({ kind: "answered", line: "x" }, "in_flight")).toBe("again");
    expect(retryOffer({ kind: "busy", line: "x" }, "model_unavailable")).toBe("again");
    expect(retryOffer({ kind: "breather", line: "x" }, "rate_limited", 30)).toBe("wait");
    expect(retryOffer({ kind: "breather", line: "x" }, "rate_limited")).toBe("again");
  });
  it("the client parsers reject anything beyond the public fields", () => {
    expect(parsePublicReply({ dialogue: "Hi.", emotion: "calm", intensity: 0.2 })).not.toBeNull();
    expect(parsePublicReply({ dialogue: "Hi.", emotion: "calm", intensity: 0.2, revealSecretId: "s1" })).toBeNull();
    expect(parsePublicReply({ dialogue: "", emotion: "calm", intensity: 0.2 })).toBeNull();
    expect(parsePublicConfrontLines([])).toBeNull();
    expect(parseStoredReply({ kind: "interrogate", characterId: "a", response: { dialogue: "Hi.", emotion: "calm", intensity: 0.2 }, stress: 50 })).toBeNull();
  });
});

describe("#49 AGAIN countdown in the screens", () => {
  it("AGAIN is disabled with a visible countdown while retryWait > 0, and enabled at 0", async () => {
    const { createElement: h } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { InterrogationScreen } = await import("@/components/dialogue/InterrogationScreen");
    const { ConfrontScreen } = await import("@/components/confront/ConfrontScreen");
    const s = (id: string) => ({ id, name: `${id} Smith`, role: "r", bio: "b", portrait: id, poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } });
    const base = { suspect: s("ann"), emotion: "calm", otherSuspects: [s("bob")], evidence: [], testimonies: [], messages: [], pending: false, busyWith: null, speaking: false, stress: 0, onAsk: () => true, onBack: () => {}, onOpenNotebook: () => {}, onRetry: () => {} };
    const button = (html: string) => html.match(/<button[^>]*data-model-retry[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    const waiting = button(renderToStaticMarkup(h(InterrogationScreen, { ...base, retryWait: 45 } as never)));
    expect(waiting).toMatch(/disabled=""/);
    expect(waiting).toContain("AGAIN 45s");
    expect(waiting).toContain('data-retry-wait="45"');
    const ready = button(renderToStaticMarkup(h(InterrogationScreen, { ...base, retryWait: 0 } as never)));
    expect(ready).not.toMatch(/disabled=""/);
    expect(ready).not.toMatch(/\d+s/);
    const cbase = { pair: [s("ann"), s("bob")], emotions: {}, stress: {}, messages: [], pending: false, speakingId: null, turnsUsed: 0, max: 6, over: false, onAsk: () => true, target: "ann", onTarget: () => {}, onBack: () => {}, onRetry: () => {} };
    const cwait = button(renderToStaticMarkup(h(ConfrontScreen, { ...cbase, retryWait: 75 } as never)));
    expect(cwait).toMatch(/disabled=""/);
    expect(cwait).toContain("AGAIN 1:15");
  });
});
