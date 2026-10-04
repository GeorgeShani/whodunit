/** Progression on the routes: search gating, `progress` on every token-returning route (progress-light fixture). */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleConfront } from "@/ai/confront-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleHint } from "@/engine/hint-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { searchLocation } from "@/engine/investigation";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("progress-light", path.join(process.cwd(), "tests/fixtures/progression"));
});

describe("searchLocation gating (state before the action)", () => {
  it("a locked room returns its lockedLine, finds nothing and is not marked searched", () => {
    const g = createInitialGameState(c);
    const r = searchLocation(c, g, "dock");
    expect(r).toMatchObject({ locked: true, newlyFound: [], lines: ["The dock is roped off until you have seen the galley."] });
    expect(g.searchedLocationIds).toEqual([]);
    expect(g.discoveredEvidenceIds).toEqual(["oil-can"]);
  });
  it("a locked clue stays hidden, its lockedLine is appended, and the room still counts as searched", () => {
    const g = createInitialGameState(c);
    const r = searchLocation(c, g, "galley");
    expect(r.newlyFound).toEqual([]);
    expect(r.lines).toContain("Something in the galley is still hidden from you.");
    expect(r.lines.join(" ")).not.toMatch(/nothing new/i);
    expect(g.searchedLocationIds).toEqual(["galley"]);
    expect(g.discoveredEvidenceIds).not.toContain("wet-logbook");
  });
  it("the unlock needs the lead (two exchanges with the cook); a repeat search then finds it", () => {
    const g = createInitialGameState(c);
    searchLocation(c, g, "galley");
    g.characters["cook-marlow"].interrogationCount = 1;
    expect(searchLocation(c, g, "galley").newlyFound).toEqual([]);
    g.characters["cook-marlow"].interrogationCount = 2;
    const again = searchLocation(c, g, "galley");
    expect(again.newlyFound.map((e) => e.id)).toEqual(["wet-logbook"]);
  });
  it("one search never chains two unlocks: the dock opens only after the galley has been searched", () => {
    const g = createInitialGameState(c);
    g.characters["cook-marlow"].interrogationCount = 2;
    expect(searchLocation(c, g, "dock").locked).toBe(true);
    expect(searchLocation(c, g, "galley").newlyFound.map((e) => e.id)).toEqual(["wet-logbook"]);
    expect(searchLocation(c, g, "dock").newlyFound.map((e) => e.id)).toEqual(["brass-spyglass"]);
  });
});

describe("progress on the routes", () => {
  const env = TEST_ENV;
  const inv = (locationId: string, stateToken?: string) => handleInvestigate({ caseId: "progress-light", locationId, ...(stateToken ? { stateToken } : {}) }, { caseData: c, env });

  it("investigate: locked flag, lockedLocationIds, no leaked conditions", () => {
    const r = inv("dock");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ locked: true, found: [] });
    expect(r.body.progress!.lockedLocationIds).toEqual(["dock"]);
    expect(r.body.progress!.accuse).toMatchObject({ unlocked: false, line: "More clues, detective.", checklist: { clues: { have: 1, need: 3 }, suspects: { have: 0, need: 2 }, secrets: { have: 0, need: 2 } } });
    expect(JSON.stringify(r.body)).not.toMatch(/requires|opensWhen|closesWhen|accuseGate/);
  });
  it("searching the galley opens the dock and a new lead (newLeadIds is the before/after difference)", () => {
    const a = inv("galley");
    expect(a.body.progress!.lockedLocationIds).toEqual([]);
    expect(a.body.progress!.leads.map((l) => l.id)).toEqual(["lead-spyglass"]);
    expect(a.body.progress!.newLeadIds).toEqual(["lead-spyglass"]);
    const b = inv("galley", a.body.stateToken);
    expect(b.body.progress!.newLeadIds).toEqual([]);
  });
  it("interrogate: the second exchange with the cook opens lead-galley; hint and confront carry progress too", async () => {
    mockGrok({});
    const ask = (stateToken?: string) => handleInterrogate({ caseId: "progress-light", characterId: "cook-marlow", question: "Where were you at ten?", ...(stateToken ? { stateToken } : {}) }, { caseData: c, env });
    const one = await ask();
    expect(one.body.progress!.leads.map((l) => l.id)).not.toContain("lead-galley");
    const two = await ask(one.body.stateToken);
    expect(two.body.progress!.leads).toEqual([expect.objectContaining({ id: "lead-galley", state: "open", hint: expect.any(String) })]);
    expect(two.body.progress!.newLeadIds).toEqual(["lead-galley"]);
    const hint = handleHint({ caseId: "progress-light", stateToken: two.body.stateToken }, { caseData: c, env });
    expect(hint.body.progress).toBeDefined();
    mockGrok({ content: goodReply({ dialogue: "Not a word to you about the galley, sir, none at all." }) }, { content: goodReply({ dialogue: "Quite a different sentence from the keeper entirely." }) });
    const conf = await handleConfront({ caseId: "progress-light", characterIds: ["cook-marlow", "keeper-quill"], question: "Well?", stateToken: two.body.stateToken }, { caseData: c, env });
    expect(conf.body.progress!.leads.map((l) => l.id)).toContain("lead-galley");
  });
  it("a bad token resets and the progress is the starting one", () => {
    const r = inv("lamp-room", "garbage");
    expect(r.body.notice).toBeTruthy();
    expect(r.body.progress!.lockedLocationIds).toEqual(["dock"]);
  });
});
