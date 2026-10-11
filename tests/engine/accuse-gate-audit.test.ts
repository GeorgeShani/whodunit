/** E1: the validator warns when ACCUSE can open while the win is still impossible (reachable-state search). */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseWarnings } from "@/engine/case-validation";
import { accuseProgress } from "@/engine/progress";
import { accuseOpenWithoutWin } from "@/engine/progression-validation";

/** These run the validator's exhaustive state search (fastestPath / checkCaseWarnings): unchanged, just slow under a loaded runner. */
const EXHAUSTIVE_SEARCH_TIMEOUT = 30_000;

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

describe("E1: accuse gate vs the win", () => {
  it("Blackwood's gate (data from #55) never opens before the win is possible: no warning", { timeout: EXHAUSTIVE_SEARCH_TIMEOUT }, () => {
    expect(accuseOpenWithoutWin(c)).toBeNull();
    expect(checkCaseWarnings(c).filter((w) => w.path === "accuseGate")).toEqual([]);
  });

  it("without the required leads (the pre-#55 gate) it finds such a state and warns", { timeout: EXHAUSTIVE_SEARCH_TIMEOUT }, () => {
    const loose: LoadedCase = { ...c, accuseGate: { ...c.accuseGate!, closedLeadIds: [] } };
    const g = accuseOpenWithoutWin(loose);
    expect(g).not.toBeNull();
    expect(g).not.toBe("budget");
    const s = g as Exclude<typeof g, null | "budget">;
    expect(accuseProgress(loose, s).unlocked).toBe(true);
    const keys = c.solution.keyEvidenceIds.filter((id) => s.discoveredEvidenceIds.includes(id)).length;
    const testimony = (c.solution.keyTestimonyIds ?? []).filter((id) => s.revealedSecretIds.includes(id)).length;
    expect(keys < (c.solution.minKeyEvidence ?? 1) || testimony < (c.solution.minKeyTestimony ?? 0)).toBe(true);
    expect(checkCaseWarnings(loose).map((w) => w.message).join("\n")).toMatch(/ACCUSE can open while winning is impossible/);
  });

  it("a case with no gate is not audited", () => {
    expect(accuseOpenWithoutWin({ ...c, accuseGate: undefined })).toBeNull();
  });
});
