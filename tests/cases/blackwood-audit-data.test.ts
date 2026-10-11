/**
 * Blackwood consistency audit, data fixes held for #53 (cases/blackwood/docs/CONSISTENCY_AUDIT.md, "queued (PR B)").
 * Each test cites the finding it guards.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { fastestPath } from "@/engine/progression-validation";
import { isLieBroken } from "@/engine/testimony";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const fact = (id: string) => [...c.facts, ...c.timeline].find((f) => f.id === id)!;
const ch = (id: string) => c.characters.find((x) => x.id === id)!;
const lie = (owner: string, id: string) => ch(owner).intendedLies.find((l) => l.id === id)!;
const secret = (owner: string, id: string) => ch(owner).secrets.find((s) => s.id === id)!;
const shown = (cards: string[]) => ({ evidenceShownIds: [], testimonyShownIds: cards, revealedSecretIds: [] });

describe("CA-10: no mud beyond the alcove, although Gregory walks through the hall into the library at 21:36", () => {
  it("he scraped his boots at the kitchen door before crossing the house", () => {
    expect(fact("f-no-mud-beyond-alcove").statement).toMatch(/free of mud/);
    expect(fact("loc-gregory-2136").locationId).toBe("library");
    expect(fact("loc-gregory-2135").statement).toMatch(/scraping the mud off his boots/);
    expect(fact("ev-gregory-arrives").statement).toMatch(/boots scraped clean/);
  });
});

describe("CA-13 / CA-14 / CA-15 / CA-17 / CA-18: canon wording", () => {
  it("the hall clock is not 'striking' at three minutes to nine (it chimes the quarters)", () => {
    const texts = c.characters.flatMap((x) => x.relationships.flatMap((r) => (r.jabs ?? []).map((j) => j.text)));
    expect(texts.filter((t) => /three minutes to nine|20:57/.test(t) && /strik|chim/i.test(t))).toEqual([]);
  });

  it("Gregory's sighting covers four actions, so it is a flash and the flickers after it, in the fact and on the card", () => {
    expect(fact("ev-gregory-sees-victoria").statement).toMatch(/flickers/);
    expect(secret("gregory", "s-gregory-saw-victoria").testimonySummary).toMatch(/flickers/);
  });

  it("the police were telephoned and cannot come before morning, and every suspect knows it", () => {
    expect(fact("ev-household-waits").statement).toMatch(/telephoned the police/);
    for (const x of c.characters) expect(x.knownFactIds, x.id).toContain("ev-household-waits");
  });

  it("the sacked gardener is still on the estate because he was told to be gone by morning", () => {
    expect(fact("f-gregory-dismissed").statement).toMatch(/gone by morning/);
  });

  it("Reginald's 21:30 scuttle is a fresh one from the kitchen, not the dining-room scuttle that holds the key", () => {
    expect(fact("loc-reginald-2130").statement).toMatch(/fresh scuttle of coal from the kitchen/);
    expect(fact("loc-reginald-2130").statement).not.toMatch(/the coal scuttle/);
  });
});

describe("CA-22: a card that plainly contradicts a story breaks it", () => {
  it.each([
    ["archibald", "l-archibald-together", "s-gregory-saw-victoria"],
    ["archibald", "l-archibald-together", "s-victoria-left-dining"],
    ["archibald", "l-archibald-together", "s-reginald-theft"],
  ])("%s's %s breaks on %s", (owner, lieId, card) => {
    expect(isLieBroken(c, lie(owner, lieId), shown([card]))).toBe(true);
  });

  it("Victoria's side stays as #47 left it (accepted in the audit): the eyewitness card cracks nothing of hers, the overheard card does not break the letter story", () => {
    expect(secret("victoria", "s-victoria-left-dining").revealConditions?.testimonyIds).not.toContain("s-gregory-saw-victoria");
    expect(isLieBroken(c, lie("victoria", "l-victoria-letter"), shown(["s-reginald-overheard"]))).toBe(false);
  });

  it("the new edges cost no actions: the fastest legal path is still 10", () => {
    expect(fastestPath(c)).toBe(10);
  });
});

describe("CA-25 / r7 M2 (CA-29): no witness invents a stained handkerchief, but tears and rouge are fine", () => {
  const hits = [
    "I saw blood on her ladyship's handkerchief, sir.",
    "There was a bloodstained handkerchief by the hearth.",
    // Gremlin's r7 bypasses
    "Her handkerchief had red smears on it.",
    "Her hanky was bloodied, sir.",
    "Her kerchief was all over blood.",
    "She hid a crimson-spotted handkerchief in her sleeve.",
    "I'd never seen so much blood as there was on her handkerchief.",
    "Nothing but blood on that handkerchief of hers, sir.",
    "Her handkerchief, which she kept balled up in her fist all evening long by the fire, was red.",
    "There was something dark and wet on her handkerchief.",
  ];
  const passes = [
    "Her handkerchief had no blood on it.",
    "Was there blood on her handkerchief?",
    "He mops his brow with a huge handkerchief, red in the face.",
    "She dabbed her eyes with a lace handkerchief.",
    "I saw no stained handkerchief.",
    // Gremlin's r7 false positives
    "Her handkerchief was stained with tears, poor thing.",
    "She pressed a tear-stained handkerchief to her eyes.",
    "Her ladyship's handkerchief was stained with rouge.",
    "I mopped my brow and my handkerchief came away stained with sweat.",
    "Blood? I saw no blood. She had her handkerchief out for her tears, that's all.",
  ];
  it.each(["archibald", "reginald", "gregory"])("%s", (id) => {
    const phrases = ch(id).forbiddenPhrases ?? [];
    for (const t of hits) expect(findForbiddenPhrase(t, phrases, []), t).toBeTruthy();
    for (const t of passes) expect(findForbiddenPhrase(t, phrases, []), t).toBeFalsy();
  });

  it("no authored line of theirs trips it", () => {
    for (const id of ["archibald", "reginald", "gregory"]) {
      const x = ch(id);
      const own = [...x.personality.quirks, ...x.personality.tells, ...x.relationships.flatMap((r) => (r.jabs ?? []).map((j) => j.text))];
      for (const t of own) expect(findForbiddenPhrase(t, x.forbiddenPhrases ?? [], []), `${id}: ${t}`).toBeFalsy();
    }
  });
});

describe("Archibald's breakdown asks for what the outburst guard checks (s-archibald-breakdown eval)", () => {
  it("his speech style, which the breakdown prompt reads, asks for a word in CAPITALS and an exclamation mark", () => {
    // ai/guard.ts no_outburst uses engine/stress.ts isOutburst: an exclamation mark plus a word of 3+ capitals.
    expect(ch("archibald").personality.speechStyle).toMatch(/blows his top[^.]*CAPITALS[^.]*exclamation mark/);
  });
});
