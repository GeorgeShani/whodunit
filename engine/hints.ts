/**
 * Contradiction assistance (MASTER_PLAN §31, §85 Phase 12). Pure and deterministic.
 *
 * "Surface POSSIBLE CONTRADICTION. Do NOT automatically solve the mystery. The
 * game should not tell the player which person is lying." A hint is offered
 * only when ALL of these hold, from engine state alone:
 *  - the character has TOLD the story (liesTold, engine/memory.ts), so the
 *    player has heard it and the hint can't reveal an untold lie;
 *  - the story is still standing (not broken or retired);
 *  - the player already HOLDS something that would break it (a discovered clue
 *    or revealed testimony) and hasn't put it to that character yet.
 * The hint names the character and the story's topic, never the item, the
 * lie's wording, what it means, or anything about the solution.
 * Cooldown: HINT_COOLDOWN_TURNS game turns between hints (the plan sets no cost).
 */
import type { LoadedCase } from "./case-schema";
import { isLieBroken, revealedSecretIds } from "./testimony";
import type { GameState, IntendedLie } from "./types";

export const HINT_COOLDOWN_TURNS = 3;

export interface HintCandidate {
  characterId: string;
  characterName: string;
  lieId: string;
  topic?: string;
}

/** Would the items the player holds (plus what the owner has already seen) break `lie`? */
function heldItemsBreak(c: LoadedCase, game: GameState, ownerId: string, lie: IntendedLie): boolean {
  const rt = game.characters[ownerId];
  if (!rt) return false;
  const revealed = revealedSecretIds(game);
  const imagined = {
    evidenceShownIds: [...new Set([...rt.evidenceShownIds, ...game.discoveredEvidenceIds])],
    testimonyShownIds: [...new Set([...rt.testimonyShownIds, ...revealed])],
    revealedSecretIds: rt.revealedSecretIds,
  };
  // Something NEW must be needed: if nothing unshown matters, the lie would already be broken.
  return isLieBroken(c, lie, imagined);
}

/** Every current possible contradiction, in case order (characters, then their lies). */
export function hintCandidates(c: LoadedCase, game: GameState): HintCandidate[] {
  const out: HintCandidate[] = [];
  for (const ch of c.characters) {
    const rt = game.characters[ch.id];
    if (!rt) continue;
    for (const lie of ch.intendedLies) {
      if (!rt.liesToldIds.includes(lie.id)) continue;
      if (isLieBroken(c, lie, rt)) continue;
      if (!heldItemsBreak(c, game, ch.id, lie)) continue;
      out.push({ characterId: ch.id, characterName: ch.name, lieId: lie.id, ...(lie.topic ? { topic: lie.topic } : {}) });
    }
  }
  return out;
}

/** Turns until the next hint may be given (0 = ready). */
export function hintCooldown(game: Pick<GameState, "turn" | "hintTurn">): number {
  return game.hintTurn === null ? 0 : Math.max(0, game.hintTurn + HINT_COOLDOWN_TURNS - game.turn);
}

export function hintText(h: HintCandidate): string {
  const about = h.topic ? `about ${h.topic}` : "in one of their answers";
  return `⚠ POSSIBLE CONTRADICTION: something in your notebook doesn't square with what ${h.characterName} told you ${about}. Which of them is wrong, and why, is for you to work out.`;
}

export const NO_HINT_LINE = "Nothing in your notebook clashes with anything you've been told... yet. Keep asking questions and searching the house.";

export type HintResult =
  | { kind: "hint"; hint: HintCandidate; text: string }
  | { kind: "none"; text: string }
  | { kind: "cooldown"; readyInTurns: number };

/**
 * Take one hint (mutates game.hintTurn / hintedLieIds when one is given).
 * Prefers a contradiction not hinted before; repeats the first otherwise.
 * "none" does not start the cooldown.
 */
export function takeHint(c: LoadedCase, game: GameState): HintResult {
  const wait = hintCooldown(game);
  if (wait > 0) return { kind: "cooldown", readyInTurns: wait };
  const all = hintCandidates(c, game);
  if (!all.length) return { kind: "none", text: NO_HINT_LINE };
  const hint = all.find((h) => !game.hintedLieIds.includes(h.lieId)) ?? all[0];
  if (!game.hintedLieIds.includes(hint.lieId)) game.hintedLieIds.push(hint.lieId);
  game.hintTurn = game.turn;
  return { kind: "hint", hint, text: hintText(hint) };
}
