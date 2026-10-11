/** C4 (DX8): a confrontation counts as an exchange only with the suspect addressed; the validator models it. */
import { beforeAll, describe, expect, it } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { commitTurn, planTurn } from "@/engine/interrogation";
import { fastestPath } from "@/engine/progression-validation";
import { publicProgress } from "@/engine/progress";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const outcome = { playerText: "x", dialogue: "Hm.", emotion: "calm" as const, intensity: 0.5, stressDelta: 0, trustDelta: 0, performed: true };

describe("C4 confrontation exchange count", () => {
  it("commitTurn: countsAsExchange false leaves interrogationCount alone (the turn itself still happens)", () => {
    const g = createInitialGameState(c);
    commitTurn(g, planTurn(c, g, "gregory", {}), { ...outcome, countsAsExchange: false }, "confrontation");
    expect(g.characters.gregory.interrogationCount).toBe(0);
    expect(g.turn).toBe(1);
    commitTurn(g, planTurn(c, g, "gregory", {}), outcome);
    expect(g.characters.gregory.interrogationCount).toBe(1);
  });

  it("one confrontation exchange: +1 for the addressed suspect only, and only they move on the questioned badges", async () => {
    mockGrok({});
    const [a, b] = [c.characters[0]!.id, c.characters[1]!.id];
    const g0 = createInitialGameState(c);
    const r = await handleConfront({ caseId: c.id, characterIds: [a, b], question: "Well?", stateToken: encodeStateToken(g0, TEST_ENV) }, { caseData: c, env: TEST_ENV });
    expect(r.status).toBe(200);
    const d = decodeStateToken(r.body.stateToken, c, TEST_ENV);
    if (!d.ok) throw new Error(d.reason);
    expect(d.game.characters[a]!.interrogationCount).toBe(1);
    expect(d.game.characters[b]!.interrogationCount).toBe(0);
    const q = publicProgress(c, d.game).questioned;
    if (q) expect([q.counts[a], q.counts[b]]).toEqual([1, 0]);
  });

  it("validator: confrontations are modelled; Blackwood's true minimum is unchanged at 10 under C4", () => {
    expect(fastestPath(c)).toBe(10);
    expect(fastestPath(c, { confrontations: false })).toBe(10);
  });
});
