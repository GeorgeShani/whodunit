/** App-level case configuration (the engine itself is case-agnostic). */

/** The case served at "/" and assumed for legacy state tokens that predate caseId. */
export const DEFAULT_CASE_ID = "blackwood";

/**
 * Published-id aliases for a draft folder that was later renamed (phase 11: `_tallyho` → `tallyho`).
 * Old tokens and save rows keep the draft id; every lookup uses the canonical (published) id.
 */
export const CASE_ALIASES: Readonly<Record<string, string>> = { _tallyho: "tallyho" };

/** The published case id, if this id was renamed; otherwise the id itself. */
export function canonicalCaseId(id: string): string {
  return CASE_ALIASES[id] ?? id;
}

/** True when both ids name the same case, including a draft id and its published name. */
export function caseIdsMatch(a: string, b: string): boolean {
  return canonicalCaseId(a) === canonicalCaseId(b);
}

/** The id itself plus any draft names that alias to it (for migrating old storage keys). */
export function caseIdAliases(id: string): string[] {
  const canon = canonicalCaseId(id);
  const drafts = Object.entries(CASE_ALIASES)
    .filter(([, to]) => to === canon)
    .map(([from]) => from);
  return [...new Set([id, canon, ...drafts])];
}
