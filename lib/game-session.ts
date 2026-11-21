/**
 * Client-only persistence of an investigation across reloads (#11).
 *
 * After saved games: the client keeps only game_id and case_id in localStorage.
 * The signed token lives on the server (and, briefly, in memory during play).
 * Old sessionStorage blobs (token + UI) are migrated once: the token is handed
 * to POST /api/resume and the blob is dropped. Dialogue transcripts are not
 * restored (accepted).
 *
 * The token stays authoritative: the server re-verifies it on every request and
 * resets (with an in-character notice) if it was tampered with, so editing a
 * leftover blob can't grant stress, reveals or undiscovered clues.
 */
import type { DialogueMessage } from "@/components/dialogue/DialogueLog";
import type { PublicTestimony } from "@/engine/testimony";
import type { PublicProgress } from "@/engine/progress";
import type { Emotion } from "@/engine/types";
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import type { ContradictionNotes } from "@/components/evidence/notebook-model";
import { canonicalCaseId, caseIdAliases } from "./cases";
import type { PublicEvidence } from "@/engine/public-view";

export const SESSION_VERSION = 1;

/** What an older saved game may hold for one clue: an id, or a whole object (rebuilt from the server on resume). */
export type StoredEvidence = PublicEvidence | string;

/** Saved-game entries worth keeping: ids and well-formed evidence objects (anything else is dropped). */
export function storedEvidence(raw: readonly unknown[]): StoredEvidence[] {
  return raw.filter(
    (x): x is StoredEvidence =>
      (typeof x === "string" && x.length > 0) || (typeof x === "object" && x !== null && typeof (x as PublicEvidence).id === "string" && typeof (x as PublicEvidence).name === "string"),
  );
}

export interface SavedGame {
  v: typeof SESSION_VERSION;
  caseId: string;
  screen: "suspects" | "interrogation" | "investigate" | "accuse" | "ending" | "confront";
  activeId: string | null;
  stateToken?: string;
  conversations: Record<string, DialogueMessage[]>;
  emotions: Record<string, Emotion>;
  /** Found clues: ids, or whole objects from older builds (only the token is migrated; resume rebuilds the notebook server-side). */
  evidence: StoredEvidence[];
  /** Testimony cards (revealed secrets' public summaries). Optional: older saves lack it. */
  testimonies?: PublicTestimony[];
  searched: string[];
  searchLines: Record<string, string[]>;
  nextId: number;
  /** Engine contradiction verdicts noted on notebook cards. Optional: older saves lack it. */
  notes?: ContradictionNotes;
  /** Leads, locked rooms and the accuse checklist as last reported (display only; the server recomputes them). */
  progress?: PublicProgress;
  /** The /api/accuse result once the case is closed (verdict, ending, solution). */
  result?: AccuseResponseBody;
  /** Engine stress per suspect, as last reported (display only; the token is authoritative). */
  stress?: Record<string, number>;
  /** Current confrontation pair and each pair's exchange count (display only; the token enforces the cap). */
  confront?: { pair: [string, string] | null; status: Record<string, { turnsUsed: number; over: boolean }> };
}

export const sessionKey = (caseId: string) => `whodunit:game:${caseId}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // storage disabled (privacy mode etc.)
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const isTestimony = (x: unknown): x is PublicTestimony =>
  isObj(x) && typeof x.id === "string" && typeof x.characterId === "string" && typeof x.characterName === "string" && typeof x.summary === "string";

/** Parse and sanity-check a saved blob; anything malformed is ignored. */
/**
 * A question whose reply never arrived (page reloaded mid-reply, #28) is not
 * kept: the saved state token predates it, so the suspect never heard it either.
 * Dropping a trailing player line keeps the transcript and the suspect's memory in step.
 */
export function withoutUnansweredQuestions(c: Record<string, DialogueMessage[]>): Record<string, DialogueMessage[]> {
  return Object.fromEntries(Object.entries(c).map(([k, msgs]) => [k, Array.isArray(msgs) && msgs.at(-1)?.speaker === "player" ? msgs.slice(0, -1) : msgs]));
}

/** Shape check for a progress block from a route response or a saved game (display data only). */
export function isPublicProgress(x: unknown): x is PublicProgress {
  return (
    isObj(x) &&
    Array.isArray(x.leads) &&
    Array.isArray(x.newLeadIds) &&
    Array.isArray(x.lockedLocationIds) &&
    isObj(x.accuse) &&
    typeof x.accuse.unlocked === "boolean" &&
    isObj(x.accuse.checklist)
  );
}

export function parseSavedGame(raw: string | null, caseId: string): SavedGame | null {
  if (!raw) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(j) || j.v !== SESSION_VERSION || j.caseId !== caseId) return null;
  if (!["suspects", "interrogation", "investigate", "accuse", "ending", "confront"].includes(String(j.screen))) return null;
  if (!isObj(j.conversations) || !isObj(j.emotions) || !Array.isArray(j.evidence) || !Array.isArray(j.searched) || !isObj(j.searchLines)) return null;
  if (j.stateToken !== undefined && typeof j.stateToken !== "string") return null;
  return {
    v: SESSION_VERSION,
    caseId,
    screen: j.screen as SavedGame["screen"],
    activeId: typeof j.activeId === "string" ? j.activeId : null,
    ...(typeof j.stateToken === "string" ? { stateToken: j.stateToken } : {}),
    conversations: withoutUnansweredQuestions(j.conversations as SavedGame["conversations"]),
    emotions: j.emotions as SavedGame["emotions"],
    evidence: storedEvidence(j.evidence as unknown[]),
    ...(Array.isArray(j.testimonies) ? { testimonies: (j.testimonies as unknown[]).filter(isTestimony) } : {}),
    searched: (j.searched as unknown[]).filter((x): x is string => typeof x === "string"),
    searchLines: j.searchLines as SavedGame["searchLines"],
    nextId: typeof j.nextId === "number" ? j.nextId : 0,
    ...(isObj(j.notes) ? { notes: j.notes as ContradictionNotes } : {}),
    ...(isObj(j.confront) && isObj(j.confront.status) && (j.confront.pair === null || (Array.isArray(j.confront.pair) && j.confront.pair.length === 2 && j.confront.pair.every((x) => typeof x === "string")))
      ? { confront: j.confront as SavedGame["confront"] }
      : {}),
    ...(isObj(j.stress) ? { stress: Object.fromEntries(Object.entries(j.stress).filter(([, v]) => typeof v === "number" && v >= 0 && v <= 100)) as Record<string, number> } : {}),
    ...(isPublicProgress(j.progress) ? { progress: j.progress } : {}),
    ...(isObj(j.result) && (j.result.outcome === "won" || j.result.outcome === "lost") && isObj(j.result.ending) && isObj(j.result.accusation) ? { result: j.result as AccuseResponseBody } : {}),
  };
}

export function loadGame(caseId: string, s: Store | null = store()): SavedGame | null {
  try {
    return parseSavedGame(s?.getItem(sessionKey(caseId)) ?? null, caseId);
  } catch {
    return null;
  }
}

export function saveGame(g: SavedGame, s: Store | null = store()): void {
  try {
    s?.setItem(sessionKey(g.caseId), JSON.stringify(g));
  } catch {
    /* quota or disabled: persistence is best effort */
  }
}

export function clearGame(caseId: string, s: Store | null = store(), local: Store | null = localStore()): void {
  try {
    s?.removeItem(sessionKey(caseId));
    clearSavePointer(caseId, local, s);
  } catch {
    /* ignore */
  }
}


/** localStorage pointer: only the server-minted game id and the case id. Never a token, never put in a URL. */
export const SAVE_POINTER_VERSION = 1;
export const savePointerKey = (caseId: string) => `whodunit:save:${canonicalCaseId(caseId)}`;

export interface SavePointer {
  v: typeof SAVE_POINTER_VERSION;
  gameId: string;
  caseId: string;
}

function localStore(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parseSavePointer(raw: string | null, caseId: string): SavePointer | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!isObj(j) || j.v !== SAVE_POINTER_VERSION) return null;
    if (typeof j.gameId !== "string" || typeof j.caseId !== "string") return null;
    if (canonicalCaseId(j.caseId) !== canonicalCaseId(caseId)) return null;
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(j.gameId)) return null;
    return { v: SAVE_POINTER_VERSION, gameId: j.gameId, caseId: canonicalCaseId(j.caseId) };
  } catch {
    return null;
  }
}

export function loadSavePointer(caseId: string, local: Store | null = localStore(), session: Store | null = store()): { pointer: SavePointer | null; legacyToken?: string } {
  for (const id of caseIdAliases(caseId)) {
    const pointer = parseSavePointer(local?.getItem(savePointerKey(id)) ?? null, caseId);
    if (pointer) return { pointer };
  }
  // Migrate a pre-deploy sessionStorage blob: keep the token only long enough to resume, then drop the blob.
  for (const id of caseIdAliases(caseId)) {
    const saved = parseSavedGame(session?.getItem(sessionKey(id)) ?? null, id) ?? parseSavedGame(session?.getItem(sessionKey(id)) ?? null, caseId);
    if (!saved?.stateToken) continue;
    try {
      session?.removeItem(sessionKey(id));
    } catch {
      /* ignore */
    }
    return { pointer: null, legacyToken: saved.stateToken };
  }
  return { pointer: null };
}

export function writeSavePointer(pointer: SavePointer, local: Store | null = localStore()): void {
  try {
    local?.setItem(savePointerKey(pointer.caseId), JSON.stringify({ ...pointer, caseId: canonicalCaseId(pointer.caseId) }));
  } catch {
    /* quota or disabled: persistence is best effort */
  }
}

export function clearSavePointer(caseId: string, local: Store | null = localStore(), session: Store | null = store()): void {
  try {
    for (const id of caseIdAliases(caseId)) {
      local?.removeItem(savePointerKey(id));
      session?.removeItem(sessionKey(id));
      session?.removeItem(tokenFallbackKey(id));
    }
  } catch {
    /* ignore */
  }
}

/** Tab-scoped leftover token so a refresh can fall back if the cabinet is stuck. Dropped when the tab closes. */
export const tokenFallbackKey = (caseId: string) => `whodunit:token:${canonicalCaseId(caseId)}`;

export function writeTokenFallback(caseId: string, token: string, session: Store | null = store()): void {
  try {
    session?.setItem(tokenFallbackKey(caseId), token);
  } catch {
    /* ignore */
  }
}

export function readTokenFallback(caseId: string, session: Store | null = store()): string | undefined {
  try {
    for (const id of caseIdAliases(caseId)) {
      const t = session?.getItem(tokenFallbackKey(id));
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function clearTokenFallback(caseId: string, session: Store | null = store()): void {
  try {
    for (const id of caseIdAliases(caseId)) session?.removeItem(tokenFallbackKey(id));
  } catch {
    /* ignore */
  }
}
