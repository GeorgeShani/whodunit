/** Regression tests for QA issue #26 (order of events) on the real Blackwood case. */
import { beforeAll, describe, expect, it } from "vitest";
import { findModernWord } from "@/ai/canon-check";
import { checkOrder, landmarksOf, orderLines } from "@/ai/order-check";
import { buildSystemPrompt } from "@/ai/prompts/interrogation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const ctxOf = (id: string, unlock: string[] = []) => {
  const game = createInitialGameState(c);
  if (unlock.length) game.characters[id].revealedSecretIds = unlock;
  return buildCharacterContext({ caseData: c, game }, id);
};

describe("landmarks", () => {
  it("are timed from the character's own knowledge", () => {
    const l = Object.fromEntries(landmarksOf(ctxOf("archibald")).map((x) => [x.id, x.minute]));
    expect(l.blackout).toBe(21 * 60 + 10);
    expect(l.candles).toBe(21 * 60 + 11);
    expect(l.scream).toBe(21 * 60 + 30);
  });
  it("show up in the prompt as THE EVENING IN ORDER", () => {
    const sys = buildSystemPrompt(ctxOf("archibald"), { exposedLieIds: [] });
    expect(sys).toContain("THE EVENING IN ORDER");
    expect(orderLines(ctxOf("archibald")).join("\n")).toMatch(/21:10/);
  });
});

describe("checkOrder (#26)", () => {
  // After the false-alibi secret is out, his real movements (away 21:13-21:22) are in his knowledge.
  const arch = () => ctxOf("archibald", ["s-archibald-false-alibi"]);
  it("rejects 'after the lights went out till the candles' when he was away 21:13-21:22", () => {
    const r = checkOrder(
      "From after the lights went out till Reginald lit the candles proper, I slipped away to use the servants' telephone.",
      arch(),
    );
    expect(r.ok).toBe(false);
    expect(r.hint).toBeTruthy();
  });
  it("accepts phrasing that fits the real movements", () => {
    expect(checkOrder("From after the candles till the scream, I stepped out to use the servants' telephone.", arch()).ok).toBe(true);
    expect(checkOrder("I was in the dining room when the lights went out.", arch()).ok).toBe(true);
    expect(checkOrder("I slipped away after the candles were lit.", arch()).ok).toBe(true);
  });
  it("does not judge a claim about movements the character is still hiding", () => {
    expect(checkOrder("I slipped away after the candles were lit.", ctxOf("archibald")).ok).toBe(true);
  });
  it("accepts plain dialogue with no landmarks", () => {
    expect(checkOrder("I never touched the brandy, detective.", arch()).ok).toBe(true);
  });
});

describe("modern words (#26)", () => {
  it.each(["telephone", "the servants' telephone", "I rang on the telephone"])("does not flag %s", (t) => {
    expect(findModernWord(t)).toBeNull();
  });
  it.each(["a phone app", "my smartphone", "I sent an email"])("still flags %s", (t) => {
    expect(findModernWord(t)).not.toBeNull();
  });
});
