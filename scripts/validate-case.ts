/**
 * Validate a case folder: schemas + referential/logic checks.
 *
 *   npm run validate:case -- <caseId> [--cases-dir <dir>]
 *
 * Exits 0 when valid, 1 when invalid, 2 on bad usage.
 */
import path from "node:path";
import { assetExists } from "../lib/case-art";
import { CLUE_ART_DIR, CLUE_FALLBACK_ICON } from "../lib/clue-art";
import { validateCase } from "../engine/case-loader";
import { checkCaseWarnings, formatIssue, OPPORTUNITY_WINDOW_MINUTES } from "../engine/case-validation";
import { fastestPath } from "../engine/progression-validation";

/** Does an illustration for this clue exist under assets/evidence/ (same lookup order as lib/clue-art.ts)? */
function clueArtExists(caseId: string, e: { id: string; image?: string | undefined }): boolean {
  return [`${caseId}/${e.id}`, e.id, ...(e.image ? [`${caseId}/${e.image}`, e.image] : [])].some((k) => assetExists(`${CLUE_ART_DIR}/${k}.webp`));
}

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
    const noArt = d.evidence.filter((e) => !e.icon && !clueArtExists(caseId, e));
    for (const e of noArt) console.log(`   ⚠ evidence "${e.id}" has no icon and no assets/evidence/${e.id}.webp (it shows the generic ${CLUE_FALLBACK_ICON} icon)`);
    const path_ = fastestPath(d);
    if (path_ !== null) console.log(`   progression: ${d.leads?.length ?? 0} lead(s), accuse gate ${d.accuseGate ? "on" : "off"}; fastest legal path: ${path_} actions.`);
    else if (d.leads?.length || d.accuseGate) console.log("   progression: fastest legal path could not be computed (the gate may be unreachable, or the search budget ran out).");
    const warnings = checkCaseWarnings(d);
    for (const w of warnings) console.log(`   ⚠ ${formatIssue(w)}`);
    console.log(`   knowledge gate: ${d.knowledgeGate}${warnings.length ? `, ${warnings.length} design warning(s) above` : ", no design warnings"}.`);
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
