/**
 * Phase 10 (case-two plan 3.8, George D10): which cases this browser has SOLVED, for the case unlock.
 *
 * localStorage key `whodunit:solved`, value `{ "v": 1, "cases": { "<caseId>": { "at": "<ISO time>" } } }`. Only a
 * win marks a case. Client-side pacing, not security: no stakes, no accounts, nothing new on the server (the API does
 * not enforce the unlock; plan 3.8 "Server and API"). If storage is unavailable or throws, wins are kept in memory
 * for the page's lifetime only; a corrupt value reads as "nothing solved".
 */
export const SOLVED_KEY = "whodunit:solved";

export interface SolvedRecord {
  v: 1;
  cases: Record<string, { at: string }>;
}

type Store = Pick<Storage, "getItem" | "setItem">;

const memory: SolvedRecord = { v: 1, cases: {} };

function defaultStore(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function parse(raw: string | null): SolvedRecord {
  if (!raw) return { v: 1, cases: {} };
  try {
    const o: unknown = JSON.parse(raw);
    if (!isObj(o) || o.v !== 1 || !isObj(o.cases)) return { v: 1, cases: {} };
    const cases: SolvedRecord["cases"] = {};
    for (const [id, rec] of Object.entries(o.cases)) if (/^[a-z0-9_-]{1,64}$/.test(id) && isObj(rec) && typeof rec.at === "string") cases[id] = { at: rec.at };
    return { v: 1, cases };
  } catch {
    return { v: 1, cases: {} };
  }
}

/** The solved cases (storage merged with this page's in-memory wins). */
export function readSolved(store: Store | null = defaultStore()): SolvedRecord {
  let stored: SolvedRecord = { v: 1, cases: {} };
  try {
    stored = parse(store?.getItem(SOLVED_KEY) ?? null);
  } catch {
    // storage blocked: memory only
  }
  return { v: 1, cases: { ...stored.cases, ...memory.cases } };
}

/** Record a WIN (idempotent: the first win's time is kept). */
export function markSolved(caseId: string, store: Store | null = defaultStore(), now: () => Date = () => new Date()): SolvedRecord {
  const cur = readSolved(store);
  if (cur.cases[caseId]) return cur;
  const next: SolvedRecord = { v: 1, cases: { ...cur.cases, [caseId]: { at: now().toISOString() } } };
  memory.cases[caseId] = next.cases[caseId];
  try {
    store?.setItem(SOLVED_KEY, JSON.stringify(next));
  } catch {
    // quota / blocked: the in-memory win still opens the next case for this page
  }
  return next;
}

/** Open when every case in `unlockedBy` is solved (absent or empty: always open). */
export function isUnlocked(unlockedBy: readonly string[] | undefined, solved: SolvedRecord): boolean {
  return (unlockedBy ?? []).every((id) => Boolean(solved.cases[id]));
}

/** Tests only: forget this page's in-memory wins. */
export function resetSolvedMemory(): void {
  for (const k of Object.keys(memory.cases)) delete memory.cases[k];
}
