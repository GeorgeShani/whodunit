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
