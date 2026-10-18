/**
 * SERVER-ONLY. Which case ids may be served publicly.
 *
 * The allowlist is built from the cases/ directory listing: a folder counts
 * only if its name matches PUBLIC_CASE_ID_RE (lowercase kebab/snake case, so
 * no leading "_": _placeholder and other templates are never routable) AND it
 * contains a case.json. Request input is only ever compared against this list;
 * it is never path-joined unchecked.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CASES_DIR, getCase } from "./case-loader";
import type { LoadedCase } from "./case-schema";

export const PUBLIC_CASE_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const MAX_CASE_ID = 64;

const listings = new Map<string, readonly string[]>();

/** Sorted public case ids found in `casesDir` (memoized; cases are static files). */
export function listPublicCaseIds(casesDir = DEFAULT_CASES_DIR): readonly string[] {
  const hit = listings.get(casesDir);
  if (hit) return hit;
  let ids: string[] = [];
  try {
    ids = readdirSync(casesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.length <= MAX_CASE_ID && PUBLIC_CASE_ID_RE.test(d.name))
      .map((d) => d.name)
      .filter((id) => existsSync(path.join(casesDir, id, "case.json")))
      .sort();
  } catch {
    ids = [];
  }
  const frozen = Object.freeze(ids);
  listings.set(casesDir, frozen);
  return frozen;
}

/** True only for an id that passes the regex AND is in the directory allowlist. */
export function isPublicCaseId(id: unknown, casesDir = DEFAULT_CASES_DIR): id is string {
  return (
    typeof id === "string" &&
    id.length <= MAX_CASE_ID &&
    PUBLIC_CASE_ID_RE.test(id) &&
    listPublicCaseIds(casesDir).includes(id)
  );
}

export class UnknownCaseError extends Error {
  constructor() {
    super("Unknown case");
    this.name = "UnknownCaseError";
  }
}

/** Load an allowlisted case (memoized) or throw UnknownCaseError. */
export function getPublicCase(id: unknown, casesDir = DEFAULT_CASES_DIR): Promise<LoadedCase> {
  if (!isPublicCaseId(id, casesDir)) return Promise.reject(new UnknownCaseError());
  return getCase(id, casesDir);
}

/** Phase 10 (3.8): a public case as the unlock UI names it. */
export interface CaseLink {
  id: string;
  title: string;
  unlockedBy?: string[];
}

/**
 * Phase 10 (3.8): the unlock edges around one public case. `requires`: the public cases it lists in `unlockedBy`
 * (all must be solved; a non-public id is dropped, so such a case stays locked). `next`: the public cases whose
 * `unlockedBy` names it (the win screen's "NEXT CASE"). Public data only: ids and titles.
 */
export async function caseUnlocks(id: string, casesDir = DEFAULT_CASES_DIR): Promise<{ requires: CaseLink[]; next: CaseLink[]; unlockedBy: string[] }> {
  const all = await Promise.all(listPublicCaseIds(casesDir).map((x) => getCase(x, casesDir)));
  const self = all.find((c) => c.id === id);
  const unlockedBy = [...(self?.unlockedBy ?? [])];
  const link = (c: LoadedCase): CaseLink => ({ id: c.id, title: c.title });
  return {
    unlockedBy,
    requires: unlockedBy.flatMap((r) => all.filter((c) => c.id === r).map(link)),
    next: all.filter((c) => c.id !== id && c.unlockedBy?.includes(id)).map((c) => ({ ...link(c), unlockedBy: [...c.unlockedBy!] })),
  };
}
