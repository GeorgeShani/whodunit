import { describe, expect, it } from "vitest";
import { accuseProgress, evaluateCondition, isUnlocked, leadStates, publicProgress } from "@/engine/progress";
import { ConditionSchema, GameStateSchema, type GameState, type Lead } from "@/engine/types";

const game = (over: Partial<GameState> = {}, counts: Record<string, number> = {}): GameState =>
  GameStateSchema.parse({
    caseId: "demo",
    phase: "investigating",
    turn: 0,
    characters: Object.fromEntries(["ann", "bob", "cy"].map((id) => [id, { characterId: id, emotion: { emotion: "calm", intensity: 0.3, composure: 0.9 }, interrogationCount: counts[id] ?? 0 }])),
    ...over,
  });

const leads: Lead[] = [
  { id: "lead-a", title: "A", hint: "ha", closesWhen: { evidenceIds: ["clue-a"] }, closedLine: "done a" },
  { id: "lead-b", title: "B", hint: "hb", opensWhen: { interrogated: [{ characterId: "ann", minExchanges: 2 }] }, closesWhen: { evidenceIds: ["clue-b"] } },
  { id: "lead-c", title: "C", hint: "hc", opensWhen: { leadIds: ["lead-b"] }, closesWhen: { secretIds: ["s1"] } },
];
const chars = ["ann", "bob", "cy"].map((id) => ({ id })) as never;
const c = {
  leads,
  characters: chars,
  locations: [
    { id: "hall", name: "Hall", description: "d" },
    { id: "study", name: "Study", description: "d", lockedLine: "Not yet.", requires: { evidenceIds: ["clue-a"] } },
  ],
  accuseGate: {
    minEvidence: 2,
    minSuspectsQuestioned: { count: 2, minExchanges: 2 },
    minRevealedSecrets: 1,
    closedLeadIds: ["lead-a"],
    lockedLines: { evidence: "need clues", suspects: "talk more", secrets: "no cracks", default: "not ready" },
  },
} as never;

describe("ConditionSchema", () => {
  it("needs at least one atom and rejects unknown keys", () => {
    expect(ConditionSchema.safeParse({}).success).toBe(false);
    expect(ConditionSchema.safeParse({ mode: "any" }).success).toBe(false);
    expect(ConditionSchema.safeParse({ evidenceIds: ["a"], nope: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ interrogated: [{ characterId: "ann" }] }).success).toBe(true);
    expect(ConditionSchema.safeParse({ interrogated: [{ characterId: "ann", minExchanges: 0 }] }).success).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("defaults to all, supports any", () => {
    const g = game({ discoveredEvidenceIds: ["x"] });
    expect(evaluateCondition({ evidenceIds: ["x", "y"] }, g)).toBe(false);
    expect(evaluateCondition({ mode: "any", evidenceIds: ["x", "y"] }, g)).toBe(true);
    expect(evaluateCondition({ mode: "all", evidenceIds: ["x"] }, g)).toBe(true);
  });
  it("reads exchanges, secrets and searched rooms", () => {
    const g = game({ revealedSecretIds: ["s1"], searchedLocationIds: ["hall"] }, { ann: 2 });
    expect(evaluateCondition({ interrogated: [{ characterId: "ann", minExchanges: 2 }] }, g)).toBe(true);
    expect(evaluateCondition({ interrogated: [{ characterId: "ann", minExchanges: 3 }] }, g)).toBe(false);
    expect(evaluateCondition({ interrogated: [{ characterId: "bob" }] }, g)).toBe(false);
    expect(evaluateCondition({ secretIds: ["s1"], searchedLocationIds: ["hall"] }, g)).toBe(true);
  });
  it("a lead atom holds when the lead is open or closed, not hidden", () => {
    expect(evaluateCondition({ leadIds: ["l"] }, game(), { l: "hidden" })).toBe(false);
    expect(evaluateCondition({ leadIds: ["l"] }, game(), { l: "open" })).toBe(true);
    expect(evaluateCondition({ leadIds: ["l"] }, game(), { l: "closed" })).toBe(true);
  });
});

describe("leadStates", () => {
  it("hidden until opensWhen, open, closed (closed wins, even if never opened)", () => {
    expect(leadStates(c, game())).toEqual({ "lead-a": "open", "lead-b": "hidden", "lead-c": "hidden" });
    expect(leadStates(c, game({}, { ann: 2 }))).toMatchObject({ "lead-b": "open", "lead-c": "open" });
    const g = game({ discoveredEvidenceIds: ["clue-a", "clue-b"] }, {});
    expect(leadStates(c, g)).toEqual({ "lead-a": "closed", "lead-b": "closed", "lead-c": "open" });
  });
  it("is monotone: once closed, adding more state never reopens", () => {
    const a = leadStates(c, game({ discoveredEvidenceIds: ["clue-a"] }));
    const b = leadStates(c, game({ discoveredEvidenceIds: ["clue-a", "clue-b"], revealedSecretIds: ["s1"] }, { ann: 5 }));
    expect(a["lead-a"]).toBe("closed");
    expect(b["lead-a"]).toBe("closed");
  });
  it("a dependency cycle resolves to hidden instead of looping", () => {
    const cyc = { leads: [{ id: "x", title: "x", hint: "h", opensWhen: { leadIds: ["y"] }, closesWhen: { evidenceIds: ["e"] } }, { id: "y", title: "y", hint: "h", opensWhen: { leadIds: ["x"] }, closesWhen: { evidenceIds: ["f"] } }] };
    expect(leadStates(cyc as never, game())).toEqual({ x: "hidden", y: "hidden" });
  });
});

describe("isUnlocked", () => {
  it("no requires: unlocked; requires: evaluated", () => {
    expect(isUnlocked({}, game(), {})).toBe(true);
    expect(isUnlocked({ requires: { evidenceIds: ["clue-a"] } }, game(), {})).toBe(false);
    expect(isUnlocked({ requires: { evidenceIds: ["clue-a"] } }, game({ discoveredEvidenceIds: ["clue-a"] }), {})).toBe(true);
  });
});

describe("accuseProgress", () => {
  it("no gate: unlocked", () => {
    expect(accuseProgress({ characters: chars, leads } as never, game()).unlocked).toBe(true);
  });
  it("reports counts and the first unmet item's line, in order clues, suspects, secrets, leads", () => {
    const r1 = accuseProgress(c, game({ discoveredEvidenceIds: ["clue-a"] }));
    expect(r1).toMatchObject({ unlocked: false, line: "need clues", checklist: { clues: { have: 1, need: 2 }, suspects: { have: 0, need: 2 }, secrets: { have: 0, need: 1 } } });
    const two = game({ discoveredEvidenceIds: ["clue-a", "clue-b"] }, { ann: 2 });
    expect(accuseProgress(c, two).line).toBe("talk more");
    const three = game({ discoveredEvidenceIds: ["clue-a", "clue-b"] }, { ann: 2, bob: 3 });
    expect(accuseProgress(c, three).line).toBe("no cracks");
    const ok = game({ discoveredEvidenceIds: ["clue-a", "clue-b"], revealedSecretIds: ["s1"] }, { ann: 2, bob: 3 });
    expect(accuseProgress(c, ok)).toMatchObject({ unlocked: true, checklist: { suspects: { have: 2, need: 2 } } });
    expect(accuseProgress(c, ok).line).toBeUndefined();
  });
  it("an open lead keeps it locked with the leads line (default when absent)", () => {
    const g = game({ discoveredEvidenceIds: ["x", "y"], revealedSecretIds: ["s1"] }, { ann: 2, bob: 2 });
    expect(accuseProgress(c, g)).toMatchObject({ unlocked: false, line: "not ready" });
  });
});

describe("publicProgress", () => {
  it("lists visible leads only, marks new ones, and lists locked rooms; never leaks conditions", () => {
    const before = leadStates(c, game());
    const after = game({ discoveredEvidenceIds: ["clue-a"] }, { ann: 2 });
    const p = publicProgress(c, after, before);
    expect(p.leads.map((l) => [l.id, l.state])).toEqual([["lead-a", "closed"], ["lead-b", "open"], ["lead-c", "open"]]);
    expect(p.newLeadIds.sort()).toEqual(["lead-a", "lead-b", "lead-c"]);
    expect(p.lockedLocationIds).toEqual([]);
    expect(publicProgress(c, game()).lockedLocationIds).toEqual(["study"]);
    expect(JSON.stringify(p)).not.toMatch(/closesWhen|opensWhen|requires/);
    expect(p.leads[0]).toEqual({ id: "lead-a", title: "A", state: "closed", closedLine: "done a" });
    expect(p.leads[1]).toMatchObject({ hint: "hb" });
  });
});
