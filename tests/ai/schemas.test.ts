import { describe, expect, it } from "vitest";
import { CharacterResponseSchema, createFallbackCharacterResponse } from "@/ai/schemas";

describe("CharacterResponseSchema", () => {
  it("accepts a valid LLM response and fills defaults", () => {
    const parsed = CharacterResponseSchema.parse({
      dialogue: "Me? Murder? I was polishing the gramophone all evening!",
      emotion: "defensive",
      intensity: 0.8,
      evidenceReactions: [{ evidenceId: "muddy-boots", reaction: "nervous" }],
    });
    expect(parsed.wantsToLeave).toBe(false);
    expect(parsed.evidenceReactions).toHaveLength(1);
  });

  it("rejects fields that would let the AI decide the solution or win state", () => {
    const base = { dialogue: "It was me!", emotion: "panicked", intensity: 1 };
    for (const extra of [{ murdererId: "butler" }, { outcome: "won" }, { revealSecretIds: ["s1"] }]) {
      expect(CharacterResponseSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("rejects empty dialogue and unknown emotions", () => {
    expect(CharacterResponseSchema.safeParse({ dialogue: "  ", emotion: "calm", intensity: 0.1 }).success).toBe(false);
    expect(CharacterResponseSchema.safeParse({ dialogue: "Hi", emotion: "hangry", intensity: 0.1 }).success).toBe(false);
  });
});

describe("createFallbackCharacterResponse", () => {
  it("returns a valid, harmless in-character response", () => {
    const fb = createFallbackCharacterResponse({ seed: 7, emotion: "nervous" });
    expect(CharacterResponseSchema.safeParse(fb).success).toBe(true);
    expect(fb.emotion).toBe("nervous");
    expect(fb.evidenceReactions).toEqual([]);
    expect(createFallbackCharacterResponse().emotion).toBe("flustered");
  });
});
