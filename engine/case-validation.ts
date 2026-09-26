/**
 * Referential / logical checks for a schema-valid case. Pure (no fs), so it can
 * be unit-tested and reused by the loader and scripts/validate-case.ts.
 */
import type { LoadedCase } from "./case-schema";
import { gameMinutes } from "./time";
import type { TimelineEntry } from "./types";

/**
 * Opportunity rule: some timeline entry with `locationId` = solution.locationId
 * must list the murderer in `involvesCharacterIds`, and place them there within
 * this many minutes of the murder time: a point entry's `time`, or a window
 * [from, to] widened by this amount on each side.
 */
export const OPPORTUNITY_WINDOW_MINUTES = 15;

export interface CaseIssue {
  /** File the problem lives in, relative to the case directory (e.g. "characters/reginald.json"). */
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
  if (e.time !== undefined) {
    const t = gameMinutes(e.time, dayStartsAt);
    return [t, t];
  }
  return [gameMinutes(e.from!, dayStartsAt), gameMinutes(e.to!, dayStartsAt)];
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

export function checkCaseReferences(c: LoadedCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
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

  // case.json
  ref(locationIds, "location", c.victim.foundAtLocationId, CASE, "victim.foundAtLocationId");
  c.facts.forEach((f, i) => {
    ref(locationIds, "location", f.locationId, CASE, `facts.${i}(${f.id}).locationId`);
    f.involvesCharacterIds.forEach((id, j) =>
      ref(personIds, "character/victim", id, CASE, `facts.${i}(${f.id}).involvesCharacterIds.${j}`),
    );
  });

  // timeline.json
  c.timeline.forEach((t, i) => {
    const p = `${i}(${t.id})`;
    ref(locationIds, "location", t.locationId, TL, `${p}.locationId`);
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
      s.revealConditions?.afterSecretIds.forEach((id, k) => {
        ref(ownSecretIds, "own secret", id, f, `${p}.revealConditions.afterSecretIds.${k}`);
        if (id === s.id) issues.push({ file: f, path: `${p}.revealConditions.afterSecretIds.${k}`, message: "a secret cannot depend on itself" });
      });
      s.relatedFactIds.forEach((id, k) => ref(factIds, "fact", id, f, `${p}.relatedFactIds.${k}`));
    });
    ch.intendedLies.forEach((l, j) => {
      const p = `intendedLies.${j}(${l.id})`;
      ref(factIds, "fact", l.aboutFactId, f, `${p}.aboutFactId`);
      l.brokenByEvidenceIds.forEach((id, k) => ref(evidenceIds, "evidence", id, f, `${p}.brokenByEvidenceIds.${k}`));
    });
    ch.relationships.forEach((r, j) => {
      ref(personIds, "character/victim", r.targetCharacterId, f, `relationships.${j}.targetCharacterId`);
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
  if (!evidenceIds.has(s.weaponId)) issues.push({ file: SOL, path: "weaponId", message: `weapon "${s.weaponId}" is not an evidence id in evidence.json` });
  if (!locationIds.has(s.locationId)) issues.push({ file: SOL, path: "locationId", message: `location "${s.locationId}" is not a location in case.json` });
  if (!motiveIds.has(s.motiveId)) issues.push({ file: SOL, path: "motiveId", message: `motive "${s.motiveId}" is not one of case.json motives[].id` });
  s.keyEvidenceIds.forEach((id, k) => ref(evidenceIds, "evidence", id, SOL, `keyEvidenceIds.${k}`));

  if (murderer && locationIds.has(s.locationId) && !wasPresent(c, s.murdererId, s.locationId, s.time)) {
    issues.push({
      file: SOL,
      message:
        `murderer "${s.murdererId}" had no opportunity: no timeline entry (point or window) places them in ` +
        `"${s.locationId}" within ${OPPORTUNITY_WINDOW_MINUTES} min of ${s.time}`,
    });
  }

  for (const ch of c.characters) {
    if (ch.id !== s.murdererId && ch.secrets.length === 0) {
      issues.push({ file: charFile(ch.id), path: "secrets", message: `innocent "${ch.id}" needs at least one secret (red herrings keep the game fun)` });
    }
  }

  return issues;
}
