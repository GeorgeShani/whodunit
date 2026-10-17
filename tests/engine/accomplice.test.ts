/**
 * G1 (case-two plan 3.1, D2/D3; Tallyho design 4.7, 8.3, 11.2): optional `solution.accompliceId` and
 * `Accusation.accompliceId`, graded strictly. In a two-culprit case a win needs the murderer AND the helper in their
 * roles; "No one helped" (null, or an omitted field from an old client) is an explicit answer and is wrong there. In a
 * single-culprit case "no one" or an omitted field is right and naming anyone loses. A loss never says which half was
 * right. H3: the closed-games row stores the helper, and a stored win replays as a win with the helper.
 *
 * The two-culprit case here is ungated Blackwood with Reginald as an invented helper (in memory only).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ACCUSE_LINES, handleAccuse, type AccusedStore, type ClosedGamesStore } from "@/engine/accuse-handler";
import { gradeAccusation } from "@/engine/accusation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences, culpritEndingWarnings } from "@/engine/case-validation";
import { createInitialGameState } from "@/engine/game-state";
import { RESET_NOTICE, restoreSession } from "@/engine/session";
import { decodeStateToken, encodeStateToken } from "@/engine/state-token";
import { AccusationSchema, type Accusation, type GameState } from "@/engine/types";
import { memoryClosedGames } from "@/lib/closed-games";
import { TEST_ENV } from "../helpers/grok-mock";
import { deepScan } from "../helpers/leak-scan";
import { ungated } from "../helpers/ungated";

let one: LoadedCase; // single culprit (Blackwood as shipped, ungated)
let two: LoadedCase; // the same with a helper
beforeAll(async () => {
  one = ungated(await loadCase("blackwood"));
  two = structuredClone(one);
  two.solution.accompliceId = "reginald";
});

const ALL = ["silver-candlestick", "muddy-footprint", "burned-letter", "library-key"];
const WIN = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "muddy-footprint"] };
const token = (c: LoadedCase) => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push(...ALL);
  return encodeStateToken(g, TEST_ENV);
};
const accuse = (
  c: LoadedCase,
  accusation: Record<string, unknown>,
  opts: { closed?: ClosedGamesStore | null; accused?: AccusedStore; stateToken?: string } = {},
) =>
  handleAccuse(
    { accusation, stateToken: opts.stateToken ?? token(c) },
    { caseData: c, env: TEST_ENV, closed: opts.closed ?? null, ...(opts.accused ? { accused: opts.accused } : {}) },
  );
const gameOf = (c: LoadedCase, t: string | undefined) => (decodeStateToken(t, c, TEST_ENV) as { ok: true; game: GameState }).game;

describe("G1 schema", () => {
  it("Accusation.accompliceId is optional: an id, null ('No one helped') or absent", () => {
    expect(AccusationSchema.safeParse(WIN).success).toBe(true);
    expect(AccusationSchema.safeParse({ ...WIN, accompliceId: null }).success).toBe(true);
    expect(AccusationSchema.safeParse({ ...WIN, accompliceId: "reginald" }).success).toBe(true);
    expect(AccusationSchema.safeParse({ ...WIN, accompliceId: "" }).success).toBe(false);
  });
  it("the validator checks solution.accompliceId exists and isn't the murderer; Blackwood has none", async () => {
    expect((await loadCase("blackwood")).solution.accompliceId).toBeUndefined();
    expect(checkCaseReferences(two).filter((i) => i.path === "accompliceId")).toEqual([]);
    const ghost = structuredClone(two);
    ghost.solution.accompliceId = "nobody";
    expect(checkCaseReferences(ghost).map((i) => i.path)).toContain("accompliceId");
    const self = structuredClone(two);
    self.solution.accompliceId = "victoria";
    expect(checkCaseReferences(self).find((i) => i.path === "accompliceId")?.message).toMatch(/can't also be the murderer/);
  });
});

describe("G1 strict grading (gradeAccusation)", () => {
  const won = (c: LoadedCase, a: Partial<Accusation>) => gradeAccusation(c.solution, { ...WIN, ...a } as Accusation).won;
  it("single culprit: no one (null) or an omitted answer is right; naming anyone loses; the grade is unchanged", () => {
    expect(won(one, {})).toBe(true);
    expect(won(one, { accompliceId: null })).toBe(true);
    for (const id of ["reginald", "gregory", "archibald"]) expect(won(one, { accompliceId: id })).toBe(false);
    expect(gradeAccusation(one.solution, WIN)).not.toHaveProperty("accompliceCorrect"); // Blackwood's grade objects stay byte-identical
  });
  it("two culprits: only murderer + helper in their roles wins; 'no one', omitted, the wrong helper and swapped roles lose", () => {
    expect(won(two, { accompliceId: "reginald" })).toBe(true);
    expect(won(two, { accompliceId: null })).toBe(false);
    expect(won(two, {})).toBe(false);
    expect(won(two, { accompliceId: "gregory" })).toBe(false);
    expect(won(two, { murdererId: "reginald", accompliceId: "victoria" })).toBe(false);
    expect(gradeAccusation(two.solution, { ...WIN, accompliceId: null }).accompliceCorrect).toBe(false);
    // Every other single-field mutation of the winning accusation still loses with the helper right.
    expect(won(two, { accompliceId: "reginald", weaponId: "burned-letter" })).toBe(false);
    expect(won(two, { accompliceId: "reginald", murdererId: "gregory" })).toBe(false);
  });
});

describe("G1 accuse route", () => {
  it("rejects an unknown helper and a murderer named as their own helper (400, nothing consumed)", async () => {
    const t = token(two);
    const ghost = await accuse(two, { ...WIN, accompliceId: "nobody" }, { stateToken: t });
    expect(ghost).toMatchObject({ status: 400, body: { error: "unknown_suspect" } });
    const self = await accuse(two, { ...WIN, accompliceId: "victoria" }, { stateToken: t });
    expect(self).toMatchObject({ status: 400, body: { error: "accomplice_is_murderer", line: ACCUSE_LINES.accompliceIsMurderer } });
    expect(gameOf(two, self.body.stateToken).outcome).toBe("pending");
    expect((await accuse(two, { ...WIN, accompliceId: "reginald" }, { stateToken: t })).body.outcome).toBe("won");
  });

  it("two culprits: the right pair wins; 'no one helped' loses with no half-right line and no leak", async () => {
    const win = await accuse(two, { ...WIN, accompliceId: "reginald" });
    expect(win).toMatchObject({ status: 200, body: { outcome: "won", accusation: { accompliceId: "reginald" } } });
    // Phase 5: a WIN reports the helper as right and reveals them; a loss carries neither (below).
    expect(win.body.verdict).toMatchObject({ accompliceCorrect: true });
    expect(win.body.solution?.accomplice).toEqual({ id: "reginald", name: expect.any(String) });
    for (const helper of [null, undefined, "gregory"]) {
      const lost = await accuse(two, { ...WIN, ...(helper === undefined ? {} : { accompliceId: helper }) });
      expect(lost.status).toBe(200);
      expect(lost.body.outcome).toBe("lost");
      // The accused (the real murderer here) still plays their own ending; nothing says the murderer was right.
      expect(lost.body.ending?.accusedId).toBe("victoria");
      for (const k of ["verdict", "solution", "rating", "murdererCorrect", "accompliceCorrect"]) expect(lost.body).not.toHaveProperty(k);
      const { keys } = deepScan(lost.body);
      for (const k of ["accompliceCorrect", "murdererCorrect", "verdict"]) expect(keys.has(k)).toBe(false);
    }
  });

  it("single culprit (Blackwood): an omitted field and 'no one' both still win; naming a helper loses", async () => {
    expect((await accuse(one, WIN)).body.outcome).toBe("won");
    expect((await accuse(one, { ...WIN, accompliceId: null })).body.outcome).toBe("won");
    expect((await accuse(one, { ...WIN, accompliceId: "reginald" })).body.outcome).toBe("lost");
  });

  it("H3: the closed-games row stores the helper (null for 'no one')", async () => {
    const repo = memoryClosedGames();
    const t1 = token(two);
    await accuse(two, { ...WIN, accompliceId: "reginald" }, { closed: repo, stateToken: t1 });
    const t2 = token(two);
    await accuse(two, { ...WIN, accompliceId: null }, { closed: repo, stateToken: t2 });
    expect([...repo.rows.values()].map((r) => [r.outcome, r.accusedId, r.accompliceId])).toEqual([
      ["won", "victoria", "reginald"],
      ["lost", "victoria", null],
    ]);
  });

  it("H3: a stored two-culprit win with the cache gone replays as a 409 WIN, helper included", async () => {
    const repo = memoryClosedGames();
    const t0 = token(two);
    const first = await accuse(two, { ...WIN, accompliceId: "reginald" }, { closed: repo, stateToken: t0 });
    expect(first.body.outcome).toBe("won");
    // Same game, the pre-accusation token, no cache record: only the closed-games row is left.
    const again = await accuse(two, { ...WIN, murdererId: "gregory" }, { closed: repo, stateToken: t0 });
    expect(again).toMatchObject({
      status: 409,
      body: { error: "case_closed", outcome: "won", accusation: { murdererId: "victoria", accompliceId: "reginald" } },
    });
    expect(gameOf(two, again.body.stateToken)).toMatchObject({ outcome: "won", accusation: { accompliceId: "reginald" } });
  });

  it("the stored accusation round-trips in the token; a token naming an unknown helper is rejected (in-character reset)", async () => {
    const win = await accuse(two, { ...WIN, accompliceId: "reginald" });
    const g = gameOf(two, win.body.stateToken);
    expect(g.accusation?.accompliceId).toBe("reginald");
    g.accusation = { ...g.accusation!, accompliceId: "nobody" };
    expect(restoreSession(two, encodeStateToken(g, TEST_ENV), TEST_ENV).notice).toBe(RESET_NOTICE);
  });
});

describe("G1 endings never leak the helper", () => {
  it("an innocent's loss ending drops the helper's cameo; the helper's own loss keeps theirs", async () => {
    const c = structuredClone(two);
    const cameo = { speaker: "reginald", text: "Well, well. Somebody had to take the blame." };
    c.endings!.wrong.gregory = [...c.endings!.wrong.gregory, cameo];
    c.endings!.wrong.reginald = [...c.endings!.wrong.reginald, cameo];
    const innocent = await accuse(c, { ...WIN, murdererId: "gregory", accompliceId: null });
    expect(JSON.stringify(innocent.body.ending)).not.toContain(cameo.text);
    const helper = await accuse(c, { ...WIN, murdererId: "reginald", accompliceId: null });
    expect(helper.body.ending?.accusedId).toBe("reginald");
    expect(JSON.stringify(helper.body.ending)).toContain(cameo.text);
    // Single-culprit cases are unchanged: Reginald is innocent there, so his cameo in Gregory's ending stays.
    const s = structuredClone(one);
    s.endings!.wrong.gregory = [...s.endings!.wrong.gregory, cameo];
    expect(JSON.stringify((await accuse(s, { ...WIN, murdererId: "gregory" })).body.ending)).toContain(cameo.text);
  });

  it("DX11: a culprit's own wrong ending drops the OTHER culprit's cameo, keeps their own lines, and the validator warns", async () => {
    const c = structuredClone(two);
    const helper = c.solution.accompliceId!;
    const doer = c.solution.murdererId;
    const byHelper = { speaker: helper, text: "Steady on. We agreed you'd keep quiet." };
    const byDoer = { speaker: doer, text: "Say nothing, you fool." };
    c.endings!.wrong[doer] = [...c.endings!.wrong[doer], byHelper];
    c.endings!.wrong[helper] = [...c.endings!.wrong[helper], byDoer];
    const own = c.endings!.wrong[doer][0].text;
    const doerLoss = await accuse(c, { ...WIN, accompliceId: null }); // right doer, no helper: a loss
    expect(doerLoss.body.ending?.outcome).toBe("lost");
    expect(JSON.stringify(doerLoss.body.ending)).toContain(own);
    expect(JSON.stringify(doerLoss.body.ending)).not.toContain(byHelper.text);
    expect(JSON.stringify((await accuse(c, { ...WIN, murdererId: helper, accompliceId: null })).body.ending)).not.toContain(byDoer.text);
    expect(culpritEndingWarnings(c).map((w) => w.path)).toEqual([`wrong.${doer}.${c.endings!.wrong[doer].length - 1}`, `wrong.${helper}.${c.endings!.wrong[helper].length - 1}`]);
    const named = structuredClone(two);
    const helperName = named.characters.find((x) => x.id === helper)!.name;
    named.endings!.wrong[doer] = [...named.endings!.wrong[doer], { speaker: doer, text: `Ask ${helperName}, not me.` }];
    expect(culpritEndingWarnings(named).some((w) => /names the other culprit/.test(w.message))).toBe(true);
    expect(culpritEndingWarnings(two)).toEqual([]);
    expect(culpritEndingWarnings(one)).toEqual([]);
  });
});
