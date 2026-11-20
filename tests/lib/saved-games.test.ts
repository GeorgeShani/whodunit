import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleResume, RESUME_LINES } from "@/engine/resume-handler";
import { saveSession } from "@/engine/session";
import { decodeStateToken, encodeStateToken, newGameId, peekStateTokenSaveVersion } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { CASE_ALIASES, canonicalCaseId, caseIdsMatch } from "@/lib/cases";
import { persistSavedGame, snapshotFromGame, syncIncomingToken } from "@/lib/saved-session";
import { memorySavedGames, SAVE_MAX_AGE_MS } from "@/lib/saved-games";
import { TEST_ENV } from "../helpers/grok-mock";

let blackwood: LoadedCase;
beforeAll(async () => {
  blackwood = await loadCase("blackwood");
});

const tokenFor = (c: LoadedCase, edit?: (g: ReturnType<typeof createInitialGameState>) => void, version = 1) => {
  const g = createInitialGameState(c);
  g.gameId = newGameId();
  g.saveVersion = version;
  edit?.(g);
  return { game: g, token: encodeStateToken(g, TEST_ENV) };
};

const proofKeys = (body: unknown) => {
  const s = JSON.stringify(body);
  return {
    hasSolution: /"solution"\s*:/.test(s),
    hasProofList: /"keyTestimonyGroups"\s*:/.test(s) || /"hiddenProof"\s*:/.test(s) || /"featureProof"\s*:/.test(s),
    hasSealed: /"sealed"\s*:/.test(s) || /"liesToldIds"\s*:/.test(s) || /"hintedLieIds"\s*:/.test(s),
  };
};

describe("128-bit game id and case aliases", () => {
  it("mints a 128-bit id and accepts the format check", () => {
    const id = newGameId();
    expect(Buffer.from(id, "base64url")).toHaveLength(16);
    expect(id).toHaveLength(22);
  });
  it("maps _tallyho to tallyho", () => {
    expect(CASE_ALIASES._tallyho).toBe("tallyho");
    expect(canonicalCaseId("_tallyho")).toBe("tallyho");
    expect(caseIdsMatch("_tallyho", "tallyho")).toBe(true);
    expect(caseIdsMatch("blackwood", "tallyho")).toBe(false);
  });
  it("an old _tallyho token decodes against a case published as tallyho", () => {
    const published = { ...blackwood, id: "tallyho" };
    const { token } = tokenFor({ ...blackwood, id: "_tallyho" }, (g) => {
      g.discoveredEvidenceIds.push(blackwood.evidence[0]!.id);
    });
    const r = decodeStateToken(token, published, TEST_ENV);
    expect(r.ok).toBe(true);
  });
});

describe("saved_games optimistic version", () => {
  it("a lower version does not overwrite the newest row (#40)", async () => {
    const repo = memorySavedGames();
    const a = tokenFor(blackwood, undefined, 2);
    const b = tokenFor(blackwood, (g) => {
      g.gameId = a.game.gameId;
    }, 1);
    await repo.upsertSave({ gameId: a.game.gameId!, caseId: "blackwood", stateToken: a.token, version: 2 });
    const lost = await repo.upsertSave({ gameId: a.game.gameId!, caseId: "blackwood", stateToken: b.token, version: 1 });
    expect(lost.written).toBe(false);
    expect((await repo.getSave(a.game.gameId!))?.stateToken).toBe(a.token);
    expect((await repo.getSave(a.game.gameId!))?.version).toBe(2);
  });
  it("prunes rows older than the retention window", async () => {
    const repo = memorySavedGames();
    const { token, game } = tokenFor(blackwood);
    await repo.upsertSave({ gameId: game.gameId!, caseId: "blackwood", stateToken: token, version: 1 });
    repo.rows.get(game.gameId!)!.updatedAt = new Date(Date.now() - SAVE_MAX_AGE_MS - 1000);
    expect(await repo.pruneSaves()).toBe(1);
    expect(await repo.getSave(game.gameId!)).toBeNull();
  });
});

describe("sync, persist, resume", () => {
  it("rejects a stale client token in favour of the newest saved version", async () => {
    const repo = memorySavedGames();
    const fresh = tokenFor(blackwood, undefined, 3);
    const stale = tokenFor(blackwood, (g) => {
      g.gameId = fresh.game.gameId;
    }, 1);
    await repo.upsertSave({ gameId: fresh.game.gameId!, caseId: "blackwood", stateToken: fresh.token, version: 3 });
    const synced = await syncIncomingToken({ caseId: "blackwood", stateToken: stale.token }, blackwood, TEST_ENV, repo);
    expect((synced.json as { stateToken: string }).stateToken).toBe(fresh.token);
    const resumed = await handleResume({ gameId: fresh.game.gameId, caseId: "blackwood", stateToken: stale.token }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });
    expect(resumed.status).toBe(200);
    expect(resumed.body.stateToken).toBe(fresh.token);
    expect(peekStateTokenSaveVersion(resumed.body.stateToken, TEST_ENV)).toBe(3);
  });

  it("rejects a swapped game id or case, and the body has no solution or proof fields", async () => {
    const repo = memorySavedGames();
    const a = tokenFor(blackwood, undefined, 1);
    await repo.upsertSave({ gameId: a.game.gameId!, caseId: "blackwood", stateToken: a.token, version: 1 });
    const swapId = await handleResume({ gameId: newGameId(), caseId: "blackwood", stateToken: a.token }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });
    expect(swapId.status).toBe(400);
    expect(swapId.body.line).toBe(RESUME_LINES.swapped);
    expect(proofKeys(swapId.body)).toEqual({ hasSolution: false, hasProofList: false, hasSealed: false });
    const other = { ...blackwood, id: "harbor-light" };
    const swapCase = await handleResume({ gameId: a.game.gameId, caseId: "harbor-light", stateToken: a.token }, { caseData: other, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });
    expect(swapCase.status).toBe(400);
    expect(swapCase.body.line).toBe(RESUME_LINES.swapped);
    expect(proofKeys(swapCase.body)).toEqual({ hasSolution: false, hasProofList: false, hasSealed: false });
  });

  it("an in-progress resume never contains solution or hidden proof fields", async () => {
    const repo = memorySavedGames();
    const { token, game } = tokenFor(blackwood, (g) => {
      g.discoveredEvidenceIds.push(blackwood.evidence[0]!.id);
    }, 1);
    await repo.upsertSave({ gameId: game.gameId!, caseId: "blackwood", stateToken: token, version: 1 });
    const r = await handleResume({ gameId: game.gameId, caseId: "blackwood" }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });
    expect(r.status).toBe(200);
    expect(r.body.snapshot?.discoveredEvidenceIds).toContain(blackwood.evidence[0]!.id);
    expect(r.body.closed).toBeUndefined();
    expect(proofKeys(r.body)).toEqual({ hasSolution: false, hasProofList: false, hasSealed: false });
    expect(proofKeys(snapshotFromGame(blackwood, game))).toEqual({ hasSolution: false, hasProofList: false, hasSealed: false });
  });

  it("falls back to the client token when the DB is down", async () => {
    const down: import("@/lib/saved-games").SavedGamesRepo = {
      getSave: async () => {
        throw new Error("ECONNREFUSED");
      },
      upsertSave: async () => {
        throw new Error("ECONNREFUSED");
      },
      pruneSaves: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const { token, game } = tokenFor(blackwood, undefined, 4);
    const r = await handleResume({ gameId: game.gameId, caseId: "blackwood", stateToken: token }, { caseData: blackwood, env: TEST_ENV, saves: down, closed: memoryClosedGames() });
    expect(r.status).toBe(200);
    expect(r.body.stateToken).toBe(token);
    await persistSavedGame({ stateToken: token, caseId: "blackwood", env: TEST_ENV, repo: down }); // must not throw
    const noToken = await handleResume({ gameId: game.gameId, caseId: "blackwood" }, { caseData: blackwood, env: TEST_ENV, saves: down, closed: memoryClosedGames() });
    expect(noToken.status).toBe(503);
    expect(noToken.body.line).toBe(RESUME_LINES.cabinetStuck);
    expect(proofKeys(noToken.body)).toEqual({ hasSolution: false, hasProofList: false, hasSealed: false });
  });

  it("replays a closed game from closed_games (#39) on resume", async () => {
    const repo = memorySavedGames();
    const closed = memoryClosedGames();
    const { token, game } = tokenFor(blackwood, undefined, 2);
    await repo.upsertSave({ gameId: game.gameId!, caseId: "blackwood", stateToken: token, version: 2 });
    await closed.closeGame({ gameId: game.gameId!, caseId: "blackwood", outcome: "lost", accusedId: blackwood.characters[0]!.id });
    const r = await handleResume({ gameId: game.gameId, caseId: "blackwood" }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed });
    expect(r.status).toBe(200);
    expect(r.body.closed?.outcome).toBe("lost");
    expect(r.body.closed?.solution).toBeUndefined();
    expect(r.body.closed?.verdict).toBeUndefined();
  });

  it("saveSession stamps a rising saveVersion into the signed token", () => {
    const g = createInitialGameState(blackwood);
    const t1 = saveSession(g, TEST_ENV);
    const t2 = saveSession(g, TEST_ENV);
    expect(peekStateTokenSaveVersion(t1, TEST_ENV)).toBe(1);
    expect(peekStateTokenSaveVersion(t2, TEST_ENV)).toBe(2);
    expect(g.saveVersion).toBe(2);
  });
});
