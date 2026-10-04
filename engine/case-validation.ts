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
    if (ch.id !== s.murdererId && ch.secrets.length === 0) {
      issues.push({ file: charFile(ch.id), path: "secrets", message: `innocent "${ch.id}" needs at least one secret (red herrings keep the game fun)` });
    }
  }

  return issues;
}

/**
 * Non-fatal design warnings (validate:case prints them with ⚠): lies that can
 * never break, testimony that can never be revealed, reveal-order cycles,
 * self-referential testimony, missing testimony summaries, explicit hiding
 * nobody can see. Assumes checkCaseReferences passed.
 */
export function checkCaseWarnings(c: LoadedCase): CaseIssue[] {
  const warnings: CaseIssue[] = [];
  const charFile = (id: string) => `characters/${id}.json`;
  const findable = new Set(c.evidence.filter((e) => e.locationId || e.initiallyAvailable).map((e) => e.id));
  const secrets = new Map(c.characters.flatMap((ch) => ch.secrets.map((s) => [s.id, { s, owner: ch.id }] as const)));

  // Reachable secrets: fixpoint over reveal conditions (stress alone is always reachable) + afterSecretIds.
  const reachable = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, { s }] of secrets) {
      if (reachable.has(id) || !s.revealConditions) continue;
      const rc = s.revealConditions;
      const conds = [...(rc.stressThreshold !== undefined ? [true] : []), ...rc.evidenceIds.map((e) => findable.has(e))];
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
  return warnings;
}
