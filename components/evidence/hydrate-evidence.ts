/**
 * The notebook is rebuilt by clue id from a current public source (the page's case view, or the server's notebook),
 * never trusted as stored. A stored copy can predate a public field (e.g. `weapon`, which the accuse form's weapon
 * picker filters on), so a fresher object for the same id always wins.
 */
import type { PublicEvidence } from "@/engine/public-view";

/** What a saved game may hold for one clue: an id, or a whole object from an older build. */
export type StoredEvidence = PublicEvidence | string;

const isEvidence = (x: unknown): x is PublicEvidence =>
  typeof x === "object" && x !== null && typeof (x as PublicEvidence).id === "string" && typeof (x as PublicEvidence).name === "string";

/** Saved-game entries worth keeping: ids and well-formed evidence objects (anything else is dropped). */
export function storedEvidence(raw: readonly unknown[]): StoredEvidence[] {
  return raw.filter((x): x is StoredEvidence => (typeof x === "string" && x.length > 0) || isEvidence(x));
}

/**
 * Rebuild `stored` by id from `catalog`: a catalog object replaces the stored one; a stored object the catalog
 * doesn't know is kept as-is (until the server's notebook arrives); a bare id the catalog doesn't know is dropped.
 * Duplicates collapse to the first.
 */
export function hydrateEvidence(stored: readonly StoredEvidence[], catalog: readonly PublicEvidence[]): PublicEvidence[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const out: PublicEvidence[] = [];
  const seen = new Set<string>();
  for (const s of stored) {
    const id = typeof s === "string" ? s : s.id;
    if (seen.has(id)) continue;
    const e = byId.get(id) ?? (typeof s === "string" ? undefined : s);
    if (!e) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** The server's notebook for the token: authoritative (replaces the list; ids it doesn't hold are dropped). */
export function parseNotebook(json: unknown): PublicEvidence[] | null {
  const ev = typeof json === "object" && json !== null ? (json as { evidence?: unknown }).evidence : undefined;
  return Array.isArray(ev) ? ev.filter(isEvidence) : null;
}
