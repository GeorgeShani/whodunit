import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { buildSystemPrompt } from "@/ai/prompts/interrogation";
import { loadCase, validateCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { BREAKDOWN_STRESS, escalateEmotion, POST_BREAKDOWN_STRESS, stressBand } from "@/engine/stress";
import { brokenLieIds } from "@/engine/testimony";
import type { GameState } from "@/engine/types";
import { FIXTURE_ID, makeBrokenCopy } from "../helpers/fixture";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const TOGETHER = "l-victoria-together";
const LEFT = "s-victoria-left-dining";
const perf = (over: Partial<Parameters<typeof commitTurn>[2]> = {}) => ({
  playerText: "Well?",
  dialogue: "Oh, very well.",
  emotion: "calm" as const,
  intensity: 0.5,
  stressDelta: 0,
  trustDelta: 0,
  performed: true,
  ...over,
});
const game = (edit: (g: GameState) => void = () => undefined) => {
  const g = createInitialGameState(c);
  edit(g);
  return g;
};

describe("stress bands (MASTER_PLAN §18)", () => {
  it("maps 0-100 onto calm / defensive / nervous / panicking / breakdown", () => {
    expect([0, 30, 31, 60, 61, 80, 81, 95, 96, 100].map(stressBand)).toEqual([
      "calm", "calm", "defensive", "defensive", "nervous", "nervous", "panicking", "panicking", "breakdown", "breakdown",
    ]);
  });

  it("puts an engine floor under the model's emotion so the pose matches the gauge", () => {
    expect(escalateEmotion("smug", 10)).toBe("smug");
    expect(escalateEmotion("calm", 45)).toBe("defensive");
    expect(escalateEmotion("smug", 70)).toBe("nervous");
    expect(escalateEmotion("angry", 70)).toBe("angry");
    expect(escalateEmotion("smug", 90)).toBe("panicked");
    expect(escalateEmotion("sad", 90)).toBe("sad");
    expect(escalateEmotion("calm", 90, true)).toBe("panicked");
    expect(escalateEmotion("angry", 90, true)).toBe("angry");
  });
});

describe("breakdowns (MASTER_PLAN §19)", () => {
  it("happen once, at 96+, only when performed; stress then settles at 85", () => {
    const g = game((x) => (x.characters.reginald.stress = BREAKDOWN_STRESS));
    const fallback = planTurn(c, g, "reginald");
    expect(fallback.breakdown).toBe(true);
    commitTurn(g, fallback, perf({ performed: false }));
    expect(g.characters.reginald.brokeDown).toBe(false); // still pending after a fallback turn

    const plan = planTurn(c, g, "reginald");
    expect(plan.breakdown).toBe(true);
    const r = commitTurn(g, plan, perf({ emotion: "smug" }));
    expect(r.brokeDown).toBe(true);
    expect(r.emotion).toBe("panicked");
    expect(g.characters.reginald.stress).toBe(POST_BREAKDOWN_STRESS);

    g.characters.reginald.stress = 100;
    expect(planTurn(c, g, "reginald").breakdown).toBe(false); // once per game
    // Survives the signed token.
    const back = decodeStateToken(encodeStateToken(g, TEST_ENV), c, TEST_ENV);
    expect(back.ok && back.game.characters.reginald.brokeDown).toBe(true);
  });

  it("never unlocks an evidence-gated secret by itself", () => {
    const g = game((x) => (x.characters.victoria.stress = 100));
    g.characters.victoria.revealedSecretIds.push(LEFT);
    const plan = planTurn(c, g, "victoria");
    expect(plan.breakdown).toBe(true);
    // Locked door needs library-key AND muddy-footprint; the murder needs three clues. Stress alone opens neither.
    expect(plan.revealSecretId).toBeNull();
  });

  it("the prompt stages the outburst but forbids new admissions", async () => {
    mockGrok({ content: goodReply({ dialogue: "ENOUGH! I polish, I serve, I do NOT murder!", emotion: "calm" }) });
    let system = "";
    const tok = encodeStateToken(game((x) => (x.characters.reginald.stress = 97)), TEST_ENV);
    const r = await handleInterrogate({ characterId: "reginald", question: "Admit it.", stateToken: tok }, { caseData: c, env: TEST_ENV, onPrompt: (p) => (system = p.system) });
    expect(system).toMatch(/You BREAK DOWN this turn/);
    expect(system).toMatch(/NOT a confession/);
    expect(r.body.stress).toEqual({ value: POST_BREAKDOWN_STRESS, band: "panicking", breakdown: true });
    expect(r.body.response.emotion).toBe("panicked"); // engine floor over the model's "calm"
  });

  it("a limp breakdown line is sent back once: the outburst has to read as one", async () => {
    const { calls } = mockGrok(
      { content: goodReply({ dialogue: "Darling, my hands? It's merely the chill.", emotion: "nervous" }) },
      { content: goodReply({ dialogue: "ENOUGH! I CANNOT BEAR IT!", emotion: "panicked" }) },
    );
    const tok = encodeStateToken(game((x) => (x.characters.victoria.stress = 99)), TEST_ENV);
    const r = await handleInterrogate({ characterId: "victoria", question: "Well?", stateToken: tok }, { caseData: c, env: TEST_ENV });
    expect(calls).toHaveLength(2);
    expect(r.body.response.dialogue).toBe("ENOUGH! I CANNOT BEAR IT!");
    expect(r.body.stress?.breakdown).toBe(true);
  });

  it("every reply reports the engine's stress reading", async () => {
    mockGrok({ content: goodReply({ stressDelta: 4 }) });
    const r = await handleInterrogate({ characterId: "gregory", question: "Hello." }, { caseData: c, env: TEST_ENV });
    expect(r.body.stress).toEqual({ value: 4, band: "calm", breakdown: false });
  });
});

describe("supersededBySecretIds: a confession retires the owner's own lie (SOLUTION_PROOF §8.4)", () => {
  it("the stress path retires l-victoria-together in the SAME turn, with no stress and no contradiction", () => {
    const g = game((x) => (x.characters.victoria.stress = 70));
    const plan = planTurn(c, g, "victoria");
    expect(plan.revealSecretId).toBe(LEFT);
    expect(plan.retiredLieIds).toEqual([TOGETHER]);
    expect(plan.exposedLieIds).toContain(TOGETHER);
    expect(plan.newlyExposedLieIds).toEqual([]); // no clue broke it: no OBJECTION beat
    expect(plan.engineStressDelta).toBe(0);
    commitTurn(g, plan, perf());
    expect(brokenLieIds(c, c.characters.find((x) => x.id === "victoria")!, g.characters.victoria)).toContain(TOGETHER);
  });

  it("stays maintained if the confession was not performed (fallback), and retires once it is", () => {
    const g = game((x) => (x.characters.victoria.stress = 70));
    commitTurn(g, planTurn(c, g, "victoria"), perf({ performed: false }));
    expect(buildCharacterContext({ caseData: c, game: g }, "victoria").intendedLies.find((l) => l.id === TOGETHER)?.status).toBe("maintain");
    commitTurn(g, planTurn(c, g, "victoria"), perf());
    expect(buildCharacterContext({ caseData: c, game: g }, "victoria").intendedLies.find((l) => l.id === TOGETHER)?.status).toBe("retired");
  });

  it("prompt level: the model is never told both to confess and to keep the together-story", async () => {
    const claim = c.characters.find((x) => x.id === "victoria")!.intendedLies.find((l) => l.id === TOGETHER)!.claim;
    const prompts: string[] = [];
    mockGrok({ content: goodReply({ dialogue: "Very well. I sat alone; Archibald was off somewhere.", emotion: "flustered" }) });
    // Turn 1: stress 70, the engine schedules the confession.
    const t1 = await handleInterrogate(
      { characterId: "victoria", question: "You were alone, weren't you?", stateToken: encodeStateToken(game((x) => (x.characters.victoria.stress = 70)), TEST_ENV) },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => prompts.push(p.system) },
    );
    // Turn 2: afterwards.
    await handleInterrogate(
      { characterId: "victoria", question: "And Archibald?", stateToken: t1.body.stateToken },
      { caseData: c, env: TEST_ENV, onPrompt: (p) => prompts.push(p.system) },
    );
    const [confessTurn, after] = prompts;
    expect(confessTurn).toMatch(/CONFESS this secret/);
    expect(confessTurn).toMatch(/DROPPED STORIES/);
    expect(confessTurn).toContain(`- DROPPED (whereabouts during the blackout): "${claim}"`);
    for (const p of prompts) expect(p).not.toContain(`MAINTAIN THIS STORY (whereabouts during the blackout): "${claim}"`);
    expect(after).not.toMatch(/CONFESS this secret/);
    expect(after).toContain(`- DROPPED (whereabouts during the blackout): "${claim}"`);
  });

  it("without the field the old gap is back (guards the data, not just the engine)", () => {
    const v = structuredClone(c);
    const lie = v.characters.find((x) => x.id === "victoria")!.intendedLies.find((l) => l.id === TOGETHER)!;
    lie.supersededBySecretIds = [];
    const g = createInitialGameState(v);
    g.characters.victoria.stress = 70;
    const plan = planTurn(v, g, "victoria");
    const ctx = buildCharacterContext({ caseData: v, game: g }, "victoria");
    const system = buildSystemPrompt(ctx, { exposedLieIds: plan.exposedLieIds, revealSecret: { id: LEFT, description: "x" } });
    expect(system).toContain(`MAINTAIN THIS STORY (whereabouts during the blackout): "${lie.claim}"`);
  });

  it("validator: accepts the owner's own secret, rejects unknown or another character's", async () => {
    const run = async (ids: string[]) => {
      const { casesDir, cleanup } = await makeBrokenCopy((edit) => edit("characters/bravo.json", (j) => (j.intendedLies[0].supersededBySecretIds = ids)));
      try {
        return (await validateCase(FIXTURE_ID, casesDir)).issues.map((i) => i.message).join("\n");
      } finally {
        await cleanup();
      }
    };
    expect(await run(["bravo-secret"])).toBe("");
    expect(await run(["alpha-secret"])).toMatch(/belongs to alpha; a lie can only be superseded by its owner's \(bravo's\) own secret/);
    expect(await run(["nope"])).toMatch(/unknown own secret "nope"/);
  });
});

describe("#29 a spent breakdown caps the gauge at panicking", () => {
  it("after the breakdown, further pressure never reads BREAKDOWN again", () => {
    const g = createInitialGameState(c);
    const rt = g.characters.victoria;
    rt.stress = 96;
    const plan = planTurn(c, g, "victoria", { playerText: "Confess!" });
    expect(plan.breakdown).toBe(true);
    commitTurn(g, plan, { playerText: "Confess!", dialogue: "NO!", emotion: "panicked", intensity: 1, stressDelta: 0, trustDelta: 0, performed: true });
    expect(rt.brokeDown).toBe(true);
    expect(rt.stress).toBe(85);
    rt.stress = 99;
    const plan2 = planTurn(c, g, "victoria", { playerText: "Admit it!" });
    expect(plan2.breakdown).toBe(false);
    const out = commitTurn(g, plan2, { playerText: "Admit it!", dialogue: "No.", emotion: "panicked", intensity: 1, stressDelta: 10, trustDelta: 0, performed: true });
    expect(out.stress).toBe(95);
    expect(stressBand(out.stress)).toBe("panicking");
  });
});
