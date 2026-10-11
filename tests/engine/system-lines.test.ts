/** E10: engine system lines are neutral by default and case-overridable (case.json systemLines). */
import { beforeAll, describe, expect, it } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleAccuse, type ClosedGamesStore } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import { LoadedCaseSchema, type LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleHint } from "@/engine/hint-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { SYSTEM_LINES, systemLine } from "@/engine/session";
import { encodeStateToken } from "@/engine/state-token";
import { mockGrok, TEST_ENV } from "../helpers/grok-mock";
import { ungated } from "../helpers/ungated";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const OWN = { caseClosed: "OWN closed line.", caseClosedSearch: "OWN search line.", recordDown: "OWN record line." };
const closedToken = (cs: LoadedCase) => {
  const g = createInitialGameState(cs);
  g.discoveredEvidenceIds.push(cs.solution.weaponId, ...cs.solution.keyEvidenceIds);
  g.accusation = { murdererId: cs.characters[0]!.id, weaponId: cs.solution.weaponId, motiveId: cs.motives[0]!.id, keyEvidenceIds: [cs.solution.weaponId] };
  g.outcome = "lost";
  g.phase = "resolved";
  return encodeStateToken(g, TEST_ENV);
};

describe("E10 system lines", () => {
  it("the defaults make no constable, police, Yard, inspector or telephone claims", () => {
    for (const l of Object.values(SYSTEM_LINES)) expect(l).not.toMatch(/constable|police|yard|inspector|telephone|phone|sealed/i);
  });

  it("schema: optional, non-empty strings, no unknown keys", () => {
    const base = { ...c } as Record<string, unknown>;
    expect(LoadedCaseSchema.safeParse({ ...base, systemLines: OWN }).success).toBe(true);
    expect(LoadedCaseSchema.safeParse({ ...base, systemLines: { caseClosed: "  " } }).success).toBe(false);
    expect(LoadedCaseSchema.safeParse({ ...base, systemLines: { nope: "x" } }).success).toBe(false);
  });

  for (const [label, lines] of [["default", undefined], ["case override", OWN]] as const) {
    it(`${label}: every closed-case route and the record-down 503 use systemLine()`, async () => {
      const cs: LoadedCase = { ...c, ...(lines ? { systemLines: lines } : {}) };
      const want = (k: keyof typeof SYSTEM_LINES) => (lines ? lines[k] : SYSTEM_LINES[k]);
      expect(systemLine(cs, "caseClosed")).toBe(want("caseClosed"));
      const t = closedToken(cs);
      mockGrok({});
      const [a, b] = [cs.characters[0]!.id, cs.characters[1]!.id];
      expect((await handleInterrogate({ characterId: a, question: "Well?", stateToken: t }, { caseData: cs, env: TEST_ENV })).body.response.dialogue).toBe(want("caseClosed"));
      expect((await handleConfront({ characterIds: [a, b], question: "Well?", stateToken: t }, { caseData: cs, env: TEST_ENV })).body.line).toBe(want("caseClosed"));
      expect(handleHint({ stateToken: t }, { caseData: cs, env: TEST_ENV }).body.line).toBe(want("caseClosed"));
      expect(handleInvestigate({ locationId: cs.locations[0]!.id, stateToken: t }, { caseData: cs, env: TEST_ENV }).body.lines).toEqual([want("caseClosedSearch")]);
      const down: ClosedGamesStore = { closeGame: async () => Promise.reject(new Error("down")), getClosed: async () => null };
      const open = ungated(cs);
      const g = createInitialGameState(open);
      g.discoveredEvidenceIds.push(...open.evidence.map((e) => e.id));
      const s = open.solution;
      const r = await handleAccuse(
        { accusation: { murdererId: s.murdererId, weaponId: s.weaponId, motiveId: s.motiveId, keyEvidenceIds: s.keyEvidenceIds.slice(0, 2) }, stateToken: encodeStateToken(g, TEST_ENV) },
        { caseData: open, env: TEST_ENV, closed: down },
      );
      expect(r.status).toBe(503);
      expect(r.body.line).toBe(want("recordDown"));
    });
  }
});
