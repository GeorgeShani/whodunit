import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { clampDelta, commitTurn, MAX_MODEL_DELTA, planTurn, STRESS_RULES, type PerformanceOutcome } from "@/engine/interrogation";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const perf = (over: Partial<PerformanceOutcome> = {}): PerformanceOutcome => ({
  playerText: "Well?",
  dialogue: "Quite so, sir.",
  emotion: "nervous",
  intensity: 0.5,
  stressDelta: 0,
  trustDelta: 0,
  performed: true,
  ...over,
});

describe("clampDelta", () => {
  it.each([
    [3, 3], [-4, -4], [100, MAX_MODEL_DELTA], [-1e9, -MAX_MODEL_DELTA], [2.6, 3],
    [Number.NaN, 0], [Infinity, 0], ["10", 0], [undefined, 0], [null, 0],
  ])("clampDelta(%s) = %s", (input, out) => {
    expect(clampDelta(input)).toBe(out);
  });
});

describe("planTurn", () => {
  it("a plain question changes nothing and reveals nothing", () => {
    const g = createInitialGameState(c);
    const plan = planTurn(c, g, "reginald");
    expect(plan).toMatchObject({ engineStressDelta: 0, revealSecretId: null, exposedLieIds: [] });
    expect(g.characters.reginald.stress).toBe(0);
  });

  it("related evidence adds a little stress; repeats add less", () => {
    const g = createInitialGameState(c);
    expect(planTurn(c, g, "reginald", "silver-candlestick").engineStressDelta).toBe(STRESS_RULES.relatedEvidence);
    expect(planTurn(c, g, "reginald", "silver-candlestick").engineStressDelta).toBe(STRESS_RULES.repeatEvidence);
    expect(g.characters.reginald.evidenceShownIds).toEqual(["silver-candlestick"]);
  });

  it("lie-breaking, secret-pressuring evidence raises stress (capped), exposes lies and reveals ONE secret at a time in order", () => {
    const g = createInitialGameState(c);
    // The cap itself: the letter breaks three of Victoria's lies and pressures her will secret (45 + 10 > 30).
    expect(planTurn(c, createInitialGameState(c), "victoria", "burned-letter").engineStressDelta).toBe(STRESS_RULES.maxPerPresentation);
    const plan = planTurn(c, g, "reginald", "burned-letter");
    expect(plan.engineStressDelta).toBe(STRESS_RULES.lieBroken + STRESS_RULES.secretEvidence);
    expect(plan.newlyExposedLieIds.sort()).toEqual(["l-reginald-few-words"]); // "heard nothing" is retired by the theft confession, not broken by the letter
    expect(plan.revealSecretId).toBe("s-reginald-theft"); // overheard waits for theft (afterSecretIds)
    commitTurn(g, plan, perf());
    expect(g.characters.reginald.revealedSecretIds).toEqual(["s-reginald-theft"]);
    const next = planTurn(c, g, "reginald");
    expect(next.revealSecretId).toBe("s-reginald-overheard");
  });

  it("the murderer's confession is core guilt: never revealed, even with all three clues, stress 100 and its prerequisites", () => {
    const g = createInitialGameState(c);
    const v = g.characters.victoria;
    v.stress = 100;
    v.evidenceShownIds = ["silver-candlestick", "library-key", "burned-letter"];
    expect(planTurn(c, g, "victoria").revealSecretId).not.toBe("s-victoria-murder");
    v.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will"];
    expect(planTurn(c, g, "victoria").revealSecretId).toBeNull();
  });
});

describe("commitTurn", () => {
  it("clamps model deltas and records memory + statement", () => {
    const g = createInitialGameState(c);
    const plan = planTurn(c, g, "reginald");
    const applied = commitTurn(g, plan, perf({ stressDelta: 100, trustDelta: -100 }));
    expect(applied).toMatchObject({ stressDelta: 10, trustDelta: -10 });
    expect(g.characters.reginald).toMatchObject({ stress: 10, trust: 40, interrogationCount: 1 });
    expect(g.characters.reginald.memory.map((m) => m.speaker)).toEqual(["player", "character"]);
    expect(g.statements).toHaveLength(1);
    expect(g.turn).toBe(1);
  });

  it("keeps stress within 0..100", () => {
    const g = createInitialGameState(c);
    g.characters.reginald.stress = 98;
    commitTurn(g, planTurn(c, g, "reginald"), perf({ stressDelta: 10, performed: false }));
    g.characters.reginald.stress = 98;
    commitTurn(g, { ...planTurn(c, g, "reginald"), breakdown: false }, perf({ stressDelta: 10 }));
    expect(g.characters.reginald.stress).toBe(100); // (once a breakdown is spent the gauge tops out at 95; see stress.test.ts)
  });

  it("a fallback turn applies no deltas and defers the reveal", () => {
    const g = createInitialGameState(c);
    const plan = planTurn(c, g, "reginald", "burned-letter");
    const applied = commitTurn(g, plan, perf({ performed: false, stressDelta: 10 }));
    expect(applied).toMatchObject({ stressDelta: 0, revealed: false });
    expect(g.characters.reginald.revealedSecretIds).toEqual([]);
    expect(g.statements).toHaveLength(0);
    expect(planTurn(c, g, "reginald").revealSecretId).toBe("s-reginald-theft");
  });

  it("caps memory", () => {
    const g = createInitialGameState(c);
    for (let i = 0; i < 20; i++) commitTurn(g, planTurn(c, g, "reginald"), perf());
    expect(g.characters.reginald.memory.length).toBeLessThanOrEqual(12);
    expect(g.statements.length).toBeLessThanOrEqual(8);
  });
});
