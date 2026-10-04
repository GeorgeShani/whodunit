/** Progression on the routes: search gating, `progress` on every token-returning route (progress-light fixture). */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleConfront } from "@/ai/confront-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleAccuse } from "@/engine/accuse-handler";
import { handleHint } from "@/engine/hint-handler";
import { saveSession } from "@/engine/session";
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

describe("the accuse gate and the win rule", () => {
  const env = TEST_ENV;
  const base = () => {
    const g = createInitialGameState(c);
    g.gameId = "game-progress-1";
    return g;
  };
  const ready = () => {
    const g = base();
    g.discoveredEvidenceIds = ["oil-can", "wet-logbook", "brass-spyglass"];
    g.searchedLocationIds = ["galley", "dock"];
    g.revealedSecretIds = ["marlow-secret", "marlow-saw-quill"];
    g.characters["cook-marlow"].interrogationCount = 4;
    g.characters["keeper-quill"].interrogationCount = 2;
    return g;
  };
  const accuse = (g: ReturnType<typeof base>, accusation: Record<string, unknown>) =>
    handleAccuse({ caseId: "progress-light", stateToken: saveSession(g, env), accusation }, { caseData: c, env });
  const right = { murdererId: "keeper-quill", weaponId: "brass-spyglass", motiveId: "salvage-rights", keyEvidenceIds: ["brass-spyglass", "wet-logbook"] };

  it("403 accuse_locked with the first unmet line, token unchanged, counts only", async () => {
    const g = base();
    g.discoveredEvidenceIds = ["oil-can"];
    const token = saveSession(g, env);
    const r = await handleAccuse({ caseId: "progress-light", stateToken: token, accusation: right }, { caseData: c, env });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "accuse_locked", line: "More clues, detective." });
    expect(r.body.outcome).toBeUndefined();
    expect(r.body.progress!.accuse.checklist.clues).toEqual({ have: 1, need: 3 });
    const after = await handleAccuse({ caseId: "progress-light", stateToken: r.body.stateToken!, accusation: right }, { caseData: c, env });
    expect(after.status).toBe(403); // still a pending game: the refusal did not spend the one accusation
  });
  it("each unmet item gives its own line, in order", async () => {
    const g = ready();
    g.characters["keeper-quill"].interrogationCount = 0;
    expect((await accuse(g, right)).body.line).toBe("Talk to more of the household.");
    g.characters["keeper-quill"].interrogationCount = 2;
    g.revealedSecretIds = ["marlow-secret"];
    expect((await accuse(g, right)).body.line).toBe("Nobody has cracked yet.");
    g.revealedSecretIds = ["marlow-secret", "marlow-saw-quill"];
    g.discoveredEvidenceIds = ["oil-can", "wet-logbook", "x"];
    g.discoveredEvidenceIds = ["oil-can", "wet-logbook", "brass-spyglass"];
    expect((await accuse(g, right)).status).not.toBe(403);
  });
  it("citing testimony nobody revealed is refused", async () => {
    const r = await accuse(ready(), { ...right, keyTestimonyIds: ["quill-secret"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("testimony_not_revealed");
  });
  it("a win needs the right culprit/weapon/motive, BOTH key clues and the key testimony", async () => {
    const win = await accuse(ready(), { ...right, keyTestimonyIds: ["marlow-saw-quill"] });
    expect(win.body.outcome).toBe("won");
    expect(win.body.verdict).toMatchObject({ hasKeyEvidence: true, hasKeyTestimony: true });
    const noTestimony = await accuse(ready(), right);
    expect(noTestimony.body.outcome).toBe("lost");
    const oneClue = await accuse(ready(), { ...right, keyEvidenceIds: ["brass-spyglass"], keyTestimonyIds: ["marlow-saw-quill"] });
    expect(oneClue.body.outcome).toBe("lost");
    const wrongTestimony = await accuse(ready(), { ...right, keyTestimonyIds: ["marlow-secret"] });
    expect(wrongTestimony.body.outcome).toBe("lost");
    // a loss never carries the solution or the per-field verdict (#22)
    expect(JSON.stringify(noTestimony.body)).not.toMatch(/"solution"|"verdict"/);
  });
  it("the accusation round-trips through the signed token with its cited testimony", async () => {
    const win = await accuse(ready(), { ...right, keyTestimonyIds: ["marlow-saw-quill"] });
    const replay = await handleAccuse({ caseId: "progress-light", stateToken: win.body.stateToken!, accusation: right }, { caseData: c, env });
    expect(replay.status).toBe(409);
    expect(replay.body.accusation?.keyTestimonyIds).toEqual(["marlow-saw-quill"]);
    expect(replay.body.outcome).toBe("won");
  });
  it("public progress tells the form to cite testimony", () => {
    expect(handleInvestigate({ caseId: "progress-light", locationId: "lamp-room" }, { caseData: c, env }).body.progress!.accuse.citeTestimony).toBe(true);
  });
});
