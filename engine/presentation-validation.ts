/**
 * Case-two plan phase 3: validator rules for the presentation blocks (engine/presentation.ts).
 * `checkPresentation` is pure and runs with every load (engine/case-validation.ts checkCaseReferences);
 * `checkPresentationAssets` needs the file system and the cue table, so callers inject them
 * (scripts/validate-case.ts and tests/cases/presentation.test.ts).
 */
import type { LoadedCase } from "./case-schema";
import type { CaseIssue } from "./case-validation";
import { bannedWordsRegex, contrastFailures, META_WORDS, resolvePalette, singularWord } from "./presentation";

const CASE = "case.json";

export function checkPresentation(c: LoadedCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const v = c.setting?.vocabulary;
  if (v) {
    const banned = new Set((v.banned ?? []).map(singularWord));
    for (const w of v.allowed ?? []) {
      if (banned.has(singularWord(w))) issues.push({ file: CASE, path: "setting.vocabulary", message: `"${w}" is both allowed and banned` });
      if (META_WORDS.includes(singularWord(w)) || META_WORDS.includes(w.toLowerCase()))
        issues.push({ file: CASE, path: "setting.vocabulary.allowed", message: `"${w}" is a meta word and is banned in every case` });
    }
    // V26: no authored line says a banned word (it would be rejected and retried every time it is spoken).
    const re = bannedWordsRegex(v.banned);
    if (re) {
      const allowed = new Set((v.allowed ?? []).map(singularWord));
      const authored: [string, string][] = [
        ...c.characters.map((ch) => [`characters/${ch.id}.json`, JSON.stringify(ch)] as [string, string]),
        [CASE, JSON.stringify({ intro: c.intro, tagline: c.tagline, victim: c.victim, locations: c.locations, facts: c.facts })],
        ["timeline.json", JSON.stringify(c.timeline)],
        ["evidence.json", JSON.stringify(c.evidence)],
        ...(c.endings ? [["endings.json", JSON.stringify(c.endings)] as [string, string]] : []),
      ];
      for (const [file, text] of authored)
        for (const m of text.matchAll(re))
          if (!allowed.has(singularWord(m[0]))) issues.push({ file, message: `uses the banned word "${m[0]}" (setting.vocabulary.banned)` });
    }
  }
  // V32: the authority is not a suspect.
  const authority = c.setting?.authority?.noun.replace(/^the\s+/i, "").toLowerCase();
  if (authority) {
    const hit = c.characters.find((ch) =>
      [ch.name, ch.role, ...(ch.aliases ?? [])].some((n) => new RegExp(`\\b${authority.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(n)),
    );
    if (hit)
      issues.push({
        file: CASE,
        path: "setting.authority.noun",
        message: `the authority "${c.setting!.authority!.noun}" matches suspect "${hit.id}"; the authority must be someone offstage`,
      });
  }
  // Theme: every palette (the case's overrides on the defaults) passes the contrast pairs; art lives in the case's own folder.
  if (c.theme) {
    for (const f of contrastFailures(resolvePalette(c.theme)))
      issues.push({ file: CASE, path: "theme.palette", message: `${f.fg} on ${f.bg} has contrast ${f.ratio.toFixed(2)}:1, below ${f.min}:1` });
    for (const k of ["logo", "titleArt"] as const) {
      const p = c.theme[k];
      if (p && !p.startsWith(`/assets/cases/${c.id}/`)) issues.push({ file: CASE, path: `theme.${k}`, message: `${p} must live under /assets/cases/${c.id}/` });
    }
  }
  // V13 (landmark part): ids unique; each fact pattern matches a fact or timeline statement (else the landmark is inert);
  // an expectTime pin equals the minute the facts give it.
  if (c.orderLandmarks) {
    const seen = new Set<string>();
    const statements = [...c.facts, ...c.timeline];
    c.orderLandmarks.forEach((l, i) => {
      const at = `orderLandmarks.${i}(${l.id})`;
      if (seen.has(l.id)) issues.push({ file: CASE, path: at, message: `duplicate landmark id "${l.id}"` });
      seen.add(l.id);
      const fact = new RegExp(l.fact.map((p) => `(?:${p})`).join("|"), "i");
      const times = statements
        .filter((s) => fact.test(s.statement))
        .map((s) => s.time ?? s.from)
        .filter((t): t is string => !!t)
        .sort();
      if (!statements.some((s) => fact.test(s.statement)))
        issues.push({ file: CASE, path: `${at}.fact`, message: "matches no fact or timeline statement, so the landmark is never timed" });
      else if (l.expectTime) {
        const got = l.pick === "latest" ? times.at(-1) : times[0];
        if (got !== l.expectTime)
          issues.push({ file: CASE, path: `${at}.expectTime`, message: `the facts time it at ${got ?? "no time"}, not ${l.expectTime}` });
      }
    });
  }
  return issues;
}

/** File checks for theme art and audio (errors: the screen or sound would silently fall back). */
export function checkPresentationAssets(c: LoadedCase, deps: { exists: (assetPath: string) => boolean; cueNames: readonly string[] }): CaseIssue[] {
  const issues: CaseIssue[] = [];
  for (const k of ["logo", "titleArt"] as const) {
    const p = c.theme?.[k];
    if (p && !deps.exists(p)) issues.push({ file: CASE, path: `theme.${k}`, message: `${p} not found under assets/` });
  }
  const stems: [string, string][] = [
    ...Object.entries(c.audio?.beds ?? {}).map(([screen, s]) => [`audio.beds.${screen}`, s as string] as [string, string]),
    ...Object.entries(c.audio?.cues ?? {}).flatMap(([cue, files]) => files.map((f) => [`audio.cues.${cue}`, f] as [string, string])),
  ];
  for (const cue of Object.keys(c.audio?.cues ?? {}))
    if (!deps.cueNames.includes(cue)) issues.push({ file: CASE, path: `audio.cues.${cue}`, message: `"${cue}" is not a sound cue` });
  for (const [at, stem] of stems)
    for (const ext of ["mp3", "ogg"])
      if (!deps.exists(`/assets/audio/${stem}.${ext}`)) issues.push({ file: CASE, path: at, message: `/assets/audio/${stem}.${ext} not found` });
  return issues;
}
