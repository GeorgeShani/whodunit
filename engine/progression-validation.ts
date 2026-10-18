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
import { liesTouchedByTestimony } from "./testimony";
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
  // Phase 8 (6.3): each keyTestimonyGroups group needs one revealable member.
  (s.keyTestimonyGroups ?? []).forEach((grp, k) => {
    if (!grp.some((id) => sim.game.revealedSecretIds.includes(id)))
      add("solution.json", `keyTestimonyGroups.${k}`, `no testimony in this group can ever be revealed (stress-only secrets count as unreachable), so the case can never be won`);
  });
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
  // E1: ACCUSE must never open while the win is impossible (key clues / key testimony not yet obtainable).
  const open = accuseOpenWithoutWin(c);
  if (open && open !== "budget") {
    const g = open;
    w.push({
      file: "case.json",
      path: "accuseGate",
      message: `ACCUSE can open while winning is impossible: e.g. clues [${g.discoveredEvidenceIds.join(", ")}], secrets [${g.revealedSecretIds.join(", ")}] unlock the gate but hold fewer than the solution's minKeyEvidence/minKeyTestimony; tighten the gate (e.g. closedLeadIds on a lead that needs the key clue/testimony)`,
    });
  }
  return w;
}

export const ACCUSE_AUDIT_BUDGET = 300_000;

/**
 * E1: a reachable state where the accuse gate is open but the player cannot yet hold the win (fewer key clues than
 * minKeyEvidence, or fewer key testimonies than minKeyTestimony), or null if none; "budget" when the search ran out.
 * Exhaustive over searching, talking and cracking, adversarially: a secret with a stress threshold counts as
 * revealable at any time (pressure alone can get there). Exchange counts are capped as in fastestPath.
 */
export function accuseOpenWithoutWin(c: LoadedCase): GameState | null | "budget" {
  if (!usesProgression(c) || !c.accuseGate) return null;
  const sol = c.solution;
  const cap = exchangeCap(c);
  const ids = c.characters.map((ch) => ch.id);
  const core = coreGuiltSecretIds(c);
  const key = (g: GameState) =>
    [[...g.discoveredEvidenceIds].sort(), [...g.searchedLocationIds].sort(), [...g.revealedSecretIds].sort(), ids.map((id) => g.characters[id].interrogationCount)].map((x) => x.join(",")).join("|");
  const clone = (g: GameState): GameState => ({
    ...g,
    discoveredEvidenceIds: [...g.discoveredEvidenceIds],
    searchedLocationIds: [...g.searchedLocationIds],
    revealedSecretIds: [...g.revealedSecretIds],
    characters: Object.fromEntries(ids.map((id) => [id, { ...g.characters[id] }])),
  });
  const revealable = (sec: LoadedCase["characters"][number]["secrets"][number], g: GameState) => {
    const rc = sec.revealConditions;
    if (!rc || core.has(sec.id) || g.revealedSecretIds.includes(sec.id) || !rc.afterSecretIds.every((x) => g.revealedSecretIds.includes(x))) return false;
    return rc.stressThreshold !== undefined || crackable(sec, core, g.discoveredEvidenceIds, g.revealedSecretIds);
  };
  const impossible = (g: GameState) =>
    sol.keyEvidenceIds.filter((id) => g.discoveredEvidenceIds.includes(id)).length < (sol.minKeyEvidence ?? 1) ||
    (sol.keyTestimonyIds ?? []).filter((id) => g.revealedSecretIds.includes(id)).length < (sol.minKeyTestimony ?? 0);
  const start = emptyGame(c);
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const g = queue[i]!;
    if (impossible(g) && accuseProgress(c, g).unlocked) return g;
    const states = leadStates(c, g);
    const next: GameState[] = [];
    for (const loc of c.locations) {
      if (!isUnlocked(loc, g, states)) continue;
      const n = clone(g);
      if (!n.searchedLocationIds.includes(loc.id)) n.searchedLocationIds.push(loc.id);
      for (const e of c.evidence) if (e.locationId === loc.id && !n.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, g, states)) n.discoveredEvidenceIds.push(e.id);
      next.push(n);
    }
    for (const id of ids) {
      const n = clone(g);
      n.characters[id].interrogationCount = Math.min(cap, n.characters[id].interrogationCount + 1);
      next.push(n);
    }
    for (const ch of c.characters)
      for (const sec of ch.secrets) {
        if (!revealable(sec, g)) continue;
        const n = clone(g);
        n.revealedSecretIds.push(sec.id);
        n.characters[ch.id].interrogationCount = Math.min(cap, n.characters[ch.id].interrogationCount + 1);
        next.push(n);
      }
    for (const n of next) {
      const k = key(n);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
    if (seen.size > ACCUSE_AUDIT_BUDGET) return "budget";
  }
  return null;
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

/** Phase 8 (6.3, 6.4): one action of the cheapest winning path, as the smoke playthrough replays it. */
export type PlanStep =
  | { kind: "search"; locationId: string }
  | { kind: "talk"; characterId: string }
  /** Show a clue or present a testimony card that cracks `secretId` (an exchange with its owner). */
  | { kind: "show"; characterId: string; secretId: string; evidenceId?: string; testimonyId?: string }
  /** Face `characterId` with `partnerId`: `partnerId` cracks `secretId` on `characterId`'s thrown `testimonyId`. */
  | { kind: "confront"; characterId: string; partnerId: string; secretId: string; testimonyId: string };

/** The win condition the simulator plays to: the gate open, enough key clues and testimony, one from each group. */
function winnable(c: LoadedCase, g: GameState): boolean {
  const sol = c.solution;
  if (!accuseProgress(c, g).unlocked) return false;
  if (sol.keyEvidenceIds.filter((id) => g.discoveredEvidenceIds.includes(id)).length < (sol.minKeyEvidence ?? 1)) return false;
  if ((sol.keyTestimonyIds ?? []).filter((id) => g.revealedSecretIds.includes(id)).length < (sol.minKeyTestimony ?? 0)) return false;
  return (sol.keyTestimonyGroups ?? []).every((grp) => grp.some((id) => g.revealedSecretIds.includes(id)));
}

/** What to hold up to crack `sec` now: a held clue it names, else a held testimony card it names. */
function crackItem(sec: LoadedCase["characters"][number]["secrets"][number], g: GameState): { evidenceId?: string; testimonyId?: string } {
  const rc = sec.revealConditions;
  const ev = rc?.evidenceIds.find((e) => g.discoveredEvidenceIds.includes(e));
  if (ev) return { evidenceId: ev };
  const t = rc?.testimonyIds?.find((x) => g.revealedSecretIds.includes(x));
  return t ? { testimonyId: t } : {};
}

export type FastestPlan = { actions: number; steps: PlanStep[]; exact: boolean; atLeast: number };

/**
 * The fastest legal path (actions) to a won accusation, or null when the case has no progression or the search
 * budget ran out. Breadth-first over the real unlock rules: a search, an exchange with any suspect, or showing a clue
 * (also an exchange with its owner, and the only way to crack a secret). The final accusation counts as one action.
 * Exchange counts are capped at the largest number any condition looks at, so the state space stays small.
 *
 * C4 (DX8): confrontations are modelled too. Facing A with B is one action: it counts as an exchange with A only (the
 * addressed suspect; B reacting is not questioned), A may crack as in an ordinary exchange, and if A does not, A
 * throws one of A's own revealed secrets that touches one of B's lies, which can crack a B secret whose testimony
 * condition names it (one reveal per exchange). The game-wide confrontation cap (MAX_CONFRONTATION_TOTAL) is far above
 * any shortest path and is not tracked. `confrontations: false` gives the old talk/search/show-only number.
 */
export function fastestPath(c: LoadedCase, opts: { confrontations?: boolean } = {}): number | null {
  const p = fastestPlan(c, opts);
  return p?.exact ? p.actions : null;
}

/**
 * Phase 8 (6.3): fastestPath with the path itself (search / talk / show / confront steps; the accusation is the last
 * action and is not a step). null: no progression, or no win reachable.
 *
 * Exact, and much smaller than a plain breadth-first search over exchange counts: a talk only matters through the
 * thresholds conditions name, so talks are explored only up to each suspect's largest named threshold, and the accuse
 * gate's "question N suspects M times" is met by talks deferred to the end (a talk has no prerequisite and changes
 * nothing else, so moving it later never costs anything). A state's cost is its depth plus those deferred talks;
 * the search runs until no shallower state can beat the best found.
 *
 * When the budget runs out the result is still a winning plan (a greedy one, so the smoke run can play it) with
 * exact: false, and atLeast is the proven floor (no plan shorter than it exists).
 */
export function fastestPlan(c: LoadedCase, opts: { confrontations?: boolean } = {}): FastestPlan | null {
  if (!usesProgression(c)) return null;
  const ids = c.characters.map((ch) => ch.id);
  const named = new Map<string, number>(ids.map((id) => [id, 0]));
  const scan = (cond?: Condition) => cond?.interrogated?.forEach((x) => named.set(x.characterId, Math.max(named.get(x.characterId) ?? 0, x.minExchanges ?? 1)));
  c.locations.forEach((l) => scan(l.requires));
  c.evidence.forEach((e) => scan(e.requires));
  (c.leads ?? []).forEach((l) => (scan(l.opensWhen), scan(l.closesWhen)));
  const sq = c.accuseGate?.minSuspectsQuestioned;
  const cap = (id: string) => Math.max(named.get(id) ?? 0, sq?.minExchanges ?? 0, 1);
  const bump = (g: GameState, id: string) => (g.characters[id].interrogationCount = Math.min(cap(id), g.characters[id].interrogationCount + 1));
  const start = emptyGame(c);
  const base = (g: GameState) => [[...g.discoveredEvidenceIds].sort(), [...g.searchedLocationIds].sort(), [...g.revealedSecretIds].sort()].map((x) => x.join(",")).join("|");
  const counts = (g: GameState) => ids.map((id) => g.characters[id].interrogationCount);
  const key = (g: GameState) => `${base(g)}|${counts(g).join(",")}`;
  // Dominance: with the same clues, rooms and secrets, a state whose every exchange count is at least another's is
  // never worse (every condition is "at least"), so a state dominated by one already seen (no deeper) is skipped.
  const kept = new Map<string, number[][]>();
  const dominated = (g: GameState) => {
    const b = base(g);
    const v = counts(g);
    const list = kept.get(b) ?? [];
    if (list.some((w) => w.every((x, i) => x >= v[i]))) return true;
    kept.set(b, [...list.filter((w) => !w.every((x, i) => v[i] >= x)), v]);
    return false;
  };
  const clone = (g: GameState): GameState => ({
    ...g,
    discoveredEvidenceIds: [...g.discoveredEvidenceIds],
    searchedLocationIds: [...g.searchedLocationIds],
    revealedSecretIds: [...g.revealedSecretIds],
    characters: Object.fromEntries(ids.map((id) => [id, { ...g.characters[id] }])),
  });
  /** The talks still owed to the "questioned" gate (cheapest suspects first), or null when this state cannot win. */
  const owed = (g: GameState): string[] | null => {
    const extra: string[] = [];
    let probe = g;
    if (sq) {
      const short = ids.map((id) => ({ id, need: Math.max(0, sq.minExchanges - g.characters[id].interrogationCount) })).sort((a, b) => a.need - b.need);
      probe = clone(g);
      for (const { id, need } of short.slice(0, sq.count)) {
        for (let n = 0; n < need; n++) extra.push(id);
        probe.characters[id].interrogationCount += need;
      }
    }
    return winnable(c, probe) ? extra : null;
  };
  // Admissible bound on the actions still needed: each action reveals at most one secret and adds at most one exchange.
  const gate = c.accuseGate;
  const lower = (g: GameState) => {
    const secrets = Math.max(0, (gate?.minRevealedSecrets ?? 0) - g.revealedSecretIds.length);
    const talks = sq ? ids.map((id) => Math.max(0, sq.minExchanges - g.characters[id].interrogationCount)).sort((a, b) => a - b).slice(0, sq.count).reduce((a, b) => a + b, 0) : 0;
    // A search adds no exchange and a talk or crack adds no clue, so the searches the clue deficit needs add: k searches
    // find at most the k largest rooms' remaining clues (searching a room twice cannot beat its total).
    let deficit = (gate?.minEvidence ?? 0) - g.discoveredEvidenceIds.length;
    let clues = 0;
    if (deficit > 0) {
      const left = c.locations.map((l) => c.evidence.filter((e) => e.locationId === l.id && !g.discoveredEvidenceIds.includes(e.id)).length).sort((x, y) => y - x);
      for (const n of left) {
        if (deficit <= 0) break;
        deficit -= n;
        clues++;
      }
    }
    return Math.max(1, Math.max(secrets, talks) + clues);
  };
  type Node = { game: GameState; steps: number; k: string };
  /** A quick upper bound for the pruning: crack whatever cracks, else search a room that yields, else talk. */
  function greedyPlan(): { actions: number; steps: PlanStep[] } | null {
    let g = clone(start);
    const steps: PlanStep[] = [];
    for (let n = 0; n < 200; n++) {
      const extra = owed(g);
      if (extra) return { actions: steps.length + extra.length + 1, steps: [...steps, ...extra.map((characterId): PlanStep => ({ kind: "talk", characterId }))] };
      const states = leadStates(c, g);
      const crack = c.characters.flatMap((ch) => ch.secrets.filter((sec) => crackable(sec, core, g.discoveredEvidenceIds, g.revealedSecretIds)).map((sec) => ({ ch, sec })))[0];
      const room = c.locations.find(
        (loc) =>
          isUnlocked(loc, g, states) &&
          (!g.searchedLocationIds.includes(loc.id) || c.evidence.some((e) => e.locationId === loc.id && !g.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, g, states))),
      );
      const talk = ids.find((id) => g.characters[id].interrogationCount < (named.get(id) ?? 0));
      const nx = clone(g);
      if (crack) {
        nx.revealedSecretIds.push(crack.sec.id);
        bump(nx, crack.ch.id);
        steps.push({ kind: "show", characterId: crack.ch.id, secretId: crack.sec.id, ...crackItem(crack.sec, g) });
      } else if (room) {
        if (!nx.searchedLocationIds.includes(room.id)) nx.searchedLocationIds.push(room.id);
        for (const e of c.evidence) if (e.locationId === room.id && !nx.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, g, states)) nx.discoveredEvidenceIds.push(e.id);
        steps.push({ kind: "search", locationId: room.id });
      } else if (talk) {
        bump(nx, talk);
        steps.push({ kind: "talk", characterId: talk });
      } else return null;
      g = nx;
    }
    return null;
  }
  const core = coreGuiltSecretIds(c);
  const startKey = key(start);
  const unwind = (parent: Map<string, { from: string; step: PlanStep } | null>, k: string): PlanStep[] => {
    const out: PlanStep[] = [];
    for (let p = parent.get(k); p; p = parent.get(p.from)) out.unshift(p.step);
    return out;
  };
  let spent = 0;
  /** Best plan of at most `limit` actions, "none" when there is none, "budget" when the search ran out. */
  const search = (limit: number): { actions: number; steps: PlanStep[] } | "none" | "budget" => {
    const parent = new Map<string, { from: string; step: PlanStep } | null>([[startKey, null]]);
    const seen = new Set([startKey]);
    kept.clear();
    dominated(start);
    let best: { actions: number; steps: PlanStep[] } | null = null;
    let bound = limit + 1; // only plans shorter than this count
    let frontier: Node[] = [{ game: start, steps: 0, k: startKey }];
    while (frontier.length && frontier[0].steps + 1 < bound) {
      const next: Node[] = [];
      for (const { game, steps, k: from } of frontier) {
        const extra = owed(game);
        if (extra && steps + extra.length + 1 < bound) {
          best = { actions: steps + extra.length + 1, steps: [...unwind(parent, from), ...extra.map((characterId): PlanStep => ({ kind: "talk", characterId }))] };
          bound = best.actions;
        }
        if (steps + 1 + lower(game) >= bound) continue; // nothing below this node can beat the bound
        const states = leadStates(c, game);
        const push = (g: GameState, step: PlanStep) => {
          const k = key(g);
          if (seen.has(k) || dominated(g)) return;
          seen.add(k);
          parent.set(k, { from, step });
          next.push({ game: g, steps: steps + 1, k });
        };
        // Search a room (state before the action decides what it yields).
        for (const loc of c.locations) {
          if (!isUnlocked(loc, game, states)) continue;
          const g = clone(game);
          if (!g.searchedLocationIds.includes(loc.id)) g.searchedLocationIds.push(loc.id);
          for (const e of c.evidence) if (e.locationId === loc.id && !g.discoveredEvidenceIds.includes(e.id) && isUnlocked(e, game, states)) g.discoveredEvidenceIds.push(e.id);
          push(g, { kind: "search", locationId: loc.id });
        }
        // An ordinary exchange, only while it can still pass a threshold a condition names (gate talks are deferred).
        for (const id of ids) {
          if (game.characters[id].interrogationCount >= (named.get(id) ?? 0)) continue;
          const g = clone(game);
          bump(g, id);
          push(g, { kind: "talk", characterId: id });
        }
        // Show a clue (or present a testimony card) that cracks one of that suspect's secrets (an exchange too). Never core guilt.
        for (const ch of c.characters) {
          for (const sec of ch.secrets) {
            if (!crackable(sec, core, game.discoveredEvidenceIds, game.revealedSecretIds)) continue;
            const g = clone(game);
            g.revealedSecretIds.push(sec.id);
            bump(g, ch.id);
            push(g, { kind: "show", characterId: ch.id, secretId: sec.id, ...crackItem(sec, game) });
          }
        }
        // C4: confront A with B. A's exchange (or A's crack) is covered above; what is new is B cracking on A's thrown
        // testimony in the same action, without an exchange of B's own.
        if (opts.confrontations !== false) {
          for (const a of c.characters) {
            const thrown = a.secrets.map((s) => s.id).filter((id) => game.revealedSecretIds.includes(id));
            if (!thrown.length) continue;
            for (const b of c.characters) {
              if (b.id === a.id) continue;
              const cards = thrown.filter((id) => liesTouchedByTestimony(c, b, id).length > 0);
              for (const sec of b.secrets) {
                if (!crackable(sec, core, game.discoveredEvidenceIds, game.revealedSecretIds)) continue;
                const card = cards.find((t) => sec.revealConditions?.testimonyIds?.includes(t));
                if (!card) continue;
                const g = clone(game);
                g.revealedSecretIds.push(sec.id);
                bump(g, a.id);
                push(g, { kind: "confront", characterId: a.id, partnerId: b.id, secretId: sec.id, testimonyId: card });
              }
            }
          }
        }
        if (spent + seen.size > FASTEST_PATH_BUDGET) return "budget";
      }
      frontier = next;
    }
    spent += seen.size;
    return best ?? "none";
  };
  // Iterative tightening: the first limit (from the admissible bound up) with a plan gives the fastest one; a tight
  // limit prunes far harder than the greedy upper bound alone.
  const greedy = greedyPlan();
  if (!greedy) {
    // Only a confrontation-only reveal can defeat the greedy pass; search with no upper bound then.
    const r = search(200);
    return r === "none" || r === "budget" ? null : { ...r, exact: true, atLeast: r.actions };
  }
  for (let limit = lower(start) + 1; limit < greedy.actions; limit++) {
    const r = search(limit);
    if (r === "budget") return { ...greedy, exact: false, atLeast: limit };
    if (r !== "none") return { ...r, exact: true, atLeast: r.actions };
  }
  return { ...greedy, exact: true, atLeast: greedy.actions };
}
