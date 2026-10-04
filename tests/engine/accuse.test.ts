import { beforeAll, describe, expect, it } from "vitest";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { POST } from "@/app/api/accuse/route";
import { handleAccuse, type AccusedStore } from "@/engine/accuse-handler";
import { validateAccusationDraft } from "@/engine/accuse-schema";
import { ungated } from "../helpers/ungated";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildEnding, engineRecapLine } from "@/engine/ending-payload";
import { createInitialGameState } from "@/engine/game-state";
import { handleInvestigate } from "@/engine/investigate-handler";
import { getPublicCaseView } from "@/engine/public-view";
import { CASE_CLOSED_LINE, CASE_CLOSED_SEARCH_LINE } from "@/engine/session";
import type { Accusation } from "@/engine/types";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { deepScan } from "../helpers/leak-scan";
import { mockGrok, TEST_ENV } from "../helpers/grok-mock";

let c: LoadedCase;
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
});

const ALL = ["silver-candlestick", "muddy-footprint", "burned-letter", "library-key"];
const token = (discovered = ALL) => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...discovered);
  return encodeStateToken(g, TEST_ENV);
};
const WIN = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "muddy-footprint"] };
const accuse = (accusation: Record<string, unknown>, stateToken = token(), accused?: AccusedStore) =>
  handleAccuse({ accusation, stateToken }, { caseData: c, env: TEST_ENV, ...(accused ? { accused } : {}) });
const memoryStore = (): AccusedStore => {
  const m = new Map<string, Accusation>();
  return { get: async (id) => m.get(id) ?? null, put: async (id, a) => void m.set(id, a) };
};

describe("gradeAccusation branches through POST /api/accuse", () => {
  it("WIN: right murderer, weapon and motive plus at least one key clue", async () => {
    const r = await accuse(WIN);
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("won");
    expect(r.body.verdict).toEqual({ murdererCorrect: true, weaponCorrect: true, motiveCorrect: true, hasKeyEvidence: true, hasKeyTestimony: true, keyEvidenceCited: ["library-key"] });
    expect(r.body.ending?.headline).toBe("CASE CLOSED!");
  });

  it.each([
    ["wrong murderer", { murdererId: "archibald" }],
    ["wrong weapon", { weaponId: "library-key" }],
    ["wrong motive", { motiveId: "revenge" }],
    ["no key evidence", { keyEvidenceIds: ["muddy-footprint", "silver-candlestick"] }],
  ])("LOSS on %s: escaped headline, and nothing about what was right or wrong (#22)", async (_n, over) => {
    const r = await accuse({ ...WIN, ...over });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe("lost");
    expect(r.body.ending?.headline).toBe(c.endings!.escapedLine);
    expect(r.body.verdict).toBeUndefined();
    expect(r.body.solution).toBeUndefined();
    const { keys, strings } = deepScan(r.body);
    for (const k of ["verdict", "solution", "murdererCorrect", "weaponCorrect", "motiveCorrect", "keyEvidence"]) expect(keys.has(k), k).toBe(false);
    expect(strings.has(c.solution.explanation!)).toBe(false);
    expect(r.body.ending!.beats.at(-1)).toMatchObject({ section: "escaped", text: "The case went unsolved." });
  });

  it("a loss never gives away the real murderer: no authored 'right lady' line, no gloating killer cameo, no unrelated clues", async () => {
    const right = await accuse({ ...WIN, motiveId: "revenge" }); // the real killer, wrong motive
    const texts = right.body.ending!.beats.map((b) => b.text).join(" ");
    expect(texts).not.toMatch(/right lady|wrong story|solicitor/i);
    const wrong = await accuse({ ...WIN, murdererId: "reginald" });
    expect(wrong.body.ending!.beats.some((b) => b.speaker === "victoria")).toBe(false); // her cameo gloats
    expect(wrong.body.ending!.beats[0].speaker).toBe("reginald");
    const shown = new Set([...WIN.keyEvidenceIds, WIN.weaponId]);
    for (const e of [right, wrong]) expect((e.body.evidence ?? []).every((x) => shown.has(x.id))).toBe(true);
  });

  it("marks the game over in the token", async () => {
    const r = await accuse(WIN);
    const d = decodeStateToken(r.body.stateToken, c, TEST_ENV);
    expect(d.ok && d.game.outcome).toBe("won");
    expect(d.ok && d.game.phase).toBe("resolved");
    expect(d.ok && d.game.accusation).toEqual(WIN);
  });
});

describe("accusation validation", () => {
  it("rejects citing a clue that isn't discovered in the signed state", async () => {
    const r = await accuse(WIN, token(["silver-candlestick", "muddy-footprint"]));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("evidence_not_discovered");
    expect(r.body.outcome).toBeUndefined();
    expect(r.body.solution).toBeUndefined();
    expect(r.body.ending).toBeUndefined();
  });

  it("rejects an undiscovered weapon, an unknown suspect or motive, and malformed bodies", async () => {
    expect((await accuse(WIN, token(["library-key", "muddy-footprint"]))).body.error).toBe("evidence_not_discovered");
    expect((await accuse({ ...WIN, murdererId: "butler-2" })).body.error).toBe("unknown_suspect");
    expect((await accuse({ ...WIN, motiveId: "boredom" })).body.error).toBe("unknown_motive");
    expect((await accuse({ ...WIN, keyEvidenceIds: [] })).status).toBe(400);
    expect((await accuse({ ...WIN, keyEvidenceIds: ["a", "b", "c", "d", "e", "f"] })).status).toBe(400);
    expect((await handleAccuse({ accusation: WIN }, { caseData: c, env: TEST_ENV })).body.error).toBe("invalid_request");
  });

  it("rejects a tampered token without grading", async () => {
    const t = token();
    const r = await accuse(WIN, t.slice(0, -3) + "AAA");
    expect(r.body.error).toBe("invalid_state");
    expect(r.body.outcome).toBeUndefined();
  });

  it("client-side draft validation mirrors the rules", async () => {
    const opts = { suspectIds: ["victoria"], evidenceIds: ["library-key"], motiveIds: ["inheritance"] };
    expect(validateAccusationDraft({ keyEvidenceIds: [] }, opts)).toMatchObject({ ok: false });
    expect((validateAccusationDraft({ keyEvidenceIds: [] }, opts) as { errors: string[] }).errors).toHaveLength(4);
    expect(validateAccusationDraft({ murdererId: "victoria", weaponId: "library-key", motiveId: "inheritance", keyEvidenceIds: ["library-key", "library-key"] }, opts)).toEqual({
      ok: true,
      accusation: { murdererId: "victoria", weaponId: "library-key", motiveId: "inheritance", keyEvidenceIds: ["library-key"] },
    });
    expect(validateAccusationDraft({ murdererId: "victoria", weaponId: "library-key", motiveId: "inheritance", keyEvidenceIds: ["nope"] }, opts).ok).toBe(false);
  });
});

describe("one accusation per game, not per token (#22)", () => {
  type G = ReturnType<typeof createInitialGameState>;
  const gameOf = (t: string | undefined) => (decodeStateToken(t, c, TEST_ENV) as { game: G }).game;

  it("replaying the PRE-accusation token with the right answer cannot win after a loss", async () => {
    const store = memoryStore();
    const t0 = token();
    const lost = await accuse({ ...WIN, murdererId: "reginald" }, t0, store);
    expect(lost.body.outcome).toBe("lost");
    expect(lost.body.solution).toBeUndefined(); // nothing to copy from
    const cheat = await accuse(WIN, t0, store); // old token, the true solution
    expect(cheat.status).toBe(409);
    expect(cheat.body.error).toBe("case_closed");
    expect(cheat.body.outcome).toBe("lost");
    expect(cheat.body.accusation?.murdererId).toBe("reginald"); // the ORIGINAL guess, not the new one
    expect(cheat.body.verdict).toBeUndefined();
    expect(cheat.body.solution).toBeUndefined();
    expect(gameOf(cheat.body.stateToken).outcome).toBe("lost");
  });

  it("a win is replayed as a win (client retry after a dropped response), with the solution", async () => {
    const store = memoryStore();
    const t0 = token();
    await accuse(WIN, t0, store);
    const again = await accuse({ ...WIN, murdererId: "gregory" }, t0, store);
    expect(again.status).toBe(409);
    expect(again.body.outcome).toBe("won");
    expect(again.body.solution?.murderer.id).toBe("victoria");
  });

  it("the id survives later turns, so ANY earlier token of the game is blocked, while a new game is not", async () => {
    const store = memoryStore();
    const t0 = token();
    const t1 = encodeStateToken(gameOf(t0), TEST_ENV);
    expect(gameOf(t0).gameId).toBeTruthy();
    expect(gameOf(t1).gameId).toBe(gameOf(t0).gameId);
    await accuse({ ...WIN, murdererId: "gregory" }, t1, store);
    expect((await accuse(WIN, t0, store)).status).toBe(409);
    expect((await accuse(WIN, token(), store)).status).toBe(200); // a different game
  });

  it("every fresh game gets its own id", () => {
    expect(gameOf(token()).gameId).not.toBe(gameOf(token()).gameId);
  });

  it("a store outage fails open: the accusation is still graded", async () => {
    const broken: AccusedStore = { get: async () => { throw new Error("down"); }, put: async () => { throw new Error("down"); } };
    expect((await accuse(WIN, token(), broken)).body.outcome).toBe("won");
  });
});

describe("after game over", () => {
  it("a replayed accusation returns the ORIGINAL verdict (409), ignoring the new guess", async () => {
    const lost = await accuse({ ...WIN, murdererId: "gregory" });
    const replay = await accuse(WIN, lost.body.stateToken);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("case_closed");
    expect(replay.body.outcome).toBe("lost");
    expect(replay.body.accusation?.murdererId).toBe("gregory");
  });

  it("interrogate and investigate answer 'the case is closed' in character, without calling the model", async () => {
    const { fn } = mockGrok({});
    const over = (await accuse(WIN)).body.stateToken!;
    const i = await handleInterrogate({ characterId: "reginald", question: "Anything else?", stateToken: over }, { caseData: c, env: TEST_ENV });
    expect(i.status).toBe(409);
    expect(i.body.error).toBe("case_closed");
    expect(i.body.response.dialogue).toBe(CASE_CLOSED_LINE);
    expect(fn).not.toHaveBeenCalled();
    const s = handleInvestigate({ locationId: "library", stateToken: over }, { caseData: c, env: TEST_ENV });
    expect(s.status).toBe(409);
    expect(s.body.lines).toEqual([CASE_CLOSED_SEARCH_LINE]);
    expect(s.body.found).toEqual([]);
  });

  it("a token claiming game over without an accusation is rejected", async () => {
    const g = createInitialGameState(c);
    g.outcome = "won";
    expect(decodeStateToken(encodeStateToken(g, TEST_ENV), c, TEST_ENV)).toMatchObject({ ok: false, reason: "invalid_payload" });
  });
});

describe("no solution or ending before the accusation", () => {
  const secrets = () => [
    c.solution.explanation!,
    ...[...c.endings!.correct.confession, ...c.endings!.correct.recap, ...Object.values(c.endings!.wrong).flat()].map((l) => l.text),
    c.endings!.escapedLine,
  ];
  it("public view, interrogate, investigate and rejected accusations carry none of it", async () => {
    mockGrok({});
    const bodies: unknown[] = [
      getPublicCaseView(c),
      (await handleInterrogate({ characterId: "victoria", question: "Did you do it?", presentedEvidenceId: "library-key", stateToken: token() }, { caseData: c, env: TEST_ENV })).body,
      handleInvestigate({ locationId: "dining-room", stateToken: token([]) }, { caseData: c, env: TEST_ENV }).body,
      await (await accuse(WIN, token(["silver-candlestick"]))).body,
      (await accuse({ ...WIN, motiveId: "boredom" })).body,
    ];
    for (const b of bodies) {
      const { keys, strings } = deepScan(b);
      for (const s of secrets()) expect(strings.has(s)).toBe(false);
      for (const k of ["solution", "ending", "verdict", "murdererId", "outcome"]) expect(keys.has(k), k).toBe(false);
    }
  });

  it("the route wrapper grades too (and the solution only appears in a graded body)", async () => {
    const res = await POST(new Request("http://t/api/accuse", { method: "POST", body: JSON.stringify({ caseId: "blackwood", accusation: WIN, stateToken: "nope" }) }));
    const j = await res.json();
    expect(j.error).toBe("invalid_state");
    expect(j.solution).toBeUndefined();
  });
});

describe("ending payload shaping", () => {
  it("won: confession then Agatha's recap, verbatim, with speakers resolved and ending emotions kept", async () => {
    const e = buildEnding(c, { won: true }, WIN);
    const n = c.endings!.correct.confession.length;
    expect(e.beats.map((b) => b.text)).toEqual([...c.endings!.correct.confession, ...c.endings!.correct.recap].map((l) => l.text));
    expect(e.beats.slice(0, n).every((b) => b.section === "confession")).toBe(true);
    expect(e.beats[1]).toMatchObject({ speaker: "archibald", speakerName: "Archibald Crane", emotion: "flustered", pauseMs: 1500 });
    expect(e.beats[n]).toMatchObject({ speaker: "narrator", section: "recap", evidenceIds: ["silver-candlestick"] });
    expect(e.beats.some((b) => b.text === engineRecapLine(c))).toBe(false);
  });

  it("falls back to the engine's time/place line only without authored endings", async () => {
    const bare = { ...c, endings: undefined } as LoadedCase;
    const e = buildEnding(bare, { won: true }, WIN);
    expect(e.beats.at(-1)?.text).toBe(engineRecapLine(c));
    expect(engineRecapLine(c)).toContain("21:17");
    const lost = buildEnding(bare, { won: false }, { ...WIN, murdererId: "gregory" });
    expect(lost.beats.at(-2)?.text).toBe("THE MURDERER ESCAPED!");
    expect(lost.beats.at(-1)?.text).toBe("The case went unsolved.");
  });
});
