import { describe, expect, it } from "vitest";
import { clearGame, loadGame, parseSavedGame, withoutUnansweredQuestions, saveGame, sessionKey, SESSION_VERSION, type SavedGame } from "@/lib/game-session";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

const sample: SavedGame = {
  v: SESSION_VERSION,
  caseId: "blackwood",
  screen: "interrogation",
  activeId: "reginald",
  stateToken: "v1.abc.def",
  conversations: { reginald: [{ id: "m0", speaker: "player", text: "Hello?" }, { id: "m1", speaker: "character", text: "Good evening, sir." }] },
  emotions: { reginald: "nervous" },
  evidence: [],
  searched: ["hall"],
  searchLines: { hall: ["You search the hall."] },
  nextId: 1,
};

describe("game session persistence (#11)", () => {
  it("round-trips the token, transcripts and notebook per case", () => {
    const s = memStore();
    saveGame(sample, s);
    expect(s.m.has(sessionKey("blackwood"))).toBe(true);
    expect(loadGame("blackwood", s)).toEqual(sample);
    expect(loadGame("other-case", s)).toBeNull();
    clearGame("blackwood", s);
    expect(loadGame("blackwood", s)).toBeNull();
  });

  it.each([
    ["not JSON", "{nope"],
    ["wrong version", JSON.stringify({ ...sample, v: 99 })],
    ["bad screen", JSON.stringify({ ...sample, screen: "accuse-everyone" })],
    ["bad token type", JSON.stringify({ ...sample, stateToken: 42 })],
    ["missing transcripts", JSON.stringify({ ...sample, conversations: undefined })],
  ])("ignores a malformed blob: %s", (_l, raw) => {
    expect(parseSavedGame(raw, "blackwood")).toBeNull();
  });

  it("keeps the closed-case result and the ending screen (Phase 8)", () => {
    const result = {
      outcome: "lost" as const,
      accusation: { murdererId: "gregory", weaponId: "burned-letter", motiveId: "revenge", keyEvidenceIds: ["burned-letter"] },
      verdict: { murdererCorrect: false, weaponCorrect: false, motiveCorrect: false, hasKeyEvidence: true, keyEvidenceCited: ["burned-letter"] },
      ending: { outcome: "lost" as const, headline: "THE MURDERER ESCAPED!", accusedId: "gregory", beats: [] },
    };
    const g = parseSavedGame(JSON.stringify({ ...sample, screen: "ending", result }), "blackwood");
    expect(g?.screen).toBe("ending");
    expect(g?.result?.verdict?.hasKeyEvidence).toBe(true);
    // A half-formed result is dropped (the game then falls back to the suspects screen).
    expect(parseSavedGame(JSON.stringify({ ...sample, screen: "ending", result: { outcome: "won" } }), "blackwood")?.result).toBeUndefined();
  });

  it("drops a question whose reply never arrived, on save and on load (#28)", () => {
    const q = { id: "m1", speaker: "player" as const, text: "Who did it?" };
    const a = { id: "m2", speaker: "character" as const, text: "Not I.", speakerName: "Gregory" };
    const q2 = { id: "m3", speaker: "player" as const, text: "Are you sure?" };
    expect(withoutUnansweredQuestions({ gregory: [q, a, q2], reginald: [q, a], archibald: [q] })).toEqual({ gregory: [q, a], reginald: [q, a], archibald: [] });
    const g = parseSavedGame(JSON.stringify({ ...sample, conversations: { gregory: [q, a, q2] } }), "blackwood");
    expect(g?.conversations.gregory).toEqual([q, a]);
  });

  it("restores the confrontation screen and pair, dropping a malformed pair", () => {
    const confront = { pair: ["victoria", "reginald"], status: { "reginald|victoria": { turnsUsed: 2, over: false } } };
    const g = parseSavedGame(JSON.stringify({ ...sample, screen: "confront", confront }), "blackwood");
    expect(g?.screen).toBe("confront");
    expect(g?.confront).toEqual(confront);
    expect(parseSavedGame(JSON.stringify({ ...sample, confront: { pair: ["victoria"], status: {} } }), "blackwood")?.confront).toBeUndefined();
  });

  it("keeps the stress meters, dropping junk values (Phase 7)", () => {
    const g = parseSavedGame(JSON.stringify({ ...sample, stress: { victoria: 72, gregory: "lots", reginald: 400 } }), "blackwood");
    expect(g?.stress).toEqual({ victoria: 72 });
  });

  it("survives storage that throws", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("x"); } };
    expect(loadGame("blackwood", bad)).toBeNull();
    expect(() => saveGame(sample, bad)).not.toThrow();
    expect(() => clearGame("blackwood", bad)).not.toThrow();
  });
});
