import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { handleSave, SAVE_LINES } from "@/engine/save-handler";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken, newGameId, tamperedTokenForTests } from "@/engine/state-token";
import { bindQuietSave, createQuietSave, QUIET_SAVE_MAX_CHARS, QUIET_SAVE_PATH } from "@/lib/quiet-save";
import { memorySavedGames } from "@/lib/saved-games";
import { TEST_ENV } from "../helpers/grok-mock";

let blackwood: LoadedCase;
beforeAll(async () => {
  blackwood = await loadCase("blackwood");
});

const tokenFor = (version: number, edit?: (g: ReturnType<typeof createInitialGameState>) => void) => {
  const g = createInitialGameState(blackwood);
  g.gameId = newGameId();
  g.saveVersion = version;
  edit?.(g);
  return { game: g, token: encodeStateToken(g, TEST_ENV) };
};

describe("quiet save trigger and dedupe", () => {
  it("flushes via sendBeacon on visibility hidden and pagehide, and skips a repeat of the same version", () => {
    const beacons: Array<{ url: string; type: string; text: string }> = [];
    const save = createQuietSave({
      transport: {
        sendBeacon: (url, data) => {
          const blob = data as Blob;
          beacons.push({ url, type: blob.type, text: "pending" });
          void blob.text().then((t) => {
            beacons[beacons.length - 1]!.text = t;
          });
          return true;
        },
      },
    });
    const { token, game } = tokenFor(3);
    save.note({ caseId: "blackwood", gameId: game.gameId, token, saveVersion: 3 });

    const doc = {
      visibilityState: "visible" as Document["visibilityState"],
      listeners: new Map<string, () => void>(),
      addEventListener(type: string, fn: () => void) {
        this.listeners.set(type, fn);
      },
      removeEventListener(type: string) {
        this.listeners.delete(type);
      },
    };
    const win = {
      listeners: new Map<string, () => void>(),
      addEventListener(type: string, fn: () => void) {
        this.listeners.set(type, fn);
      },
      removeEventListener(type: string) {
        this.listeners.delete(type);
      },
    };
    const unbind = bindQuietSave(save, { document: doc, window: win });

    doc.listeners.get("visibilitychange")?.();
    expect(beacons).toHaveLength(0);

    doc.visibilityState = "hidden";
    doc.listeners.get("visibilitychange")?.();
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.url).toBe(QUIET_SAVE_PATH);
    expect(beacons[0]!.type).toBe("application/json");

    win.listeners.get("pagehide")?.();
    expect(beacons).toHaveLength(1); // same version, skipped
    expect(save.snapshot().flushed).toBe(3);

    save.note({ caseId: "blackwood", gameId: game.gameId, token, saveVersion: 4 });
    win.listeners.get("pagehide")?.();
    expect(beacons).toHaveLength(2);
    unbind();
    expect(doc.listeners.size).toBe(0);
    expect(win.listeners.size).toBe(0);
  });

  it("does not register a beforeunload listener", () => {
    const types: string[] = [];
    const target = {
      visibilityState: "hidden" as const,
      addEventListener(type: string) {
        types.push(type);
      },
      removeEventListener() {},
    };
    bindQuietSave(createQuietSave(), { document: target, window: target });
    expect(types).toEqual(["visibilitychange", "pagehide"]);
    expect(types).not.toContain("beforeunload");
  });

  it("never sends an offline-lineage token, and skips an oversized one", () => {
    let sent = 0;
    const save = createQuietSave({ transport: { sendBeacon: () => ((sent += 1), true) } });
    const { token, game } = tokenFor(2, (g) => {
      g.offline = true;
    });
    save.note({ caseId: "blackwood", gameId: game.gameId, token, saveVersion: 2, offline: true });
    save.flush();
    expect(sent).toBe(0);

    save.note({ caseId: "blackwood", gameId: game.gameId, token: "x".repeat(QUIET_SAVE_MAX_CHARS + 1), saveVersion: 5 });
    save.flush();
    expect(sent).toBe(0);
  });

  it("falls back to fetch keepalive when sendBeacon is missing or returns false, and ignores a 429", async () => {
    const calls: RequestInit[] = [];
    const save = createQuietSave({
      transport: {
        sendBeacon: () => false,
        fetch: async (_url, init) => {
          calls.push(init);
          return { ok: false, status: 429 };
        },
      },
    });
    const { token, game } = tokenFor(1);
    save.note({ caseId: "blackwood", gameId: game.gameId, token, saveVersion: 1 });
    save.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.keepalive).toBe(true);
    expect(calls[0]!.method).toBe("POST");
    await Promise.resolve();
    expect(save.snapshot().flushed).toBeUndefined(); // 429 must not mark flushed or throw
  });
});

describe("POST /api/save handling", () => {
  it("writes a new online token and is idempotent on the same version", async () => {
    const repo = memorySavedGames();
    const { token, game } = tokenFor(4, (g) => {
      g.searchedLocationIds = ["library"];
    });
    const first = await handleSave({ caseId: "blackwood", gameId: game.gameId, stateToken: token }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(first.status).toBe(204);
    expect((await repo.getSave(game.gameId!))?.version).toBe(4);

    const again = await handleSave({ caseId: "blackwood", gameId: game.gameId, stateToken: token }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(again.status).toBe(204);
    expect((await repo.getSave(game.gameId!))?.version).toBe(4);
  });

  it("refuses an offline-lineage token and does not overwrite a newer row", async () => {
    const repo = memorySavedGames();
    const saved = tokenFor(5, (g) => {
      g.searchedLocationIds = ["library", "hall"];
    });
    await handleSave({ caseId: "blackwood", stateToken: saved.token }, { caseData: blackwood, env: TEST_ENV, saves: repo });

    const rolled = tokenFor(2, (g) => {
      g.gameId = saved.game.gameId;
      g.searchedLocationIds = ["library"];
      g.offline = true;
    });
    const r = await handleSave({ caseId: "blackwood", gameId: saved.game.gameId, stateToken: rolled.token }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(r.status).toBe(204);
    const row = await repo.getSave(saved.game.gameId!);
    expect(row?.version).toBe(5);
    expect(row?.stateToken).toBe(saved.token);
  });

  it("rejects a swapped game id or a tampered token, in character", async () => {
    const repo = memorySavedGames();
    const { token } = tokenFor(1);
    const swapped = await handleSave({ caseId: "blackwood", gameId: newGameId(), stateToken: token }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(swapped.status).toBe(400);
    expect(swapped.body?.line).toBe(SAVE_LINES.invalid);

    const tampered = tamperedTokenForTests(token, (p) => {
      p.saveVersion = 99;
    });
    const bad = await handleSave({ caseId: "blackwood", stateToken: tampered }, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(bad.status).toBe(400);
    expect(bad.body?.line).toBe(SAVE_LINES.invalid);
    expect(bad.body?.line).not.toMatch(/hmac|signature|token|server|database/i);
  });

  it("accepts a text/plain JSON body the way a beacon may send it", async () => {
    const { readSaveBody } = await import("@/app/api/save/route");
    const { token, game } = tokenFor(1);
    const payload = { caseId: "blackwood", gameId: game.gameId, stateToken: token };
    const parsed = await readSaveBody(
      new Request("http://t/api/save", {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.json).toEqual(payload);
    const repo = memorySavedGames();
    const r = await handleSave(payload, { caseData: blackwood, env: TEST_ENV, saves: repo });
    expect(r.status).toBe(204);
    expect((await repo.getSave(game.gameId!))?.version).toBe(1);
  });
});
