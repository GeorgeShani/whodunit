/**
 * Investigate step (spec §46): deterministic location search. Pure; no model.
 * Searching a location reveals every evidence item whose locationId matches.
 * All locations are searchable from the start; repeat searches are idempotent.
 */
import type { LoadedCase } from "./case-schema";
import { isUnlocked, leadStates } from "./progress";
import type { Evidence, GameState } from "./types";

export interface SearchResult {
  locationId: string;
  /** Evidence discovered by THIS search (was not discovered before). */
  newlyFound: Evidence[];
  /** Was this location searched before this call? */
  alreadySearched: boolean;
  /** Public flavour lines to show. */
  lines: string[];
  /** The room is closed for now (its `requires` is unmet): nothing was searched or found. */
  locked?: boolean;
}

export const defaultLockedLine = (locationName: string) => `${locationName} is closed to you for now, detective. Try something else first.`;

export const defaultEmptyLine = (locationName: string) =>
  `You turn ${locationName} upside down, check under every cushion twice... and find nothing new.`;

/** Search a location. Mutates `game` (discoveredEvidenceIds, searchedLocationIds). Caller checks the id exists. */
export function searchLocation(caseData: LoadedCase, game: GameState, locationId: string): SearchResult {
  const loc = caseData.locations.find((l) => l.id === locationId);
  if (!loc) throw new Error(`searchLocation: unknown location "${locationId}"`);

  const alreadySearched = game.searchedLocationIds.includes(locationId);
  const discovered = new Set(game.discoveredEvidenceIds);
  // Progression: every condition is checked against the state BEFORE this action, so one search can't chain two unlocks.
  const states = leadStates(caseData, game);
  if (!isUnlocked(loc, game, states)) {
    return { locationId, newlyFound: [], alreadySearched, lines: [loc.lockedLine ?? defaultLockedLine(loc.name)], locked: true };
  }
  const here = caseData.evidence.filter((e) => e.locationId === locationId && !discovered.has(e.id));
  const newlyFound = here.filter((e) => isUnlocked(e, game, states));
  const lockedLines = here.filter((e) => !isUnlocked(e, game, states) && e.lockedLine).map((e) => e.lockedLine as string);
  for (const e of newlyFound) game.discoveredEvidenceIds.push(e.id);
  if (!alreadySearched) game.searchedLocationIds.push(locationId);

  const empty = loc.searchFlavor?.emptyLine ?? defaultEmptyLine(loc.name);
  let lines: string[];
  // A search that skipped a locked clue says so instead of "nothing new".
  const nothing = newlyFound.length === 0 && lockedLines.length === 0;
  if (!alreadySearched) {
    lines = [...(loc.searchFlavor?.lines ?? [])];
    if (nothing) lines.push(empty);
  } else {
    lines = newlyFound.length ? [...(loc.searchFlavor?.lines ?? [])] : nothing ? [empty] : [];
  }
  lines.push(...lockedLines);
  if (lines.length === 0) lines = [`You search ${loc.name} from top to bottom.`];
  return { locationId, newlyFound, alreadySearched, lines };
}
