/**
 * Referential / logical checks for a schema-valid case. Pure (no fs), so it can
 * be unit-tested and reused by the loader and scripts/validate-case.ts.
 */
import type { LoadedCase } from "./case-schema";
import { MAX_CONFRONTATION_TOTAL } from "./constants";
import { gameMinutes } from "./time";
import type { TimelineEntry } from "./types";
import { checkProgression, progressionWarnings } from "./progression-validation";
import { coreGuiltSecretIds, guiltProfile, guiltProfiles } from "./core-guilt";
import { compileForbiddenPhrase, unlessRevealedIds } from "@/ai/forbidden-phrases";
import { findGuiltLeak, speakerNamesOf } from "@/ai/guilt-check";
import { knowledgeGate } from "./knowledge-gate";
import { checkFeatureConfig, featureWarnings } from "./features/registry";
import { checkPresentation } from "./presentation-validation";

/**
 * Opportunity rule: some timeline entry with `locationId` = solution.locationId
 * must list the murderer in `involvesCharacterIds`, and place them there within
 * this many minutes of the murder time: a point entry's `time`, or a window
 * [from, to] widened by this amount on each side.
 */
export const OPPORTUNITY_WINDOW_MINUTES = 15;

export interface CaseIssue {
  /** File the problem lives in, relative to the case directory (e.g. "characters/the-butler.json"). */
  file: string;
  /** Dotted path inside the file, if applicable (e.g. "secrets.0.revealConditions.evidenceIds.1"). */
  path?: string;
  message: string;
}

export function formatIssue(issue: CaseIssue): string {
  return `${issue.file}${issue.path ? ` -> ${issue.path}` : ""}: ${issue.message}`;
}

/** Game-day minute range covered by a timeline entry. */
export function entryRange(e: TimelineEntry, dayStartsAt: string): [number, number] {
  return factRange(e, dayStartsAt) as [number, number];
}

/** Game-day minute range of any fact with a `time` or `from`/`to`; null when it has no time. */
export function factRange(e: { time?: string; from?: string; to?: string }, dayStartsAt: string): [number, number] | null {
  if (e.time !== undefined) {
    const t = gameMinutes(e.time, dayStartsAt);
    return [t, t];
  }
  if (e.from === undefined || e.to === undefined) return null;
  return [gameMinutes(e.from, dayStartsAt), gameMinutes(e.to, dayStartsAt)];
}

/** True if the timeline places `characterId` at `locationId` within ±windowMinutes of `time`. */
export function wasPresent(
  c: Pick<LoadedCase, "timeline" | "dayStartsAt">,
  characterId: string,
  locationId: string,
  time: string,
  windowMinutes = OPPORTUNITY_WINDOW_MINUTES,
): boolean {
  const t = gameMinutes(time, c.dayStartsAt);
  return c.timeline.some((e) => {
    if (e.locationId !== locationId || !e.involvesCharacterIds.includes(characterId)) return false;
    const [from, to] = entryRange(e, c.dayStartsAt);
    return from - windowMinutes <= t && t <= to + windowMinutes;
  });
}

/** C3: every word of a multi-word name the guilt check splits (victim, characters, locations, evidence). */
function multiWordNameTokens(c: LoadedCase): Set<string> {
  const names = [c.victim.name, ...c.victim.aliases, ...c.characters.flatMap((ch) => [ch.name, ...(ch.aliases ?? [])]), ...c.locations.map((l) => l.name), ...c.evidence.map((e) => e.name)];
  return new Set(names.map((n) => n.toLowerCase().split(/\s+/)).filter((w) => w.length > 1).flat());
}

export function checkCaseReferences(c: LoadedCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
  // C3: a name token can't be both ignored and kept.
  for (const w of c.guiltCheck?.ignoreNameTokens ?? []) {
    if (c.guiltCheck?.keepNameTokens?.includes(w)) issues.push({ file: "case.json", path: "guiltCheck", message: `"${w}" is in both ignoreNameTokens and keepNameTokens` });
  }
  const CASE = "case.json";
  const TL = "timeline.json";
  const EV = "evidence.json";
  const SOL = "solution.json";
  const charFile = (id: string) => `characters/${id}.json`;

  const locationIds = new Set(c.locations.map((l) => l.id));
  const evidenceIds = new Set(c.evidence.map((e) => e.id));
  const factIds = new Set([...c.facts.map((f) => f.id), ...c.timeline.map((t) => t.id)]);
  const characterIds = new Set(c.characters.map((ch) => ch.id));
  const personIds = new Set([...characterIds, c.victim.id]);
  const motiveIds = new Set(c.motives.map((m) => m.id));

  const dupes = (kind: string, file: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push({ file, message: `duplicate ${kind} id "${id}"` });
      seen.add(id);
    }
  };
  dupes("location", CASE, c.locations.map((l) => l.id));
  dupes("motive", CASE, c.motives.map((m) => m.id));
  dupes("evidence", EV, c.evidence.map((e) => e.id));
  dupes("fact/timeline", `${CASE} + ${TL}`, [...c.facts.map((f) => f.id), ...c.timeline.map((t) => t.id)]);
  dupes("character", "characters/", c.characters.map((ch) => ch.id));
  if (characterIds.has(c.victim.id)) {
    issues.push({ file: CASE, path: "victim.id", message: `victim id "${c.victim.id}" collides with a character id` });
  }

  const ref = (set: Set<string>, kind: string, id: string | undefined, file: string, path: string) => {
    if (id !== undefined && !set.has(id)) issues.push({ file, path, message: `unknown ${kind} "${id}"` });
  };

  const allSecretIds = new Set(c.characters.flatMap((ch) => ch.secrets.map((s) => s.id)));
  const lieOwners = new Map<string, string[]>();
  for (const ch of c.characters) for (const l of ch.intendedLies) lieOwners.set(l.id, [...(lieOwners.get(l.id) ?? []), ch.id]);
  const checkHidden = (h: { secretIds: string[]; lieIds: string[] } | undefined, file: string, p: string) => {
    h?.secretIds.forEach((id, k) => ref(allSecretIds, "secret", id, file, `${p}.hiddenUntil.secretIds.${k}`));
    h?.lieIds.forEach((id, k) => {
      const owners = lieOwners.get(id) ?? [];
      if (owners.length === 0) issues.push({ file, path: `${p}.hiddenUntil.lieIds.${k}`, message: `unknown intended lie "${id}"` });
      else if (owners.length > 1) issues.push({ file, path: `${p}.hiddenUntil.lieIds.${k}`, message: `lie id "${id}" is used by several characters (${owners.join(", ")}); make it unique` });
    });
  };

  // case.json
  ref(locationIds, "location", c.victim.foundAtLocationId, CASE, "victim.foundAtLocationId");
  c.facts.forEach((f, i) => {
    ref(locationIds, "location", f.locationId, CASE, `facts.${i}(${f.id}).locationId`);
    checkHidden(f.hiddenUntil, CASE, `facts.${i}(${f.id})`);
    const r = factRange(f, c.dayStartsAt);
    if (r && r[1] < r[0]) issues.push({ file: CASE, path: `facts.${i}(${f.id})`, message: `"to" (${f.to}) is before "from" (${f.from}) in game-day order` });
    f.involvesCharacterIds.forEach((id, j) =>
      ref(personIds, "character/victim", id, CASE, `facts.${i}(${f.id}).involvesCharacterIds.${j}`),
    );
  });

  // timeline.json
  c.timeline.forEach((t, i) => {
    const p = `${i}(${t.id})`;
    ref(locationIds, "location", t.locationId, TL, `${p}.locationId`);
    checkHidden(t.hiddenUntil, TL, p);
    t.involvesCharacterIds.forEach((id, j) => ref(personIds, "character/victim", id, TL, `${p}.involvesCharacterIds.${j}`));
    const [from, to] = entryRange(t, c.dayStartsAt);
    if (to < from) issues.push({ file: TL, path: p, message: `"to" (${t.to}) is before "from" (${t.from}) in game-day order` });
  });

  // evidence.json
  c.evidence.forEach((e, i) => {
    const p = `${i}(${e.id})`;
    ref(locationIds, "location", e.locationId, EV, `${p}.locationId`);
    e.relatedFactIds.forEach((id, j) => ref(factIds, "fact", id, EV, `${p}.relatedFactIds.${j}`));
    e.relatedCharacters.forEach((id, j) => ref(personIds, "character/victim", id, EV, `${p}.relatedCharacters.${j}`));
  });

  // characters/*.json
  for (const ch of c.characters) {
    const f = charFile(ch.id);
    const ownSecretIds = new Set(ch.secrets.map((s) => s.id));
    ch.knownFactIds.forEach((id, j) => ref(factIds, "fact", id, f, `knownFactIds.${j}`));
    ch.beliefs.forEach((b, j) => ref(factIds, "fact", b.aboutFactId, f, `beliefs.${j}(${b.id}).aboutFactId`));
    ch.secrets.forEach((s, j) => {
      const p = `secrets.${j}(${s.id})`;
      s.revealConditions?.evidenceIds.forEach((id, k) => ref(evidenceIds, "evidence", id, f, `${p}.revealConditions.evidenceIds.${k}`));
      (s.revealConditions?.testimonyIds ?? []).forEach((id, k) => {
        ref(allSecretIds, "secret", id, f, `${p}.revealConditions.testimonyIds.${k}`);
        if (ownSecretIds.has(id)) issues.push({ file: f, path: `${p}.revealConditions.testimonyIds.${k}`, message: `"${id}" is ${ch.id}'s own secret; testimony comes from someone else (use afterSecretIds for ordering)` });
      });
      s.revealConditions?.afterSecretIds.forEach((id, k) => {
        ref(ownSecretIds, "own secret", id, f, `${p}.revealConditions.afterSecretIds.${k}`);
        if (id === s.id) issues.push({ file: f, path: `${p}.revealConditions.afterSecretIds.${k}`, message: "a secret cannot depend on itself" });
      });
      s.relatedFactIds.forEach((id, k) => ref(factIds, "fact", id, f, `${p}.relatedFactIds.${k}`));
    });
    // #46 forbidden phrases: switches and lifts reference real ids.
    ch.forbiddenPhrases.forEach((fp, j) => {
      // E13: any character's secret may lift an entry; a card shown to the speaker may too (evidence, or another's testimony).
      const unless = fp.unlessRevealed === undefined ? [] : typeof fp.unlessRevealed === "string" ? [fp.unlessRevealed] : fp.unlessRevealed;
      unless.forEach((id, k) => ref(allSecretIds, "secret", id, f, `forbiddenPhrases.${j}.unlessRevealed${Array.isArray(fp.unlessRevealed) ? `.${k}` : ""}`));
      // DX7: lifted when one of the speaker's OWN stories breaks.
      fp.unlessBroken?.forEach((id, k) => {
        if (!ch.intendedLies.some((l) => l.id === id)) issues.push({ file: f, path: `forbiddenPhrases.${j}.unlessBroken.${k}`, message: `unknown lie "${id}": unlessBroken lists ${ch.id}'s own intendedLies ids` });
      });
      if (fp.unlessShown) {
        const sp = `forbiddenPhrases.${j}.unlessShown`;
        if (!evidenceIds.has(fp.unlessShown) && !allSecretIds.has(fp.unlessShown)) issues.push({ file: f, path: sp, message: `unknown evidence or testimony (secret) id "${fp.unlessShown}"` });
        else if (ownSecretIds.has(fp.unlessShown)) issues.push({ file: f, path: sp, message: `"${fp.unlessShown}" is ${ch.id}'s own secret; a testimony card is shown to someone else (use unlessRevealed)` });
      }
      // E12: switched on by any character's secret; never by the one that also lifts it.
      fp.onlyAfterRevealed?.forEach((id, k) => {
        ref(allSecretIds, "secret", id, f, `forbiddenPhrases.${j}.onlyAfterRevealed.${k}`);
        if (unless.includes(id)) issues.push({ file: f, path: `forbiddenPhrases.${j}.onlyAfterRevealed.${k}`, message: `"${id}" both switches this phrase on and lifts it, so it never applies` });
      });
    });
    ch.intendedLies.forEach((l, j) => {
      const p = `intendedLies.${j}(${l.id})`;
      ref(factIds, "fact", l.aboutFactId, f, `${p}.aboutFactId`);
      l.brokenByEvidenceIds.forEach((id, k) => ref(evidenceIds, "evidence", id, f, `${p}.brokenByEvidenceIds.${k}`));
      l.breaksOnSecretIds.forEach((id, k) => ref(allSecretIds, "secret", id, f, `${p}.breaksOnSecretIds.${k}`));
      l.breaksOnFactIds.forEach((id, k) => ref(factIds, "fact", id, f, `${p}.breaksOnFactIds.${k}`));
      // Superseding secrets must be the lie owner's OWN secrets (their confession retires their own story).
      (l.supersededBySecretIds ?? []).forEach((id, k) => {
        if (ownSecretIds.has(id)) return;
        const owner = c.characters.find((o) => o.secrets.some((x) => x.id === id));
        issues.push({
          file: f,
          path: `${p}.supersededBySecretIds.${k}`,
          message: owner
            ? `secret "${id}" belongs to ${owner.id}; a lie can only be superseded by its owner's (${ch.id}'s) own secret (use breaksOnSecretIds for another character's testimony)`
            : `unknown own secret "${id}" (not in ${ch.id}'s secrets)`,
        });
      });
    });
    ch.relationships.forEach((r, j) => {
      ref(personIds, "character/victim", r.targetCharacterId, f, `relationships.${j}.targetCharacterId`);
      (r.jabs ?? []).forEach((jab, k) => ref(factIds, "fact", jab.aboutFactId, f, `relationships.${j}.jabs.${k}.aboutFactId`));
      if (r.targetCharacterId === ch.id) issues.push({ file: f, path: `relationships.${j}`, message: "a character cannot have a relationship with themselves" });
    });
    dupes("belief", f, ch.beliefs.map((b) => b.id));
    dupes("secret", f, ch.secrets.map((s) => s.id));
    dupes("intended lie", f, ch.intendedLies.map((l) => l.id));
  }

  // solution.json
  const s = c.solution;
  const murderer = c.characters.find((ch) => ch.id === s.murdererId);
  if (!murderer) issues.push({ file: SOL, path: "murdererId", message: `murderer "${s.murdererId}" is not a character in characters/` });
  if (s.accompliceId !== undefined) {
    if (!c.characters.some((ch) => ch.id === s.accompliceId)) issues.push({ file: SOL, path: "accompliceId", message: `accomplice "${s.accompliceId}" is not a character in characters/` });
    else if (s.accompliceId === s.murdererId) issues.push({ file: SOL, path: "accompliceId", message: `the accomplice can't also be the murderer ("${s.accompliceId}")` });
  }
  if (!evidenceIds.has(s.weaponId)) issues.push({ file: SOL, path: "weaponId", message: `weapon "${s.weaponId}" is not an evidence id in evidence.json` });
  if (!locationIds.has(s.locationId)) issues.push({ file: SOL, path: "locationId", message: `location "${s.locationId}" is not a location in case.json` });
  if (!motiveIds.has(s.motiveId)) issues.push({ file: SOL, path: "motiveId", message: `motive "${s.motiveId}" is not one of case.json motives[].id` });
  s.keyEvidenceIds.forEach((id, k) => ref(evidenceIds, "evidence", id, SOL, `keyEvidenceIds.${k}`));
  // E2: supporting citations exist and never overlap the key lists.
  (s.supportingEvidenceIds ?? []).forEach((id, k) => {
    ref(evidenceIds, "evidence", id, SOL, `supportingEvidenceIds.${k}`);
    if (s.keyEvidenceIds.includes(id)) issues.push({ file: SOL, path: `supportingEvidenceIds.${k}`, message: `"${id}" is already in keyEvidenceIds (supporting ids must not overlap the key list)` });
  });
  (s.supportingTestimonyIds ?? []).forEach((id, k) => {
    if (!allSecretIds.has(id)) issues.push({ file: SOL, path: `supportingTestimonyIds.${k}`, message: `unknown secret "${id}"` });
    if ((s.keyTestimonyIds ?? []).includes(id)) issues.push({ file: SOL, path: `supportingTestimonyIds.${k}`, message: `"${id}" is already in keyTestimonyIds (supporting ids must not overlap the key list)` });
  });

  if (murderer && locationIds.has(s.locationId) && !wasPresent(c, s.murdererId, s.locationId, s.time)) {
    issues.push({
      file: SOL,
      message:
        `murderer "${s.murdererId}" had no opportunity: no timeline entry (point or window) places them in ` +
        `"${s.locationId}" within ${OPPORTUNITY_WINDOW_MINUTES} min of ${s.time}`,
    });
  }

  // Phase 5 (V5, V6): the accomplice's act has an opportunity like the murder; a case with an accomplice must ask
  // "Did anyone help?" (or it can't be won); testimony groups are subsets of keyTestimonyIds.
  if (s.accompliceAct) {
    const act = s.accompliceAct;
    if (!s.accompliceId) issues.push({ file: SOL, path: "accompliceAct", message: "accompliceAct needs an accompliceId" });
    if (!locationIds.has(act.locationId)) issues.push({ file: SOL, path: "accompliceAct.locationId", message: `location "${act.locationId}" is not a location in case.json` });
    else if (s.accompliceId && characterIds.has(s.accompliceId) && !wasPresent(c, s.accompliceId, act.locationId, act.time)) {
      issues.push({
        file: SOL,
        path: "accompliceAct",
        message: `accomplice "${s.accompliceId}" had no opportunity: no timeline entry places them in "${act.locationId}" within ${OPPORTUNITY_WINDOW_MINUTES} min of ${act.time}`,
      });
    }
  }
  if (s.accompliceId && !c.accuse?.askHelper) {
    issues.push({ file: "case.json", path: "accuse.askHelper", message: `the solution has an accomplice ("${s.accompliceId}") but the accuse form doesn't ask "Did anyone help?" (set accuse.askHelper: true), so the case can't be won` });
  }
  (s.keyTestimonyGroups ?? []).forEach((g, k) =>
    g.forEach((id, j) => {
      if (!(s.keyTestimonyIds ?? []).includes(id)) issues.push({ file: SOL, path: `keyTestimonyGroups.${k}.${j}`, message: `"${id}" is not in keyTestimonyIds` });
    }),
  );
  // One citation per group at least, and the accuse form only asks for testimony when minKeyTestimony >= 1.
  if (s.keyTestimonyGroups && (s.minKeyTestimony ?? 0) < s.keyTestimonyGroups.length) {
    issues.push({ file: SOL, path: "keyTestimonyGroups", message: `${s.keyTestimonyGroups.length} groups need minKeyTestimony >= ${s.keyTestimonyGroups.length} (it is ${s.minKeyTestimony ?? 0})` });
  }

  // E3: when the case marks weapon candidates, the real weapon must be one, or the picker hides the answer.
  if (c.evidence.some((e) => e.weapon) && !c.evidence.find((e) => e.id === s.weaponId)?.weapon) {
    issues.push({ file: "evidence.json", path: s.weaponId, message: `evidence marks weapon candidates ("weapon": true) but the solution's weapon "${s.weaponId}" is not one, so the accuse form would not offer it` });
  }

  // endings.json (optional)
  if (c.endings) {
    const END = "endings.json";
    const checkLines = (lines: { speaker: string; evidenceIds?: string[] }[], p: string) =>
      lines.forEach((l, k) => {
        if (l.speaker !== "narrator" && !characterIds.has(l.speaker)) {
          issues.push({ file: END, path: `${p}.${k}.speaker`, message: `unknown speaker "${l.speaker}" (use a character id or "narrator")` });
        }
        (l.evidenceIds ?? []).forEach((id, j) => ref(evidenceIds, "evidence", id, END, `${p}.${k}.evidenceIds.${j}`));
      });
    checkLines(c.endings.correct.confession, "correct.confession");
    checkLines(c.endings.correct.recap, "correct.recap");
    if (c.endings.sloppyRemark) checkLines([c.endings.sloppyRemark], "sloppyRemark");
    for (const [suspectId, lines] of Object.entries(c.endings.wrong)) {
      if (!characterIds.has(suspectId)) issues.push({ file: END, path: `wrong.${suspectId}`, message: `"${suspectId}" is not a suspect` });
      checkLines(lines, `wrong.${suspectId}`);
    }
    for (const id of characterIds) {
      if (!c.endings.wrong[id]) {
        issues.push({
          file: END,
          path: "wrong",
          message: `missing wrong ending for suspect "${id}"${id === s.murdererId ? " (the murderer: right culprit, couldn't prove it)" : ""}`,
        });
      }
    }
  }

  for (const ch of c.characters) {
    if (ch.id !== s.murdererId && ch.id !== s.accompliceId && ch.secrets.length === 0) {
      issues.push({ file: charFile(ch.id), path: "secrets", message: `innocent "${ch.id}" needs at least one secret (red herrings keep the game fun)` });
    }
  }

  issues.push(...checkProgression(c));
  issues.push(...checkPresentation(c));
  issues.push(...checkFeatureConfig(c));
  (c.unlockedBy ?? []).forEach((id, i) => {
    if (id === c.id) issues.push({ file: "case.json", path: `unlockedBy.${i}`, message: "a case cannot be unlocked by itself (V31)" });
    if (c.unlockedBy!.indexOf(id) !== i) issues.push({ file: "case.json", path: `unlockedBy.${i}`, message: `"${id}" is listed twice` });
  });
  return issues;
}

/** How to Play tips (case.json howToPlayTips): no duplicates, and nothing that names the solution. */
export function howToPlayTipWarnings(c: LoadedCase): CaseIssue[] {
  const warnings: CaseIssue[] = [];
  const tips = c.howToPlayTips ?? [];
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Map<string, number>();
  const murderer = c.characters.find((x) => x.id === c.solution.murdererId);
  const weapon = c.evidence.find((e) => e.id === c.solution.weaponId);
  const motive = c.motives.find((m) => m.id === c.solution.motiveId);
  // The culprit's name and each distinctive part of it (not a title, and not shared with the case title, the victim or
  // another suspect: a family surname that is also in the case title is no giveaway).
  const shared = new Set(
    [c.title, c.victim.name, ...c.characters.filter((x) => x.id !== murderer?.id).map((x) => x.name)].flatMap((n) => key(n).split(" ")),
  );
  const TITLES = new Set(["lady", "lord", "miss", "mister", "missus", "madam", "madame", "master", "doctor", "captain", "colonel", "major", "father", "sister", "brother", "uncle", "aunt", "professor", "inspector", "reverend", "sir", "dame"]);
  const parts = murderer ? key(murderer.name).split(" ").filter((w) => w.length >= 3 && !TITLES.has(w) && !shared.has(w)) : [];
  const giveaways = [murderer?.name, ...parts, weapon?.name, motive?.label]
    .filter((x): x is string => Boolean(x))
    .map(key)
    .filter(Boolean);
  tips.forEach((t, j) => {
    const k = key(t);
    if (seen.has(k)) warnings.push({ file: "case.json", path: `howToPlayTips.${j}`, message: `duplicates howToPlayTips.${seen.get(k)}` });
    else seen.set(k, j);
    const hit = giveaways.find((g) => ` ${k} `.includes(` ${g} `));
    if (hit) warnings.push({ file: "case.json", path: `howToPlayTips.${j}`, message: `mentions "${hit}", which is part of the solution (culprit, weapon or motive); tips must be spoiler-free` });
  });
  return warnings;
}

/**
 * Non-fatal design warnings (validate:case prints them with ⚠): lies that can
 * never break, testimony that can never be revealed, reveal-order cycles,
 * self-referential testimony, missing testimony summaries, explicit hiding
 * nobody can see. Assumes checkCaseReferences passed.
 */
/** confrontation.perPair above the (case or default) total can never be used up: the engine clamps it to the total. */
export function confrontationCapWarnings(c: Pick<LoadedCase, "confrontation">): CaseIssue[] {
  const caps = c.confrontation;
  if (!caps?.perPair) return [];
  const total = caps.total ?? MAX_CONFRONTATION_TOTAL;
  return caps.perPair > total
    ? [{ file: "case.json", path: "confrontation.perPair", message: `perPair ${caps.perPair} is greater than total ${total}${caps.total ? "" : " (the default)"}; a pair can only ever get ${total}` }]
    : [];
}

export function checkCaseWarnings(c: LoadedCase): CaseIssue[] {
  const warnings: CaseIssue[] = [...confrontationCapWarnings(c)];
  // C3: an override word that is no word of any multi-word name does nothing.
  const tokens = multiWordNameTokens(c);
  for (const [k, list] of [["ignoreNameTokens", c.guiltCheck?.ignoreNameTokens], ["keepNameTokens", c.guiltCheck?.keepNameTokens]] as const) {
    for (const w of list ?? []) if (!tokens.has(w)) warnings.push({ file: "case.json", path: `guiltCheck.${k}`, message: `"${w}" is not a word of any multi-word name (victim, character, location or evidence), so it has no effect` });
  }
  const charFile = (id: string) => `characters/${id}.json`;
  const findable = new Set(c.evidence.filter((e) => e.locationId || e.initiallyAvailable).map((e) => e.id));
  const secrets = new Map(c.characters.flatMap((ch) => ch.secrets.map((s) => [s.id, { s, owner: ch.id }] as const)));

  // Reachable secrets: fixpoint over reveal conditions (stress alone is always reachable) + afterSecretIds.
  // Core guilt (engine/core-guilt.ts) is never revealed before the accusation, so it is never reachable here.
  const core = coreGuiltSecretIds(c);
  // #46: a forbidden phrase gated on a core-guilt secret never lifts (core guilt is never revealed): say so.
  for (const ch of c.characters)
    ch.forbiddenPhrases.forEach((fp, j) => {
      if (fp.onlyAfterRevealed?.length && fp.onlyAfterRevealed.every((id) => core.has(id)))
        warnings.push({ file: charFile(ch.id), path: `forbiddenPhrases.${j}.onlyAfterRevealed`, message: "every listed secret is core guilt and is never revealed, so this phrase never applies" });
      if (fp.unlessShown && core.has(fp.unlessShown))
        warnings.push({ file: charFile(ch.id), path: `forbiddenPhrases.${j}.unlessShown`, message: `"${fp.unlessShown}" is core guilt: its card is never shown, so this phrase is always forbidden` });
      const unless = fp.unlessRevealed === undefined ? [] : typeof fp.unlessRevealed === "string" ? [fp.unlessRevealed] : fp.unlessRevealed;
      for (const id of unless.filter((x) => core.has(x)))
        warnings.push({ file: charFile(ch.id), path: `forbiddenPhrases.${j}.unlessRevealed`, message: `"${id}" is core guilt and is never revealed, so it never lifts this phrase; drop it from unlessRevealed` });
    });
  warnings.push(...howToPlayTipWarnings(c));
  // #52: voice variants. Duplicates waste a rotation slot; a long opener is not an opener; one variant cannot rotate.
  for (const ch of c.characters) {
    for (const k of ["openers", "actions", "deflections"] as const) {
      const list = ch.voice[k];
      const seen = new Map<string, number>();
      list.forEach((v, j) => {
        const key = v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(key)) warnings.push({ file: charFile(ch.id), path: `voice.${k}.${j}`, message: `duplicates voice.${k}.${seen.get(key)}; every variant should be different` });
        else seen.set(key, j);
      });
      if (list.length === 1) warnings.push({ file: charFile(ch.id), path: `voice.${k}`, message: `a single variant cannot rotate; give 6-8, or leave it empty for the generic rules` });
    }
    ch.voice.openers.forEach((o, j) => {
      if (o.split(/\s+/).length > 6) warnings.push({ file: charFile(ch.id), path: `voice.openers.${j}`, message: `"${o}" is longer than 6 words; an opener is the first few words of a reply ("My dear detective,")` });
    });
  }
  const reachable = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, { s }] of secrets) {
      if (reachable.has(id) || !s.revealConditions || core.has(id)) continue;
      const rc = s.revealConditions;
      const conds = [
        ...(rc.stressThreshold !== undefined ? [true] : []),
        ...rc.evidenceIds.map((e) => findable.has(e)),
        ...(rc.testimonyIds ?? []).map((t) => reachable.has(t)),
      ];
      const ok = (rc.mode === "all" ? conds.every(Boolean) : conds.some(Boolean)) && rc.afterSecretIds.every((a) => reachable.has(a));
      if (ok) {
        reachable.add(id);
        changed = true;
      }
    }
  }
  // afterSecretIds cycles (a secret waiting, directly or indirectly, on itself).
  for (const [id, { s, owner }] of secrets) {
    const seen = new Set<string>();
    const stack = [...(s.revealConditions?.afterSecretIds ?? [])];
    while (stack.length) {
      const x = stack.pop() as string;
      if (x === id) {
        warnings.push({ file: charFile(owner), path: `secrets(${id}).revealConditions.afterSecretIds`, message: "reveal-order cycle: this secret waits (indirectly) on itself and can never be revealed" });
        break;
      }
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(secrets.get(x)?.s.revealConditions?.afterSecretIds ?? []));
    }
  }

  // Core guilt flagged in data: never revealable, so reveal rules, a testimony card or a win rule built on it are dead.
  for (const ch of c.characters) {
    for (const sec of ch.secrets) {
      if (sec.coreGuilt !== true) continue;
      const p = `secrets(${sec.id})`;
      if (sec.revealConditions) warnings.push({ file: charFile(ch.id), path: `${p}.revealConditions`, message: "is coreGuilt, so it is never revealed in interrogation: these reveal conditions are ignored (remove them)" });
      if (sec.testimonySummary) warnings.push({ file: charFile(ch.id), path: `${p}.testimonySummary`, message: "is coreGuilt, so it never becomes a testimony card: this summary is never shown" });
      if (ch.id !== c.solution.murdererId && ch.id !== c.solution.accompliceId) warnings.push({ file: charFile(ch.id), path: p, message: `is coreGuilt but ${ch.id} is not the solution's murderer (fine for an accomplice; check it is intended)` });
    }
  }

  warnings.push(...checkGuiltLeakPaths(c));
  warnings.push(...checkGuardDataWarnings(c));
  warnings.push(...culpritEndingWarnings(c));
  warnings.push(...featureWarnings(c));

  const summaryNeeded = new Set<string>();
  for (const ch of c.characters) {
    const f = charFile(ch.id);
    ch.intendedLies.forEach((l, j) => {
      const p = `intendedLies.${j}(${l.id})`;
      const factSecrets = (fact: string) => [...secrets.values()].filter(({ s }) => s.relatedFactIds.includes(fact));
      l.breaksOnSecretIds.forEach((id) => summaryNeeded.add(id));
      l.breaksOnFactIds.forEach((fact) => factSecrets(fact).forEach(({ s }) => summaryNeeded.add(s.id)));

      const conds = [
        ...l.brokenByEvidenceIds.map((e) => findable.has(e)),
        ...l.breaksOnSecretIds.map((id) => reachable.has(id)),
        ...l.breaksOnFactIds.map((fact) => factSecrets(fact).some(({ s }) => reachable.has(s.id))),
      ];
      if (conds.length && !(l.breakMode === "all" ? conds.every(Boolean) : conds.some(Boolean))) {
        warnings.push({ file: f, path: p, message: `lie can never break: its ${l.breakMode === "all" ? "required" : ""} conditions are unreachable (clues not findable, secrets never revealed, or facts in no revealable secret)`.replace("  ", " ") });
      }
      l.breaksOnSecretIds.forEach((id, k) => {
        if (secrets.get(id)?.owner === ch.id) {
          warnings.push({ file: f, path: `${p}.breaksOnSecretIds.${k}`, message: `self-referential: "${id}" is ${ch.id}'s own secret, so the lie only breaks after they confess it themselves; point it at another character's secret` });
        }
        if (secrets.has(id) && !reachable.has(id)) warnings.push({ file: f, path: `${p}.breaksOnSecretIds.${k}`, message: `secret "${id}" can never be revealed, so it can never be presented` });
      });
      l.breaksOnFactIds.forEach((fact, k) => {
        const via = factSecrets(fact);
        if (via.length === 0) warnings.push({ file: f, path: `${p}.breaksOnFactIds.${k}`, message: `fact "${fact}" is in no secret's relatedFactIds, so no testimony can carry it` });
        else if (via.every(({ owner }) => owner === ch.id)) warnings.push({ file: f, path: `${p}.breaksOnFactIds.${k}`, message: `self-referential: fact "${fact}" only comes out through ${ch.id}'s own secrets` });
      });
    });
  }
  for (const id of summaryNeeded) {
    const x = secrets.get(id);
    if (x && !x.s.testimonySummary) warnings.push({ file: charFile(x.owner), path: `secrets(${id}).testimonySummary`, message: "used as testimony but has no testimonySummary; the notebook card will show a generic line" });
  }

  const knowers = new Set(c.characters.flatMap((ch) => ch.knownFactIds));
  const hidden = [...c.facts.map((f) => ["case.json", f] as const), ...c.timeline.map((t) => ["timeline.json", t] as const)].filter(([, f]) => f.hiddenUntil);
  for (const [file, f] of hidden) {
    if (!knowers.has(f.id)) warnings.push({ file, path: f.id, message: "has hiddenUntil but no character knows this fact" });
    f.hiddenUntil?.secretIds.forEach((id) => {
      if (secrets.has(id) && !reachable.has(id)) warnings.push({ file, path: `${f.id}.hiddenUntil`, message: `secret "${id}" can never be revealed` });
    });
  }
  if (c.knowledgeGate === "explicit" && hidden.length === 0) {
    warnings.push({ file: "case.json", path: "knowledgeGate", message: 'is "explicit" but no fact has hiddenUntil: only lie aboutFactId / locked secret relatedFactIds are withheld' });
  }
  warnings.push(...progressionWarnings(c));
  return warnings;
}

const clockMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const KILLER_CLAIM = /\b(?:killed|murdered|did\s+(?:it|him\s+in|away\s+with)|struck\s+(?:him|her)\s+down|(?:is|was)\s+the\s+(?:killer|murderer|culprit))\b/i;
const NOT_A_CLAIM = /\b(?:not|never|n't|no|nobody|think|thinks|suppose|perhaps|maybe|might|could|wonder|if|whether|suspect|suspects|fear|fears|accuse|accuses)\b|\?/i;

/**
 * Guard-robustness warnings (leak paths that bypass coreGuilt):
 *  (a) a fact inside the murder window that involves the culprit (or happens at the scene) and is unhidden by the
 *      culprit's OWN non-coreGuilt secret (relatedFactIds or hiddenUntil) or her own lie breaking. That is how the
 *      21:20 letter-burning reached her prompt. (Another witness's card unlocking a fact for her is a confrontation
 *      by design and is not flagged; layer 4 of the knowledge gate still withholds anything a core secret covers.)
 *  (b) an innocent suspect's always-visible text (bio, personality, goals, beliefs, relationships, stories) names
 *      the culprit as the killer: it is in their prompt from the first turn.
 */
export function checkGuiltLeakPaths(c: LoadedCase): CaseIssue[] {
  const out: CaseIssue[] = [];
  const murderer = c.characters.find((ch) => ch.id === c.solution.murdererId);
  if (!murderer) return out;
  const core = coreGuiltSecretIds(c);
  const [lo, hi] = guiltProfile(c).window;
  const inWindow = (f: { time?: string; from?: string; to?: string }) => {
    const a = f.time ?? f.from;
    if (!a) return false;
    const b = f.time ?? f.to ?? f.from!;
    return clockMin(a) <= hi && clockMin(b) >= lo;
  };
  const ownNonCore = murderer.secrets.filter((s) => !core.has(s.id));
  for (const [file, list] of [["case.json", c.facts], ["timeline.json", c.timeline]] as const) {
    list.forEach((f, i) => {
      if (!inWindow(f)) return;
      if (!f.involvesCharacterIds.includes(murderer.id) && f.locationId !== c.solution.locationId) return;
      const via = [
        ...ownNonCore.filter((s) => s.relatedFactIds.includes(f.id)).map((s) => `secret ${s.id} (relatedFactIds)`),
        ...(f.hiddenUntil?.secretIds ?? []).filter((id) => ownNonCore.some((s) => s.id === id)).map((id) => `secret ${id} (hiddenUntil)`),
        ...(f.hiddenUntil?.lieIds ?? []).filter((id) => murderer.intendedLies.some((l) => l.id === id)).map((id) => `lie ${id} (hiddenUntil)`),
      ];
      if (via.length) {
        out.push({ file, path: `${file === "case.json" ? "facts" : "timeline"}.${i}(${f.id})`, message: `inside the murder window and about the culprit, but unhidden by ${via.join(", ")}, which is not coreGuilt: the culprit's prompt would carry it (move it behind a coreGuilt secret)` });
      }
    });
  }
  const names = [murderer.name, ...murderer.name.split(/\s+/), ...(murderer.aliases ?? [])].filter((n) => n.length > 2 && !/^(lady|lord|sir|mrs?|miss|the|her|his)$/i.test(n));
  const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  for (const ch of c.characters) {
    if (ch.id === murderer.id) continue;
    // forbiddenPhrases are guard data, never in the prompt.
    const { secrets: _s, forbiddenPhrases: _f, ...visible } = ch;
    void _s;
    void _f;
    for (const text of strings(visible)) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (!names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence))) continue;
        if (KILLER_CLAIM.test(sentence) && !NOT_A_CLAIM.test(sentence)) {
          out.push({ file: `characters/${ch.id}.json`, path: "(always-visible text)", message: `names the culprit as the killer: "${sentence.slice(0, 120)}" (an innocent should not know; this is in their prompt from the first turn)` });
        }
      }
    }
  }
  return out;
}

/**
 * Guard-data self-tests (case-two plan 3.9). All warnings; data-driven and case-agnostic.
 *  V33 (DX4): no REVEALABLE secret's testimonySummary or description, spoken by its owner, trips the guilt check
 *      (any culprit's profile, guiltProfiles). Such a reveal would be rejected forever: a soft-lock (R6).
 *  V34 (DX10): (a) a forbiddenPhrases entry lifted by `unlessRevealed` that matches the statement of a fact its
 *      character can see while those secrets are still locked (the fact's hiddenUntil lists another key, or it has
 *      none and isn't one of those secrets' own facts): the phrase would block a fact the prompt carries. (b) a
 *      hiddenUntil fact with two or more knowers whose keys are owned by different knowers (a key of one unhides it
 *      for every knower).
 */
export function checkGuardDataWarnings(c: LoadedCase): CaseIssue[] {
  const out: CaseIssue[] = [];
  const charFile = (id: string) => `characters/${id}.json`;
  const core = coreGuiltSecretIds(c);
  const profiles = guiltProfiles(c);
  for (const ch of c.characters) {
    const speakerNames = speakerNamesOf(c, ch.id);
    for (const sec of ch.secrets) {
      if (core.has(sec.id)) continue;
      for (const field of ["testimonySummary", "description"] as const) {
        const text = sec[field];
        if (!text) continue;
        for (const p of profiles) {
          const leak = findGuiltLeak(text, p, ch.id, { speakerNames });
          if (leak)
            out.push({
              file: charFile(ch.id),
              path: `secrets(${sec.id}).${field}`,
              message: `spoken by ${ch.id}, trips the guilt check (${p.role ?? "murderer"} ${p.murdererId}, ${leak.kind}): "${leak.text.slice(0, 100)}". This reveal would be rejected every time (a soft-lock); reword it or narrow the guilt data`,
            });
        }
      }
    }
  }
  const facts = [...c.facts, ...c.timeline];
  const factById = new Map(facts.map((f) => [f.id, f]));
  const ownerOfSecret = new Map(c.characters.flatMap((ch) => ch.secrets.map((x) => [x.id, ch.id] as const)));
  const ownerOfLie = new Map(c.characters.flatMap((ch) => ch.intendedLies.map((l) => [l.id, ch.id] as const)));
  for (const ch of c.characters) {
    ch.forbiddenPhrases.forEach((fp, j) => {
      const unless = unlessRevealedIds(fp);
      if (!unless.length) return;
      // The most the character can see while the entry is still live (every `unless` secret locked, every `unlessBroken`
      // lie standing, the `unlessShown` item unseen): every other secret revealed (own ones whose prerequisites don't
      // need an `unless` one), every other card and clue shown.
      const keep = new Set(unless);
      const lies = ch.intendedLies.filter((l) => fp.unlessBroken?.includes(l.id));
      lies.forEach((l) => l.breaksOnSecretIds.forEach((id) => keep.add(id)));
      const needs = (id: string, seen = new Set<string>()): boolean => {
        if (keep.has(id)) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return (ch.secrets.find((x) => x.id === id)?.revealConditions?.afterSecretIds ?? []).some((x) => needs(x, seen));
      };
      const own = ch.secrets.filter((x) => !core.has(x.id) && !needs(x.id)).map((x) => x.id);
      const noShow = new Set([...lies.flatMap((l) => l.brokenByEvidenceIds), ...(fp.unlessShown ? [fp.unlessShown] : [])]);
      const heard = c.characters.flatMap((o) => (o.id === ch.id ? [] : o.secrets.filter((x) => !core.has(x.id) && !keep.has(x.id) && !noShow.has(x.id)).map((x) => x.id)));
      const gate = knowledgeGate(c, ch, { revealedSecretIds: own, testimonyShownIds: heard, evidenceShownIds: c.evidence.map((e) => e.id).filter((id) => !noShow.has(id)) });
      const re = compileForbiddenPhrase(fp);
      for (const id of ch.knownFactIds) {
        const f = factById.get(id);
        if (!f || gate.withheldFactIds.has(id)) continue;
        const m = re.exec(f.statement);
        if (m)
          out.push({
            file: charFile(ch.id),
            path: `forbiddenPhrases.${j}`,
            message: `matches "${m[0].slice(0, 60)}" in fact ${f.id}, which ${ch.id} can see while ${unless.join("/")} is still locked: the guard would reject what the prompt tells them`,
          });
      }
    });
  }
  for (const f of facts) {
    if (!f.hiddenUntil) continue;
    const knowers = new Set(c.characters.filter((ch) => ch.knownFactIds.includes(f.id)).map((ch) => ch.id));
    if (knowers.size < 2) continue;
    const owners = new Set(
      [...f.hiddenUntil.secretIds.map((k) => ownerOfSecret.get(k)), ...f.hiddenUntil.lieIds.map((k) => ownerOfLie.get(k))].filter((o): o is string => !!o && knowers.has(o)),
    );
    if (owners.size >= 2)
      out.push({
        file: c.facts.includes(f) ? "case.json" : "timeline.json",
        path: `${f.id}.hiddenUntil`,
        message: `its keys belong to different knowers (${[...owners].join(", ")}): one knower's key unhides it for every knower; split the fact per knower`,
      });
  }
  return out;
}

/** DX11 / design T-55: a culprit's own wrong ending never confirms a role: no line by the other culprit (it is never
 * played) and no line naming them. Two-culprit cases only. */
export function culpritEndingWarnings(c: Pick<LoadedCase, "solution" | "characters" | "endings">): CaseIssue[] {
  const out: CaseIssue[] = [];
  const culpritIds = [c.solution.murdererId, ...(c.solution.accompliceId ? [c.solution.accompliceId] : [])];
  if (culpritIds.length > 1 && c.endings)
    for (const id of culpritIds) {
      const other = c.characters.find((ch) => ch.id !== id && culpritIds.includes(ch.id));
      if (!other) continue;
      const names = [other.name, ...(other.aliases ?? [])].filter((n) => n.length > 2);
      (c.endings.wrong[id] ?? []).forEach((l, k) => {
        const path = `wrong.${id}.${k}`;
        if (l.speaker === other.id) out.push({ file: "endings.json", path, message: `a line by the other culprit (${other.id}) in ${id}'s own wrong ending is never played (DX11)` });
        else if (names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(l.text)))
          out.push({ file: "endings.json", path, message: `${id}'s own wrong ending names the other culprit (${other.id}): a loss must not confirm a role (design T-55)` });
      });
    }
  return out;
}

/**
 * V31 (phase 10, 3.8): the unlock graph over every case in a cases dir. Each `unlockedBy` id is a case there, never
 * the case itself, there is no cycle, and at least one case has no `unlockedBy` (otherwise nothing can be played first).
 */
export function checkUnlockGraph(cases: readonly { id: string; unlockedBy?: readonly string[] | undefined }[]): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const by = new Map(cases.map((c) => [c.id, c.unlockedBy ?? []]));
  for (const c of cases)
    (c.unlockedBy ?? []).forEach((id, i) => {
      if (id === c.id) issues.push({ file: `${c.id}/case.json`, path: `unlockedBy.${i}`, message: "a case cannot be unlocked by itself (V31)" });
      else if (!by.has(id)) issues.push({ file: `${c.id}/case.json`, path: `unlockedBy.${i}`, message: `unknown case "${id}" (V31)` });
    });
  if (cases.length && cases.every((c) => c.unlockedBy?.length))
    issues.push({ file: "cases/", message: "every case has unlockedBy, so none can be played first (V31)" });
  // Cycle: depth-first over "needs" edges.
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const loop = [...trail.slice(trail.indexOf(id)), id];
      const key = [...new Set(loop)].sort().join(",");
      if (!reported.has(key)) {
        reported.add(key);
        issues.push({ file: `${id}/case.json`, path: "unlockedBy", message: `unlock cycle: ${loop.join(" -> ")} (V31)` });
      }
      return;
    }
    state.set(id, 1);
    for (const next of by.get(id) ?? []) if (next !== id && by.has(next)) visit(next, [...trail, id]);
    state.set(id, 2);
  };
  for (const c of cases) visit(c.id, []);
  return issues;
}
