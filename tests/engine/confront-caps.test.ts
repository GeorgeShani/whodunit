/**
 * Confrontation counter (follow-up to #24): a pair's "N left" is min(this pair's remaining, the whole game's remaining)
 * from the first look, not "6 left" until the first exchange; caps come from case data (case.json `confrontation`).
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import { loadCase } from "@/engine/case-loader";
import { CaseEnvelopeSchema, type LoadedCase } from "@/engine/case-schema";
import { confrontCounter, confrontLeft, confrontationCaps, DEFAULT_CONFRONTATION_CAPS } from "@/engine/confront-caps";
import { MAX_CONFRONTATION_TOTAL, MAX_CONFRONTATION_TURNS, openConfrontation, pairKey, spendExchange } from "@/engine/confrontation";
import { createInitialGameState } from "@/engine/game-state";
import { confrontProgress, publicProgress } from "@/engine/progress";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const VR = pairKey("victoria", "reginald");
const VA = pairKey("victoria", "archibald");
const GR = pairKey("gregory", "reginald");

describe("caps from case data", () => {
  it("defaults to the global constants; a case may lower them, a per-pair cap above the total is clamped", () => {
    expect(confrontationCaps(c)).toEqual({ perPair: MAX_CONFRONTATION_TURNS, total: MAX_CONFRONTATION_TOTAL });
    expect(confrontationCaps({ confrontation: { perPair: 3 } })).toEqual({ perPair: 3, total: MAX_CONFRONTATION_TOTAL });
    expect(confrontationCaps({ confrontation: { total: 4 } })).toEqual({ perPair: 4, total: 4 });
    expect(confrontationCaps({ confrontation: { perPair: 5, total: 2 } })).toEqual({ perPair: 2, total: 2 });
    expect(DEFAULT_CONFRONTATION_CAPS).toEqual({ perPair: 6, total: 12 });
  });

  it("schema: optional; 1..6 per pair and 1..12 in total (the constants are hard ceilings), strict keys", () => {
    const env: Record<string, unknown> = { ...c };
    for (const k of ["timeline", "evidence", "characters", "solution", "endings"]) delete env[k];
    const ok = (confrontation: unknown) => CaseEnvelopeSchema.safeParse({ ...env, confrontation }).success;
    expect(CaseEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(ok({ perPair: 3, total: 8 })).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ perPair: 7 })).toBe(false);
    expect(ok({ total: 13 })).toBe(false);
    expect(ok({ perPair: 0 })).toBe(false);
    expect(ok({ perPair: 2.5 })).toBe(false);
    expect(ok({ perpair: 3 })).toBe(false);
  });
});

describe("confrontLeft: min(per-pair remaining, game-wide remaining), before the first exchange too", () => {
  it("a fresh pair after 10 of 12 game-wide exchanges shows 2 left, not 6", () => {
    const g = createInitialGameState(c);
    g.pairTurns = { [VR]: 6, [VA]: 4 };
    g.confrontedPairs = [VR];
    const p = confrontProgress(c, g);
    expect(p).toEqual({ perPair: 6, total: 12, totalUsed: 10, pairUsed: { [VR]: 6, [VA]: 4 }, finished: [VR] });
    expect(confrontLeft(p, GR)).toBe(2);
    expect(confrontLeft(p, VA)).toBe(2); // min(6-4, 12-10)
    expect(confrontLeft(p, VR)).toBe(0); // finished
    expect(confrontLeft(confrontProgress(c, createInitialGameState(c)), GR)).toBe(6);
  });

  it("uses the case's caps", () => {
    const small = { ...c, confrontation: { perPair: 3, total: 5 } };
    const g = createInitialGameState(c);
    expect(confrontLeft(confrontProgress(small, g), GR)).toBe(3);
    g.pairTurns = { [VA]: 3 };
    expect(confrontLeft(confrontProgress(small, g), GR)).toBe(2);
  });

  it("every route's progress carries it; the initial view starts at the full caps", () => {
    expect(publicProgress(c, createInitialGameState(c)).confront).toEqual({ perPair: 6, total: 12, totalUsed: 0, pairUsed: {}, finished: [] });
  });

  it("confrontCounter: progress wins from the first look; a server refusal (over) always wins; no progress falls back", () => {
    const g = createInitialGameState(c);
    g.pairTurns = { [VA]: 6, [VR]: 5 };
    const p = confrontProgress(c, g);
    expect(confrontCounter(p, GR)).toEqual({ left: 1, max: 6, over: false });
    expect(confrontCounter(p, GR, { turnsUsed: 0, over: true })).toEqual({ left: 0, max: 6, over: true });
    g.pairTurns[GR] = 1;
    expect(confrontCounter(confrontProgress(c, g), GR)).toEqual({ left: 0, max: 6, over: true });
    expect(confrontCounter(undefined, GR)).toEqual({ left: 6, max: 6, over: false });
    expect(confrontCounter(undefined, GR, { turnsUsed: 4, over: false })).toEqual({ left: 2, max: 6, over: false });
  });

  it("the screen shows the passed count before any exchange", () => {
    const s = c.characters.slice(0, 2).map((ch) => ({ id: ch.id, name: ch.name, role: ch.role, bio: ch.bio, portrait: ch.id, poses: [], emotion: ch.initialEmotion }));
    const html = renderToStaticMarkup(
      h(ConfrontScreen, { pair: s as never, emotions: {}, stress: {}, messages: [], pending: false, speakingId: null, left: 2, max: 6, over: false, onAsk: () => true, target: s[0]!.id, onTarget: () => {}, onBack: () => {} }),
    );
    expect(html).toContain('data-confront-left="2"');
    expect(html).toContain("2 left");
    expect(html).toContain("of 6 exchanges");
  });
});

describe("the engine enforces the case's caps", () => {
  it("per pair and in total", () => {
    const caps = confrontationCaps({ confrontation: { perPair: 2, total: 3 } });
    const g = createInitialGameState(c);
    expect(openConfrontation(g, "victoria", "reginald", caps)).toEqual({ ok: true, turnsUsed: 0 });
    expect(spendExchange(g, caps)).toEqual({ turnsUsed: 1, over: false, totalLeft: 2 });
    expect(spendExchange(g, caps)).toEqual({ turnsUsed: 2, over: true, totalLeft: 1 });
    expect(openConfrontation(g, "victoria", "reginald", caps)).toEqual({ ok: false, reason: "pair_finished" });
    expect(openConfrontation(g, "gregory", "archibald", caps).ok).toBe(true);
    expect(spendExchange(g, caps)).toEqual({ turnsUsed: 1, over: true, totalLeft: 0 });
    expect(openConfrontation(g, "gregory", "victoria", caps)).toEqual({ ok: false, reason: "limit_reached" });
  });

  it("the confront route uses the case's caps and returns the live counter in progress", async () => {
    const small = { ...c, confrontation: { perPair: 2, total: 3 } };
    mockGrok({ content: goodReply({ dialogue: "I was in the dining room." }) }, { content: goodReply({ dialogue: "So she says." }) });
    const r = await handleConfront({ caseId: "blackwood", characterIds: ["victoria", "reginald"], question: "Where were you?" }, { caseData: small, env: TEST_ENV });
    expect(r.status).toBe(200);
    expect(r.body.confrontation).toMatchObject({ turnsUsed: 1, max: 2, over: false, totalLeft: 2 });
    const p = r.body.progress!.confront!;
    expect(confrontLeft(p, VR)).toBe(1);
    expect(confrontLeft(p, GR)).toBe(2);
  });

  it("a token's finished pairs count the case's per-pair allowance, not the global 6", () => {
    const small = { ...c, confrontation: { perPair: 2, total: 5 } };
    const g = createInitialGameState(small);
    g.confrontedPairs = [VR];
    g.pairTurns = { [VR]: 2 };
    const d = decodeStateToken(encodeStateToken(g, TEST_ENV), small, TEST_ENV);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.game.pairTurns[VR]).toBe(2);
    expect(confrontLeft(confrontProgress(small, d.game), GR)).toBe(2);
  });
});
