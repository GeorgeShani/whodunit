/**
 * Gremlin round 6, swallowed questions: when a beat fires that is not a reaction to something shown this turn (a
 * deferred stress reveal on an ordinary question, #47, or a breakdown), the prompt tells the model to take up the
 * detective's actual question in the same reply. A clue/card reveal gets no extra line (its prompt is unchanged).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTurn } from "@/ai/perform-turn";
import { ANSWER_AND_CONFESS, ANSWER_THE_QUESTION } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import type { GameState } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const reveal = (g: GameState, ch: string, ...ids: string[]) => {
  for (const id of ids) {
    g.characters[ch].revealedSecretIds.push(id);
    g.revealedSecretIds.push(id);
  }
};
/** r6: Victoria right after Reginald's overheard card, stress 77. */
const r6 = (): GameState => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
  reveal(g, "gregory", "s-gregory-in-hall", "s-gregory-saw-victoria");
  reveal(g, "reginald", "s-reginald-theft", "s-reginald-overheard");
  reveal(g, "victoria", "s-victoria-new-will");
  g.characters.victoria.testimonyShownIds.push("s-gregory-saw-victoria", "s-reginald-overheard");
  g.characters.victoria.stress = 77;
  return g;
};
const Q = "And when exactly did you burn that letter, your ladyship? Half past eight, was it, before the storm?";

describe("swallowed questions: the prompt keeps the player's question on scheduled beats", () => {
  it("deferred stress reveal on an ordinary question: the directive says to answer the question too", () => {
    const p = prepareTurn({ caseData: c, game: r6(), characterId: "victoria", question: Q });
    expect(p.plan.revealSecretId).toBe("s-victoria-left-dining");
    expect(p.system).toContain(ANSWER_AND_CONFESS);
    // The question itself is in the user message, so "THE DETECTIVE NOW SAYS" points at it.
    expect(p.user).toContain("burn that letter");
  });

  it("breakdown turn: the directive says to answer the question too", () => {
    const g = createInitialGameState(c);
    g.characters.archibald.stress = 97;
    const p = prepareTurn({ caseData: c, game: g, characterId: "archibald", question: "Where were you at a quarter past nine?" });
    expect(p.plan.breakdown).toBe(true);
    expect(p.system).toContain(ANSWER_THE_QUESTION);
  });

  it("a clue or card reveal (the reveal IS the answer) and an ordinary turn get no extra line", () => {
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
    const card = prepareTurn({ caseData: c, game: g, characterId: "gregory", question: "Explain these boots.", move: { presentedEvidenceId: "muddy-footprint" } });
    expect(card.plan.revealSecretId).toBe("s-gregory-in-hall");
    expect(card.system).not.toContain(ANSWER_THE_QUESTION);
    expect(card.system).not.toContain(ANSWER_AND_CONFESS);
    const plain = prepareTurn({ caseData: c, game: createInitialGameState(c), characterId: "reginald", question: "Where were you?" });
    expect(plain.system).not.toContain(ANSWER_THE_QUESTION);
    expect(plain.system).not.toContain(ANSWER_AND_CONFESS);
  });
});
