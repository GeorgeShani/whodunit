/**
 * Client-only persistence of an investigation across reloads (#11).
 *
 * Stores the opaque server-signed state token plus UI state (transcripts,
 * notebook, searched rooms, current screen) in sessionStorage under one key
 * per case. The token stays authoritative: the server re-verifies it on every
 * request and resets (with an in-character notice) if it was tampered with, so
 * editing this blob can't grant stress, reveals or undiscovered clues.
 */
import type { DialogueMessage } from "@/components/dialogue/DialogueLog";
import type { PublicEvidence } from "@/engine/public-view";
import type { PublicTestimony } from "@/engine/testimony";
import type { Emotion } from "@/engine/types";

export const SESSION_VERSION = 1;

export interface SavedGame {
  v: typeof SESSION_VERSION;
  caseId: string;
  screen: "suspects" | "interrogation" | "investigate";
  activeId: string | null;
  stateToken?: string;
  conversations: Record<string, DialogueMessage[]>;
  emotions: Record<string, Emotion>;
  evidence: PublicEvidence[];
  /** Testimony cards (revealed secrets' public summaries). Optional: older saves lack it. */
  testimonies?: PublicTestimony[];
  searched: string[];
  searchLines: Record<string, string[]>;
  nextId: number;
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
export function parseSavedGame(raw: string | null, caseId: string): SavedGame | null {
  if (!raw) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(j) || j.v !== SESSION_VERSION || j.caseId !== caseId) return null;
  if (!["suspects", "interrogation", "investigate"].includes(String(j.screen))) return null;
  if (!isObj(j.conversations) || !isObj(j.emotions) || !Array.isArray(j.evidence) || !Array.isArray(j.searched) || !isObj(j.searchLines)) return null;
  if (j.stateToken !== undefined && typeof j.stateToken !== "string") return null;
  return {
    v: SESSION_VERSION,
    caseId,
    screen: j.screen as SavedGame["screen"],
    activeId: typeof j.activeId === "string" ? j.activeId : null,
    ...(typeof j.stateToken === "string" ? { stateToken: j.stateToken } : {}),
    conversations: j.conversations as SavedGame["conversations"],
    emotions: j.emotions as SavedGame["emotions"],
    evidence: j.evidence as PublicEvidence[],
    ...(Array.isArray(j.testimonies) ? { testimonies: (j.testimonies as unknown[]).filter(isTestimony) } : {}),
    searched: (j.searched as unknown[]).filter((x): x is string => typeof x === "string"),
    searchLines: j.searchLines as SavedGame["searchLines"],
    nextId: typeof j.nextId === "number" ? j.nextId : 0,
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

export function clearGame(caseId: string, s: Store | null = store()): void {
  try {
    s?.removeItem(sessionKey(caseId));
  } catch {
    /* ignore */
  }
}
