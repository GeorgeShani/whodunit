/**
 * Case progression (docs/BLACKWOOD_PROGRESSION_PROPOSAL.md §5). Pure and deterministic; no model.
 *
 * Every condition reads only fields already in the signed token (discoveredEvidenceIds, searchedLocationIds,
 * revealedSecretIds, characters[id].interrogationCount) and only ever goes false -> true, so no order of play can
 * undo an unlock. Conditions are evaluated against the state BEFORE an action.
 */
import type { LoadedCase } from "./case-schema";
import type { AccuseGate, Condition, GameState, Lead, Location } from "./types";

export type LeadState = "hidden" | "open" | "closed";
export type LeadStates = Record<string, LeadState>;

const exchanges = (game: GameState, characterId: string) => game.characters[characterId]?.interrogationCount ?? 0;

/**
 * Does the condition hold? `states` resolves `leadIds` atoms (open or closed counts); build it with leadStates().
 * An atom-less condition never holds (the schema forbids it, this is the safe answer).
 */
export function evaluateCondition(cond: Condition, game: GameState, states: LeadStates = {}): boolean {
  const checks: boolean[] = [
    ...(cond.interrogated ?? []).map((i) => exchanges(game, i.characterId) >= (i.minExchanges ?? 1)),
    ...(cond.evidenceIds ?? []).map((id) => game.discoveredEvidenceIds.includes(id)),
    ...(cond.secretIds ?? []).map((id) => game.revealedSecretIds.includes(id)),
    ...(cond.searchedLocationIds ?? []).map((id) => game.searchedLocationIds.includes(id)),
    ...(cond.leadIds ?? []).map((id) => (states[id] ?? "hidden") !== "hidden"),
  ];
  if (checks.length === 0) return false;
  return cond.mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

/** Lead ids a condition refers to. */
const leadRefs = (c: Condition | undefined) => c?.leadIds ?? [];

/**
 * hidden | open | closed for every lead. Closed wins over open; a lead counts as closed as soon as its closesWhen
 * holds, even if it never opened. Leads that (wrongly) depend on each other in a cycle resolve to hidden.
 */
export function leadStates(caseData: Pick<LoadedCase, "leads">, game: GameState): LeadStates {
  const leads = new Map((caseData.leads ?? []).map((l) => [l.id, l]));
  const memo: LeadStates = {};
  const visiting = new Set<string>();
  const stateOf = (id: string): LeadState => {
    const cached = memo[id];
    if (cached) return cached;
    const lead = leads.get(id);
    if (!lead || visiting.has(id)) return "hidden";
    visiting.add(id);
    // Resolve the leads this one depends on first, so evaluateCondition sees them.
    const deps: LeadStates = {};
    for (const d of [...leadRefs(lead.opensWhen), ...leadRefs(lead.closesWhen)]) deps[d] = stateOf(d);
    const state: LeadState = evaluateCondition(lead.closesWhen, game, deps)
      ? "closed"
      : !lead.opensWhen || evaluateCondition(lead.opensWhen, game, deps)
        ? "open"
        : "hidden";
    visiting.delete(id);
    memo[id] = state;
    return state;
  };
  for (const id of leads.keys()) stateOf(id);
  return memo;
}

/** Is this room or clue unlocked right now? (No `requires`: always.) */
export function isUnlocked(item: { requires?: Condition }, game: GameState, states: LeadStates): boolean {
  return !item.requires || evaluateCondition(item.requires, game, states);
}

export interface AccuseChecklist {
  clues: { have: number; need: number };
  suspects: { have: number; need: number };
  secrets: { have: number; need: number };
}

export interface AccuseProgress {
  unlocked: boolean;
  checklist: AccuseChecklist;
  /** The first unmet item's hint; only while locked. */
  line?: string;
}

export const DEFAULT_ACCUSE_LOCKED_LINE = "The case isn't ready yet, detective. Keep digging.";

type Unmet = "evidence" | "suspects" | "secrets" | "leads";

/** Counts and the first unmet item (order: clues, suspects, secrets, leads). Never says which clue, who or why. */
export function accuseProgress(caseData: Pick<LoadedCase, "characters" | "accuseGate" | "leads">, game: GameState, states: LeadStates = leadStates(caseData, game)): AccuseProgress {
  const gate: AccuseGate | undefined = caseData.accuseGate;
  if (!gate) return { unlocked: true, checklist: { clues: { have: 0, need: 0 }, suspects: { have: 0, need: 0 }, secrets: { have: 0, need: 0 } } };
  const clues = { have: game.discoveredEvidenceIds.length, need: gate.minEvidence };
  const sq = gate.minSuspectsQuestioned;
  const suspects = {
    have: sq ? caseData.characters.filter((c) => exchanges(game, c.id) >= sq.minExchanges).length : 0,
    need: sq?.count ?? 0,
  };
  const secrets = { have: game.revealedSecretIds.length, need: gate.minRevealedSecrets ?? 0 };
  const leadsOpen = (gate.closedLeadIds ?? []).every((id) => states[id] === "closed");
  const unmet: Unmet | null =
    clues.have < clues.need ? "evidence" : suspects.have < suspects.need ? "suspects" : secrets.have < secrets.need ? "secrets" : !leadsOpen ? "leads" : null;
  const checklist = { clues, suspects, secrets };
  if (!unmet) return { unlocked: true, checklist };
  return { unlocked: false, checklist, line: gate.lockedLines?.[unmet] ?? gate.lockedLines?.default ?? DEFAULT_ACCUSE_LOCKED_LINE };
}

/** The public progress object returned by every route that returns a token (docs §5.6). */
export interface PublicProgress {
  leads: { id: string; title: string; state: "open" | "closed"; hint?: string; closedLine?: string }[];
  /** Leads that became open or closed in THIS action (state before vs after). */
  newLeadIds: string[];
  /** Rooms whose `requires` is unmet now. */
  lockedLocationIds: string[];
  accuse: AccuseProgress;
}

export function publicProgress(caseData: Pick<LoadedCase, "leads" | "locations" | "characters" | "accuseGate">, game: GameState, before?: LeadStates): PublicProgress {
  const states = leadStates(caseData, game);
  const leads = (caseData.leads ?? []).filter((l): l is Lead => states[l.id] !== "hidden");
  const prev = before ?? states;
  return {
    leads: leads.map((l) =>
      states[l.id] === "closed"
        ? { id: l.id, title: l.title, state: "closed" as const, ...(l.closedLine ? { closedLine: l.closedLine } : {}) }
        : { id: l.id, title: l.title, state: "open" as const, hint: l.hint },
    ),
    newLeadIds: leads.filter((l) => (prev[l.id] ?? "hidden") !== states[l.id]).map((l) => l.id),
    lockedLocationIds: caseData.locations.filter((l: Location) => !isUnlocked(l, game, states)).map((l) => l.id),
    accuse: accuseProgress(caseData, game, states),
  };
}
