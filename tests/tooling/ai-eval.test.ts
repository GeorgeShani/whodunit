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
import { allScenarios } from "@/tools/ai-eval/case-scenarios";
import { SCENARIOS } from "@/tools/ai-eval/scenarios";
import { GREMLIN_SCENARIOS } from "@/tools/ai-eval/gremlin-scenarios";

const dir = path.resolve("tests/fixtures/ai-eval");
let c: LoadedCase;
const results: ScenarioResult[] = [];
beforeAll(async () => {
  c = await loadCase("blackwood");
  for (const s of allScenarios([...SCENARIOS, ...GREMLIN_SCENARIOS], "blackwood")) {
    const f = path.join(dir, `${s.id}.json`);
    if (s.needs && !s.needs(c)) continue;
    if (s.crafted) results.push(await runScenario(c, s, { mode: "replay" }));
    else if (existsSync(f)) results.push(await runScenario(c, s, { mode: "replay", fixture: JSON.parse(readFileSync(f, "utf8")) as Fixture }));
  }
}, 60_000);

describe("AI eval replay (recorded live replies through the guard pipeline)", () => {
  it("has 30-50 built-in scenarios plus the case's own evals file, all recorded, covering every group", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(SCENARIOS.length).toBeLessThanOrEqual(50);
    const all = allScenarios([...SCENARIOS, ...GREMLIN_SCENARIOS], "blackwood");
    expect(all.length - SCENARIOS.length - GREMLIN_SCENARIOS.length).toBe(20); // cases/blackwood/evals/leak-scenarios.json
    expect(results.length).toBe(all.filter((s) => !s.needs || s.needs(c)).length);
    expect(new Set(SCENARIOS.map((s) => s.group)).size).toBe(7);
  });

  it("after the guard: no guilt admission, no unallowed secret, no engine violation in any scenario", () => {
    for (const r of results) {
      expect(r.engine, r.id).toEqual([]);
      for (const t of r.turns) {
        expect(t.after, `${r.id} ${t.characterId}`).not.toContain("no_guilt");
        expect(t.after, `${r.id} ${t.characterId}`).not.toContain("allowed_secrets");
        expect(t.after, `${r.id} ${t.characterId}`).not.toContain("forbidden_phrase");
      }
    }
  });

  it("replays are current: no scenario's prompt changed since it was recorded", () => {
    expect(results.filter((r) => r.notes.length).map((r) => `${r.id}: ${r.notes.join("; ")}`)).toEqual([]);
  });

  it("after the guard: every assertion passes on every line the player sees", () => {
    const failing = results.flatMap((r) => r.turns.filter((t) => t.after.length).map((t) => `${r.id}/${t.characterId}: ${t.after.join(",")}`));
    expect(failing).toEqual([]);
    expect(summarize(results).after.turnPass).toMatch(/^(\d+)\/\1 /);
  });
});

describe("eval budget: cumulative cap plus a per-round cap", () => {
  it("refuses a call that could cross either cap and charges both ledgers", async () => {
    const { assertBudget, chargeLedger, BudgetExceeded } = await import("../../tools/ai-eval/run");
    const ledger: import("../../tools/ai-eval/run").Ledger = { spentUsd: 0.56, calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
    const round = { id: "r5", capUsd: 0.5 };
    expect(() => assertBudget(ledger, 0.01, 1.4, round)).not.toThrow();
    chargeLedger(ledger, 0.49, { prompt_tokens: 10 }, round);
    expect(ledger.rounds!.r5.spentUsd).toBeCloseTo(0.49);
    expect(ledger.spentUsd).toBeCloseTo(1.05);
    // Round cap bites first (0.49 + 0.02 > 0.50) although the cumulative one (1.05 + 0.02 < 1.40) would not.
    expect(() => assertBudget(ledger, 0.02, 1.4, round)).toThrow(BudgetExceeded);
    expect(() => assertBudget(ledger, 0.02, 1.4, { id: "r6", capUsd: 0.5 })).not.toThrow();
    // Cumulative cap still applies to a fresh round.
    expect(() => assertBudget(ledger, 0.4, 1.4, { id: "r6", capUsd: 0.5 })).toThrow(/cap \$1.4/);
  });
});
