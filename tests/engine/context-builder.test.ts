import { beforeAll, describe, expect, it } from "vitest";
import { buildCharacterContext as viaAi } from "@/ai/context-builder";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, UnknownCharacterError } from "@/engine/context-builder";
import { createInitialGameState, type CaseState } from "@/engine/game-state";
import { FIXTURE_ID, FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;

/** State where the player has shown bravo both discovered clues AND tried to show the undiscovered weapon. */
function makeState(): CaseState {
  const game = createInitialGameState(c);
  game.turn = 3;
  game.characters.bravo.evidenceShownIds = ["note", "heavy-wrench"]; // heavy-wrench is NOT discovered
  game.characters.bravo.memory = [
    { turn: 1, speaker: "player", text: "Where were you?" },
    { turn: 2, speaker: "player", text: "Look at this.", evidenceId: "note" },
    { turn: 3, speaker: "player", text: "And this?", evidenceId: "heavy-wrench" },
  ];
  game.characters.alpha.memory = [{ turn: 1, speaker: "player", text: "ALPHA_MEMORY_LINE" }];
  game.characters.charlie.revealedSecretIds = ["charlie-secret"];
  game.statements = [
    { id: "st1", characterId: "bravo", text: "BRAVO_STATEMENT", turn: 1, mode: "interrogation", relatedFactIds: [], contradictedByEvidenceIds: ["heavy-wrench"] },
    { id: "st2", characterId: "alpha", text: "ALPHA_STATEMENT", turn: 1, mode: "interrogation", relatedFactIds: [], contradictedByEvidenceIds: [] },
  ];
  return { caseData: c, game };
}

/** Collect every key and string value anywhere in the object. */
function deepScan(value: unknown, keys = new Set<string>(), strings = new Set<string>()) {
  if (typeof value === "string") strings.add(value);
  else if (Array.isArray(value)) value.forEach((v) => deepScan(v, keys, strings));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      deepScan(v, keys, strings);
    }
  }
  return { keys, strings };
}

const SOLUTION_KEYS = ["solution", "murdererId", "murderer", "weaponId", "isMurderer", "isGuilty", "guilty", "culprit", "timeline", "isAccurate", "pressuredByEvidenceIds", "outcome"];

beforeAll(async () => {
  c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
});

describe("buildCharacterContext", () => {
  it("throws on an unknown characterId", () => {
    expect(() => buildCharacterContext(makeState(), "zed")).toThrow(UnknownCharacterError);
    expect(() => buildCharacterContext(makeState(), "victim-v")).toThrow(UnknownCharacterError);
  });

  it("is re-exported from ai/context-builder", () => {
    expect(viaAi).toBe(buildCharacterContext);
  });

  for (const id of ["alpha", "bravo", "charlie"]) {
    it(`never leaks the solution object or solution keys (${id})`, () => {
      const ctx = buildCharacterContext(makeState(), id);
      const json = JSON.stringify(ctx);
      const { keys } = deepScan(ctx);
      for (const k of SOLUTION_KEYS) expect(keys.has(k), `key ${k}`).toBe(false);
      expect(json).not.toContain(JSON.stringify(c.solution));
      expect(json).not.toContain(JSON.stringify(c.solution).slice(1, -1));
      // Weapon is undiscovered: its id/description must not appear anywhere.
      expect(json).not.toContain("heavy-wrench");
      expect(json).not.toContain("UNDISCOVERED_WEAPON_DESC");
    });

    it(`contains no other character's private facts, secrets, beliefs, memory or statements (${id})`, () => {
      const json = JSON.stringify(buildCharacterContext(makeState(), id));
      const prefix = id.toUpperCase();
      for (const other of ["ALPHA", "BRAVO", "CHARLIE"].filter((p) => p !== prefix)) {
        for (const tag of ["_SECRET", "_BELIEF", "_PRIVATE_FACT", "_GUILTY_FACT", "_REL", "_MEMORY_LINE", "_STATEMENT"]) {
          expect(json, `${id} must not see ${other}${tag}`).not.toContain(`${other}${tag}`);
        }
      }
      // Other characters' secret ids must not appear either.
      for (const other of ["alpha", "bravo", "charlie"].filter((o) => o !== id)) {
        expect(json).not.toContain(`${other}-secret`);
        expect(json).not.toContain(`${other}-belief`);
      }
    });
  }

  it("gives the murderer their own guilty knowledge, without a solution flag", () => {
    const ctx = buildCharacterContext(makeState(), "alpha");
    expect(ctx.knowledge.map((k) => k.id)).toContain("alpha-struck-victim");
    expect(JSON.stringify(ctx)).toContain("ALPHA_GUILTY_FACT");
    expect(ctx.secrets[0].description).toContain("ALPHA_SECRET");
    expect(Object.keys(ctx).sort()).toEqual(
      ["beliefs", "case", "emotion", "evidenceShown", "goals", "knowledge", "memory", "persona", "relationships", "secrets", "statements"],
    );
    expect(ctx.relationships[0]).toMatchObject({ characterId: "victim-v", name: "Victor Fixture" });
  });

  it("innocents do not get the murderer's guilty knowledge", () => {
    for (const id of ["bravo", "charlie"]) {
      const json = JSON.stringify(buildCharacterContext(makeState(), id));
      expect(json).not.toContain("alpha-struck-victim");
      expect(json).not.toContain("GUILTY");
    }
  });

  it("includes only discovered evidence that was actually shown to this character", () => {
    const bravo = buildCharacterContext(makeState(), "bravo");
    expect(bravo.evidenceShown.map((e) => e.id)).toEqual(["note"]);
    expect(JSON.stringify(bravo)).not.toContain("torn-glove"); // discovered but never shown
    expect(bravo.memory.map((m) => m.turn)).toEqual([1, 2]); // memory about the undiscovered weapon is dropped
    expect(bravo.statements).toEqual([{ id: "st1", text: "BRAVO_STATEMENT", turn: 1, mode: "interrogation" }]);

    const charlie = buildCharacterContext(makeState(), "charlie");
    expect(charlie.evidenceShown).toEqual([]);
    expect(JSON.stringify(charlie)).not.toContain("DISCOVERED_EVIDENCE_DESC");
    expect(charlie.secrets[0].revealed).toBe(true);
  });

  it("exposes the character's own persona, beliefs (without truth labels), goals and emotion", () => {
    const ctx = buildCharacterContext(makeState(), "bravo");
    expect(ctx.persona).toMatchObject({ id: "bravo", name: "Bravo Testperson", role: "The Gardener" });
    expect(ctx.beliefs).toEqual([{ id: "bravo-belief", statement: "BRAVO_BELIEF: Charlie did it.", confidence: 0.7 }]);
    expect(ctx.goals).toEqual(["Bravo Testperson goal"]);
    expect(ctx.emotion.emotion).toBe("nervous");
    expect(ctx.case.otherCharacters.map((o) => o.id)).toEqual(["alpha", "charlie"]);
  });

  it("does not mutate or alias the loaded case", () => {
    const state = makeState();
    const ctx = buildCharacterContext(state, "bravo");
    ctx.persona.personality.traits.push("mutated");
    ctx.goals.push("mutated");
    expect(c.characters.find((x) => x.id === "bravo")!.personality.traits).not.toContain("mutated");
    expect(c.characters.find((x) => x.id === "bravo")!.goals).not.toContain("mutated");
  });
});
