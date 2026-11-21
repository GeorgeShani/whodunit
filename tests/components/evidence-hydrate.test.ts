/**
 * Stored notebooks are rebuilt by id, never trusted: a saved copy of the candlestick without `weapon` (an older
 * build's /api/investigate shape) must still be offered in Accuse once the case view or the server's notebook is in.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { hydrateEvidence, parseNotebook, storedEvidence } from "@/components/evidence/hydrate-evidence";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { handleInvestigate } from "@/engine/investigate-handler";
import { handleNotebook } from "@/engine/notebook-handler";
import { getPublicCaseView, type PublicEvidence } from "@/engine/public-view";
import { parseSavedGame, SESSION_VERSION, sessionKey } from "@/lib/game-session";
import { ungated } from "../helpers/ungated";
import { TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
});

/** A saved game as an older build wrote it: whole evidence objects, the candlestick without `weapon`. */
function staleSave(stateToken: string, extra: unknown[] = []) {
  const view = getPublicCaseView(c, { discoveredEvidenceIds: [...getPublicCaseView(c).evidence.map((e) => e.id), "silver-candlestick"] });
  const evidence = view.evidence.map(({ weapon: _w, ...e }) => (void _w, e));
  return JSON.stringify({
    v: SESSION_VERSION, caseId: c.id, screen: "accuse", activeId: null, stateToken,
    conversations: {}, emotions: {}, evidence: [...evidence, ...extra], searched: ["library"], searchLines: {}, nextId: 0,
  });
}

describe("restoring a stale notebook (accuse weapon picker)", () => {
  it("the stale copy alone offers no weapon (the live bug), and the server's notebook brings the candlestick back", () => {
    const token = handleInvestigate({ locationId: "library" }, { caseData: c, env: TEST_ENV }).body.stateToken!;
    const saved = parseSavedGame(staleSave(token), c.id)!;
    expect(saved).not.toBeNull();
    const view = getPublicCaseView(c);
    const local = hydrateEvidence(saved.evidence, view.evidence);
    expect(local.map((e) => e.id)).toContain("silver-candlestick");
    expect(weaponChoices(local, view.weaponsMarked)).toEqual([]); // what George saw

    // Restore refresh: POST /api/notebook with the saved token replaces the stored objects by id.
    const server = parseNotebook(handleNotebook({ caseId: c.id, stateToken: saved.stateToken }, { caseData: c, env: TEST_ENV }).body)!;
    expect(weaponChoices(server, view.weaponsMarked).map((e) => e.id)).toEqual(["silver-candlestick"]);
    expect(weaponChoices(hydrateEvidence(saved.evidence, server), view.weaponsMarked).map((e) => e.id)).toEqual(["silver-candlestick"]);
  });

  it("a case view that holds the clue wins over the stored copy", () => {
    const view = getPublicCaseView(c, { discoveredEvidenceIds: c.evidence.map((e) => e.id) });
    const stale = { id: "silver-candlestick", name: "Silver Candlestick", description: "old", kind: "physical" } as PublicEvidence;
    const [e] = hydrateEvidence([stale], view.evidence);
    expect(e?.weapon).toBe(true);
    expect(e?.description).not.toBe("old");
    expect(weaponChoices(hydrateEvidence(["silver-candlestick"], view.evidence), true).map((x) => x.id)).toEqual(["silver-candlestick"]);
  });

  it("old object arrays and id arrays both load; unknown ids, junk and duplicates are dropped", () => {
    const view = getPublicCaseView(c, { discoveredEvidenceIds: ["muddy-footprint", "silver-candlestick"] });
    const first = view.evidence[0]!;
    const saved = parseSavedGame(staleSave("t", ["no-such-clue", 42, null, { id: 7 }, first.id]), c.id)!;
    expect(saved.evidence.every((e) => typeof e === "string" || typeof e.id === "string")).toBe(true);
    const ids = hydrateEvidence(saved.evidence, view.evidence).map((e) => e.id);
    expect(ids).not.toContain("no-such-clue");
    expect(ids.filter((id) => id === first.id)).toHaveLength(1);
    expect(storedEvidence(["", "x", { id: "y" }, { id: "z", name: "Z" }])).toEqual(["x", { id: "z", name: "Z" }]);
    expect(sessionKey(c.id)).toContain(c.id);
  });

  it("parseNotebook keeps only well-formed clues and rejects non-notebooks", () => {
    expect(parseNotebook({ evidence: [{ id: "a", name: "A" }, { id: 1 }] })).toEqual([{ id: "a", name: "A" }]);
    expect(parseNotebook({ error: "stale_token" })).toBeNull();
    expect(parseNotebook(null)).toBeNull();
  });
});

describe("Game wiring (source guard)", () => {
  it("restore and every finding search rebuild the notebook from the server; stored objects are never set raw", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("components/game/Game.tsx", "utf8");
    expect(src).not.toMatch(/setEvidence\(saved\.evidence/);
    expect(src).toMatch(/hydrateEvidence\(saved\.evidence, view\.evidence\)/);
    expect(src).toMatch(/if \(saved\.stateToken\) refreshNotebook\(saved\.stateToken\)/);
    expect(src).toMatch(/if \(r\.stateToken\) refreshNotebook\(r\.stateToken\)/);
    expect(src).toContain('fetch("/api/notebook"');
  });
});
