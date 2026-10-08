/**
 * #39: the accuse route with the Postgres closed-games record as the source of truth (lib/closed-games.ts).
 * Handler-level runs use the in-memory repository (same contract as Postgres, see tests/lib/closed-games.test.ts) and
 * a failing one; route-level runs use the real route with DATABASE_URL unset (cache-only fallback) and pointed at a
 * closed port (the real postgres-js client failing: fail closed).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/accuse/route";
import { closeDb } from "@/db/client";
import { ACCUSE_LINES, handleAccuse, type AccusedStore, type ClosedGamesStore } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import type { Accusation, GameState } from "@/engine/types";
import { closedGamesRepo, memoryClosedGames, resetClosedGamesWarning } from "@/lib/closed-games";
import { deepScan } from "../helpers/leak-scan";
import { TEST_ENV } from "../helpers/grok-mock";
import { ungated } from "../helpers/ungated";

let c: LoadedCase;
let real: LoadedCase;
beforeAll(async () => {
  real = await loadCase("blackwood");
  c = ungated(real);
});

const ALL = ["silver-candlestick", "muddy-footprint", "burned-letter", "library-key"];
const token = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...ALL);
  return encodeStateToken(g, TEST_ENV);
};
const WIN = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "muddy-footprint"] };
const LOSE = { ...WIN, murdererId: "reginald" };
const cacheStore = (): AccusedStore & { m: Map<string, Accusation> } => {
  const m = new Map<string, Accusation>();
  return { m, get: async (id) => m.get(id) ?? null, put: async (id, a) => void m.set(id, a) };
};
const accuse = (accusation: Record<string, unknown>, stateToken: string, closed: ClosedGamesStore | null, accused?: AccusedStore) =>
  handleAccuse({ accusation, stateToken }, { caseData: c, env: TEST_ENV, closed, ...(accused ? { accused } : {}) });
const gameOf = (t: string | undefined) => (decodeStateToken(t, c, TEST_ENV) as { ok: true; game: GameState }).game;
const NO_SOLUTION_KEYS = ["verdict", "solution", "murdererCorrect", "weaponCorrect", "motiveCorrect", "keyEvidence"];

describe("#39 accuse with the closed-games record (Postgres contract, in-memory)", () => {
  it("won: the inserting request gets the fresh verdict and the row records it", async () => {
    const repo = memoryClosedGames();
    const t0 = token();
    const r = await accuse(WIN, t0, repo, cacheStore());
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("won");
    expect([...repo.rows.values()]).toEqual([expect.objectContaining({ gameId: gameOf(t0).gameId, caseId: "blackwood", outcome: "won", accusedId: "victoria" })]);
  });

  it("lost, then the old pre-accusation token with the TRUE answer (cache missed): the stored loss, nothing revealed", async () => {
    const repo = memoryClosedGames();
    const t0 = token();
    expect((await accuse(LOSE, t0, repo, cacheStore())).body.outcome).toBe("lost");
    // A different instance/region: its cache never saw this game; Postgres did.
    const cheat = await accuse(WIN, t0, repo, cacheStore());
    expect(cheat.status).toBe(409);
    expect(cheat.body).toMatchObject({ error: "case_closed", line: ACCUSE_LINES.caseClosed, outcome: "lost" });
    expect(cheat.body.ending?.accusedId).toBe("reginald");
    expect(cheat.body.ending?.beats.every((b) => b.evidenceIds.length === 0)).toBe(true);
    expect(cheat.body.evidence).toBeUndefined();
    expect(cheat.body.accusation).toBeUndefined();
    const { keys, strings } = deepScan(cheat.body);
    for (const k of NO_SOLUTION_KEYS) expect(keys.has(k), k).toBe(false);
    expect(strings.has(c.solution.explanation!)).toBe(false);
    // The token comes back exactly as sent (a game-over token needs a full accusation), and it still can't win.
    expect(cheat.body.stateToken).toBe(t0);
    expect((await accuse(WIN, t0, repo, cacheStore())).body.outcome).toBe("lost");
    expect(repo.rows.size).toBe(1);
  });

  it("won, then the old token from a cold cache: the stored win, with the solution, and a game-over token", async () => {
    const repo = memoryClosedGames();
    const t0 = token();
    await accuse(WIN, t0, repo, cacheStore());
    const again = await accuse(LOSE, t0, repo, cacheStore());
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "case_closed", outcome: "won" });
    expect(again.body.solution?.murderer.id).toBe("victoria");
    expect(gameOf(again.body.stateToken)).toMatchObject({ outcome: "won", phase: "resolved" });
    // That game-over token replays without touching the record again.
    const spy = { closeGame: vi.fn(), getClosed: vi.fn() };
    expect((await accuse(LOSE, again.body.stateToken!, spy as never)).body.outcome).toBe("won");
    expect(spy.getClosed).not.toHaveBeenCalled();
  });

  it("the cache record stays the fast pre-check: a warm cache replays the ORIGINAL accusation without asking Postgres", async () => {
    const repo = memoryClosedGames();
    const cache = cacheStore();
    const t0 = token();
    await accuse(LOSE, t0, repo, cache);
    expect(cache.m.size).toBe(1); // write-through
    const spy = { closeGame: vi.fn(), getClosed: vi.fn() };
    const replay = await accuse(WIN, t0, spy as never, cache);
    expect(replay.status).toBe(409);
    expect(replay.body.accusation?.murdererId).toBe("reginald");
    expect(spy.getClosed).not.toHaveBeenCalled();
    expect(spy.closeGame).not.toHaveBeenCalled();
  });

  it("a concurrent double accuse (two tabs, one token): exactly one fresh verdict; the other gets the stored outcome", async () => {
    const repo = memoryClosedGames();
    const t0 = token();
    const rs = await Promise.all([accuse(WIN, t0, repo, cacheStore()), accuse(LOSE, t0, repo, cacheStore()), accuse(WIN, t0, repo, cacheStore())]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    const fresh = rs.find((r) => r.status === 200)!;
    for (const r of rs) expect(r.body.outcome).toBe(fresh.body.outcome);
    expect(repo.rows.size).toBe(1);
  });

  it("the DB down: 503 in character, token unchanged, nothing consumed; a retry later succeeds", async () => {
    const repo = memoryClosedGames();
    const cache = cacheStore();
    let down = true;
    const flaky: ClosedGamesStore = {
      getClosed: (id) => (down ? Promise.reject(new Error("ECONNREFUSED")) : repo.getClosed(id)),
      closeGame: (input) => (down ? Promise.reject(new Error("ECONNREFUSED")) : repo.closeGame(input)),
    };
    const t0 = token();
    const r = await accuse(LOSE, t0, flaky, cache);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "record_unavailable", line: ACCUSE_LINES.recordDown, stateToken: t0, progress: expect.anything() });
    expect(r.body.line).not.toMatch(/\b(database|db|error|server|postgres|supabase)\b/i);
    expect(cache.m.size).toBe(0);
    expect(repo.rows.size).toBe(0);
    down = false;
    const retry = await accuse(WIN, t0, flaky, cache);
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe("won"); // the earlier failed guess was never decided
  });

  it("a read error alone is not trusted either way: the insert decides", async () => {
    const repo = memoryClosedGames();
    const readBroken: ClosedGamesStore = { getClosed: () => Promise.reject(new Error("x")), closeGame: (i) => repo.closeGame(i) };
    const t0 = token();
    expect((await accuse(LOSE, t0, readBroken)).status).toBe(200);
    const again = await accuse(WIN, t0, readBroken);
    expect(again.status).toBe(409);
    expect(again.body.outcome).toBe("lost");
  });

  it("no record configured (DATABASE_URL unset): today's cache-only behaviour", async () => {
    const cache = cacheStore();
    const t0 = token();
    expect((await accuse(LOSE, t0, null, cache)).status).toBe(200);
    const replay = await accuse(WIN, t0, null, cache);
    expect(replay.status).toBe(409);
    expect(replay.body.accusation?.murdererId).toBe("reginald");
  });
});

/** A gate-open token for the REAL (gated) case, built generically: every clue, every secret, everyone questioned. */
function readyToken(): string {
  const g = createInitialGameState(real);
  g.discoveredEvidenceIds.push(...real.evidence.map((e) => e.id));
  for (const ch of real.characters) {
    g.characters[ch.id].interrogationCount = 5;
    for (const s of ch.secrets) {
      g.characters[ch.id].revealedSecretIds.push(s.id);
      g.revealedSecretIds.push(s.id);
    }
  }
  return encodeStateToken(g);
}
const realWin = () => ({
  murdererId: real.solution.murdererId,
  weaponId: real.solution.weaponId,
  motiveId: real.solution.motiveId,
  keyEvidenceIds: real.solution.keyEvidenceIds.slice(0, 5),
  ...(real.solution.keyTestimonyIds?.length ? { keyTestimonyIds: real.solution.keyTestimonyIds.slice(0, 3) } : {}),
});
const post = (body: unknown) => POST(new Request("http://t/api/accuse", { method: "POST", body: JSON.stringify(body) }));

describe("#39 POST /api/accuse (route)", () => {
  const prev = process.env.DATABASE_URL;
  afterEach(async () => {
    await closeDb();
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
    vi.restoreAllMocks();
  });

  it("DATABASE_URL unset: accusations work cache-only, and the warning is logged once per process", async () => {
    delete process.env.DATABASE_URL;
    resetClosedGamesWarning();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = readyToken();
    const r = await post({ caseId: "blackwood", accusation: realWin(), stateToken: t0 });
    expect(r.status).toBe(200);
    expect((await r.json()).outcome).toBe("won");
    const replay = await post({ caseId: "blackwood", accusation: realWin(), stateToken: t0 });
    expect(replay.status).toBe(409); // the in-process cache record
    const ours = warn.mock.calls.filter((a) => String(a[0]).includes("[closed-games]"));
    expect(ours, JSON.stringify(warn.mock.calls)).toHaveLength(1);
    expect(String(ours[0][0])).toMatch(/DATABASE_URL is not set/);
    expect(closedGamesRepo(process.env, () => {})).toBeNull();
  });

  it("DATABASE_URL set but the database unreachable (real postgres-js client): 503 + Retry-After, token unchanged, then OK once the record answers", async () => {
    // A closed local port: the connection is refused at once. No credentials are involved.
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:9/none";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = readyToken();
    const r = await post({ caseId: "blackwood", accusation: realWin(), stateToken: t0 });
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("5");
    const j = await r.json();
    expect(j).toMatchObject({ error: "record_unavailable", line: ACCUSE_LINES.recordDown, stateToken: t0 });
    expect(j.outcome).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain("127.0.0.1");
    void err;
    // The same token, once the env var is gone again (cache-only), is still un-spent.
    await closeDb();
    delete process.env.DATABASE_URL;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const later = await post({ caseId: "blackwood", accusation: realWin(), stateToken: t0 });
    expect(later.status).toBe(200);
  });
});
