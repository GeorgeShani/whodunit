/**
 * Validation for the progression fields (docs/BLACKWOOD_PROGRESSION_PROPOSAL.md §5.7): reference checks, cycles,
 * and a reachability simulation from an empty state. Pure. Cases without any progression field return nothing.
 *
 * The simulation is deliberately generous to the player: every suspect can be questioned without limit and any
 * clue in hand can be shown to anyone. Secrets reveal by evidence, testimony held and afterSecretIds only (stress-only
 * conditions count as unreachable); core guilt (engine/core-guilt.ts) never reveals. It iterates to a fixed point; anything still locked then can never be reached.
 */
import type { LoadedCase } from "./case-schema";
import type { CaseIssue } from "./case-validation";
import { coreGuiltSecretIds } from "./core-guilt";
import { accuseProgress, isUnlocked, leadStates, type LeadStates } from "./progress";
import type { Condition, GameState } from "./types";
import { GameStateSchema } from "./types";

const LOTS = 99;

export function usesProgression(c: LoadedCase): boolean {
  return Boolean(
    c.leads?.length ||
      c.accuseGate ||
      c.locations.some((l) => l.requires || l.lockedLine) ||
      c.evidence.some((e) => e.requires || e.lockedLine) ||
      c.solution.keyTestimonyIds?.length ||
      c.solution.minKeyEvidence !== undefined ||
      c.solution.minKeyTestimony !== undefined,
  );
}

function emptyGame(c: LoadedCase): GameState {
  return GameStateSchema.parse({
    caseId: c.id,
    phase: "investigating",
    turn: 0,
    discoveredEvidenceIds: c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id),
    characters: Object.fromEntries(c.characters.map((ch) => [ch.id, { characterId: ch.id, emotion: { ...ch.initialEmotion } }])),
  });
}

export interface Simulation {
  game: GameState;
  states: LeadStates;
  /** Locations that became searchable. */
  unlockedLocationIds: string[];
  /** Greedy count of the fastest legal path to a won accusation (see fastestPath). */
  actions?: number;
}

/**
 * Can this secret be cracked now with the clues found and the testimony held (stress never counts)?
 * Testimony conditions count once that secret is revealed (any card can be presented to anyone). Core guilt never.
 */
function crackable(s: LoadedCase["characters"][number]["secrets"][number], core: ReadonlySet<string>, discovered: ReadonlySet<string> | readonly string[], revealed: ReadonlySet<string> | readonly string[]): boolean {
  const has = (set: ReadonlySet<string> | readonly string[], id: string) => ("has" in set ? set.has(id) : set.includes(id));
  const rc = s.revealConditions;
  if (core.has(s.id) || has(revealed, s.id) || !rc || !rc.afterSecretIds.every((id) => has(revealed, id))) return false;
  const conds = [...rc.evidenceIds.map((e) => has(discovered, e)), ...(rc.testimonyIds ?? []).map((t) => has(revealed, t))];
  return conds.length > 0 && (rc.mode === "all" ? conds.every(Boolean) : conds.some(Boolean));
}

/** Secrets whose reveal conditions can be met with the given clues (stress never counts). */
function revealableSecrets(c: LoadedCase, discovered: ReadonlySet<string>, revealed: Set<string>): boolean {
  let changed = false;
  const core = coreGuiltSecretIds(c);
  for (const ch of c.characters) {
    for (const s of ch.secrets) {
      if (!crackable(s, core, discovered, revealed)) continue;
      revealed.add(s.id);
      changed = true;
    }
  }
  return changed;
}

/** Run the generous simulation to a fixed point. */
export function simulate(c: LoadedCase): Simulation {
  const game = emptyGame(c);
  for (const id of Object.keys(game.characters)) game.characters[id].interrogationCount = LOTS;
  for (let round = 0; round < 200; round++) {
    let changed = false;
    const states = leadStates(c, game);
    // Searches use the state BEFORE the action: collect, then apply.
    const found: string[] = [];
    const searched: string[] = [];
    for (const loc of c.locations) {
      if (!isUnlocked(loc, game, states)) continue;
      if (!game.searchedLocationIds.includes(loc.id)) searched.push(loc.id);
      for (const e of c.evidence) if (e.locationId === loc.id && !game.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, game, states)) found.push(e.id);
    }
    for (const id of searched) {
      game.searchedLocationIds.push(id);
      changed = true;
    }
    for (const id of found) {
      if (game.discoveredEvidenceIds.includes(id)) continue;
      game.discoveredEvidenceIds.push(id);
      changed = true;
    }
    const revealed = new Set(game.revealedSecretIds);
    if (revealableSecrets(c, new Set(game.discoveredEvidenceIds), revealed)) {
      game.revealedSecretIds = [...revealed];
      changed = true;
    }
    if (!changed) break;
  }
  const states = leadStates(c, game);
  return { game, states, unlockedLocationIds: c.locations.filter((l) => isUnlocked(l, game, states)).map((l) => l.id) };
}

const condRefs = (cond: Condition | undefined) => ({
  characters: cond?.interrogated?.map((i) => i.characterId) ?? [],
  evidence: cond?.evidenceIds ?? [],
  secrets: cond?.secretIds ?? [],
  locations: cond?.searchedLocationIds ?? [],
  leads: cond?.leadIds ?? [],
});

/** Errors: unresolved ids, empty/duplicate/self-referential definitions, impossible win rules, unreachable content. */
export function checkProgression(c: LoadedCase): CaseIssue[] {
  if (!usesProgression(c)) return [];
  const issues: CaseIssue[] = [];
  const add = (file: string, path: string, message: string) => issues.push({ file, path, message });
  const characterIds = new Set(c.characters.map((x) => x.id));
  const evidenceIds = new Set(c.evidence.map((e) => e.id));
  const locationIds = new Set(c.locations.map((l) => l.id));
  const secrets = new Map(c.characters.flatMap((ch) => ch.secrets.map((s) => [s.id, s] as const)));
  const leadIds = new Set<string>();
  for (const l of c.leads ?? []) {
    if (leadIds.has(l.id)) add("case.json", `leads(${l.id})`, `duplicate lead id "${l.id}"`);
    leadIds.add(l.id);
  }

  const checkCondition = (cond: Condition | undefined, file: string, path: string) => {
    const r = condRefs(cond);
    r.characters.forEach((id) => characterIds.has(id) || add(file, path, `unknown character "${id}"`));
    r.evidence.forEach((id) => evidenceIds.has(id) || add(file, path, `unknown evidence "${id}"`));
    r.secrets.forEach((id) => secrets.has(id) || add(file, path, `unknown secret "${id}"`));
    r.locations.forEach((id) => locationIds.has(id) || add(file, path, `unknown location "${id}"`));
    r.leads.forEach((id) => leadIds.has(id) || add(file, path, `unknown lead "${id}"`));
  };

  c.locations.forEach((l, i) => {
    const p = `locations.${i}(${l.id}).requires`;
    checkCondition(l.requires, "case.json", p);
    if (l.requires?.searchedLocationIds?.includes(l.id)) add("case.json", p, `location "${l.id}" requires itself`);
  });
  c.evidence.forEach((e, i) => {
    const p = `${i}(${e.id}).requires`;
    checkCondition(e.requires, "evidence.json", p);
    if (e.requires?.evidenceIds?.includes(e.id)) add("evidence.json", p, `evidence "${e.id}" requires itself`);
    if (e.requires && !e.locationId) add("evidence.json", p, `evidence "${e.id}" has requires but no locationId (a clue with no room is never searched, so requires does nothing)`);
    if (e.requires && e.initiallyAvailable) add("evidence.json", p, `evidence "${e.id}" has requires but is initiallyAvailable (it is in the notebook from the start)`);
  });
  (c.leads ?? []).forEach((l, i) => {
    checkCondition(l.opensWhen, "case.json", `leads.${i}(${l.id}).opensWhen`);
    checkCondition(l.closesWhen, "case.json", `leads.${i}(${l.id}).closesWhen`);
  });
  // A lead that (directly or indirectly) opens or closes on itself.
  const deps = new Map((c.leads ?? []).map((l) => [l.id, [...(l.opensWhen?.leadIds ?? []), ...(l.closesWhen?.leadIds ?? [])]]));
  for (const id of deps.keys()) {
    const seen = new Set<string>();
    const stack = [...(deps.get(id) ?? [])];
    while (stack.length) {
      const x = stack.pop() as string;
      if (x === id) {
        add("case.json", `leads(${id})`, `lead "${id}" depends on itself (cycle through leadIds)`);
        break;
      }
      if (!seen.has(x)) {
        seen.add(x);
        stack.push(...(deps.get(x) ?? []));
      }
    }
  }

  const g = c.accuseGate;
  if (g) {
    (g.closedLeadIds ?? []).forEach((id, k) => leadIds.has(id) || add("case.json", `accuseGate.closedLeadIds.${k}`, `unknown lead "${id}"`));
    if (g.minSuspectsQuestioned && g.minSuspectsQuestioned.count > c.characters.length) add("case.json", "accuseGate.minSuspectsQuestioned.count", `needs ${g.minSuspectsQuestioned.count} suspects but the case has ${c.characters.length}`);
    if (g.minEvidence > c.evidence.length) add("case.json", "accuseGate.minEvidence", `needs ${g.minEvidence} clues but the case has ${c.evidence.length}`);
  }

  const s = c.solution;
  (s.keyTestimonyIds ?? []).forEach((id, k) => {
    const sec = secrets.get(id);
    if (!sec) add("solution.json", `keyTestimonyIds.${k}`, `unknown secret "${id}"`);
    else if (!sec.testimonySummary) add("solution.json", `keyTestimonyIds.${k}`, `secret "${id}" has no testimonySummary, so it cannot be a testimony card`);
  });
  if ((s.minKeyTestimony ?? 0) > (s.keyTestimonyIds?.length ?? 0)) add("solution.json", "minKeyTestimony", `${s.minKeyTestimony} is more than keyTestimonyIds (${s.keyTestimonyIds?.length ?? 0})`);
  if ((s.minKeyEvidence ?? 1) > s.keyEvidenceIds.length) add("solution.json", "minKeyEvidence", `${s.minKeyEvidence} is more than keyEvidenceIds (${s.keyEvidenceIds.length})`);

  if (issues.length > 0) return issues; // simulate only a case whose references resolve

  // Reachability from an empty state.
  const sim = simulate(c);
  const have = (id: string) => sim.game.discoveredEvidenceIds.includes(id);
  for (const l of c.locations) if (!sim.unlockedLocationIds.includes(l.id)) add("case.json", `locations(${l.id})`, `location "${l.id}" can never be searched: its requires can never be met (possible dependency cycle)`);
  for (const e of c.evidence) if (e.locationId && !have(e.id)) add("evidence.json", `evidence(${e.id})`, `clue "${e.id}" can never be found: its room or its requires can never be reached (possible dependency cycle)`);
  if (g && !accuseProgress(c, sim.game, sim.states).unlocked) add("case.json", "accuseGate", "ACCUSE can never unlock: even questioning everyone without limit and showing every clue found, the gate is never met");
  const keyHeld = s.keyEvidenceIds.filter(have).length;
  if (keyHeld < (s.minKeyEvidence ?? 1)) add("solution.json", "keyEvidenceIds", `only ${keyHeld} of the key clues can ever be found; the win rule needs ${s.minKeyEvidence ?? 1}`);
  const testimonyHeld = (s.keyTestimonyIds ?? []).filter((id) => sim.game.revealedSecretIds.includes(id)).length;
  if (testimonyHeld < (s.minKeyTestimony ?? 0)) add("solution.json", "keyTestimonyIds", `only ${testimonyHeld} of the key testimonies can ever be revealed (stress-only secrets count as unreachable); the win rule needs ${s.minKeyTestimony}`);
  return issues;
}

/** Warnings: leads that never open/close, soft gates, locked content with no line. */
export function progressionWarnings(c: LoadedCase): CaseIssue[] {
  if (!usesProgression(c)) return [];
  const w: CaseIssue[] = [];
  const sim = simulate(c);
  for (const l of c.leads ?? []) {
    const st = sim.states[l.id];
    if (st === "hidden") w.push({ file: "case.json", path: `leads(${l.id})`, message: "lead never opens (its opensWhen can never hold)" });
    else if (st !== "closed") w.push({ file: "case.json", path: `leads(${l.id})`, message: "lead never closes (its closesWhen can never hold)" });
  }
  if (c.accuseGate && c.accuseGate.minEvidence < 2) w.push({ file: "case.json", path: "accuseGate.minEvidence", message: "is below 2: a single clue unlocks ACCUSE, which is the easy mode this gate exists to prevent" });
  for (const e of c.evidence) if (e.requires && !e.lockedLine) w.push({ file: "evidence.json", path: `evidence(${e.id})`, message: "is gated by requires but has no lockedLine (searches skip it silently)" });
  for (const l of c.locations) if (l.requires && !l.lockedLine) w.push({ file: "case.json", path: `locations(${l.id})`, message: "is gated by requires but has no lockedLine (the card shows a generic padlock line)" });
  return w;
}

/** Largest exchange count any condition or the accuse gate ever looks at (counts above it change nothing). */
function exchangeCap(c: LoadedCase): number {
  const caps: number[] = [1, c.accuseGate?.minSuspectsQuestioned?.minExchanges ?? 1];
  const scan = (cond?: Condition) => cond?.interrogated?.forEach((i) => caps.push(i.minExchanges ?? 1));
  c.locations.forEach((l) => scan(l.requires));
  c.evidence.forEach((e) => scan(e.requires));
  (c.leads ?? []).forEach((l) => (scan(l.opensWhen), scan(l.closesWhen)));
  return Math.max(...caps);
}

export const FASTEST_PATH_BUDGET = 400_000;

/**
 * The fastest legal path (actions) to a won accusation, or null when the case has no progression or the search
 * budget ran out. Breadth-first over the real unlock rules: a search, an exchange with any suspect, or showing a clue
 * (also an exchange with its owner, and the only way to crack a secret). The final accusation counts as one action.
 * Exchange counts are capped at the largest number any condition looks at, so the state space stays small.
 */
export function fastestPath(c: LoadedCase): number | null {
  if (!usesProgression(c)) return null;
  const cap = exchangeCap(c);
  const sol = c.solution;
  const ids = c.characters.map((ch) => ch.id);
  const start = emptyGame(c);
  type Node = { game: GameState; steps: number };
  const key = (g: GameState) =>
    [[...g.discoveredEvidenceIds].sort(), [...g.searchedLocationIds].sort(), [...g.revealedSecretIds].sort(), ids.map((id) => g.characters[id].interrogationCount)].map((x) => x.join(",")).join("|");
  const clone = (g: GameState): GameState => ({
    ...g,
    discoveredEvidenceIds: [...g.discoveredEvidenceIds],
    searchedLocationIds: [...g.searchedLocationIds],
    revealedSecretIds: [...g.revealedSecretIds],
    characters: Object.fromEntries(ids.map((id) => [id, { ...g.characters[id] }])),
  });
  const done = (g: GameState) => {
    if (!accuseProgress(c, g).unlocked) return false;
    if (sol.keyEvidenceIds.filter((id) => g.discoveredEvidenceIds.includes(id)).length < (sol.minKeyEvidence ?? 1)) return false;
    return (sol.keyTestimonyIds ?? []).filter((id) => g.revealedSecretIds.includes(id)).length >= (sol.minKeyTestimony ?? 0);
  };
  const core = coreGuiltSecretIds(c);
  const seen = new Set([key(start)]);
  let frontier: Node[] = [{ game: start, steps: 0 }];
  while (frontier.length) {
    const next: Node[] = [];
    for (const { game, steps } of frontier) {
      if (done(game)) return steps + 1;
      const states = leadStates(c, game);
      const push = (g: GameState) => {
        const k = key(g);
        if (seen.has(k)) return;
        seen.add(k);
        next.push({ game: g, steps: steps + 1 });
      };
      // Search a room (state before the action decides what it yields).
      for (const loc of c.locations) {
        if (!isUnlocked(loc, game, states)) continue;
        const g = clone(game);
        if (!g.searchedLocationIds.includes(loc.id)) g.searchedLocationIds.push(loc.id);
        for (const e of c.evidence) if (e.locationId === loc.id && !g.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, game, states)) g.discoveredEvidenceIds.push(e.id);
        push(g);
      }
      // An ordinary exchange with each suspect.
      for (const id of ids) {
        const g = clone(game);
        g.characters[id].interrogationCount = Math.min(cap, g.characters[id].interrogationCount + 1);
        push(g);
      }
      // Show a clue (or present a testimony card) that cracks one of that suspect's secrets (an exchange too). Never core guilt.
      for (const ch of c.characters) {
        for (const sec of ch.secrets) {
          if (!crackable(sec, core, game.discoveredEvidenceIds, game.revealedSecretIds)) continue;
          const g = clone(game);
          g.revealedSecretIds.push(sec.id);
          g.characters[ch.id].interrogationCount = Math.min(cap, g.characters[ch.id].interrogationCount + 1);
          push(g);
        }
      }
      if (seen.size > FASTEST_PATH_BUDGET) return null;
    }
    frontier = next;
  }
  return null;
}
