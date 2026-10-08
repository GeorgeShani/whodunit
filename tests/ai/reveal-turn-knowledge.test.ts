/**
 * #51 the reveal turn knows what it reveals: the facts a secret unlocks are in the prompt and the guard's allowed
 * times on the exchange that reveals it, not one exchange later. Same principle as forbiddenPhrases' unlessRevealed
 * and the retraction check counting this exchange's reveal. Core-guilt facts stay withheld.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkTimes } from "@/ai/canon-check";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { coreGuiltFactIds } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import type { GameState } from "@/engine/types";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const fresh = (): GameState => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
  return g;
};
const reveal = (g: GameState, ch: string, ...ids: string[]) => {
  for (const id of ids) {
    g.characters[ch].revealedSecretIds.push(id);
    g.revealedSecretIds.push(id);
  }
};

describe("#51 reveal turn: the secret's own canon time is allowed", () => {
  it("Reginald's overheard reveal (letter shown again): 'six minutes to nine' (20:54) passes, the wrong time still fails", () => {
    const g = fresh();
    reveal(g, "reginald", "s-reginald-theft");
    g.characters.reginald.evidenceShownIds.push("burned-letter");
    const p = prepareTurn({ caseData: c, game: g, characterId: "reginald", question: "What else did you hear?", move: { presentedEvidenceId: "burned-letter", allowReveal: true } });
    expect(p.plan.revealSecretId).toBe("s-reginald-overheard");
    expect(p.system).toContain("20:54");
    expect(checkReply({ dialogue: "I overheard her ladyship's argument with his lordship at six minutes to nine, sir, through the ajar library door.", admits: ["s-reginald-overheard"] }, p.guard)).toBeNull();
    expect(checkReply({ dialogue: "I overheard her ladyship's argument with his lordship at twenty minutes to nine, sir.", admits: ["s-reginald-overheard"] }, p.guard)?.reason).toBe("event_time");
  });

  it("Gregory's in-hall reveal (footprint): 'sixteen minutes past nine' (21:16) passes", () => {
    const g = fresh();
    const p = prepareTurn({ caseData: c, game: g, characterId: "gregory", question: "These are your boots.", move: { presentedEvidenceId: "muddy-footprint", allowReveal: true } });
    expect(p.plan.revealSecretId).toBe("s-gregory-in-hall");
    expect(p.system).toContain("21:16");
    expect(checkReply({ dialogue: "I slipped in by the garden door at sixteen minutes past nine, sir, and stood in the alcove.", admits: ["s-gregory-in-hall"] }, p.guard)).toBeNull();
  });

  it("without a reveal this exchange nothing extra is unlocked (the time is still unknown)", () => {
    const g = fresh();
    const p = prepareTurn({ caseData: c, game: g, characterId: "gregory", question: "Where were you?", move: {} });
    expect(p.plan.revealSecretId).toBeNull();
    expect(p.system).not.toContain("21:16");
    expect(checkTimes("I slipped in by the garden door at sixteen minutes past nine, sir.", p.guard.allowedTimes).ok).toBe(false);
  });

  it("the revealing secret is NOT listed as ALREADY ADMITTED (the directive carries it this turn)", () => {
    const g = fresh();
    const ctx = buildCharacterContext({ caseData: c, game: g }, "gregory", { revealingSecretIds: ["s-gregory-in-hall"] });
    expect(ctx.secrets.map((s) => s.id)).not.toContain("s-gregory-in-hall");
    expect(ctx.knowledge.some((k) => k.time === "21:16")).toBe(true);
  });

  it("core guilt is never unlocked by a pending reveal: the culprit's covered facts stay withheld", () => {
    const g = fresh();
    const victoria = c.characters.find((x) => x.id === "victoria")!;
    const covered = coreGuiltFactIds(c, victoria);
    const all = victoria.secrets.map((s) => s.id);
    const ctx = buildCharacterContext({ caseData: c, game: g }, "victoria", { revealingSecretIds: all });
    for (const id of covered) expect(ctx.knowledge.map((k) => k.id)).not.toContain(id);
    expect(ctx.secrets).toEqual([]);
  });

  it("another character's secret id is ignored", () => {
    const g = fresh();
    const a = buildCharacterContext({ caseData: c, game: g }, "gregory");
    const b = buildCharacterContext({ caseData: c, game: g }, "gregory", { revealingSecretIds: ["s-reginald-overheard"] });
    expect(b.knowledge).toEqual(a.knowledge);
  });
});
