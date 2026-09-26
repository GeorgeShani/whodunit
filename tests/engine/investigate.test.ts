import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/investigate/route";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { BAD_REQUEST_LINE, handleInvestigate, UNKNOWN_LOCATION_LINE } from "@/engine/investigate-handler";
import { defaultEmptyLine, searchLocation } from "@/engine/investigation";
import { RESET_NOTICE } from "@/engine/session";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { goodReply, mockGrok, TEST_ENV } from "../helpers/grok-mock";
import { SOLUTION_KEYS, deepScan } from "../helpers/leak-scan";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

const search = (locationId: string, stateToken?: string) =>
  handleInvestigate({ locationId, ...(stateToken ? { stateToken } : {}) }, { caseData: c, env: TEST_ENV });

const stateOf = (t: string | undefined) => {
  const r = decodeStateToken(t, c, TEST_ENV);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
};

describe("searchLocation (engine)", () => {
  it("maps every clue to its location (candlestick in the library); garden and kitchen are empty", () => {
    const g = createInitialGameState(c);
    const found = Object.fromEntries(
      c.locations.map((l) => [l.id, searchLocation(c, g, l.id).newlyFound.map((e) => e.id).sort()]),
    );
    expect(found).toEqual({
      library: ["silver-candlestick"], // not initiallyAvailable: found by searching the library
      hall: ["muddy-footprint"],
      "dining-room": ["burned-letter", "library-key"],
      garden: [],
      kitchen: [],
    });
    expect(g.discoveredEvidenceIds.sort()).toEqual(c.evidence.map((e) => e.id).sort());
    expect(g.searchedLocationIds.sort()).toEqual(c.locations.map((l) => l.id).sort());
  });

  it("is idempotent: a repeat search finds nothing new and shows the empty line", () => {
    const g = createInitialGameState(c);
    const first = searchLocation(c, g, "dining-room");
    expect(first.alreadySearched).toBe(false);
    expect(first.newlyFound).toHaveLength(2);
    const again = searchLocation(c, g, "dining-room");
    expect(again.alreadySearched).toBe(true);
    expect(again.newlyFound).toEqual([]);
    const loc = c.locations.find((l) => l.id === "dining-room")!;
    expect(again.lines).toEqual([loc.searchFlavor?.emptyLine ?? defaultEmptyLine(loc.name)]);
    expect(g.discoveredEvidenceIds.filter((id) => id === "burned-letter")).toHaveLength(1);
    expect(g.searchedLocationIds.filter((id) => id === "dining-room")).toHaveLength(1);
  });

  it("uses Agatha's search flavour on the first search", () => {
    const g = createInitialGameState(c);
    const loc = c.locations.find((l) => l.id === "hall")!;
    expect(searchLocation(c, g, "hall").lines.slice(0, loc.searchFlavor!.lines.length)).toEqual(loc.searchFlavor!.lines);
  });
});

describe("handleInvestigate / POST /api/investigate", () => {
  it("returns public fields only and a new signed token", () => {
    const r = search("dining-room");
    expect(r.status).toBe(200);
    expect(r.body.found.map((f) => f.id).sort()).toEqual(["burned-letter", "library-key"]);
    for (const f of r.body.found) {
      expect(Object.keys(f).every((k) => ["id", "name", "description", "kind", "image", "discoveryLine"].includes(k))).toBe(true);
      expect(f.discoveryLine).toBeTruthy();
    }
    expect(r.body.searchedLocationIds).toEqual(["dining-room"]);
    expect(stateOf(r.body.stateToken).discoveredEvidenceIds).toEqual(expect.arrayContaining(["burned-letter", "library-key"]));
  });

  it("never leaks the solution, endings, engine links or other locations' undiscovered clues", () => {
    const r = search("dining-room");
    const json = JSON.stringify(r.body);
    const { keys } = deepScan(r.body);
    for (const k of SOLUTION_KEYS) expect(keys.has(k), k).toBe(false);
    for (const k of ["relatedFactIds", "relatedCharacterIds", "brokenByEvidenceIds", "initiallyAvailable"]) expect(json).not.toContain(k);
    const hallClue = c.evidence.find((e) => e.id === "muddy-footprint")!;
    expect(json).not.toContain(hallClue.id);
    expect(json).not.toContain(hallClue.description);
    if (c.endings) expect(json).not.toContain(JSON.stringify(c.endings).slice(2, 40));
    expect(json).not.toContain(c.solution.explanation);
  });

  it("repeat searches over the token are idempotent", () => {
    const a = search("dining-room");
    const b = search("dining-room", a.body.stateToken);
    expect(b.body.found).toEqual([]);
    expect(stateOf(b.body.stateToken).discoveredEvidenceIds).toEqual(stateOf(a.body.stateToken).discoveredEvidenceIds);
  });

  it("an unknown location is a 400 with the in-character line and keeps the state", () => {
    const a = search("hall");
    const r = search("the-moon", a.body.stateToken);
    expect(r.status).toBe(400);
    expect(r.body.lines).toEqual([UNKNOWN_LOCATION_LINE]);
    expect(r.body.error).toBe("unknown_location");
    expect(stateOf(r.body.stateToken).discoveredEvidenceIds).toContain("muddy-footprint");
  });

  it("a malformed request is a 400 with an in-character line", () => {
    const r = handleInvestigate({ locationId: "hall", extra: 1 }, { caseData: c, env: TEST_ENV });
    expect(r.status).toBe(400);
    expect(r.body.lines).toEqual([BAD_REQUEST_LINE]);
  });

  it("a tampered token resets the game with the notice", () => {
    const a = search("dining-room");
    const [v, payload, sig] = a.body.stateToken!.split(".");
    const tampered = `${v}.${payload}.${sig.slice(0, -2)}xx`;
    const r = search("hall", tampered);
    expect(r.status).toBe(200);
    expect(r.body.notice).toBe(RESET_NOTICE);
    const g = stateOf(r.body.stateToken);
    expect(g.discoveredEvidenceIds).not.toContain("burned-letter");
    expect(g.searchedLocationIds).toEqual(["hall"]);
  });

  it("the route wrapper answers 400 on invalid JSON", async () => {
    const res = await POST(new Request("http://t/api/investigate", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { lines: string[] }).lines).toEqual([BAD_REQUEST_LINE]);
  });

  it("an old token without searchedLocationIds still decodes", () => {
    const g = createInitialGameState(c);
    const t = encodeStateToken(g, TEST_ENV);
    expect(stateOf(t).searchedLocationIds).toEqual([]);
  });
});

describe("integration: search → present → reveal", () => {
  it("searching the dining room lets the burned letter crack Reginald's theft", async () => {
    const found = search("dining-room");
    expect(found.body.found.map((f) => f.id)).toContain("burned-letter");

    // Before the search, presenting it is refused (not discovered).
    mockGrok({ content: goodReply() });
    const early = await handleInterrogate(
      { characterId: "reginald", question: "Explain this.", presentedEvidenceId: "burned-letter" },
      { caseData: c, env: TEST_ENV },
    );
    expect(early.body.error).toBe("evidence_not_discovered");

    mockGrok({ content: goodReply({ dialogue: "Very well, sir. I took the money from the household accounts." }) });
    const r = await handleInterrogate(
      { characterId: "reginald", question: "Explain this letter.", presentedEvidenceId: "burned-letter", stateToken: found.body.stateToken },
      { caseData: c, env: TEST_ENV },
    );
    expect(r.body.source).toBe("model");
    const g = stateOf(r.body.stateToken);
    expect(g.characters.reginald.revealedSecretIds).toContain("s-reginald-theft");
    expect(g.searchedLocationIds).toEqual(["dining-room"]); // the shared token carries the search too
  });
});
