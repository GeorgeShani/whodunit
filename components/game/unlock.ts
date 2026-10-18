/** Phase 10 (3.8): the public unlock links the server hands a case's page (ids, titles, hrefs; nothing secret). */
export interface UnlockLink {
  id: string;
  title: string;
  href: string;
  /** For a NEXT case: everything it needs solved (it may need more than this case). */
  unlockedBy?: string[];
}
export interface CaseUnlockInfo {
  /** case.json `unlockedBy` (all must be solved in this browser). Empty: always open. */
  unlockedBy: string[];
  /** Those cases as links (for the locked screen's "Play <title>"). */
  requires: UnlockLink[];
  /** Public cases this one opens (the win screen's "NEXT CASE", the title's "Next case" once solved). */
  next: UnlockLink[];
}
