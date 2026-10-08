import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleAccuse } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { COLD_CASE_NOTICE, RESET_NOTICE, restoreSession } from "@/engine/session";
import { decodeStateToken, encodeStateToken, isExpired, LEGACY_TOKEN_GRACE_UNTIL, STATE_TOKEN_MAX_AGE_MS } from "@/engine/state-token";
import { ACCUSED_TTL_SECONDS } from "@/lib/accused-store";
import { mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
afterEach(() => {
  vi.useRealTimers();
});

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const DAY = 24 * 3600 * 1000;
const at = (ms: number) => vi.useFakeTimers({ now: ms, toFake: ["Date"] });

/** Re-sign a token's payload after editing it (as a token issued by older code would look). */
function resign(token: string, edit: (p: Record<string, unknown>) => void): string {
  const [v, body] = token.split(".");
  const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  edit(p);
  const nb = Buffer.from(JSON.stringify(p)).toString("base64url");
  const key = createHash("sha256").update(TEST_ENV.GAME_STATE_SECRET).digest();
  return `${v}.${nb}.${createHmac("sha256", key).update(`${v}.${nb}`).digest("base64url")}`;
}
const payloadOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
const midGame = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick");
  g.turn = 6;
  return g;
};

describe("#39 state token max age", () => {
  it("numbers: 7 days; legacy tokens (no iat) accepted until 2026-10-15 UTC", () => {
    expect(STATE_TOKEN_MAX_AGE_MS).toBe(7 * DAY);
    expect(new Date(LEGACY_TOKEN_GRACE_UNTIL).toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });
  it("every token carries its issue time (seconds)", () => {
    at(NOW);
    expect(payloadOf(encodeStateToken(midGame(), TEST_ENV)).iat).toBe(NOW / 1000);
  });
  it("a 6-day-old token still plays; one older than 7 days is refused as expired", () => {
    at(NOW);
    const token = encodeStateToken(midGame(), TEST_ENV);
    at(NOW + 6 * DAY);
    expect(decodeStateToken(token, c, TEST_ENV).ok).toBe(true);
    at(NOW + 7 * DAY + 1000);
    expect(decodeStateToken(token, c, TEST_ENV)).toEqual({ ok: false, reason: "expired" });
  });
  it("each save re-stamps it, so an active game never goes cold", () => {
    at(NOW);
    let token = encodeStateToken(midGame(), TEST_ENV);
    for (let d = 1; d <= 20; d++) {
      at(NOW + d * 5 * DAY);
      const r = decodeStateToken(token, c, TEST_ENV);
      expect(r.ok).toBe(true);
      if (r.ok) token = encodeStateToken(r.game, TEST_ENV);
    }
  });
  it("legacy tokens without iat: accepted during the grace period, expired after it", () => {
    at(NOW);
    const legacy = resign(encodeStateToken(midGame(), TEST_ENV), (p) => delete p.iat);
    expect(payloadOf(legacy).iat).toBeUndefined();
    expect(decodeStateToken(legacy, c, TEST_ENV).ok).toBe(true);
    at(LEGACY_TOKEN_GRACE_UNTIL - 1);
    expect(decodeStateToken(legacy, c, TEST_ENV).ok).toBe(true);
    at(LEGACY_TOKEN_GRACE_UNTIL);
    expect(decodeStateToken(legacy, c, TEST_ENV)).toEqual({ ok: false, reason: "expired" });
  });
  it("isExpired edges", () => {
    expect(isExpired(NOW / 1000, NOW + STATE_TOKEN_MAX_AGE_MS)).toBe(false);
    expect(isExpired(NOW / 1000, NOW + STATE_TOKEN_MAX_AGE_MS + 1)).toBe(true);
    expect(isExpired(undefined, LEGACY_TOKEN_GRACE_UNTIL - 1)).toBe(false);
  });
  it("an expired token is a fresh start with the in-character 'gone cold' line (other bad tokens keep the old line)", () => {
    at(NOW);
    const token = encodeStateToken(midGame(), TEST_ENV);
    at(NOW + 8 * DAY);
    const s = restoreSession(c, token, TEST_ENV);
    expect(s).toMatchObject({ notice: COLD_CASE_NOTICE, resetReason: "expired" });
    expect(s.game.turn).toBe(0);
    expect(s.game.discoveredEvidenceIds).toEqual([]);
    expect(COLD_CASE_NOTICE).toMatch(/gone cold/);
    expect(COLD_CASE_NOTICE).not.toMatch(/\b(token|expired|error|session|server)\b/i);
    expect(restoreSession(c, token.slice(0, -2) + "xx", TEST_ENV).notice).toBe(RESET_NOTICE);
  });
  it("the routes: investigate restarts with the notice; accuse refuses a cold pre-accusation token (the #39 replay)", async () => {
    at(NOW);
    const g = midGame();
    g.discoveredEvidenceIds.push("muddy-footprint", "burned-letter", "library-key");
    const token = encodeStateToken(g, TEST_ENV);
    at(NOW + 8 * DAY);
    const inv = handleInvestigate({ caseId: "blackwood", locationId: "library", stateToken: token }, { caseData: c, env: TEST_ENV });
    expect(inv.body.notice).toBe(COLD_CASE_NOTICE);
    const acc = await handleAccuse(
      { accusation: { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key"] }, stateToken: token },
      { caseData: c, env: TEST_ENV },
    );
    expect(acc.status).toBe(400);
    expect(acc.body).toMatchObject({ error: "invalid_state", notice: COLD_CASE_NOTICE });
    expect(JSON.stringify(acc.body)).not.toMatch(/"solution"/);
  });
  it("interrogating with a cold token starts afresh (notice) instead of continuing the old game", async () => {
    mockGrok({});
    at(NOW);
    const token = encodeStateToken(midGame(), TEST_ENV);
    at(NOW + 30 * DAY);
    const r = await handleInterrogate({ caseId: "blackwood", characterId: "reginald", question: "Hello?", stateToken: token }, { caseData: c, env: TEST_ENV });
    expect(r.body.notice).toBe(COLD_CASE_NOTICE);
    at(NOW + 30 * DAY);
    const back = decodeStateToken(r.body.stateToken, c, TEST_ENV);
    expect(back.ok && back.game.turn).toBe(1);
  });
});

describe("#39 accusation record and the cache backend", () => {
  it("the accused-game record lives 30 days, past the 7-day token age", () => {
    expect(ACCUSED_TTL_SECONDS).toBe(30 * 24 * 3600);
    expect(ACCUSED_TTL_SECONDS * 1000).toBeGreaterThan(STATE_TOKEN_MAX_AGE_MS);
  });
  it("GET /api/health reports which cache backs the limits (memory off Vercel), no-store", async () => {
    const res = health();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, runtimeCache: "memory" });
  });
});
