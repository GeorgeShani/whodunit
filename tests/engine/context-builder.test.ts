import { beforeAll, describe, expect, it } from "vitest";
import { buildCharacterContext as viaAi } from "@/ai/context-builder";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext, UnknownCharacterError } from "@/engine/context-builder";
import { createInitialGameState, type CaseState } from "@/engine/game-state";
import { FIXTURE_ID, FIXTURES_DIR } from "../helpers/fixture";
import { deepScan, SOLUTION_KEYS } from "../helpers/leak-scan";

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

beforeAll(async () => {
  c = await loadCase(FIXTURE_ID, FIXTURES_DIR);
});

describe("buildCharacterContext", () => {
  it.each(["alpha", "bravo", "charlie"])("never includes endings (%s)", (id) => {
    expect(c.endings).toBeDefined();
    const json = JSON.stringify(buildCharacterContext(makeState(), id));
    for (const banned of ["ENDING_", "endings", "confession", "escapedLine"]) expect(json).not.toContain(banned);
  });

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
      expect(json).not.toContain("SOLUTION_EXPLANATION");
      expect(json).not.toContain("partnership-dispute"); // true motive id
      for (const m of c.motives) expect(json).not.toContain(m.label);
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
        for (const tag of ["_SECRET", "_BELIEF", "_PRIVATE_FACT", "_GUILTY_FACT", "_REL", "_MEMORY_LINE", "_STATEMENT", "_LIE"]) {
          expect(json, `${id} must not see ${other}${tag}`).not.toContain(`${other}${tag}`);
        }
      }
      // Other characters' secret ids must not appear either.
      for (const other of ["alpha", "bravo", "charlie"].filter((o) => o !== id)) {
        expect(json).not.toContain(`${other}-secret`);
        expect(json).not.toContain(`${other}-belief`);
        expect(json).not.toContain(`${other}-lie`);
      }
    });
  }

  it("withholds the murderer's guilty knowledge and secret while locked; only the story to maintain (#7)", () => {
    const ctx = buildCharacterContext(makeState(), "alpha");
    expect(ctx.knowledge.map((k) => k.id)).not.toContain("alpha-struck-victim");
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("ALPHA_GUILTY_FACT");
    expect(json).not.toContain("ALPHA_SECRET");
    expect(ctx.secrets).toEqual([]);
    expect(Object.keys(ctx).sort()).toEqual([
      "beliefs", "case", "emotion", "evidenceShown", "goals", "intendedLies", "knowledge", "memory", "persona", "playerClaims",
      "relationships", "secrets", "state", "statements", "testimonyShown",
    ]);
    expect(ctx.relationships[0]).toMatchObject({ targetCharacterId: "victim-v", name: "Victor Fixture" });
    expect(ctx.relationships[0]).toHaveProperty("resentment");
    // Own lie: claim + status only, no fact/evidence links.
    expect(ctx.intendedLies).toEqual([{ id: "alpha-lie", claim: "ALPHA_LIE: I never left the hall all evening.", status: "maintain", told: false }]);
  });

  it("gives the murderer their guilty knowledge only once the engine has revealed the secret", () => {
    const state = makeState();
    state.game.characters.alpha.revealedSecretIds = ["alpha-secret"];
    // The lie about the same fact must be broken too, or its truth stays withheld.
    state.game.discoveredEvidenceIds.push("heavy-wrench");
    state.game.characters.alpha.evidenceShownIds = ["heavy-wrench"];
    const ctx = buildCharacterContext(state, "alpha");
    expect(JSON.stringify(ctx)).toContain("ALPHA_GUILTY_FACT");
    expect(ctx.secrets[0].description).toContain("ALPHA_SECRET");
    // Secret conditions are engine-only.
    expect(Object.keys(ctx.secrets[0]).sort()).toEqual(["description", "id", "revealed", "severity"]);
    // Knowledge from timeline carries provenance.
    expect(ctx.knowledge.find((k) => k.id === "alpha-struck-victim")).toMatchObject({ time: "21:00", location: "Study", source: "canonical", confidence: 1 });
    expect(ctx.intendedLies[0].status).toBe("exposed");
    expect(buildCharacterContext(makeState(), "alpha").secrets).toEqual([]);
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
    expect(ctx.knowledge.find((k) => k.id === "bravo-in-garden")).toMatchObject({ from: "20:30", to: "21:30", source: "witnessed", confidence: 0.9 });
    expect(ctx.persona.personality.honesty).toBeTypeOf("number");
    expect(ctx.intendedLies).toEqual([{ id: "bravo-lie", topic: "money", claim: "BRAVO_LIE: I have never gambled in my life.", status: "maintain", told: false }]);
    expect(ctx.state).toEqual({ stress: 0, trust: 50, band: "calm", brokeDown: false });
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
