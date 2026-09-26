import { describe, expect, it } from "vitest";
import {
  AccusationSchema,
  CharacterRuntimeStateSchema,
  CharacterSchema,
  FactSchema,
  TimelineEntrySchema,
  GameStateSchema,
  MAX_CONFRONTATION_TURNS,
  type Character,
} from "@/engine";
import { CaseSolutionSchema } from "@/engine/solution";

const validCharacter = {
  id: "test-butler",
  name: "Test Butler",
  role: "The Butler",
  bio: "Has served the household for forty years.",
  personality: {
    traits: ["stiff", "loyal"],
    speechStyle: "Formal, clipped sentences.",
    confidence: 0.6,
    nervousness: 0.4,
    arrogance: 0.3,
    honesty: 0.5,
    impulsiveness: 0.2,
    empathy: 0.5,
    aggression: 0.1,
  },
  goals: ["Protect the family's reputation"],
  knownFactIds: ["butler-in-pantry"],
  beliefs: [
    { id: "b1", statement: "The cook did it.", isAccurate: false, confidence: 0.7 },
  ],
  secrets: [{ id: "s1", description: "Pawned the silver.", severity: "serious" }],
  relationships: [
    { targetCharacterId: "test-cook", trust: 20, fear: 5, affection: 10, resentment: 70, suspicion: 60, kind: "rival" },
  ],
  initialEmotion: { emotion: "calm", intensity: 0.3, composure: 0.9 },
};

describe("CharacterSchema", () => {
  it("accepts a valid authored character and fills defaults", () => {
    const parsed: Character = CharacterSchema.parse(validCharacter);
    expect(parsed.personality.catchphrases).toEqual([]);
    expect(parsed.secrets[0].revealConditions).toBeUndefined();
    expect(parsed.intendedLies).toEqual([]);
  });

  it("rejects unknown keys (strict) and bad ids", () => {
    expect(CharacterSchema.safeParse({ ...validCharacter, isMurderer: true }).success).toBe(false);
    expect(CharacterSchema.safeParse({ ...validCharacter, id: "Bad Id!" }).success).toBe(false);
  });

  it("rejects out-of-range emotional values", () => {
    const bad = { ...validCharacter, initialEmotion: { emotion: "calm", intensity: 2, composure: 0.5 } };
    expect(CharacterSchema.safeParse(bad).success).toBe(false);
  });
});

describe("new schema fields", () => {
  it("requires all numeric personality traits in 0..1", () => {
    const { aggression: _omit, ...noAggression } = validCharacter.personality;
    void _omit;
    expect(CharacterSchema.safeParse({ ...validCharacter, personality: noAggression }).success).toBe(false);
    expect(
      CharacterSchema.safeParse({ ...validCharacter, personality: { ...validCharacter.personality, honesty: 1.2 } }).success,
    ).toBe(false);
  });

  it("validates relationship axes 0..100 and rejects the old sentiment shape", () => {
    const rel = validCharacter.relationships[0];
    expect(CharacterSchema.safeParse({ ...validCharacter, relationships: [{ ...rel, trust: 101 }] }).success).toBe(false);
    expect(
      CharacterSchema.safeParse({ ...validCharacter, relationships: [{ characterId: "x", kind: "k", sentiment: 0, description: "d" }] }).success,
    ).toBe(false);
  });

  it("validates reveal conditions and intended lies", () => {
    const withSecret = (revealConditions: unknown) => ({
      ...validCharacter,
      secrets: [{ id: "s1", description: "d", severity: "serious", revealConditions }],
    });
    expect(CharacterSchema.safeParse(withSecret({ stressThreshold: 60 })).success).toBe(true);
    expect(CharacterSchema.safeParse(withSecret({ evidenceIds: ["x"], mode: "all" })).success).toBe(true);
    expect(CharacterSchema.safeParse(withSecret({ mode: "any" })).success).toBe(false); // no condition at all
    expect(CharacterSchema.safeParse(withSecret({ stressThreshold: 150 })).success).toBe(false);
    const lie = { id: "l1", claim: "I was asleep." };
    expect(CharacterSchema.safeParse({ ...validCharacter, intendedLies: [lie] }).success).toBe(false); // needs topic/aboutFactId
    expect(CharacterSchema.safeParse({ ...validCharacter, intendedLies: [{ ...lie, topic: "sleep" }] }).success).toBe(true);
  });

  it("defaults fact source/confidence and accepts timeline points or windows (not both)", () => {
    const base = { id: "f1", statement: "s", category: "location", locationId: "hall", involvesCharacterIds: ["a"] };
    expect(FactSchema.parse(base)).toMatchObject({ source: "canonical", confidence: 1 });
    expect(FactSchema.safeParse({ ...base, source: "rumour" }).success).toBe(false);
    expect(TimelineEntrySchema.safeParse({ ...base, time: "21:00" }).success).toBe(true);
    expect(TimelineEntrySchema.safeParse({ ...base, from: "21:00", to: "21:10" }).success).toBe(true);
    expect(TimelineEntrySchema.safeParse({ ...base, time: "21:00", from: "21:00", to: "21:10" }).success).toBe(false);
    expect(TimelineEntrySchema.safeParse({ ...base, from: "21:00" }).success).toBe(false);
    expect(TimelineEntrySchema.safeParse(base).success).toBe(false);
    expect(TimelineEntrySchema.safeParse({ ...base, time: "21:00", extra: 1 }).success).toBe(false);
  });

  it("accusations need murderer, weapon, motive and key evidence", () => {
    const acc = { murdererId: "a", weaponId: "w", motiveId: "m", keyEvidenceIds: ["e"] };
    expect(AccusationSchema.safeParse(acc).success).toBe(true);
    expect(AccusationSchema.safeParse({ ...acc, keyEvidenceIds: [] }).success).toBe(false);
    const { motiveId: _m, ...noMotive } = acc;
    void _m;
    expect(AccusationSchema.safeParse(noMotive).success).toBe(false);
  });

  it("runtime state defaults stress 0 and trust 50", () => {
    const rt = CharacterRuntimeStateSchema.parse({ characterId: "a", emotion: validCharacter.initialEmotion });
    expect(rt).toMatchObject({ stress: 0, trust: 50 });
  });
});

describe("GameStateSchema", () => {
  const base = {
    caseId: "blackwood",
    phase: "confronting",
    turn: 3,
    characters: { "test-butler": { characterId: "test-butler", emotion: validCharacter.initialEmotion } },
  };

  it("parses a minimal state with defaults and no solution fields", () => {
    const state = GameStateSchema.parse(base);
    expect(state.outcome).toBe("pending");
    expect(state.activeConfrontation).toBeNull();
    expect(state).not.toHaveProperty("solution");
    expect(GameStateSchema.safeParse({ ...base, solution: { murdererId: "x" } }).success).toBe(false);
  });

  it(`caps confrontation turns at MAX_CONFRONTATION_TURNS (${MAX_CONFRONTATION_TURNS})`, () => {
    expect(MAX_CONFRONTATION_TURNS).toBe(6);
    const ok = { ...base, activeConfrontation: { characterId: "test-butler", turnsUsed: 6 } };
    const tooMany = { ...base, activeConfrontation: { characterId: "test-butler", turnsUsed: 7 } };
    expect(GameStateSchema.safeParse(ok).success).toBe(true);
    expect(GameStateSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("CaseSolutionSchema", () => {
  it("requires a valid HH:MM time", () => {
    const sol = {
      murdererId: "test-butler",
      weaponId: "candlestick",
      locationId: "library",
      time: "21:45",
      motiveId: "greed",
      keyEvidenceIds: ["candlestick"],
    };
    expect(CaseSolutionSchema.parse(sol)).toEqual(sol);
    expect(CaseSolutionSchema.safeParse({ ...sol, time: "9pm" }).success).toBe(false);
    expect(CaseSolutionSchema.safeParse({ ...sol, keyEvidenceIds: [] }).success).toBe(false);
    const { motiveId: _m, ...noMotive } = sol;
    void _m;
    expect(CaseSolutionSchema.safeParse(noMotive).success).toBe(false);
  });
});
