/**
 * Lies broken by testimony, and the notebook's testimony cards. Pure and deterministic.
 *
 * A revealed secret becomes TESTIMONY the detective can present to any
 * character, just like a clue. A character learns of it only when the player
 * CONFRONTS them with it (presentedTestimonyId); nothing spreads by itself.
 *
 * An intended lie is broken for its owner when its break conditions hold:
 *  - each brokenByEvidenceIds id: that clue has been shown to the owner;
 *  - each breaksOnSecretIds id: that secret (anyone's) is revealed AND has been
 *    presented to the owner as testimony;
 *  - each breaksOnFactIds id: some testimony presented to the owner is a
 *    revealed secret whose relatedFactIds include that fact.
 * breakMode "any" (default): one condition suffices; "all": every listed one.
 */
import type { LoadedCase } from "./case-schema";
import type { Character, CharacterRuntimeState, GameState, IntendedLie, Secret } from "./types";

export type LieState = Pick<CharacterRuntimeState, "evidenceShownIds"> & Partial<Pick<CharacterRuntimeState, "testimonyShownIds">>;

/** Every secret in the case by id, with its owner. */
export function secretIndex(c: Pick<LoadedCase, "characters">): Map<string, { secret: Secret; owner: Character }> {
  const m = new Map<string, { secret: Secret; owner: Character }>();
  for (const owner of c.characters) for (const secret of owner.secrets) if (!m.has(secret.id)) m.set(secret.id, { secret, owner });
  return m;
}

/** Facts made public by the given secrets (their relatedFactIds). */
function factsFrom(c: Pick<LoadedCase, "characters">, secretIds: readonly string[]): Set<string> {
  const idx = secretIndex(c);
  const out = new Set<string>();
  for (const id of secretIds) idx.get(id)?.secret.relatedFactIds.forEach((f) => out.add(f));
  return out;
}

/** Is this lie broken for its owner, given the owner's runtime state? */
export function isLieBroken(c: Pick<LoadedCase, "characters">, lie: IntendedLie, rt: LieState | undefined): boolean {
  const shown = new Set(rt?.evidenceShownIds ?? []);
  const testimony = rt?.testimonyShownIds ?? [];
  const heard = new Set(testimony);
  const facts = lie.breaksOnFactIds.length ? factsFrom(c, testimony) : new Set<string>();
  const results = [
    ...lie.brokenByEvidenceIds.map((id) => shown.has(id)),
    ...lie.breaksOnSecretIds.map((id) => heard.has(id)),
    ...lie.breaksOnFactIds.map((id) => facts.has(id)),
  ];
  if (results.length === 0) return false;
  return lie.breakMode === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** Ids of this character's intended lies that are broken now. */
export function brokenLieIds(c: Pick<LoadedCase, "characters">, ch: Character, rt: LieState | undefined): string[] {
  return ch.intendedLies.filter((l) => isLieBroken(c, l, rt)).map((l) => l.id);
}

/** Lies of `ch` that presenting testimony `secretId` would satisfy a condition of (whether or not that alone breaks them). */
export function liesTouchedByTestimony(c: Pick<LoadedCase, "characters">, ch: Character, secretId: string): IntendedLie[] {
  const facts = factsFrom(c, [secretId]);
  return ch.intendedLies.filter((l) => l.breaksOnSecretIds.includes(secretId) || l.breaksOnFactIds.some((f) => facts.has(f)));
}

/** Case-wide revealed secrets: the game-level set plus every character's own (legacy states lack the former). */
export function revealedSecretIds(game: Pick<GameState, "revealedSecretIds" | "characters">): string[] {
  const out = new Set(game.revealedSecretIds ?? []);
  for (const rt of Object.values(game.characters)) rt.revealedSecretIds.forEach((id) => out.add(id));
  return [...out];
}

/** PUBLIC notebook card for a revealed secret. Never built for a locked one. */
export interface PublicTestimony {
  /** The revealed secret's id (what the client sends back as presentedTestimonyId). */
  id: string;
  /** Who admitted it. */
  characterId: string;
  characterName: string;
  /** Spoiler-safe summary (authored testimonySummary, or a generic line). */
  summary: string;
}

export function testimonyFallback(ownerName: string): string {
  return `${ownerName} admitted something under questioning.`;
}

/** Testimony cards for every revealed secret, in reveal order. */
export function publicTestimonies(c: Pick<LoadedCase, "characters">, game: Pick<GameState, "revealedSecretIds" | "characters">): PublicTestimony[] {
  const idx = secretIndex(c);
  return revealedSecretIds(game)
    .map((id) => idx.get(id))
    .filter((x): x is { secret: Secret; owner: Character } => Boolean(x))
    .map(({ secret, owner }) => ({
      id: secret.id,
      characterId: owner.id,
      characterName: owner.name,
      summary: secret.testimonySummary ?? testimonyFallback(owner.name),
    }));
}
