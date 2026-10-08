/**
 * The leak-eval scenarios (cases/blackwood/evals/leak-scenarios.json, LEAK_AUDIT.md §4) checked against the ENGINE:
 * what each scenario expects the engine to reveal, expose and withhold must hold today, so the model-side harness
 * only has to judge the reply text. Also checks the example lines against the scenario's own forbidden phrases.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { CONFRONTATION_PRESSURE, testimonyToThrow } from "@/engine/confrontation";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { planTurn } from "@/engine/interrogation";
import type { GameState } from "@/engine/types";

interface Scenario {
  id: string;
  suspect: string;
  kind: "interrogate" | "confront";
  addressed?: string;
  partner?: string;
  setup: { discoveredEvidenceIds: string[]; characters: Record<string, { stress?: number; evidenceShownIds?: string[]; testimonyShownIds?: string[]; revealedSecretIds?: string[] }> };
  input: { question: string; presentedEvidenceId?: string; presentedTestimonyId?: string };
  engine: {
    revealSecretId: string | null;
    newlyExposedLieIds: string[];
    stonewallLieIds?: string[];
    secretsInPrompt: string[];
    hiddenFactIds: string[];
    addressedRevealSecretId?: string | null;
    thrownTestimonyId?: string;
  };
  allowed: string[];
  forbidden: { phrases: string[]; concepts: string[] };
  allowedExamples: string[];
  forbiddenExamples: string[];
}

const file = JSON.parse(readFileSync(join(process.cwd(), "cases/blackwood/evals/leak-scenarios.json"), "utf8")) as { version: number; scenarios: Scenario[] };
let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

function stateOf(s: Scenario): GameState {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = [...s.setup.discoveredEvidenceIds];
  for (const [id, rt] of Object.entries(s.setup.characters)) {
    const t = g.characters[id];
    if (rt.stress !== undefined) t.stress = rt.stress;
    t.evidenceShownIds = [...(rt.evidenceShownIds ?? [])];
    t.testimonyShownIds = [...(rt.testimonyShownIds ?? [])];
    t.revealedSecretIds = [...(rt.revealedSecretIds ?? [])];
    for (const x of t.revealedSecretIds) if (!g.revealedSecretIds.includes(x)) g.revealedSecretIds.push(x);
  }
  return g;
}
const commit = (g: GameState, who: string, secret: string | null) => {
  if (!secret) return;
  g.characters[who].revealedSecretIds.push(secret);
  g.revealedSecretIds.push(secret);
};

describe("Blackwood leak-eval scenarios", () => {
  it("has 15 to 20 well-formed scenarios with unique ids", () => {
    expect(file.version).toBe(1);
    expect(file.scenarios.length).toBeGreaterThanOrEqual(15);
    expect(file.scenarios.length).toBeLessThanOrEqual(20);
    expect(new Set(file.scenarios.map((s) => s.id)).size).toBe(file.scenarios.length);
    for (const s of file.scenarios) {
      expect(c.characters.some((x) => x.id === s.suspect), s.id).toBe(true);
      expect(s.allowed.length && s.forbidden.concepts.length && s.forbidden.phrases.length, s.id).toBeTruthy();
      for (const p of s.forbidden.phrases) expect(() => new RegExp(p, "i"), `${s.id}: ${p}`).not.toThrow();
    }
  });

  for (const s of file.scenarios) {
    it(`${s.id}: the engine reveals, exposes and withholds what the scenario says`, () => {
      const g = stateOf(s);
      let suspectMove: Parameters<typeof planTurn>[3] = { ...s.input, playerText: s.input.question };
      if (s.kind === "confront") {
        const a = s.addressed!;
        expect(s.partner, s.id).toBe(s.suspect);
        for (const id of [a, s.suspect]) g.characters[id].stress = Math.min(100, g.characters[id].stress + CONFRONTATION_PRESSURE);
        const thrown = testimonyToThrow(c, g, a, s.suspect);
        expect(thrown, s.id).toBe(s.engine.thrownTestimonyId ?? null);
        const first = planTurn(c, g, a, { playerText: s.input.question });
        expect(first.revealSecretId, `${s.id} addressed`).toBe(s.engine.addressedRevealSecretId ?? null);
        commit(g, a, first.revealSecretId);
        suspectMove = { ...(thrown ? { presentedTestimonyId: thrown } : {}), playerText: s.input.question, allowReveal: !first.revealSecretId };
      }
      const plan = planTurn(c, g, s.suspect, suspectMove);
      if (typeof suspectMove === "object" && suspectMove.presentedTestimonyId) {
        const rt = g.characters[s.suspect];
        if (!rt.testimonyShownIds.includes(suspectMove.presentedTestimonyId)) rt.testimonyShownIds.push(suspectMove.presentedTestimonyId);
      }
      expect(plan.revealSecretId, s.id).toBe(s.engine.revealSecretId);
      expect([...plan.newlyExposedLieIds].sort(), s.id).toEqual([...s.engine.newlyExposedLieIds].sort());
      commit(g, s.suspect, plan.revealSecretId);
      const ctx = buildCharacterContext({ caseData: c, game: g }, s.suspect);
      expect(ctx.secrets.map((x) => x.id).sort(), s.id).toEqual([...s.engine.secretsInPrompt].sort());
      const visible = new Set(ctx.knowledge.map((k) => k.id));
      for (const id of s.engine.hiddenFactIds) expect(visible.has(id), `${s.id}: ${id} must stay out of the prompt`).toBe(false);
      for (const id of s.engine.stonewallLieIds ?? []) expect(ctx.intendedLies.find((l) => l.id === id)?.stonewall, `${s.id}: ${id}`).toBe(true);
    });

    it(`${s.id}: allowed examples pass the forbidden phrases and forbidden examples are caught`, () => {
      const res = s.forbidden.phrases.map((p) => new RegExp(p, "i"));
      for (const line of s.allowedExamples) expect(res.filter((r) => r.test(line)).map(String), `${s.id} allowed: ${line}`).toEqual([]);
      for (const line of s.forbiddenExamples) expect(res.some((r) => r.test(line)), `${s.id} forbidden: ${line}`).toBe(true);
    });
  }
});
