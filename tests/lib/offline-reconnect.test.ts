/**
 * #94 + #96: a tab that fell back to offline tokens reconnects and is sent back to the stored save. Every surface
 * (investigate, hint, dialogue, confront, accuse, and Continue/resume) gets the in-character STALE_TOKEN_NOTICE plus,
 * on a move, the public snapshot of the resulting state, which the client helpers turn into "rebuild + show notice".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cabinetAhead, resumeNotice, swappedSnapshot, withNotice } from "@/components/game/cabinet-notice";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { handleHint } from "@/engine/hint-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { handleResume } from "@/engine/resume-handler";
import { OFFLINE_RESUME_NOTICE, STALE_TOKEN_NOTICE } from "@/engine/session";
import { decodeStateToken, encodeStateToken, peekStateTokenOffline } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { resetIssuedHighWater, runWithSaveContext } from "@/lib/save-context";
import { commitSavedAction, syncIncomingToken } from "@/lib/saved-session";
import { memorySavedGames, type SavedGamesRepo } from "@/lib/saved-games";
import { TEST_ENV } from "../helpers/grok-mock";

let blackwood: LoadedCase;
beforeAll(async () => {
  blackwood = await loadCase("blackwood");
});

/** Stored save at v2 (library, hall); the same game's offline tab got to v5 with other rooms while the cabinet was shut. */
async function scenario() {
  resetIssuedHighWater();
  const repo = memorySavedGames();
  const run = async (json: Record<string, unknown>, handler: typeof handleInvestigate | typeof handleHint = handleInvestigate) => {
    const synced = await syncIncomingToken(json, blackwood, TEST_ENV, repo);
    const { status, body } = runWithSaveContext(synced.cabinetOffline, () => handler(synced.json, { caseData: blackwood, env: TEST_ENV }));
    const c = await commitSavedAction(status, body as { stateToken?: string; notice?: string }, synced, blackwood, TEST_ENV);
    return { status, body: body as unknown as Record<string, unknown> & { stateToken?: string; notice?: string; line?: string }, c, synced };
  };
  const r1 = await run({ caseId: "blackwood", locationId: "library" });
  const r2 = await run({ caseId: "blackwood", locationId: "hall", stateToken: r1.body.stateToken });
  const d = decodeStateToken(r2.body.stateToken, blackwood, TEST_ENV);
  if (!d.ok) throw new Error("seed");
  const offline = encodeStateToken({ ...d.game, offline: true, saveVersion: 5, searchedLocationIds: ["library", "garden", "kitchen"] }, TEST_ENV);
  expect(peekStateTokenOffline(offline, TEST_ENV)).toBe(true);
  return { repo, run, stored: r2.body.stateToken!, offline, gameId: d.game.gameId! };
}

describe("an offline tab reconnecting is sent back to the stored save, with the stale notice", () => {
  it("the offline-reconnect notice IS the in-character stale notice", () => {
    expect(OFFLINE_RESUME_NOTICE).toBe(STALE_TOKEN_NOTICE);
  });

  it("investigate: notice + snapshot of the stored save plus this search; the client rebuilds from it", async () => {
    const { repo, run, offline, gameId } = await scenario();
    const r = await run({ caseId: "blackwood", locationId: "dining-room", stateToken: offline });
    expect(r.status).toBe(200);
    expect(r.c.kind).toBe("ok");
    expect(r.body.notice).toBe(STALE_TOKEN_NOTICE);
    const swap = swappedSnapshot(r.body);
    expect(swap?.notice).toBe(STALE_TOKEN_NOTICE);
    // The offline rooms (garden, kitchen) are rolled back; the stored ones and this search remain.
    expect(swap?.snapshot.searchedLocationIds).toEqual(["library", "hall", "dining-room"]);
    expect(JSON.stringify(r.body)).not.toMatch(/"solution"|"hiddenProof"|"liesToldIds"/);
    const row = (await repo.getSave(gameId))!;
    expect(row.version).toBe(3);
    expect(peekStateTokenOffline(row.stateToken, TEST_ENV)).toBe(false);
  });

  it("hint: notice + snapshot, and the hint view leads with the notice", async () => {
    const { run, offline } = await scenario();
    const r = await run({ caseId: "blackwood", stateToken: offline }, handleHint);
    expect(r.body.notice).toBe(STALE_TOKEN_NOTICE);
    expect(swappedSnapshot(r.body)?.snapshot.searchedLocationIds).toEqual(["library", "hall"]);
    expect(withNotice(r.body.notice, r.body.line ?? "")).toMatch(new RegExp(`^${STALE_TOKEN_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("dialogue, confront and accuse: the same swap + notice reaches their bodies (no model call needed to prove it)", async () => {
    const { repo, offline, stored } = await scenario();
    for (const json of [
      { caseId: "blackwood", characterId: "reginald", question: "Where were you?", stateToken: offline },
      { caseId: "blackwood", characterIds: ["reginald", "victoria"], question: "Well?", stateToken: offline },
      { caseId: "blackwood", accusation: {}, stateToken: offline },
    ]) {
      const synced = await syncIncomingToken(json, blackwood, TEST_ENV, repo as SavedGamesRepo);
      expect(synced.swapped).toBe(true);
      expect(synced.notice).toBe(STALE_TOKEN_NOTICE);
      expect((synced.json as { stateToken: string }).stateToken).toBe(stored);
      // A handler that answered without minting (e.g. the model was out of reach) still carries notice + snapshot.
      const body: { stateToken?: string; notice?: string } = { stateToken: stored };
      const c = await commitSavedAction(200, body, synced, blackwood, TEST_ENV);
      expect(c.kind).toBe("ok");
      expect(body.notice).toBe(STALE_TOKEN_NOTICE);
      expect(swappedSnapshot(body)?.snapshot.searchedLocationIds).toEqual(["library", "hall"]);
    }
  });

  it("Continue: resume with the offline leftover returns the stored save and the stale notice for the title", async () => {
    const { repo, offline, stored, gameId } = await scenario();
    const r = await handleResume({ caseId: "blackwood", gameId, stateToken: offline }, { caseData: blackwood, env: TEST_ENV, saves: repo, closed: memoryClosedGames() });
    expect(r.status).toBe(200);
    expect(r.body.stateToken).toBe(stored);
    expect(r.body.snapshot?.searchedLocationIds).toEqual(["library", "hall"]);
    expect(resumeNotice(r.body)).toBe(STALE_TOKEN_NOTICE);
  });

  it("an ordinary move on the tab's own stored token carries no notice and no snapshot", async () => {
    const { run, stored } = await scenario();
    const r = await run({ caseId: "blackwood", locationId: "garden", stateToken: stored });
    expect(r.body.notice).toBeUndefined();
    expect(swappedSnapshot(r.body)).toBeUndefined();
  });
});

describe("client helpers", () => {
  const snap = { searchedLocationIds: ["library"], evidence: [], testimonies: [] };
  it("swappedSnapshot needs a notice and a well-formed snapshot, and ignores a refused (409) move", () => {
    expect(swappedSnapshot({ notice: "n", snapshot: snap })?.notice).toBe("n");
    expect(swappedSnapshot({ snapshot: snap })).toBeUndefined();
    expect(swappedSnapshot({ notice: "n", snapshot: { evidence: [] } })).toBeUndefined();
    expect(swappedSnapshot({ notice: "n", snapshot: snap, error: "stale_token", stateToken: "t" })).toBeUndefined();
    expect(cabinetAhead({ notice: "n", snapshot: snap, error: "stale_token", stateToken: "t" })?.stateToken).toBe("t");
  });
  it("resumeNotice and withNotice", () => {
    expect(resumeNotice({ notice: STALE_TOKEN_NOTICE })).toBe(STALE_TOKEN_NOTICE);
    expect(resumeNotice({ notice: "  " })).toBeUndefined();
    expect(resumeNotice(null)).toBeUndefined();
    expect(withNotice(undefined, "line")).toBe("line");
    expect(withNotice("n", "")).toBe("n");
    expect(withNotice("n", "line")).toBe("n line");
  });
});
