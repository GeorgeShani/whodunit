/**
 * Validate a case folder: schemas + referential/logic checks.
 *
 *   npm run validate:case -- <caseId> [--cases-dir <dir>]
 *
 * Exits 0 when valid, 1 when invalid, 2 on bad usage.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { assetExists } from "../lib/case-art";
import { CLUE_ART_DIR, CLUE_FALLBACK_ICON } from "../lib/clue-art";
import { validateCase } from "../engine/case-loader";
import { checkCaseWarnings, checkUnlockGraph, formatIssue, OPPORTUNITY_WINDOW_MINUTES } from "../engine/case-validation";
import { fastestPath } from "../engine/progression-validation";
import { guiltProfiles } from "../engine/core-guilt";
import { featureAssetPaths } from "../engine/features/registry";
import { checkPresentationAssets } from "../engine/presentation-validation";
import { CUES } from "../components/effects/audio";
import { caseCharacterSprites } from "../lib/case-sprites.server";

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

  let result = await validateCase(caseId, casesDir);
  const where = path.relative(process.cwd(), path.join(casesDir, caseId)) || caseId;
  // Phase 3: theme art and audio files must exist (errors, like a schema problem).
  if (result.data) {
    const missing = checkPresentationAssets(result.data, { exists: (p) => assetExists(p), cueNames: Object.keys(CUES) });
    if (missing.length) result = { caseId, issues: missing };
  }
  // V31 (phase 10): the unlock graph over every case folder in the dir ("_" cases included: they are the next ones).
  if (result.data) {
    const all = readdirSync(casesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(casesDir, d.name, "case.json")))
      .map((d) => {
        try {
          const j = JSON.parse(readFileSync(path.join(casesDir, d.name, "case.json"), "utf8")) as { unlockedBy?: string[] };
          return { id: d.name, unlockedBy: Array.isArray(j.unlockedBy) ? j.unlockedBy : undefined };
        } catch {
          return { id: d.name };
        }
      });
    const graph = checkUnlockGraph(all).filter((i) => i.file.startsWith(`${caseId}/`) || i.file === "cases/" || (result.data!.unlockedBy ?? []).some((r) => i.file.startsWith(`${r}/`)));
    if (graph.length) result = { caseId, issues: graph };
  }
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
    if (path_ !== null) console.log(`   progression: ${d.leads?.length ?? 0} lead(s), accuse gate ${d.accuseGate ? "on" : "off"}; fastest legal path: ${path_} actions (confrontations included).`);
    else if (d.leads?.length || d.accuseGate) console.log("   progression: fastest legal path could not be computed (the gate may be unreachable, or the search budget ran out).");
    // DX4: what the guilt check protects, per culprit, so an author can see why a line is rejected.
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (const p of guiltProfiles(d))
      console.log(`   guilt check (${p.role ?? "murderer"} ${p.murdererId}): window ${hhmm(p.window[0])}-${hhmm(p.window[1])}; coreObjects: ${p.coreObjects.join(", ") || "(none)"}.`);
    if (d.solution.accompliceId && !d.solution.accompliceAct) console.log(`   guilt check: no accompliceAct, so ${d.solution.accompliceId} has only data-flagged coreGuilt (no accomplice profile).`);
    // Phase 6: art a feature module points at (ship-list diagram frames).
    for (const f of featureAssetPaths(d)) if (!assetExists(f.path)) console.log(`   ⚠ featureConfig.${f.feature}: ${f.path} not found under assets/`);
    // Character sprites: the case's assets/cases/<id>/characters/<key>/, else assets/characters/<key>/ (sprite-lookup.ts).
    const sprites = caseCharacterSprites(d);
    for (const ch of d.characters) {
      const key = ch.portrait ?? ch.id;
      const s = sprites[key];
      if (!s?.poses.length) console.log(`   ⚠ character "${ch.id}" has no sprite: no assets/cases/${caseId}/characters/${key}/*.webp and no assets/characters/${key}/ in anchors.json (it shows a silhouette)`);
      else if (!s.poses.includes("neutral")) console.log(`   ⚠ character "${ch.id}" has no neutral pose (${s.spriteDir ?? `assets/characters/${key}`}); emotions without their own pose fall back to "${s.poses[0]}"`);
    }
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
