/**
 * Referential / logical checks for a schema-valid case. Pure (no fs), so it can
 * be unit-tested and reused by the loader and scripts/validate-case.ts.
 */
import type { LoadedCase } from "./case-schema";
import { gameMinutes } from "./time";

/**
 * Opportunity rule: the murderer must have a timeline entry at the solution's
 * location whose [from, to] window, widened by this many minutes on each side,
 * contains the murder time.
 */
export const OPPORTUNITY_WINDOW_MINUTES = 15;

export interface CaseIssue {
  /** File the problem lives in, relative to the case directory (e.g. "characters/reginald.json"). */
  file: string;
  /** Dotted path inside the file, if applicable (e.g. "secrets.0.pressuredByEvidenceIds.1"). */
  path?: string;
  message: string;
}

export function formatIssue(issue: CaseIssue): string {
  return `${issue.file}${issue.path ? ` -> ${issue.path}` : ""}: ${issue.message}`;
}

export function checkCaseReferences(c: LoadedCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const CASE = "case.json";
  const SOL = "solution.json";
  const charFile = (id: string) => `characters/${id}.json`;

  const locationIds = new Set(c.locations.map((l) => l.id));
  const evidenceIds = new Set(c.evidence.map((e) => e.id));
  const factIds = new Set(c.facts.map((f) => f.id));
  const characterIds = new Set(c.characters.map((ch) => ch.id));
  const personIds = new Set([...characterIds, c.victim.id]);

  const dupes = (kind: string, file: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push({ file, message: `duplicate ${kind} id "${id}"` });
      seen.add(id);
    }
  };
  dupes("location", CASE, c.locations.map((l) => l.id));
  dupes("evidence", CASE, c.evidence.map((e) => e.id));
  dupes("fact", CASE, c.facts.map((f) => f.id));
  dupes("timeline", CASE, c.timeline.map((t) => t.id));
  dupes("character", "characters/", c.characters.map((ch) => ch.id));
  if (characterIds.has(c.victim.id)) {
    issues.push({ file: CASE, path: "victim.id", message: `victim id "${c.victim.id}" collides with a character id` });
  }

  const ref = (set: Set<string>, kind: string, id: string | undefined, file: string, path: string) => {
    if (id !== undefined && !set.has(id)) issues.push({ file, path, message: `unknown ${kind} "${id}"` });
  };

  // case.json
  ref(locationIds, "location", c.victim.foundAtLocationId, CASE, "victim.foundAtLocationId");
  c.facts.forEach((f, i) => {
    ref(locationIds, "location", f.locationId, CASE, `facts.${i}(${f.id}).locationId`);
    f.involvesCharacterIds.forEach((id, j) =>
      ref(personIds, "character/victim", id, CASE, `facts.${i}(${f.id}).involvesCharacterIds.${j}`),
    );
  });
  c.timeline.forEach((t, i) => {
    const p = `timeline.${i}(${t.id})`;
    ref(characterIds, "character", t.characterId, CASE, `${p}.characterId`);
    ref(locationIds, "location", t.locationId, CASE, `${p}.locationId`);
    ref(factIds, "fact", t.factId, CASE, `${p}.factId`);
    if (gameMinutes(t.to, c.meta.dayStartsAt) < gameMinutes(t.from, c.meta.dayStartsAt)) {
      issues.push({ file: CASE, path: p, message: `"to" (${t.to}) is before "from" (${t.from}) in game-day order` });
    }
  });
  c.evidence.forEach((e, i) => {
    ref(locationIds, "location", e.locationId, CASE, `evidence.${i}(${e.id}).locationId`);
    e.relatedFactIds.forEach((id, j) => ref(factIds, "fact", id, CASE, `evidence.${i}(${e.id}).relatedFactIds.${j}`));
  });

  // characters/*.json
  for (const ch of c.characters) {
    const f = charFile(ch.id);
    ch.knownFactIds.forEach((id, j) => ref(factIds, "fact", id, f, `knownFactIds.${j}`));
    ch.beliefs.forEach((b, j) => ref(factIds, "fact", b.aboutFactId, f, `beliefs.${j}(${b.id}).aboutFactId`));
    ch.secrets.forEach((s, j) => {
      s.pressuredByEvidenceIds.forEach((id, k) =>
        ref(evidenceIds, "evidence", id, f, `secrets.${j}(${s.id}).pressuredByEvidenceIds.${k}`),
      );
      s.relatedFactIds.forEach((id, k) => ref(factIds, "fact", id, f, `secrets.${j}(${s.id}).relatedFactIds.${k}`));
    });
    ch.relationships.forEach((r, j) => {
      ref(personIds, "character/victim", r.characterId, f, `relationships.${j}.characterId`);
      if (r.characterId === ch.id) issues.push({ file: f, path: `relationships.${j}`, message: "a character cannot have a relationship with themselves" });
    });
    dupes("belief", f, ch.beliefs.map((b) => b.id));
    dupes("secret", f, ch.secrets.map((s) => s.id));
  }

  // solution.json
  const s = c.solution;
  const murderer = c.characters.find((ch) => ch.id === s.murdererId);
  if (!murderer) issues.push({ file: SOL, path: "murdererId", message: `murderer "${s.murdererId}" is not a character in characters/` });
  if (!evidenceIds.has(s.weaponId)) issues.push({ file: SOL, path: "weaponId", message: `weapon "${s.weaponId}" is not an evidence id in case.json` });
  if (!locationIds.has(s.locationId)) issues.push({ file: SOL, path: "locationId", message: `location "${s.locationId}" is not a location in case.json` });

  if (murderer && locationIds.has(s.locationId)) {
    const murderT = gameMinutes(s.time, c.meta.dayStartsAt);
    const hadOpportunity = c.timeline.some(
      (t) =>
        t.characterId === s.murdererId &&
        t.locationId === s.locationId &&
        gameMinutes(t.from, c.meta.dayStartsAt) - OPPORTUNITY_WINDOW_MINUTES <= murderT &&
        murderT <= gameMinutes(t.to, c.meta.dayStartsAt) + OPPORTUNITY_WINDOW_MINUTES,
    );
    if (!hadOpportunity) {
      issues.push({
        file: SOL,
        message:
          `murderer "${s.murdererId}" had no opportunity: no timeline entry places them in "${s.locationId}" ` +
          `within ${OPPORTUNITY_WINDOW_MINUTES} min of ${s.time}`,
      });
    }
  }

  for (const ch of c.characters) {
    if (ch.id !== s.murdererId && ch.secrets.length === 0) {
      issues.push({ file: charFile(ch.id), path: "secrets", message: `innocent "${ch.id}" needs at least one secret (red herrings keep the game fun)` });
    }
  }

  return issues;
}
