/**
 * npm run audit:prompts [-- --cases-dir <dir>] [--case <id>] [--out <file>] [--check]
 * Writes docs/PROMPT_SURFACE.md and exits 1 if any culprit prompt holds unrevealed core-guilt content.
 * --check: do not write the file, only fail on problems.
 */
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCase } from "../engine/case-loader";
import { auditCase, renderSurface } from "../tools/prompt-audit";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const casesDir = path.resolve(opt("--cases-dir") ?? "cases");
const ids = opt("--case") ? [opt("--case")!] : (await readdir(casesDir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name);
const results = [];
for (const id of ids) results.push(auditCase(await loadCase(id, casesDir)));
const outFile = path.resolve(opt("--out") ?? "docs/PROMPT_SURFACE.md");
if (!args.includes("--check")) await writeFile(outFile, renderSurface(results) + "\n");
let bad = 0;
for (const r of results) {
  const culprit = r.rows.filter((x) => x.characterId === r.murdererId);
  console.log(`${r.caseId}: ${r.rows.length} prompts, culprit ${r.murdererId} (${culprit.length} prompts, ${Math.min(...culprit.map((x) => x.facts.length))}-${Math.max(...culprit.map((x) => x.facts.length))} facts), core secrets ${r.coreSecretIds.join(", ") || "none"}, ${r.failures.length} problems`);
  for (const f of r.failures) console.log(`  FAIL ${f.characterId} [${f.state}]: ${f.problem}`);
  bad += r.failures.length;
}
if (!args.includes("--check")) console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
process.exit(bad ? 1 : 0);
