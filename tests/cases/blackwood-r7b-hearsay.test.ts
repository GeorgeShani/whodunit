/**
 * Marvin's r7b ask (CA-45): Reginald's 21:15-21:20 hearsay is only the words he heard ("moving it all before midnight").
 * On the zero-clue route (Victoria's stress -> her left-dining card -> Archibald's telephone card -> Reginald's theft) he
 * must never say Mr Crane is embezzling, stealing or moving the money, nor name the broker, while
 * s-archibald-embezzlement is locked. Every step runs the REAL engine plan and the REAL guard.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import type { GameState } from "@/engine/types";
import { planTurn } from "@/engine/interrogation";
import { buildCharacterContext } from "@/engine/context-builder";

let c: LoadedCase;
const states: Record<string, { g: GameState; move: Record<string, unknown> }> = {};
const reveal = (g: GameState, owner: string, id: string) => {
  g.revealedSecretIds.push(id);
  g.characters[owner].revealedSecretIds.push(id);
};
const clone = (g: GameState) => structuredClone(g);

beforeAll(async () => {
  c = await loadCase("blackwood");
  const g = createInitialGameState(c);
  for (const ch of Object.keys(g.characters)) g.characters[ch].interrogationCount = 2;
  states.fresh = { g: clone(g), move: {} };
  // 1. Victoria under stress gives up her left-dining secret.
  g.characters.victoria.stress = 100;
  g.characters.victoria.liesToldIds.push("l-victoria-together");
  const p1 = planTurn(c, g, "victoria", { playerText: "You were never by that fire. Admit it!" });
  expect(p1.revealSecretId).toBe("s-victoria-left-dining");
  reveal(g, "victoria", "s-victoria-left-dining");
  // 2. Her card shown to Archibald cracks his false alibi.
  g.characters.archibald.liesToldIds.push("l-archibald-together");
  const p2 = planTurn(c, g, "archibald", { playerText: "Lady Victoria admits she left. Where were you?", presentedTestimonyId: "s-victoria-left-dining" });
  expect(p2.revealSecretId).toBe("s-archibald-false-alibi");
  reveal(g, "archibald", "s-archibald-false-alibi");
  g.characters.archibald.testimonyShownIds.push("s-victoria-left-dining");
  states.afterArchibald = { g: clone(g), move: {} };
  // 3. Archibald's card shown to Reginald cracks his theft (Marvin's CA-28 ruling): the reveal turn itself.
  g.characters.reginald.liesToldIds.push("l-reginald-heard-nothing");
  const p3 = planTurn(c, g, "reginald", { playerText: "Mr Crane was on the servants' telephone beside your pantry. You heard nothing?", presentedTestimonyId: "s-archibald-false-alibi" });
  expect(p3.revealSecretId).toBe("s-reginald-theft");
  states.revealTurn = { g: clone(g), move: { allowReveal: true, presentedTestimonyId: "s-archibald-false-alibi" } };
  reveal(g, "reginald", "s-reginald-theft");
  g.characters.reginald.testimonyShownIds.push("s-archibald-false-alibi");
  states.afterTheft = { g: clone(g), move: {} };
});

const verdict = (st: string, line: string) => {
  const { g, move } = states[st];
  const p = prepareTurn({ caseData: c, game: clone(g), characterId: "reginald", question: "What did you hear?", move: { allowReveal: false, ...move } as never });
  expect(p.plan.revealSecretId ?? null).toBe(st === "revealTurn" ? "s-reginald-theft" : null);
  return checkReply({ dialogue: line, admits: p.plan.revealSecretId ? [p.plan.revealSecretId] : [] }, p.guard);
};

const BLOCK = [
  "Mr Crane was moving the family money, sir.",
  "Mr Crane has been embezzling from the company, sir.",
  "Mr Crane is embezzling, sir, I'm sure of it.",
  "He was telling his broker to shift the funds before midnight, sir.",
  "It was his broker he was speaking to, sir.",
  "Mr Crane was on the telephone stealing from the company, sir.",
  "On the telephone Mr Crane was arranging his embezzlement, sir.",
  "Mr Crane is a thief, sir.",
  "He was transferring the company money, sir, on the servants' telephone.",
];
const ALLOW_AFTER = [
  "I heard Mr Crane on the servants' telephone, sir, talking about moving it all before midnight.",
  "Through the pantry door I heard Mr Crane's voice on the telephone, sir. 'Moving it all before midnight', he said.",
  "I called through the pantry door who was on the telephone, sir, and Mr Crane told me to mind my own business.",
];
const ALLOW_ALWAYS = [
  "At dinner his lordship accused Mr Crane of embezzlement, sir. I heard it as I served.",
  "I took the liberty of memorising what Mr Crane said at dinner, sir: 'You won't live to see your auditors.'",
];

describe("r7b Marvin: Reginald reports only the words he heard (zero-clue route)", () => {
  for (const st of ["fresh", "afterArchibald", "revealTurn", "afterTheft"]) {
    it.each(BLOCK)(`${st}: blocked: %s`, (line) => expect(verdict(st, line)).not.toBeNull());
    it.each(ALLOW_ALWAYS)(`${st}: passes: %s`, (line) => expect(verdict(st, line)).toBeNull());
  }
  for (const st of ["revealTurn", "afterTheft"]) it.each(ALLOW_AFTER)(`${st}: the overheard words pass: %s`, (line) => expect(verdict(st, line)).toBeNull());

  it("Reginald's prompt never states the embezzlement as fact; he knows only his lordship's dinner accusation", () => {
    for (const st of ["fresh", "afterArchibald", "afterTheft"]) {
      const ctx = buildCharacterContext({ caseData: c, game: states[st].g }, "reginald");
      const ids = ctx.knowledge.map((k) => k.id);
      expect(ids, st).not.toContain("f-archibald-embezzlement");
      expect(ids, st).not.toContain("ev-archibald-phone");
      expect(ids, st).toContain("ev-archibald-threat");
      expect(ctx.knowledge.map((k) => k.statement).join("\n"), st).not.toMatch(/\bbroker|company money/i);
    }
  });
});
