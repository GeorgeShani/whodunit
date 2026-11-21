/** #89 resume: the snapshot's notebook is the shared notebook shape (weapon flag and per-clue feature extras kept). */
import { describe, expect, it } from "vitest";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { loadCase } from "@/engine/case-loader";
import { clueFeatures } from "@/engine/features/registry";
import { createInitialGameState } from "@/engine/game-state";
import { notebookEvidence } from "@/engine/public-view";
import { snapshotFromGame } from "@/lib/saved-session";

describe("snapshotFromGame notebook", () => {
  it("keeps feature extras on resumed clues (Tallyho) and matches notebookEvidence", async () => {
    const c = await loadCase("tallyho");
    const withFeatures = c.evidence.filter((e) => clueFeatures(c, e.id) !== undefined);
    expect(withFeatures.length).toBeGreaterThan(0);
    const g = createInitialGameState(c);
    for (const e of c.evidence) if (!g.discoveredEvidenceIds.includes(e.id)) g.discoveredEvidenceIds.push(e.id);
    const snap = snapshotFromGame(c, g);
    for (const e of withFeatures) expect(snap.evidence.find((x) => x.id === e.id)?.features).toEqual(clueFeatures(c, e.id));
    expect(snap.evidence).toEqual(notebookEvidence(c, snap.discoveredEvidenceIds));
    expect(weaponChoices(snap.evidence, true).length).toBe(c.evidence.filter((e) => e.weapon).length);
  });

  it("a resumed Blackwood game that found the candlestick offers it in Accuse", async () => {
    const c = await loadCase("blackwood");
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("silver-candlestick");
    g.searchedLocationIds.push("library");
    const snap = snapshotFromGame(c, g);
    expect(weaponChoices(snap.evidence, true).map((e) => e.id)).toEqual(["silver-candlestick"]);
    expect(snap.evidence.map((e) => e.id)).not.toContain("burned-letter");
  });
});
