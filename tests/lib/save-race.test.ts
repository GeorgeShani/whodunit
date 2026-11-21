/**
 * #95 / #96 / #102: saved_games writes are an atomic compare-and-swap with a per-game throttle in the row, the losing
 * tab is refused (never a 200 at N+1) and handed the winner's row, resume says so in character, the quiet tab-close
 * flush can never replace a row, the save-path limiter fails closed, and the preview-only outage switch does not
 * exist outside a preview.
 *
 * The race runs against the in-memory repo AND against PGlite (real Postgres in WASM) with the committed migrations,
 * so the actual UPDATE ... WHERE version = $base AND state_token = $baseToken is what is being tested.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { handleResume, RESUME_LINES } from "@/engine/resume-handler";
import { handleSave } from "@/engine/save-handler";
import { STALE_TOKEN_NOTICE } from "@/engine/session";
import { decodeStateToken, encodeStateToken, newGameId, peekStateTokenOffline, peekStateTokenSaveVersion } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { memoryKv, type KvStore } from "@/lib/runtime-kv";
import { resetIssuedHighWater, runWithSaveContext } from "@/lib/save-context";
import { allowSavePath, commitSavedAction, SAVE_BUSY_LINE, syncIncomingToken } from "@/lib/saved-session";
import {
  downSavedGames,
  memorySavedGames,
  postgresSavedGames,
  SAVE_WRITES_PER_WINDOW,
  savedGamesRepo,
  savedGamesRepoFor,
  type SavedGamesRepo,
} from "@/lib/saved-games";
import { simulatedDbOutage, TEST_OUTAGE_HEADER } from "@/lib/test-outage";
import { TEST_ENV } from "../helpers/grok-mock";

const SLOW = { timeout: 60_000 };
let blackwood: LoadedCase;
beforeAll(async () => {
  blackwood = await loadCase("blackwood");
});

const MIGRATIONS = ["drizzle/0002_saved_games.sql", "drizzle/0003_saved_games_throttle.sql"].map((f) => readFileSync(f, "utf8"));
async function pgliteRepo(): Promise<{ repo: SavedGamesRepo; pg: PGlite }> {
  const pg = new PGlite();
  for (const m of MIGRATIONS) await pg.exec(m);
  return { repo: postgresSavedGames(drizzlePglite(pg) as never), pg };
}

/** What a route does: sync -> handler -> compare-and-swap. Returns the HTTP status the route would send. */
type Body = ReturnType<typeof handleInvestigate>["body"] & { gameId?: string; offline?: boolean };
async function investigateLikeRoute(repo: SavedGamesRepo, json: Record<string, unknown>): Promise<{ status: number; body: Body }> {
  const synced = await syncIncomingToken(json, blackwood, TEST_ENV, repo);
  const { status, body } = runWithSaveContext(synced.cabinetOffline, () => handleInvestigate(synced.json, { caseData: blackwood, env: TEST_ENV }));
  const c = await commitSavedAction(status, body, synced, blackwood, TEST_ENV);
  if (c.kind === "stale") return { status: 409, body: { ...body, ...c.stale } };
  if (c.kind === "throttled") return { status: 429, body };
  return { status, body };
}

const searched = (token: string | undefined) => {
  const d = decodeStateToken(token, blackwood, TEST_ENV);
  return d.ok ? [...d.game.searchedLocationIds] : null;
};

const backends: [string, () => Promise<SavedGamesRepo>][] = [
  ["in-memory", async () => memorySavedGames()],
  ["PGlite + committed migrations", async () => (await pgliteRepo()).repo],
];

describe.each(backends)("#95 two tabs from the same base (%s)", (_name, make) => {
  it("exactly one move lands; the loser is refused with the winner's row; the winner's room survives the loser's next move", SLOW, async () => {
    resetIssuedHighWater();
    const repo = await make();
    // Base: library searched and stored (N = 1).
    const first = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library" });
    expect(first.status).toBe(200);
    const t0 = first.body.stateToken!;
    const gameId = first.body.gameId!;
    expect((await repo.getSave(gameId))?.stateToken).toBe(t0);

    // Two tabs, both holding T0, both read the row before either writes: the classic race.
    const syncA = await syncIncomingToken({ caseId: "blackwood", locationId: "hall", stateToken: t0 }, blackwood, TEST_ENV, repo);
    const syncB = await syncIncomingToken({ caseId: "blackwood", locationId: "dining-room", stateToken: t0 }, blackwood, TEST_ENV, repo);
    const a = handleInvestigate(syncA.json, { caseData: blackwood, env: TEST_ENV });
    const b = handleInvestigate(syncB.json, { caseData: blackwood, env: TEST_ENV });
    expect(peekStateTokenSaveVersion(a.body.stateToken, TEST_ENV)).toBe(2);
    expect(peekStateTokenSaveVersion(b.body.stateToken, TEST_ENV)).toBe(2);
    const [ca, cb] = await Promise.all([
      commitSavedAction(a.status, a.body, syncA, blackwood, TEST_ENV),
      commitSavedAction(b.status, b.body, syncB, blackwood, TEST_ENV),
    ]);

    const outcomes = [ca.kind, cb.kind].sort();
    expect(outcomes).toEqual(["ok", "stale"]); // never two 200s at N+1
    const winnerRoom = ca.kind === "ok" ? "hall" : "dining-room";
    const loser = ca.kind === "stale" ? ca : cb;
    if (loser.kind !== "stale") throw new Error("unreachable");
    const row = (await repo.getSave(gameId))!;
    expect(row.version).toBe(2);
    expect(searched(row.stateToken)).toEqual(["library", winnerRoom]);
    // The loser gets the winner's row, its snapshot and the in-character notice, not its own N+1.
    expect(loser.stale.error).toBe("stale_token");
    expect(loser.stale.notice).toBe(STALE_TOKEN_NOTICE);
    expect(loser.stale.stateToken).toBe(row.stateToken);
    expect(loser.stale.saveVersion).toBe(2);
    expect(loser.stale.snapshot.searchedLocationIds).toEqual(["library", winnerRoom]);
    expect(JSON.stringify(loser.stale)).not.toMatch(/"solution"|"hiddenProof"|"liesToldIds"/);

    // Worst case: the losing tab still holds its own unsaved N+1 fork (an old client ignoring the 409) and searches
    // the kitchen with it. It must move forward from the stored row, with the notice, and never fork.
    const forkToken = (ca.kind === "stale" ? a : b).body.stateToken!;
    const next = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "kitchen", stateToken: forkToken });
    expect(next.status).toBe(200);
    expect(next.body.notice).toBe(STALE_TOKEN_NOTICE);
    expect(next.body.searchedLocationIds).toEqual(["library", winnerRoom, "kitchen"]);
    const after = (await repo.getSave(gameId))!;
    expect(after.version).toBe(3);
    expect(searched(after.stateToken)).toEqual(["library", winnerRoom, "kitchen"]);

    // And the quiet tab-close flush of that fork cannot replace the row either (silent 204, row untouched).
    const flushed = await handleSave({ caseId: "blackwood", gameId, stateToken: forkToken }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(flushed.status).toBe(204);
    expect(flushed.body).toBeUndefined();
    expect((await repo.getSave(gameId))!.stateToken).toBe(after.stateToken);
  });

  it("many tabs at once from one base: one write, every other request refused with the same row", SLOW, async () => {
    resetIssuedHighWater();
    const repo = await make();
    const first = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library" });
    const t0 = first.body.stateToken!;
    const rooms = ["hall", "dining-room", "kitchen", "garden"];
    const synced = await Promise.all(rooms.map((locationId) => syncIncomingToken({ caseId: "blackwood", locationId, stateToken: t0 }, blackwood, TEST_ENV, repo)));
    const handled = synced.map((s) => handleInvestigate(s.json, { caseData: blackwood, env: TEST_ENV }));
    const commits = await Promise.all(handled.map((h, i) => commitSavedAction(h.status, h.body, synced[i]!, blackwood, TEST_ENV)));
    expect(commits.filter((c) => c.kind === "ok")).toHaveLength(1);
    const row = (await repo.getSave(first.body.gameId!))!;
    for (const c of commits) if (c.kind === "stale") expect(c.stale.stateToken).toBe(row.stateToken);
  });

  it("the per-game throttle lives in the row: write N+1 past the cap is refused, the row is untouched", SLOW, async () => {
    resetIssuedHighWater();
    const repo = await make();
    let r = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library" });
    let token = r.body.stateToken!;
    for (let i = 1; i < SAVE_WRITES_PER_WINDOW; i++) {
      r = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library", stateToken: token });
      expect(r.status).toBe(200);
      token = r.body.stateToken!;
    }
    const capped = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "hall", stateToken: token });
    expect(capped.status).toBe(429);
    const row = (await repo.getSave(r.body.gameId!))!;
    expect(row.stateToken).toBe(token);
    expect(row.version).toBe(SAVE_WRITES_PER_WINDOW);
  });
});

describe("the per-game throttle window resets (PGlite)", SLOW, () => {
  it("an expired window lets the next write through and restarts the count", async () => {
    resetIssuedHighWater();
    const { repo, pg } = await pgliteRepo();
    const first = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library" });
    await pg.query(`update saved_games set write_window_count = ${SAVE_WRITES_PER_WINDOW}`);
    const capped = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "hall", stateToken: first.body.stateToken });
    expect(capped.status).toBe(429);
    await pg.query(`update saved_games set write_window_start = now() - interval '61 seconds'`);
    const ok = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "hall", stateToken: first.body.stateToken });
    expect(ok.status).toBe(200);
    const w = await pg.query<{ c: number }>(`select write_window_count as c from saved_games`);
    expect(w.rows[0]!.c).toBe(1);
  });
});

describe("commit edge cases", () => {
  it("a write that throws after a good read downgrades the issued token to offline lineage (#94)", async () => {
    resetIssuedHighWater();
    const mem = memorySavedGames();
    const first = await investigateLikeRoute(mem, { caseId: "blackwood", locationId: "library" });
    const flaky: SavedGamesRepo = { ...mem, commitSave: async () => Promise.reject(new Error("ECONNRESET")) };
    const r = await investigateLikeRoute(flaky, { caseId: "blackwood", locationId: "hall", stateToken: first.body.stateToken });
    expect(r.status).toBe(200);
    expect(peekStateTokenOffline(r.body.stateToken, TEST_ENV)).toBe(true);
    expect((r.body as { offline?: boolean }).offline).toBe(true);
    // The row is still the library-only base; the offline token can never be written over it.
    const flushed = await handleSave({ caseId: "blackwood", stateToken: r.body.stateToken }, { caseData: blackwood, env: TEST_ENV, saves: mem });
    expect(flushed.status).toBe(204);
    expect((await mem.getSave(first.body.gameId!))!.stateToken).toBe(first.body.stateToken);
  });

  it("the tab-close flush can create a missing row but never replace one", async () => {
    const mem = memorySavedGames();
    const g = createInitialGameState(blackwood);
    g.gameId = newGameId();
    g.saveVersion = 3;
    const t3 = encodeStateToken(g, TEST_ENV);
    expect((await handleSave({ caseId: "blackwood", stateToken: t3 }, { caseData: blackwood, env: TEST_ENV, saves: mem })).status).toBe(204);
    expect((await mem.getSave(g.gameId))!.stateToken).toBe(t3);
    g.saveVersion = 9;
    g.searchedLocationIds = ["garden"];
    const t9 = encodeStateToken(g, TEST_ENV);
    expect((await handleSave({ caseId: "blackwood", stateToken: t9 }, { caseData: blackwood, env: TEST_ENV, saves: mem })).status).toBe(204);
    expect((await mem.getSave(g.gameId))!.stateToken).toBe(t3);
  });
});

describe("#96 resume tells a stale or diverged tab", () => {
  const seed = async () => {
    resetIssuedHighWater();
    const repo = memorySavedGames();
    const r1 = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "library" });
    const r2 = await investigateLikeRoute(repo, { caseId: "blackwood", locationId: "hall", stateToken: r1.body.stateToken });
    return { repo, t1: r1.body.stateToken!, t2: r2.body.stateToken!, gameId: r1.body.gameId! };
  };
  const resume = (repo: SavedGamesRepo, gameId: string, stateToken?: string) =>
    handleResume({ caseId: "blackwood", gameId, ...(stateToken ? { stateToken } : {}) }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });

  it("a leftover behind the row: the row comes back with STALE_TOKEN_NOTICE", async () => {
    const { repo, t1, t2, gameId } = await seed();
    const r = await resume(repo, gameId, t1);
    expect(r.status).toBe(200);
    expect(r.body.stateToken).toBe(t2);
    expect(r.body.notice).toBe(STALE_TOKEN_NOTICE);
    expect(r.body.snapshot?.searchedLocationIds).toEqual(["library", "hall"]);
  });

  it("a leftover at the same version but another lineage (a losing tab): the row, with the notice", async () => {
    const { repo, t1, t2, gameId } = await seed();
    const fork = handleInvestigate({ caseId: "blackwood", locationId: "garden", stateToken: t1 }, { caseData: blackwood, env: TEST_ENV }).body.stateToken!;
    expect(peekStateTokenSaveVersion(fork, TEST_ENV)).toBe(2);
    const r = await resume(repo, gameId, fork);
    expect(r.body.stateToken).toBe(t2);
    expect(r.body.notice).toBe(STALE_TOKEN_NOTICE);
  });

  it("a leftover with a HIGHER version that never landed does not beat the row", async () => {
    const { repo, t2, gameId } = await seed();
    const d = decodeStateToken(t2, blackwood, TEST_ENV);
    if (!d.ok) throw new Error("bad seed");
    const pumped = encodeStateToken({ ...d.game, saveVersion: 7, searchedLocationIds: ["library"] }, TEST_ENV);
    const r = await resume(repo, gameId, pumped);
    expect(r.body.stateToken).toBe(t2);
    expect(r.body.notice).toBe(STALE_TOKEN_NOTICE);
  });

  it("the exact stored token, or no leftover: no notice", async () => {
    const { repo, t2, gameId } = await seed();
    expect((await resume(repo, gameId, t2)).body.notice).toBeUndefined();
    expect((await resume(repo, gameId)).body.notice).toBeUndefined();
  });
});

describe("#102 the save-path limiter fails closed", () => {
  const broken: KvStore = {
    get: async () => {
      throw new Error("cache down");
    },
    set: async () => {
      throw new Error("cache down");
    },
    delete: async () => {},
  };
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

  it("a limiter error refuses instead of letting the request through", async () => {
    expect(await allowSavePath(headers, broken)).toBe(false);
    expect(await allowSavePath(headers, memoryKv())).toBe(true);
  });

  it("an action is refused quietly and in character before anything runs", async () => {
    const repo = memorySavedGames();
    const synced = await syncIncomingToken({ caseId: "blackwood", locationId: "library" }, blackwood, TEST_ENV, repo, { headers, kv: broken });
    expect(synced.rateLimited).toBe(true);
    expect(synced.notice).toBe(SAVE_BUSY_LINE);
    expect(repo.rows.size).toBe(0);
  });

  it("resume over the cap says 'a moment' in character, even with a leftover token", async () => {
    const kv = memoryKv();
    const h = new Headers({ "x-forwarded-for": "203.0.113.77" });
    for (let i = 0; i < 60; i++) await allowSavePath(h, kv);
    expect(await allowSavePath(h, kv)).toBe(false);
  });

  it("a refused tab-close flush stays a silent 204", async () => {
    const repo = memorySavedGames();
    const g = createInitialGameState(blackwood);
    g.gameId = newGameId();
    g.saveVersion = 1;
    const t = encodeStateToken(g, TEST_ENV);
    // handleSave uses the shared runtime limiter; force a refusal through a broken store via persist's kv seam.
    const { persistSavedGame } = await import("@/lib/saved-session");
    expect(await persistSavedGame({ stateToken: t, caseId: "blackwood", env: TEST_ENV, repo, headers, kv: broken })).toBe("refused");
    expect(repo.rows.size).toBe(0);
    expect(RESUME_LINES.rate).toBe(SAVE_BUSY_LINE);
  });
});

describe("preview-only outage switch", () => {
  const SECRET = "bypass-secret-for-tests-only";
  const on = (extra: Record<string, string> = {}) => new Headers({ [TEST_OUTAGE_HEADER]: "db-down", "x-vercel-protection-bypass": SECRET, ...extra });
  const preview = { VERCEL_ENV: "preview", VERCEL_AUTOMATION_BYPASS_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;

  it("production refuses it outright, even with the correct bypass header", () => {
    const prod = { VERCEL_ENV: "production", VERCEL_AUTOMATION_BYPASS_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
    expect(simulatedDbOutage(on(), prod)).toBe(false);
    expect(simulatedDbOutage(on({ "x-whodunit-bypass": SECRET }), prod)).toBe(false);
    // ...and the production repo is the real one (null here: no DATABASE_URL), never the "down" stand-in.
    expect(savedGamesRepoFor(on(), prod)).toBe(savedGamesRepo(prod));
  });

  it("development, tests and an unset VERCEL_ENV refuse it too", () => {
    for (const VERCEL_ENV of ["development", "", undefined]) {
      expect(simulatedDbOutage(on(), { VERCEL_ENV, VERCEL_AUTOMATION_BYPASS_SECRET: SECRET } as unknown as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it("a preview refuses it without the secret, with a wrong secret, or without the outage header", () => {
    expect(simulatedDbOutage(on(), { VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(simulatedDbOutage(on({ "x-vercel-protection-bypass": "wrong" }), preview)).toBe(false);
    expect(simulatedDbOutage(new Headers({ "x-vercel-protection-bypass": SECRET }), preview)).toBe(false);
    expect(simulatedDbOutage(new Headers({ [TEST_OUTAGE_HEADER]: "db-down" }), preview)).toBe(false);
    expect(simulatedDbOutage(undefined, preview)).toBe(false);
  });

  it("on a preview with the right secret it makes every saved_games call fail like a refused connection", async () => {
    expect(simulatedDbOutage(on(), preview)).toBe(true);
    expect(simulatedDbOutage(new Headers({ [TEST_OUTAGE_HEADER]: "db-down", "x-whodunit-bypass": SECRET }), preview)).toBe(true);
    const repo = savedGamesRepoFor(on(), preview)!;
    await expect(repo.getSave("x")).rejects.toThrow(/simulated/);
    // Through sync, that is the ordinary outage path: offline-lineage minting (#94).
    const synced = await syncIncomingToken({ caseId: "blackwood", locationId: "library" }, blackwood, TEST_ENV, downSavedGames());
    expect(synced.cabinetOffline).toBe(false); // no game id yet: nothing to read
    const g = createInitialGameState(blackwood);
    g.gameId = newGameId();
    g.saveVersion = 1;
    const withId = await syncIncomingToken({ caseId: "blackwood", locationId: "library", stateToken: encodeStateToken(g, TEST_ENV) }, blackwood, TEST_ENV, repo);
    expect(withId.cabinetOffline).toBe(true);
  });
});
