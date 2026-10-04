/** Engine-side runtime state helpers. */
import type { LoadedCase } from "./case-schema";
import { GameStateSchema, type GameState } from "./types";

/** Server-side bundle: the loaded case (truth) + the current runtime state. */
export interface CaseState {
  caseData: LoadedCase;
  game: GameState;
}

export function createInitialGameState(c: LoadedCase): GameState {
  return GameStateSchema.parse({
    caseId: c.id,
    phase: "investigating",
    turn: 0,
    discoveredEvidenceIds: c.evidence.filter((e) => e.initiallyAvailable).map((e) => e.id),
    characters: Object.fromEntries(
      c.characters.map((ch) => [ch.id, { characterId: ch.id, emotion: { ...ch.initialEmotion } }]),
    ),
  });
}
