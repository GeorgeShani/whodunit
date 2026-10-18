/**
 * Validate a case folder: schemas + referential/logic checks.
 *
 *   npm run validate:case -- <caseId> [--cases-dir <dir>] [--strict]
 *   npm run validate:strict            (every public case, strict; runs before npm test)
 *
 * Exits 0 when valid, 1 when invalid, 2 on bad usage.
 * Phase 8 (6.3) --strict also fails on: any ⚠ warning, a fastest path that cannot be computed exactly, and a failed
 * offline smoke run (tools/smoke/playthrough.ts: the plan played through the real handlers, zero live calls).
 * --all validates every case folder whose name has no leading "_" (the public ones).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { assetExists } from "../lib/case-art";
import { CLUE_ART_DIR, CLUE_FALLBACK_ICON } from "../lib/clue-art";
import { validateCase } from "../engine/case-loader";
import { checkCaseWarnings, checkUnlockGraph, formatIssue, OPPORTUNITY_WINDOW_MINUTES } from "../engine/case-validation";
import { fastestPlan } from "../engine/progression-validation";
import { smokeRun } from "../tools/smoke/playthrough";
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
  let strict = false;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cases-dir") casesDir = path.resolve(args[++i] ?? "");
    else if (args[i] === "--strict") strict = true;
    else if (args[i] === "--all") all = true;
    else positional.push(args[i]);
  }
  const ids = all ? readdirSync(casesDir).filter((d) => !d.startsWith("_") && existsSync(path.join(casesDir, d, "case.json"))).sort() : positional.slice(0, 1);
  if (!ids.length) {
    console.error("Usage: npm run validate:case -- <caseId> [--cases-dir <dir>] [--strict] | --all [--strict]");
    process.exit(2);
  }
  let failed = 0;
  for (const id of ids) if (!(await validateOne(id, casesDir, strict))) failed++;
  if (failed) process.exit(1);
}

/** Validate one case; false when it is invalid (or, with strict, has a warning or a failed smoke run). */
async function validateOne(caseId: string, casesDir: string, strict: boolean): Promise<boolean> {
  let warned = 0;
  const log = console.log;
  const out = (line: string) => {
    if (line.includes("⚠")) warned++;
    log(line);
  };

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
    out(`✅ Case "${caseId}" is valid (${where})`);
    out(
      `   ${d.characters.length} characters, ${d.locations.length} locations, ${d.facts.length} facts, ` +
        `${d.timeline.length} timeline entries, ${d.evidence.length} evidence`,
    );
    out(`   Murderer opportunity check passed (±${OPPORTUNITY_WINDOW_MINUTES} min window).`);
    out(d.endings ? "   endings.json: present and valid." : "   endings.json: not present (optional for now).");
    const unfindable = d.evidence.filter((e) => !e.locationId && !e.initiallyAvailable).map((e) => e.id);
    if (unfindable.length) out(`   ⚠ evidence with no locationId and not initially available (unreachable): ${unfindable.join(", ")}`);
    const art = [
      ...Object.entries(d.backdrops ?? {}).map(([screen, p]) => [`backdrops.${screen}`, p] as const),
      ...d.locations.filter((l) => l.background).map((l) => [`locations.${l.id}.background`, l.background as string] as const),
    ];
    const missingArt = art.filter(([, p]) => p && !assetExists(p));
    for (const [field, p] of missingArt) out(`   ⚠ ${field}: ${p} not found under assets/ (the screen falls back to its default look)`);
    if (art.length && !missingArt.length) out(`   art: ${art.length} asset path(s) found.`);
    const noArt = d.evidence.filter((e) => !e.icon && !clueArtExists(caseId, e));
    for (const e of noArt) out(`   ⚠ evidence "${e.id}" has no icon and no assets/evidence/${e.id}.webp (it shows the generic ${CLUE_FALLBACK_ICON} icon)`);
    const plan = fastestPlan(d);
    const progression = `   progression: ${d.leads?.length ?? 0} lead(s), accuse gate ${d.accuseGate ? "on" : "off"}`;
    if (plan?.exact) out(`${progression}; fastest legal path: ${plan.actions} actions (confrontations included).`);
    else if (plan) out(`${progression}; ⚠ fastest legal path not proven (search budget ran out): at least ${plan.atLeast}, a found route takes ${plan.actions} actions.`);
    else if (d.leads?.length || d.accuseGate) out("   progression: ⚠ fastest legal path could not be computed (the gate may be unreachable, or the search budget ran out).");
    // DX4: what the guilt check protects, per culprit, so an author can see why a line is rejected.
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (const p of guiltProfiles(d))
      out(`   guilt check (${p.role ?? "murderer"} ${p.murdererId}): window ${hhmm(p.window[0])}-${hhmm(p.window[1])}; coreObjects: ${p.coreObjects.join(", ") || "(none)"}.`);
    if (d.solution.accompliceId && !d.solution.accompliceAct) out(`   guilt check: no accompliceAct, so ${d.solution.accompliceId} has only data-flagged coreGuilt (no accomplice profile).`);
    // Phase 6: art a feature module points at (ship-list diagram frames).
    for (const f of featureAssetPaths(d)) if (!assetExists(f.path)) out(`   ⚠ featureConfig.${f.feature}: ${f.path} not found under assets/`);
    // Character sprites: the case's assets/cases/<id>/characters/<key>/, else assets/characters/<key>/ (sprite-lookup.ts).
    const sprites = caseCharacterSprites(d);
    for (const ch of d.characters) {
      const key = ch.portrait ?? ch.id;
      const s = sprites[key];
      if (!s?.poses.length) out(`   ⚠ character "${ch.id}" has no sprite: no assets/cases/${caseId}/characters/${key}/*.webp and no assets/characters/${key}/ in anchors.json (it shows a silhouette)`);
      else if (!s.poses.includes("neutral")) out(`   ⚠ character "${ch.id}" has no neutral pose (${s.spriteDir ?? `assets/characters/${key}`}); emotions without their own pose fall back to "${s.poses[0]}"`);
    }
    const warnings = checkCaseWarnings(d);
    for (const w of warnings) out(`   ⚠ ${formatIssue(w)}`);
    out(`   knowledge gate: ${d.knowledgeGate}${warnings.length ? `, ${warnings.length} design warning(s) above` : ", no design warnings"}.`);
    if (!strict) return true;
    if (plan) {
      const smoke = await smokeRun(d);
      if (smoke.ok) out(`   smoke run: won in ${smoke.actions} actions offline (${smoke.modelCalls} canned model replies, ${smoke.lockedChecks} early ACCUSE refused, token ${smoke.tokenChars} chars).`);
      else for (const f of smoke.failures) out(`   ⚠ smoke run: ${f}`);
    }
    if (warned) console.error(`❌ Case "${caseId}" fails --strict: ${warned} warning line(s) above.`);
    return warned === 0;
  }
  console.error(`❌ Case "${caseId}" has ${result.issues.length} problem(s) (${where}):\n`);
  for (const issue of result.issues) console.error(`  • ${formatIssue(issue)}`);
  console.error("\nSee docs/CASE_FORMAT.md for the expected format.");
  return false;
}

main().catch((e) => {
  console.error(`❌ Unexpected error: ${(e as Error).message}`);
  process.exit(1);
});
