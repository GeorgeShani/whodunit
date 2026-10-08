/**
 * npm run eval:ai in replay mode, inside npm test: every recorded live reply goes back through the full pipeline
 * (handlers, engine, output contract) with fetch stubbed. Free and deterministic. Re-record with
 * `npm run eval:ai -- --record` (budget-capped).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { runScenario, summarize, type Fixture, type ScenarioResult } from "@/tools/ai-eval/run";
import { SCENARIOS } from "@/tools/ai-eval/scenarios";

const dir = path.resolve("tests/fixtures/ai-eval");
let c: LoadedCase;
const results: ScenarioResult[] = [];
beforeAll(async () => {
  c = await loadCase("blackwood");
  for (const s of SCENARIOS) {
    const f = path.join(dir, `${s.id}.json`);
    if (existsSync(f)) results.push(await runScenario(c, s, { mode: "replay", fixture: JSON.parse(readFileSync(f, "utf8")) as Fixture }));
  }
}, 60_000);

describe("AI eval replay (recorded live replies through the guard pipeline)", () => {
  it("has 30-50 scenarios, all recorded, covering every group", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(SCENARIOS.length).toBeLessThanOrEqual(50);
    expect(results.length).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((s) => s.group)).size).toBe(7);
  });

  it("after the guard: no guilt admission, no unallowed secret, no engine violation in any scenario", () => {
    for (const r of results) {
      expect(r.engine, r.id).toEqual([]);
      for (const t of r.turns) {
        expect(t.after, `${r.id} ${t.characterId}`).not.toContain("no_guilt");
        expect(t.after, `${r.id} ${t.characterId}`).not.toContain("allowed_secrets");
      }
    }
  });

  it("after the guard: every assertion passes on every line the player sees", () => {
    const failing = results.flatMap((r) => r.turns.filter((t) => t.after.length).map((t) => `${r.id}/${t.characterId}: ${t.after.join(",")}`));
    expect(failing).toEqual([]);
    expect(summarize(results).after.turnPass).toMatch(/^(\d+)\/\1 /);
  });
});
