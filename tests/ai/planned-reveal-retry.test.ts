/** C2: a retry on a turn with a planned reveal keeps the confession; it never says "admit nothing new". */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply, plannedRevealNote, withPlannedReveal } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { helpers } from "@/tools/ai-eval/run";
import { SCENARIOS } from "@/tools/ai-eval/scenarios";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

/** The guard input of a recorded eval scenario's turn (its own setup, its own question and move). */
function scenarioTurn(id: string) {
  const s = SCENARIOS.find((x) => x.id === id)!;
  if (s.turn.kind !== "interrogate") throw new Error("interrogate only");
  const g = createInitialGameState(c);
  s.setup?.(g, helpers(g, c));
  const { characterId, question, presentedEvidenceId, presentedTestimonyId } = s.turn;
  return prepareTurn({ caseData: c, game: g, characterId, question, move: { presentedEvidenceId, presentedTestimonyId } });
}

describe("C2 retry note on a planned-reveal turn", () => {
  for (const id of ["s-archibald-breakdown", "s-reginald-breakdown"]) {
    it(`${id}: a breakdown that is also a reveal; the no_outburst note keeps the confession`, () => {
      const p = scenarioTurn(id);
      expect(p.directives.breakdown).toBe(true);
      const reveal = p.directives.revealSecret;
      expect(reveal, "the engine plans a reveal on this breakdown").toBeDefined();
      const v = checkReply({ dialogue: "I have nothing to say to you, sir.", admits: [] }, p.guard);
      expect(v?.reason).toBe("no_outburst");
      expect(v!.note).not.toMatch(/admit nothing/i);
      expect(v!.note).toContain(plannedRevealNote(reveal!.id));
      expect(v!.note).toMatch(/keep that confession/);
      expect(v!.note).toMatch(/fix only the problem/);
    });
  }

  it("general: any reason on a reveal turn gets the keep-the-confession ending; without a reveal the note is untouched", () => {
    const v = { reason: "modern_word" as const, note: "You used a modern word. Still admit nothing new.", detail: "x" };
    const kept = withPlannedReveal(v, { revealSecret: { id: "s-x", description: "d" } });
    expect(kept.note).toBe(`You used a modern word. ${plannedRevealNote("s-x")}`);
    expect(withPlannedReveal(v, {})).toEqual(v);
  });

  it("a breakdown WITHOUT a planned reveal still says admit nothing new", () => {
    const p = scenarioTurn("s-archibald-breakdown");
    const guard = { ...p.guard, directives: { ...p.guard.directives, revealSecret: undefined } };
    const v = checkReply({ dialogue: "I have nothing to say to you, sir.", admits: [] }, guard);
    expect(v?.reason).toBe("no_outburst");
    expect(v!.note).toMatch(/Still admit nothing new/);
  });
});
