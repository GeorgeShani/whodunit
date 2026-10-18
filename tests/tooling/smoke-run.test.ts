/** Phase 8 (6.3): the simulator's plan and the offline smoke run (tools/smoke/playthrough.ts). Zero live calls. */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCase } from "@/engine/case-loader";
import { fastestPath, fastestPlan } from "@/engine/progression-validation";
import { smokeRun } from "@/tools/smoke/playthrough";

const FIXTURES = path.join(process.cwd(), "tests/fixtures/progression");

afterEach(() => vi.unstubAllGlobals());

describe("fastestPlan", () => {
  it("Blackwood: exact, 10 actions, the steps replay the path (the accusation is the last action)", async () => {
    const c = await loadCase("blackwood");
    const p = fastestPlan(c)!;
    expect(p).toMatchObject({ actions: 10, exact: true, atLeast: 10 });
    expect(p.steps).toHaveLength(9);
    expect(fastestPath(c)).toBe(10);
    for (const s of p.steps) expect(["search", "talk", "show", "confront"]).toContain(s.kind);
  });
  it("full-gate search agrees with the general search when the gate questions everyone", async () => {
    for (const [id, dir] of [["blackwood", undefined], ["progress-light", FIXTURES]] as const) {
      const c = await loadCase(id, dir);
      const sq = c.accuseGate!.minSuspectsQuestioned ?? { count: 1, minExchanges: 1 };
      for (const minExchanges of [1, 2, 3]) {
        const all = { ...c, accuseGate: { ...c.accuseGate!, minSuspectsQuestioned: { count: c.characters.length, minExchanges: Math.max(minExchanges, sq.minExchanges) } } };
        const fast = fastestPlan(all)!;
        const general = fastestPlan(all, { general: true })!;
        expect(fast.exact && general.exact, `${id} m=${minExchanges}`).toBe(true);
        expect(fast.actions, `${id} m=${minExchanges}`).toBe(general.actions);
        expect(fast.steps).toHaveLength(fast.actions - 1);
      }
    }
  });
  it("the progression fixture keeps its number", async () => {
    expect(fastestPlan(await loadCase("progress-light", FIXTURES))).toMatchObject({ actions: 9, exact: true });
  });
});

describe("smoke run (offline)", () => {
  it("Blackwood wins on the plan, ACCUSE stays locked until the end, wrong fields lose, nothing leaves the process", async () => {
    const real = vi.fn(async () => new Response("live call"));
    vi.stubGlobal("fetch", real);
    const r = await smokeRun(await loadCase("blackwood"));
    expect(r.failures).toEqual([]);
    expect(r).toMatchObject({ ok: true, actions: 10, exact: true });
    expect(r.lockedChecks).toBeGreaterThan(0);
    expect(r.modelCalls).toBeGreaterThan(0);
    expect(real).not.toHaveBeenCalled(); // the canned model replaced fetch for the run and restored it after
    expect(globalThis.fetch).toBe(real);
  });
  it("the progression fixture passes too", async () => {
    const r = await smokeRun(await loadCase("progress-light", FIXTURES));
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("catches a soft gate: one clue opens ACCUSE long before the case can be won", async () => {
    const c = await loadCase("blackwood");
    const r = await smokeRun({ ...c, accuseGate: { minEvidence: 1 } });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/ACCUSE was not locked/);
  });
  it("catches an unwinnable solution: a motive that is not in the case", async () => {
    const c = await loadCase("blackwood");
    const r = await smokeRun({ ...c, solution: { ...c.solution, motiveId: "no-such-motive" } });
    expect(r.ok).toBe(false);
  });
});
