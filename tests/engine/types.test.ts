import { describe, expect, it } from "vitest";
import {
  CharacterSchema,
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
  },
  goals: ["Protect the family's reputation"],
  knownFactIds: ["butler-in-pantry"],
  beliefs: [
    { id: "b1", statement: "The cook did it.", isAccurate: false, confidence: 0.7 },
  ],
  secrets: [{ id: "s1", description: "Pawned the silver.", severity: "serious" }],
  relationships: [
    { characterId: "test-cook", kind: "rival", sentiment: -0.5, description: "Feud over soup." },
  ],
  initialEmotion: { emotion: "calm", intensity: 0.3, composure: 0.9 },
};

describe("CharacterSchema", () => {
  it("accepts a valid authored character and fills defaults", () => {
    const parsed: Character = CharacterSchema.parse(validCharacter);
    expect(parsed.personality.catchphrases).toEqual([]);
    expect(parsed.secrets[0].pressuredByEvidenceIds).toEqual([]);
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
    const sol = { murdererId: "test-butler", weaponId: "candlestick", locationId: "library", time: "21:45" };
    expect(CaseSolutionSchema.parse(sol)).toEqual(sol);
    expect(CaseSolutionSchema.safeParse({ ...sol, time: "9pm" }).success).toBe(false);
  });
});
