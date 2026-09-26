/**
 * Investigate step (spec §46): deterministic location search. Pure; no model.
 * Searching a location reveals every evidence item whose locationId matches.
 * All locations are searchable from the start; repeat searches are idempotent.
 */
import type { LoadedCase } from "./case-schema";
import type { Evidence, GameState } from "./types";

export interface SearchResult {
  locationId: string;
  /** Evidence discovered by THIS search (was not discovered before). */
  newlyFound: Evidence[];
  /** Was this location searched before this call? */
  alreadySearched: boolean;
  /** Public flavour lines to show. */
  lines: string[];
}

export const defaultEmptyLine = (locationName: string) =>
  `You turn ${locationName} upside down, check under every cushion twice... and find nothing new.`;

/** Search a location. Mutates `game` (discoveredEvidenceIds, searchedLocationIds). Caller checks the id exists. */
export function searchLocation(caseData: LoadedCase, game: GameState, locationId: string): SearchResult {
  const loc = caseData.locations.find((l) => l.id === locationId);
  if (!loc) throw new Error(`searchLocation: unknown location "${locationId}"`);

  const alreadySearched = game.searchedLocationIds.includes(locationId);
  const discovered = new Set(game.discoveredEvidenceIds);
  const newlyFound = caseData.evidence.filter((e) => e.locationId === locationId && !discovered.has(e.id));
  for (const e of newlyFound) game.discoveredEvidenceIds.push(e.id);
  if (!alreadySearched) game.searchedLocationIds.push(locationId);

  const empty = loc.searchFlavor?.emptyLine ?? defaultEmptyLine(loc.name);
  let lines: string[];
  if (!alreadySearched) {
    lines = [...(loc.searchFlavor?.lines ?? [])];
    if (newlyFound.length === 0) lines.push(empty);
  } else {
    lines = newlyFound.length ? [...(loc.searchFlavor?.lines ?? [])] : [empty];
  }
  if (lines.length === 0) lines = [`You search ${loc.name} from top to bottom.`];
  return { locationId, newlyFound, alreadySearched, lines };
}
