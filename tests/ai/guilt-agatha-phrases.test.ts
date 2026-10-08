/** #45 follow-up: Agatha's culprit phrases folded into the guilt check (data-derived witnesses and motive act). */
import { beforeAll, describe, expect, it } from "vitest";
import { findGuiltLeak } from "@/ai/guilt-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { guiltProfile, type GuiltProfile } from "@/engine/core-guilt";

let c: LoadedCase;
let p: GuiltProfile;
beforeAll(async () => {
  c = await loadCase("blackwood");
  p = guiltProfile(c);
});
const v = (line: string) => findGuiltLeak(line, p, "victoria", { speakerNames: ["Victoria Blackwood", "her ladyship", "Lady Blackwood", "Lady Victoria"] });
const other = (who: string, line: string) => findGuiltLeak(line, p, who);

describe("data derivation", () => {
  it("witnesses and the motive act come from the case data", () => {
    expect(p.witnessNames).toEqual(expect.arrayContaining(["gregory", "gardener"]));
    expect(p.witnessNames).not.toContain("reginald");
    expect(p.motiveActs).toEqual(["signing"]);
  });
});

describe("culprit phrases are rejected (positive) / harmless variants pass (negative)", () => {
  const cases: [string, string[], string[], [string, string][]][] = [
    // [name, culprit lines that must be caught, culprit lines that must pass, innocent [speaker, line] that must pass]
    ["never meant to hurt him", ["I never meant to hurt him, Inspector.", "I didn't mean to harm Edmund."], ["I never meant to hurt your feelings, darling."], [["archibald", "I never meant to hurt him, the money was only borrowed."]]],
    ["self-defence", ["It was self-defence, Inspector!", "He came at me, I tell you."], ["It was not self-defence I needed, but a good lawyer, darling."], [["gregory", "I keep a spade by the door for self-defence, sir."]]],
    ["watched him fall", ["I watched him fall.", "I saw Edmund crumple."], ["I watched him drink himself silly every night."], [["gregory", "I watched him fall asleep over his papers once, sir."]]],
    ["blood on my gown", ["There was blood on my gown, I couldn't help it.", "My sleeves were bloodstained."], ["There was no blood on my gown, Inspector."], [["reginald", "I found blood on my cuffs from the roast, sir."]]],
    ["weapon in my hand", ["The candlestick was in my hand before I knew it."], ["I never had the candlestick in my hand, darling."], [["reginald", "I polish that candlestick with my own hands every Sunday, sir."]]],
    ["wiped it clean", ["I wiped it clean.", "I wiped the blood away with my handkerchief."], ["I wiped my eyes, Inspector."], [["reginald", "I wiped it clean, sir, as I do all the silver."]]],
    ["already dead when I came out", ["He was already dead when I came out."], ["He was already dead when Gregory found him, they say."], [["archibald", "He was already dead when I came in with the others."]]],
    ["left the library in the dark / by the lightning", ["I left the library in the dark.", "I slipped out of the library by the lightning."], ["I left the library at ten to nine after our little chat."], [["gregory", "I left the library garden in the dark, sir."]]],
    ["the gardener saw me", ["The gardener saw me, I suppose.", "Gregory must have seen me."], ["Gregory never saw me, darling.", "Does the gardener claim he saw me?"], [["archibald", "The gardener saw me on the terrace at nine."]]],
    ["stopped him signing", ["I stopped him signing that wretched will.", "I made sure he never signed it."], ["I tried to stop him drinking, darling."], [["archibald", "I stopped him signing the contract last spring."]]],
  ];
  for (const [name, bad, okCulprit, okInnocent] of cases) {
    it(name, () => {
      for (const l of bad) expect(v(l), l).not.toBeNull();
      for (const l of okCulprit) expect(v(l), l).toBeNull();
      for (const [who, l] of okInnocent) expect(other(who, l), `${who}: ${l}`).toBeNull();
    });
  }
});
