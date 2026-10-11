/**
 * E20 (CA-64): the loss panel, "your investigation". Built from the investigation ONLY: what the player found and
 * cited against the case's key clues and key testimony, plus at most two unnamed "missed" hints in a fixed order. It
 * never reads who, what or why the solution is (murdererId, weaponId, motiveId, locationId, time) nor the grade, so
 * it is identical for every possible accusation with the same progress, and it names no unfound item.
 */
import type { LoadedCase } from "./case-schema";
import { coreGuiltSecretIds } from "./core-guilt";
import type { Accusation, GameState } from "./types";
import { isLieBroken, isLieSuperseded } from "./testimony";

export const LOSS_FEEDBACK_DEFAULTS = {
  foundClues: "You found {n} of the {m} key clues.",
  foundTestimony: "You uncovered {n} of the {m} key testimonies.",
  citedTooFew: "Your accusation cited less proof than the case needed.",
  missedRoom: "There was a room you never searched thoroughly.",
  missedSecret: "Someone still had a secret you never got out of them.",
  missedClue: "A clue that mattered never turned up.",
  untestedStory: "At least one story you heard was never put to the test.",
} as const;
export type LossFeedbackKey = keyof typeof LOSS_FEEDBACK_DEFAULTS;

type FeedbackCase = Pick<LoadedCase, "characters" | "evidence"> & {
  solution: Pick<LoadedCase["solution"], "keyEvidenceIds" | "keyTestimonyIds" | "minKeyEvidence" | "minKeyTestimony">;
  lossFeedback?: Partial<Record<LossFeedbackKey, string>>;
};

/**
 * Only the cited CLUES and TESTIMONY of the accusation are read (to say whether it cited enough proof): never the
 * accused, the weapon or the motive.
 */
export function lossFeedback(
  c: FeedbackCase,
  game: Pick<GameState, "discoveredEvidenceIds" | "revealedSecretIds" | "characters">,
  cited: Pick<Accusation, "keyEvidenceIds" | "keyTestimonyIds">,
): string[] {
  const line = (k: LossFeedbackKey, n = 0, m = 0) =>
    (c.lossFeedback?.[k] ?? LOSS_FEEDBACK_DEFAULTS[k]).replace(/\{n\}/g, String(n)).replace(/\{m\}/g, String(m));
  const found = new Set(game.discoveredEvidenceIds);
  const revealed = new Set(game.revealedSecretIds);
  const keyEv = c.solution.keyEvidenceIds;
  const keyTe = c.solution.keyTestimonyIds ?? [];
  const out = [line("foundClues", keyEv.filter((id) => found.has(id)).length, keyEv.length)];
  if (keyTe.length) out.push(line("foundTestimony", keyTe.filter((id) => revealed.has(id)).length, keyTe.length));
  const citedEv = cited.keyEvidenceIds.filter((id) => keyEv.includes(id)).length;
  const citedTe = (cited.keyTestimonyIds ?? []).filter((id) => keyTe.includes(id)).length;
  if (citedEv < (c.solution.minKeyEvidence ?? 1) || citedTe < (c.solution.minKeyTestimony ?? 0)) out.push(line("citedTooFew"));
  // Missed hints, fixed order, at most two. Core-guilt secrets never count (they never reveal, so they would point
  // at the murderer); every other suspect's secrets do.
  const core = coreGuiltSecretIds(c as never);
  const missed: LossFeedbackKey[] = [];
  if (c.evidence.some((e) => e.locationId && !found.has(e.id))) missed.push("missedRoom");
  if (c.characters.some((ch) => ch.secrets.some((s) => !core.has(s.id) && !revealed.has(s.id)))) missed.push("missedSecret");
  if (keyEv.some((id) => !found.has(id))) missed.push("missedClue");
  if (c.characters.some((ch) => ch.intendedLies.some((l) => !isLieSuperseded(l, game.characters[ch.id]) && !isLieBroken(c, l, game.characters[ch.id]))))
    missed.push("untestedStory");
  return [...out, ...missed.slice(0, 2).map((k) => line(k))];
}
