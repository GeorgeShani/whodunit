import { describe, expect, it } from "vitest";
import { clearGame, loadGame, parseSavedGame, saveGame, sessionKey, SESSION_VERSION, type SavedGame } from "@/lib/game-session";

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
  conversations: { reginald: [{ id: "m0", speaker: "player", text: "Hello?" }] },
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

  it("survives storage that throws", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("x"); } };
    expect(loadGame("blackwood", bad)).toBeNull();
    expect(() => saveGame(sample, bad)).not.toThrow();
    expect(() => clearGame("blackwood", bad)).not.toThrow();
  });
});
