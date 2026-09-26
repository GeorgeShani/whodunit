/**
 * Canon check tightening (#6 follow-up, Marvin): a clock time said about a
 * named person or place must match a fact the character knows about THAT
 * subject, not just any time in their data. Real Blackwood data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { allowedTimes, canonTimes, checkTimes } from "@/ai/canon-check";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const Q = "When did her ladyship leave the dining room?";
const reginald = (caseData = c) => buildCharacterContext({ caseData, game: createInitialGameState(caseData) }, "reginald");

describe("subject-matched times (Reginald)", () => {
  it("REGRESSION: 'a quarter to nine' about Victoria leaving (his own 20:45 kitchen time) is rejected", () => {
    const ctx = reginald();
    const bad = "Lady Victoria left the dining room at a quarter to nine, sir.";
    // The old rule accepted it: 20:45 is in his data (loc-reginald-2045, the kitchen).
    expect(checkTimes(bad, allowedTimes(ctx, { exposedLieIds: [] }, Q)).ok).toBe(true);
    const res = checkTimes(bad, canonTimes(ctx, { exposedLieIds: [] }, Q));
    expect(res).toEqual({ ok: false, offending: ["quarter to nine"] });
  });

  it("allows the same time about himself or the place it belongs to", () => {
    const allowed = canonTimes(reginald(), { exposedLieIds: [] }, Q);
    expect(checkTimes("At a quarter to nine I was clearing up and making coffee.", allowed).ok).toBe(true);
    expect(checkTimes("I was in the kitchen at a quarter to nine, sir.", allowed).ok).toBe(true);
  });

  it("allows a time from a fact about that person (his 20:57 sighting names Victoria)", () => {
    const allowed = canonTimes(reginald(), { exposedLieIds: [] }, Q);
    expect(checkTimes("Lady Victoria swept past me in the hall at three minutes to nine.", allowed).ok).toBe(true);
  });

  it("a subject-less clause inherits the sentence's subject; no subject at all falls back to the old rule", () => {
    const allowed = canonTimes(reginald(), { exposedLieIds: [] }, Q);
    expect(checkTimes("Lady Victoria went out and came back at a quarter to nine.", allowed).ok).toBe(false);
    expect(checkTimes("It was a quarter to nine, sir.", allowed).ok).toBe(true);
  });

  it("aliases are subjects too: with 'her ladyship' authored, the regression holds for that phrasing", () => {
    const withAlias = structuredClone(c);
    withAlias.characters.find((x) => x.id === "victoria")!.aliases = ["her ladyship"];
    const allowed = canonTimes(reginald(withAlias), { exposedLieIds: [] }, "When did she leave?");
    expect(checkTimes("Her ladyship left at a quarter to nine, sir.", allowed).ok).toBe(false);
    // Without the alias the sentence names no one and only the old rule applies.
    const noAlias = structuredClone(c);
    noAlias.characters.find((x) => x.id === "victoria")!.aliases = [];
    expect(checkTimes("Her ladyship left at a quarter to nine, sir.", canonTimes(reginald(noAlias), { exposedLieIds: [] }, "When did she leave?")).ok).toBe(true);
    // Blackwood now authors the alias, so the shipped case catches it.
    expect(checkTimes("Her ladyship left at a quarter to nine, sir.", canonTimes(reginald(), { exposedLieIds: [] }, "When did she leave?")).ok).toBe(false);
  });

  it("times the detective said, stories and shown clues stay allowed whatever the subject", () => {
    const allowed = canonTimes(reginald(), { exposedLieIds: [] }, "Did Lady Victoria leave at ten past eight?");
    expect(checkTimes("Lady Victoria, at ten past eight? I couldn't say, sir.", allowed).ok).toBe(true);
  });

  it("through the handler: the bad line is retried, the grounded one kept", async () => {
    const { calls } = mockGrok(
      { content: goodReply({ dialogue: "Lady Victoria left the dining room at a quarter to nine, sir." }) },
      { content: goodReply({ dialogue: "I couldn't say when her ladyship left the dining room, sir." }) },
    );
    const r = await handleInterrogate({ caseId: "blackwood", characterId: "reginald", question: Q }, { caseData: c, env: TEST_ENV });
    expect(calls.length).toBe(2);
    expect(r.body.source).toBe("model");
    expect(r.body.response.dialogue).toContain("couldn't say");
  });
});
