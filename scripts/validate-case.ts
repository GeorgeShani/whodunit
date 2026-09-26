/**
 * Validate a case folder: schemas + referential/logic checks.
 *
 *   npm run validate:case -- <caseId> [--cases-dir <dir>]
 *
 * Exits 0 when valid, 1 when invalid, 2 on bad usage.
 */
import path from "node:path";
import { assetExists } from "../lib/case-art";
import { validateCase } from "../engine/case-loader";
import { formatIssue, OPPORTUNITY_WINDOW_MINUTES } from "../engine/case-validation";

async function main() {
  const args = process.argv.slice(2);
  let casesDir = path.join(process.cwd(), "cases");
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cases-dir") casesDir = path.resolve(args[++i] ?? "");
    else positional.push(args[i]);
  }
  const caseId = positional[0];
  if (!caseId) {
    console.error("Usage: npm run validate:case -- <caseId> [--cases-dir <dir>]");
    process.exit(2);
  }

  const result = await validateCase(caseId, casesDir);
  const where = path.relative(process.cwd(), path.join(casesDir, caseId)) || caseId;
  if (result.data) {
    const d = result.data;
    console.log(`✅ Case "${caseId}" is valid (${where})`);
    console.log(
      `   ${d.characters.length} characters, ${d.locations.length} locations, ${d.facts.length} facts, ` +
        `${d.timeline.length} timeline entries, ${d.evidence.length} evidence`,
    );
    console.log(`   Murderer opportunity check passed (±${OPPORTUNITY_WINDOW_MINUTES} min window).`);
    console.log(d.endings ? "   endings.json: present and valid." : "   endings.json: not present (optional for now).");
    const unfindable = d.evidence.filter((e) => !e.locationId && !e.initiallyAvailable).map((e) => e.id);
    if (unfindable.length) console.log(`   ⚠ evidence with no locationId and not initially available (unreachable): ${unfindable.join(", ")}`);
    const art = [
      ...Object.entries(d.backdrops ?? {}).map(([screen, p]) => [`backdrops.${screen}`, p] as const),
      ...d.locations.filter((l) => l.background).map((l) => [`locations.${l.id}.background`, l.background as string] as const),
    ];
    const missingArt = art.filter(([, p]) => p && !assetExists(p));
    for (const [field, p] of missingArt) console.log(`   ⚠ ${field}: ${p} not found under assets/ (the screen falls back to its default look)`);
    if (art.length && !missingArt.length) console.log(`   art: ${art.length} asset path(s) found.`);
    return;
  }
  console.error(`❌ Case "${caseId}" has ${result.issues.length} problem(s) (${where}):\n`);
  for (const issue of result.issues) console.error(`  • ${formatIssue(issue)}`);
  console.error("\nSee docs/CASE_FORMAT.md for the expected format.");
  process.exit(1);
}

main().catch((e) => {
  console.error(`❌ Unexpected error: ${(e as Error).message}`);
  process.exit(1);
});
