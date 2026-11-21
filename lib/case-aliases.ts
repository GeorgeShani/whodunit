/**
 * Canonical ids for cases that were renamed (draft folder `_tallyho` → published `tallyho`).
 * Keep this module tiny and self-contained so a parallel saves PR can add the same map
 * with only a trivial merge.
 */
export const CASE_ALIASES: Readonly<Record<string, string>> = {
  _tallyho: "tallyho",
};

/** Map a request or stored case id onto the published folder id. */
export function canonicalCaseId(id: string): string {
  return CASE_ALIASES[id] ?? id;
}
