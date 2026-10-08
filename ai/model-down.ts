/**
 * When the model cannot answer (no credits, rate limit, timeout, network, an unusable reply) the game does NOT
 * improvise a character line and does NOT spend the turn. The server answers with `unavailable` (this file's kinds
 * and lines), the signed state token it was sent, and the client shows a narrator line plus a retry button.
 *
 * Pure and client-safe: used by the server handlers and by the browser when the request itself fails.
 * Tone: period and in-fiction (a storm, a telephone line, a hesitating suspect), never "AI", "error" or "server",
 * and never an accusation that anything is broken. "busy" is a moment's hesitation; "quiet" is a longer lull.
 */
export type ModelDownKind = "busy" | "quiet";
/**
 * Why no reply came: the model hesitated ("busy") or is out for a while ("quiet"), the per-player rate limit
 * ("breather", see ai/model-gate.ts), or this exact state was already answered ("answered", a duplicate request).
 */
export type UnavailableKind = ModelDownKind | "breather" | "answered";

export interface Unavailable {
  kind: UnavailableKind;
  /** Narrator line for the log. */
  line: string;
  /** Seconds before asking again can succeed ("breather" only). */
  retryAfter?: number;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "They";

const BUSY: readonly ((n: string) => string)[] = [
  (n) => `${n} falters and asks for a moment to collect their thoughts. Give it a breath, detective, then ask again.`,
  (n) => `A crack of thunder swallows ${n}'s answer whole. Nobody caught a word. Ask again, detective.`,
  (n) => `The old house creaks and ${n} hesitates, the words won't come. A moment, detective, then try once more.`,
];

const QUIET: readonly ((n: string) => string)[] = [
  (n) => `The telephone line is down for the night and ${n} won't be drawn. Search the rooms, check your notebook, or accuse; talk resumes when it's mended.`,
  (n) => `The storm has cut the lines and ${n} has gone silent. Search the rooms, go over the notebook, or accuse, and ask again later.`,
];

/** The in-fiction line for an unavailable model. `seed` picks a variant deterministically. */
export function modelDownLine(kind: ModelDownKind, characterName: string, seed = 0): string {
  const list = kind === "quiet" ? QUIET : BUSY;
  return list[Math.abs(Math.trunc(seed)) % list.length](first(characterName));
}

export function unavailable(kind: ModelDownKind, characterName: string, seed = 0): Unavailable {
  return { kind, line: modelDownLine(kind, characterName, seed) };
}

const minutes = (seconds: number) => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
};

/** The per-player rate limit (HTTP 429): nothing was spent; ask again after `retryAfter` seconds. */
export function breatherLine(characterName: string, retryAfterSec: number): string {
  return `${first(characterName)} needs a breather, detective. Give them ${minutes(retryAfterSec)}, then ask again.`;
}

export function confrontBreatherLine(a: string, b: string, retryAfterSec: number): string {
  return `${first(a)} and ${first(b)} need a breather, detective. Give them ${minutes(retryAfterSec)}, then put it to them again.`;
}

/** A duplicate of a request already answered (HTTP 409): the client is handed the newest state. */
export function answeredLine(characterName: string): string {
  return `${first(characterName)} gives you an odd look: "I've only just answered that, detective." Your notes are up to date now; ask again if you wish.`;
}

/** A duplicate of a request that is still being answered (HTTP 409). */
export function stillAnsweringLine(characterName: string): string {
  return `${first(characterName)} is still answering your last question, detective. One thing at a time.`;
}

/** Read an `unavailable` object from a response body (unknown kinds read as "busy"). */
export function parseUnavailable(u: unknown): Unavailable | null {
  const o = u as { kind?: unknown; line?: unknown; retryAfter?: unknown } | null;
  if (!o || typeof o.line !== "string") return null;
  const kind: UnavailableKind = o.kind === "quiet" || o.kind === "breather" || o.kind === "answered" ? o.kind : "busy";
  return { kind, line: o.line, ...(typeof o.retryAfter === "number" && o.retryAfter > 0 ? { retryAfter: o.retryAfter } : {}) };
}

/** The narrator line to show for an `unavailable` reply; a repeated "busy"/"quiet" gets the shorter follow-up. */
export function downLineFor(u: Unavailable, isRetry: boolean): string {
  return isRetry && (u.kind === "busy" || u.kind === "quiet") ? stillDownLine(u.kind) : u.line;
}

/** Shown instead of repeating the first line when the player has asked again and it still did not go through. */
export function stillDownLine(kind: ModelDownKind): string {
  return kind === "quiet"
    ? "The line is still dead. The notebook and the rooms of the house are better company for now, detective."
    : "Still nothing. Perhaps a little longer, detective.";
}

/** Confrontations are two voices at once, so the line is about the pair. */
export function confrontDownLine(kind: ModelDownKind, a: string, b: string): string {
  const names = `${first(a)} and ${first(b)}`;
  return kind === "quiet"
    ? `The telephone line is down for the night and ${names} will say nothing more just now. Search the rooms, check your notebook, or make your accusation; they will talk when the line is mended.`
    : `Thunder rolls through the hall and ${names} both lose the thread. Nobody caught a word. Put it to them again, detective.`;
}

/**
 * #49: seconds to wait before AGAIN can succeed, from a "breather" (429) reply: the body's `retryAfter`, else the
 * `Retry-After` header (delta seconds or an HTTP date). Other kinds have no wait.
 */
export function retryWaitSeconds(u: Unavailable, header?: string | null, now = Date.now()): number | undefined {
  if (u.kind !== "breather") return undefined;
  if (u.retryAfter && u.retryAfter > 0) return Math.ceil(u.retryAfter);
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  const at = Date.parse(header);
  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : undefined;
}

/** The countdown on a disabled AGAIN button: "45s", or "1:05" from a minute up. */
export function formatRetryWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * #49: what the client offers after an `unavailable` reply. "again": the AGAIN button; "wait": AGAIN disabled with a
 * countdown (a breather with a known wait); "none": the turn was already answered, so there is nothing to ask again
 * (the stored answer is shown when the server sent it).
 */
export function retryOffer(u: Unavailable, error?: unknown, waitSeconds?: number): "again" | "wait" | "none" {
  if (u.kind === "answered" && error === "already_answered") return "none";
  return waitSeconds && waitSeconds > 0 ? "wait" : "again";
}
