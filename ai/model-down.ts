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

export interface Unavailable {
  kind: ModelDownKind;
  /** Narrator line for the log. */
  line: string;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || "They";

const BUSY: readonly ((n: string) => string)[] = [
  (n) => `${n} opens their mouth, falters, and asks for a moment to collect their thoughts. Give it a breath, detective, then put the question again.`,
  (n) => `A crack of thunder swallows ${n}'s answer whole. Nobody caught a word of it. Ask again, detective.`,
  (n) => `The old house creaks, and ${n} hesitates as if the words won't come. A moment, detective, then try once more.`,
];

const QUIET: readonly ((n: string) => string)[] = [
  (n) => `The telephone exchange has gone quiet for the night, and ${n} will not be drawn just now. The house still holds its secrets: search the rooms, study your notebook, or make your accusation. Conversation will resume when the line is mended.`,
  (n) => `The storm has taken the lines down and ${n} has gone silent. There is still plenty to do: search the rooms, go over the notebook, or put your accusation. Try asking again in a little while.`,
];

/** The in-fiction line for an unavailable model. `seed` picks a variant deterministically. */
export function modelDownLine(kind: ModelDownKind, characterName: string, seed = 0): string {
  const list = kind === "quiet" ? QUIET : BUSY;
  return list[Math.abs(Math.trunc(seed)) % list.length](first(characterName));
}

export function unavailable(kind: ModelDownKind, characterName: string, seed = 0): Unavailable {
  return { kind, line: modelDownLine(kind, characterName, seed) };
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
    ? `The telephone exchange has gone quiet for the night and ${names} will say nothing more just now. Search the rooms, study your notebook, or make your accusation; they will talk again when the line is mended.`
    : `Thunder rolls through the hall and ${names} both lose the thread. Nobody caught a word. Put it to them again, detective.`;
}
