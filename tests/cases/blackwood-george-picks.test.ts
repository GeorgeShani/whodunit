/** George's four story picks (2026-10-11, relayed by Marvin): CA-63 to CA-66 in CONSISTENCY_AUDIT.md. */
import { beforeAll, describe, expect, it } from "vitest";
import { gradeAccusation } from "@/engine/accusation";
import { buildEnding } from "@/engine/ending-payload";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { r7Verdict, type R7Spec } from "../helpers/r7-guard";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const all = () => [...c.facts, ...c.timeline];
const fact = (id: string) => all().find((f) => f.id === id)!;
const ch = (id: string) => c.characters.find((x) => x.id === id)!;
const SUSPECTS = ["victoria", "archibald", "reginald", "gregory"];

describe("pick 1: Victoria's decoy motive (unhappy marriage) is offered, suggested, disproved and graded wrong", () => {
  it("is in the accuse-form list, which stays alphabetical", () => {
    const labels = c.motives.map((m) => m.label);
    expect(c.motives.map((m) => m.id)).toContain("unhappy-marriage");
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
  it("the overheard row both suggests it (a marital quarrel) and disproves it (she'd let him go, not the money)", () => {
    const s = ch("reginald").secrets.find((x) => x.id === "s-reginald-overheard")!.testimonySummary!;
    expect(s).toMatch(/Leave me, but not on two hundred a year/);
    expect(fact("ev-reginald-overhears").statement).toMatch(/Leave me, but not on two hundred a year/);
    expect(c.solution.motiveId).toBe("inheritance");
  });
  const acc = (motiveId: string) => ({ murdererId: "victoria", weaponId: "silver-candlestick", motiveId, keyEvidenceIds: ["library-key", "burned-letter"], keyTestimonyIds: ["s-gregory-saw-victoria"] });
  it("right person, decoy motive: a loss whose ending is the same as any other loss for Victoria and names nothing", () => {
    const g = gradeAccusation(c.solution, acc("unhappy-marriage"));
    expect(g.won).toBe(false);
    expect(g.murdererCorrect).toBe(true);
    const decoy = buildEnding(c, g, acc("unhappy-marriage"));
    const other = buildEnding(c, gradeAccusation(c.solution, acc("revenge")), acc("revenge"));
    expect(decoy).toEqual(other);
    const text = JSON.stringify(decoy);
    expect(text).not.toMatch(/inheritance|new will|two hundred|candlestick|21:17|seventeen/i);
    expect(gradeAccusation(c.solution, acc("inheritance")).won).toBe(true);
  });
});

const NOW: R7Spec = {};
describe("pick 3: the detective arrived at 21:44, after everything", () => {
  it("is canon, public to every suspect, and the intro says so", () => {
    expect(fact("ev-detective-arrives").time).toBe("21:44");
    for (const id of SUSPECTS) expect(ch(id).knownFactIds, id).toContain("ev-detective-arrives");
    expect(c.intro).toMatch(/expected for dinner/);
    expect(c.intro).toMatch(/quarter to ten/);
    expect(fact("f-household-tonight").statement).toMatch(/Until the detective arrived at 21:44/);
  });
  it.each([
    ["victoria", "You were there at dinner yourself, detective, you saw how he was."],
    ["archibald", "As you saw at dinner, old boy, Edmund was in a foul temper."],
    ["reginald", "You dined with us, sir, you will recall the port."],
    ["gregory", "You was in the hall when the lights went, sir."],
    ["victoria", "When the scream came you were here with us, darling."],
    ["reginald", "You heard the scream yourself, sir."],
    ["archibald", "It was dinner for four, old boy, you included."],
  ])("blocks %s: %s", (who, line) => {
    expect(r7Verdict(c, who, line, NOW)).not.toBeNull();
  });
  it.each([
    ["reginald", "You arrived at a quarter to ten, sir, soaked to the skin. I let you in myself."],
    ["victoria", "You missed dinner entirely, detective. Lucky you."],
    ["archibald", "By the time you turned up, old boy, the lights were back on."],
    ["gregory", "You come up the drive after it were all over, sir."],
    ["reginald", "You were expected for dinner, sir, but the storm had other ideas."],
  ])("allows %s: %s", (who, line) => {
    expect(r7Verdict(c, who, line, NOW)).toBeNull();
  });
});

const IN_HALL: R7Spec = { ev: ["muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"]], shown: { gregory: ["muddy-footprint"] } };
const SAW: R7Spec = { ev: ["muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]], shown: { gregory: ["muddy-footprint"] } };
describe("pick 4: Gregory is tipsy but truthful", () => {
  it("the nip is canon, and his cards keep the sighting firm with no clock times", () => {
    expect(fact("f-gregory-nip").statement).toMatch(/clear on what he saw/);
    expect(ch("gregory").knownFactIds).toContain("f-gregory-nip");
    for (const s of ch("gregory").secrets) expect(s.testimonySummary, s.id).not.toMatch(/\b21:\d\d\b/);
    expect(ch("gregory").secrets.find((s) => s.id === "s-gregory-saw-victoria")!.testimonySummary).toMatch(/sure of her/);
    expect(ch("gregory").personality.speechStyle).toMatch(/just after the lights went/);
  });
  it.each([
    ["gregory", "Just after the lights went, sir, I come in by the garden door.", IN_HALL],
    ["gregory", "A bit after the thud, sir, I heard nothin' more, just stood there shakin'.", IN_HALL],
    ["gregory", "When the thunder cracked I seen her face, sir, plain as day.", SAW],
    ["gregory", "I'm hazy on the clock, sir, but I know what I seen.", NOW],
    ["gregory", "I had a nip or two in the shed after supper, sir, I'll not lie.", NOW],
    ["reginald", "Gregory had a nip of gin in the shed, sir, I dare say, but he was steady on his feet.", NOW],
  ] as [string, string, R7Spec][])("allows %s: %s", (who, line, s) => {
    expect(r7Verdict(c, who, line, s)).toBeNull();
  });
  it.each([
    ["gregory", "I was blind drunk, sir, couldn't see straight.", NOW],
    ["gregory", "I'd had half a bottle in the shed, sir.", NOW],
    ["victoria", "Gregory was blind drunk, darling. He was seeing things.", NOW],
    ["archibald", "The gardener was too drunk to see a thing, old boy.", NOW],
    ["reginald", "Gregory couldn't have seen a thing, sir, the state he was in.", NOW],
  ] as [string, string, R7Spec][])("blocks %s: %s", (who, line, s) => {
    expect(r7Verdict(c, who, line, s)).not.toBeNull();
  });
});
