/**
 * npm run eval:ai                 replay the recorded fixtures through the full guard pipeline (free, deterministic)
 * npm run eval:ai -- --record     call xAI for real and (re)write tests/fixtures/ai-eval/<scenario>.json
 *   --only id1,id2   only these scenarios      --cap 1.40   hard USD cap for the cumulative ledger (record)
 *   --round gremlin-5 --round-cap 0.50   a per-round cap, enforced alongside --cap (record; spend kept per round)
 *   --json           print the full results as JSON
 *
 * Record mode reads XAI_API_KEY from the environment (never printed, never written). Spend is priced from each
 * response's `usage` and accumulated in .ai-eval-spend.json (gitignored); a call whose worst case could cross the cap
 * is refused before it is sent.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCase } from "../engine/case-loader";
import { BudgetExceeded, runScenario, summarize, type Fixture, type Ledger, type ScenarioResult } from "../tools/ai-eval/run";
import { allScenarios } from "../tools/ai-eval/case-scenarios";
import { SCENARIOS } from "../tools/ai-eval/scenarios";
import { GREMLIN_SCENARIOS } from "../tools/ai-eval/gremlin-scenarios";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const record = args.includes("--record");
const only = opt("--only")?.split(",");
const cap = Number(opt("--cap") ?? "1.40");
const roundId = opt("--round");
const round = roundId ? { id: roundId, capUsd: Number(opt("--round-cap") ?? "0.50") } : undefined;
if (record && !round) console.warn("eval:ai --record without --round: only the cumulative cap applies");
const dir = path.resolve("tests/fixtures/ai-eval");
const ledgerFile = path.resolve(".ai-eval-spend.json");
await mkdir(dir, { recursive: true });

const c = await loadCase("blackwood");
const selected = allScenarios([...SCENARIOS, ...GREMLIN_SCENARIOS], c.id).filter((s) => !only || only.includes(s.id));
const pending = selected.filter((s) => s.needs && !s.needs(c)).map((s) => s.id);
const scenarios = selected.filter((s) => !s.needs || s.needs(c));
const ledger: Ledger = existsSync(ledgerFile) ? JSON.parse(await readFile(ledgerFile, "utf8")) : { spentUsd: 0, calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
const apiKey = process.env.XAI_API_KEY;
if (record && !apiKey) {
  console.error("eval:ai --record needs XAI_API_KEY in the environment");
  process.exit(2);
}

const results: ScenarioResult[] = [];
const missing: string[] = [];
let aborted = "";
for (const s of scenarios) {
  const file = path.join(dir, `${s.id}.json`);
  try {
    if (record) {
      const before = ledger.spentUsd;
      results.push(await runScenario(c, s, { mode: "record", apiKey, ledger, capUsd: cap, round, onFixture: (f) => void writeFile(file, JSON.stringify(f, null, 2) + "\n") }));
      await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
      console.log(`recorded ${s.id}  +$${(ledger.spentUsd - before).toFixed(4)}  total $${ledger.spentUsd.toFixed(4)}${round ? `  round ${round.id} $${(ledger.rounds?.[round.id]?.spentUsd ?? 0).toFixed(4)}/${round.capUsd}` : ""}`);
    } else {
      if (s.crafted) {
        results.push(await runScenario(c, s, { mode: "replay" }));
        continue;
      }
      if (!existsSync(file)) {
        missing.push(s.id);
        continue;
      }
      const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
      results.push(await runScenario(c, s, { mode: "replay", fixture }));
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      aborted = e.message;
      break;
    }
    throw e;
  }
}
if (record) await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");

const sum = summarize(results);
if (args.includes("--json")) console.log(JSON.stringify({ results, sum }, null, 2));
for (const r of results) {
  const flag = r.turns.every((t) => t.after.length === 0) && r.engine.length === 0 ? "PASS" : "FAIL";
  const detail = r.turns.map((t) => `${t.characterId}: before[${t.before?.join(",") ?? "none"}] after[${t.after.join(",")}] ${t.source}${t.rejects.length ? ` rejects=${t.rejects.join(",")}` : ""}`).join(" | ");
  console.log(`${flag} ${r.id}  ${detail}${r.engine.length ? `  ENGINE: ${r.engine.join("; ")}` : ""}${r.notes.length ? `  (${r.notes.join("; ")})` : ""}`);
}
console.log(JSON.stringify(sum, null, 2));
if (pending.length) console.log(`pending (case data not there yet): ${pending.join(", ")}`);
if (missing.length) console.log(`unrecorded scenarios (no fixture): ${missing.join(", ")}`);
if (record) console.log(`ledger: $${ledger.spentUsd.toFixed(4)} over ${ledger.calls} calls (prompt ${ledger.promptTokens}, cached ${ledger.cachedTokens}, completion ${ledger.completionTokens} tokens)`);
if (aborted) {
  console.error(`ABORTED: ${aborted}`);
  process.exit(3);
}
const hardFail = results.some((r) => r.engine.length || r.turns.some((t) => t.after.includes("no_guilt") || t.after.includes("allowed_secrets")));
process.exit(hardFail ? 1 : 0);
