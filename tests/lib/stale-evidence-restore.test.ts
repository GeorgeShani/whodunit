/**
 * A mid-game player whose save predates the weapon-flag fix (old sessionStorage blob: whole evidence objects, the
 * candlestick without `weapon`) reloads. The blob only hands over its token; the notebook in state comes from the
 * server's resume snapshot (rebuilt by id from the case), or from the public case view when resume fails. No path
 * puts stored evidence objects into state, so Accuse offers the candlestick.
 */
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { getPublicCaseView } from "@/engine/public-view";
import { handleResume } from "@/engine/resume-handler";
import { encodeStateToken } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { loadSavePointer, readTokenFallback, resumedEvidence, sessionKey, SESSION_VERSION } from "@/lib/game-session";
import { memorySavedGames } from "@/lib/saved-games";
import { TEST_ENV } from "../helpers/grok-mock";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

let c: LoadedCase;
let token: string;
let session: ReturnType<typeof memStore>;
beforeAll(async () => {
  c = await loadCase("blackwood");
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick");
  g.searchedLocationIds.push("library");
  token = encodeStateToken(g, TEST_ENV);
});

/** The pre-fix blob: the candlestick as the old /api/investigate shape (no weapon, no locationId), plus junk. */
function oldBlob() {
  const s = memStore();
  const candle = c.evidence.find((e) => e.id === "silver-candlestick")!;
  s.m.set(sessionKey("blackwood"), JSON.stringify({
    v: SESSION_VERSION, caseId: "blackwood", screen: "accuse", activeId: null, stateToken: token, conversations: {}, emotions: {},
    evidence: [{ id: candle.id, name: candle.name, description: candle.description, kind: candle.kind }, "no-such-clue"],
    searched: ["library"], searchLines: {}, nextId: 0,
  }));
  return s;
}

describe("restoring a save made before the weapon fix", () => {
  it("the old blob hands over only its token (no evidence) and is dropped", () => {
    session = oldBlob();
    const loaded = loadSavePointer("blackwood", memStore(), session);
    expect(loaded).toEqual({ pointer: null, legacyToken: token });
    expect(session.m.has(sessionKey("blackwood"))).toBe(false);
  });

  it("resume rebuilds the notebook server-side: the candlestick in state has weapon: true and Accuse offers it", async () => {
    const r = await handleResume({ caseId: "blackwood", stateToken: token }, { caseData: c, env: TEST_ENV, saves: memorySavedGames(), closed: memoryClosedGames() });
    expect(r.status).toBe(200);
    const view = getPublicCaseView(c);
    const inState = resumedEvidence(r.body.snapshot, view.evidence);
    expect(inState.find((e) => e.id === "silver-candlestick")?.weapon).toBe(true);
    expect(inState.map((e) => e.id)).not.toContain("no-such-clue");
    expect(weaponChoices(inState, view.weaponsMarked).map((e) => e.id)).toEqual(["silver-candlestick"]);
  });

  it("fallback (resume failed, offline or unknown): state is the public case view, never the stored copy", () => {
    const view = getPublicCaseView(c);
    expect(resumedEvidence(undefined, view.evidence)).toBe(view.evidence);
    expect(resumedEvidence({ evidence: [] }, view.evidence)).toBe(view.evidence);
    expect(readTokenFallback("blackwood", memStore())).toBeUndefined();
    // A view that already holds the clue (e.g. a case where it starts in the notebook) carries the flag.
    const full = getPublicCaseView(c, { discoveredEvidenceIds: ["silver-candlestick"] });
    expect(weaponChoices(resumedEvidence(null, full.evidence), true).map((e) => e.id)).toEqual(["silver-candlestick"]);
  });

  it("Game.tsx: every setEvidence takes server or case-view data, never storage", async () => {
    const src = await readFile("components/game/Game.tsx", "utf8");
    const calls = [...src.matchAll(/setEvidence\(([^\n]*)/g)].map((m) => m[1]!.trim());
    for (const call of calls) expect(call, call).toMatch(/^(view\.evidence\)|resumedEvidence\(snap, view\.evidence\)\)|\(ev\) => \{)/);
    expect(src).not.toMatch(/loadGame\(|saved\.evidence/);
  });
});
