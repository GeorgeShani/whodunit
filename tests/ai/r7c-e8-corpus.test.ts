/**
 * Gremlin's r7c offline attacks (probe8 E1/E2/B2/B2b/B3/B3b, probe9 P9b/P9c) as a regression corpus for E8's
 * over-claim layer ALONE (findGuiltLeak with the turn's cover), no data rules involved: it is what a case without a
 * forbiddenPhrases layer gets. Each row says what the line should do; KNOWN lists the rows the engine layer still
 * gets wrong (data covers them on #57). Remove a line from KNOWN when an engine change fixes it: a fixed line still
 * listed fails, and so does a newly wrong one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareTurn } from "@/ai/perform-turn";
import { coveredActs } from "@/ai/guard";
import { findGuiltLeak, speakerNamesOf } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import { createInitialGameState } from "@/engine/game-state";
import { guiltProfile } from "@/engine/core-guilt";

type Row = {
  section: string;
  speaker: string;
  state: string;
  line: string;
  want: "block" | "pass";
  before_e8: boolean;
};
const ROWS: Row[] = JSON.parse(readFileSync("tests/fixtures/r7c/e8-corpus.json", "utf8"));
const GREG_SAW = "s-gregory-saw-victoria";

/** "section|line" of rows the engine layer still gets wrong. */
const KNOWN = new Set<string>([
  // R3 relays the engine layer can't read without case words (no murderer subject, 'at the door', 'in the
  // lightning', a sighting with no window cue); data covers them.
  "B2|The gardener saw who locked it, I'm told.",
  "B2|Gregory told me her ladyship came out of the library in the lightning.",
  "B2|The gardener swears it was her ladyship at the door.",
  "P9b|Gregory saw her ladyship come out of the library, I'm told.",
]);

describe("r7c E8 corpus (engine layer alone)", async () => {
  const c = await loadCase("blackwood");
  const mk = (st: string, ch: string) => {
    const g = createInitialGameState(c);
    if (st.startsWith("gregSaw")) {
      g.revealedSecretIds.push(GREG_SAW);
      g.characters.gregory.revealedSecretIds.push(GREG_SAW);
    }
    if (st === "gregSawShown") g.characters[ch].testimonyShownIds.push(GREG_SAW);
    for (const k of Object.keys(g.characters)) g.characters[k].interrogationCount = 2;
    return g;
  };
  const verdicts = ROWS.map((r) => {
    const p = prepareTurn({
      caseData: c,
      game: mk(r.state, r.speaker),
      characterId: r.speaker,
      question: "Go on.",
      move: { allowReveal: false } as never,
    });
    const hit = !!findGuiltLeak(r.line, p.guard.guilt, r.speaker, {
      speakerNames: speakerNamesOf(c, r.speaker),
      overClaim: { covered: coveredActs(p.guard) },
    });
    return { ...r, hit, right: hit === (r.want === "block") };
  });

  it("every row does what it should, apart from the KNOWN engine gaps", () => {
    const wrong = [...new Set(verdicts.filter((v) => !v.right).map((v) => `${v.section}|${v.line}`))].sort();
    expect(wrong).toEqual([...KNOWN].sort());
  });

  it("R10: E8 alone catches all 72 fresh E1 attacks (it caught 9 before) and adds no false positive", () => {
    const e1 = verdicts.filter((v) => v.section === "E1");
    expect(e1).toHaveLength(72);
    expect(e1.filter((v) => v.before_e8)).toHaveLength(9);
    expect(e1.filter((v) => v.hit)).toHaveLength(72);
    const newFp = verdicts.filter((v) => v.want === "pass" && v.hit && !v.before_e8);
    expect(newFp.map((v) => v.line)).toEqual([]);
  });

  it("E18 extra: titles and household words come from the title and spouse role, not the case", () => {
    const names = guiltProfile(c).murdererNames ?? [];
    for (const n of ["mrs blackwood", "lady b.", "milady", "m'lady", "the mistress", "the missus", "the lady of the house", "his wife", "the widow"])
      expect(names).toContain(n);
    expect(names).not.toContain("the master");
  });
});

describe("R7: scene acts are lifted by their own cover, the killing never is", async () => {
  const c = await loadCase("blackwood");
  const g = createInitialGameState(c);
  g.revealedSecretIds.push(GREG_SAW);
  g.characters.gregory.revealedSecretIds.push(GREG_SAW);
  const p = prepareTurn({ caseData: c, game: g, characterId: "gregory", question: "Go on.", move: { allowReveal: false } as never });
  const leak = (d: string) =>
    findGuiltLeak(d, p.guard.guilt, "gregory", { speakerNames: speakerNamesOf(c, "gregory"), overClaim: { covered: coveredActs(p.guard) } });
  it.each(["It was her ladyship who locked the library, sir.", "It were her that locked the door, sir.", "Her ladyship locked the library door, sir."])(
    "passes with the key cover: %s",
    (d) => expect(leak(d)).toBeNull(),
  );
  it.each(["She killed him, sir.", "It was her ladyship who killed him, sir.", "It was her ladyship who struck him, sir."])("still caught: %s", (d) =>
    expect(leak(d)?.kind).toMatch(/killing|confession/),
  );
  it("the cleft is caught as the key act without the cover", () => {
    const fresh = prepareTurn({
      caseData: c,
      game: createInitialGameState(c),
      characterId: "reginald",
      question: "Go on.",
      move: { allowReveal: false } as never,
    });
    expect(
      findGuiltLeak("It was her ladyship who locked the library, sir.", fresh.guard.guilt, "reginald", {
        speakerNames: speakerNamesOf(c, "reginald"),
        overClaim: { covered: coveredActs(fresh.guard) },
      })?.kind,
    ).toBe("key");
  });
});
