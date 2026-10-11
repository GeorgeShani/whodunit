/** r7 M4, M6, L1-L4 (CA-30, CA-32 to CA-35): canon the guards now hold, through the REAL guard (see tests/helpers/r7-guard.ts). */
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "@/ai/forbidden-phrases";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { r7Verdict, type R7Spec } from "../helpers/r7-guard";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const ch = (id: string) => c.characters.find((x) => x.id === id)!;
const fact = (id: string) => [...c.facts, ...c.timeline].find((f) => f.id === id)!;
const SUSPECTS = ["victoria", "reginald", "archibald", "gregory"] as const;

describe("CA-32 (r7 M6): invented mud, scuttle, telephone, keys, staff and rooms are blocked", () => {
  const inHall: R7Spec = { ev: ["muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"]], shown: { gregory: ["muddy-footprint"] } };
  it.each([
    ["gregory", "I tracked mud all through the hall and into the library, sir, I'll own that.", {}],
    ["victoria", "Ask the gardener. A sacked man reeking of gin, dripping mud across my library carpet.", {}],
    ["reginald", "I fetched the coal scuttle from the dining-room hearth, sir, at half past nine.", {}],
    ["reginald", "I took the scuttle up from the dining room, sir, as his lordship asked.", {}],
    ["victoria", "The telephone is dead, detective. The storm took the line.", {}],
    ["gregory", "The police'll be here within the hour, sir, mark my words.", {}],
    ["archibald", "The telephone lines are down, old boy. We're cut off.", {}],
    ["reginald", "There is a spare key on my ring, sir, though I never use it.", {}],
    ["victoria", "Edmund kept a second library key in his desk, darling.", {}],
    ["reginald", "Only the cook and the scullery maid, sir, and they were abed.", {}],
    ["archibald", "Ask the footman, he was about all evening.", {}],
    ["gregory", "I went round by the conservatory, sir, and in through the billiard room.", {}],
    ["victoria", "I was in the drawing room, darling, if you must know.", {}],
    ["gregory", "My boots left mud all over the library carpet, sir.", inHall],
  ] as [string, string, R7Spec][])("%s: %s", (who, line, s) => {
    expect(r7Verdict(c, who, line, s)).not.toBeNull();
  });

  it.each([
    ["gregory", "I left a muddy print in the alcove by the garden door, sir.", inHall],
    ["gregory", "I scraped my boots at the kitchen door afore I came through, sir.", {}],
    ["reginald", "There is no spare key, sir. His lordship kept the only one.", {}],
    ["victoria", "There isn't a spare key, detective, which is rather the point.", {}],
    ["reginald", "I brought a fresh scuttle of coal up from the kitchen, sir.", {}],
    ["reginald", "I telephoned the police from the servants' telephone, sir, but nobody can come before morning.", {}],
    ["victoria", "The police can't come before morning, darling. The road is flooded.", {}],
    ["reginald", "We have no billiard room, sir.", {}],
    ["reginald", "There is no cook tonight, sir. Only Gregory and myself.", {}],
    ["gregory", "His lordship sacked me for the drink, sir, this very morning.", {}],
    // George's pick 4 (2026-10-11): a nip or two in the shed is canon (f-gregory-nip), so r7-M6-gin is gone.
    ["gregory", "I'd had a nip of gin in the shed, sir, I'll not lie.", {}],
  ] as [string, string, R7Spec][])("passes: %s: %s", (who, line, s) => {
    expect(r7Verdict(c, who, line, s)).toBeNull();
  });

  it("every suspect knows the household list, and nobody's authored lines trip the new canon guards", () => {
    expect(fact("f-household-tonight").statement).toMatch(/no other servants/);
    for (const id of SUSPECTS) expect(ch(id).knownFactIds, id).toContain("f-household-tonight");
    for (const id of SUSPECTS) {
      const x = ch(id);
      const own = [...x.voice.openers, ...x.voice.deflections, ...x.relationships.flatMap((r) => (r.jabs ?? []).map((j) => j.text))];
      const all = x.secrets.map((s) => s.id);
      for (const t of own) expect(findForbiddenPhrase(t, x.forbiddenPhrases, all), `${id}: ${t}`).toBeNull();
    }
  });
});

describe("CA-33 (r7 L1): one lightning wording everywhere, and Victoria's guard still catches it", () => {
  it("Gregory's 21:19 entry, the reveal directive, the lead's closing line and the win recap all say flash and flickers", () => {
    expect(fact("loc-gregory-2119").statement).toMatch(/lightning flash and the flickers/);
    expect(ch("gregory").secrets.find((s) => s.id === "s-gregory-saw-victoria")!.description).toMatch(/lightning flash and the flickers/);
    expect(c.leads!.find((l) => l.id === "lead-eyewitness")!.closedLine).toMatch(/flash and its flickers/);
    expect(c.endings!.correct.recap.map((l) => l.text).join(" ")).toMatch(/lightning flash and the flickers/);
  });
  it.each([
    "In the flickering lightning I stepped out of the library and locked the door.",
    "In the flickers of lightning I came out of Edmund's library, darling, and turned the key.",
    "By the lightning's flicker I left the library and went back to the fire.",
    "When the lightning flickered I was already in the hall, by the library door.",
    "In the flash I came out of the library.",
  ])("Victoria: %s", (line) => {
    expect(r7Verdict(c, "victoria", line, {}, "Where were you when the lightning flashed?")).not.toBeNull();
  });
});

describe("CA-34 (r7 L2): Reginald's police call has a time and a place", () => {
  it("21:38, the servants' telephone; everyone knows it from that event alone (r7b N7: ev-household-waits does not restate it)", () => {
    const e = fact("ev-reginald-telephones-police");
    expect(e.time).toBe("21:38");
    expect(e.statement).toMatch(/servants' telephone/);
    expect(ch("reginald").knownFactIds).toContain("ev-reginald-telephones-police");
    for (const x of c.characters) expect(x.knownFactIds, x.id).toContain("ev-reginald-telephones-police");
    expect(fact("ev-household-waits").statement).not.toMatch(/police|21:38/);
  });
});

describe("CA-35 (r7 L3, L4): Reginald saw her ladyship; the desk was not bare", () => {
  it("f-reginald-saw-no-one is scoped to 21:13-21:30", () => {
    expect(fact("f-reginald-saw-no-one").statement).toMatch(/did not see Victoria at all in that time\.$/);
  });
  it("the flat denial is blocked; a scoped one passes", () => {
    expect(r7Verdict(c, "reginald", "I did not see her ladyship at all this evening, sir.", {}, "Did you see her ladyship tonight?")).not.toBeNull();
    expect(r7Verdict(c, "reginald", "I did not see her ladyship at all during the blackout, sir.", {}, "Did you see her ladyship tonight?")).toBeNull();
  });
  it("the letter lead no longer says the desk was bare (the candlestick stood on it)", () => {
    const hint = c.leads!.find((l) => l.id === "lead-letter")!.hint;
    expect(hint).not.toMatch(/bare/);
    expect(hint).toMatch(/the letter was gone/);
  });
});

describe("CA-30 (r7 M4): Victoria may admit the burning, never when", () => {
  const G: R7Spec = { ev: ["silver-candlestick", "library-key", "burned-letter"] };
  const after: R7Spec = { ...G, rev: [["victoria", "s-victoria-new-will"]], shown: { victoria: ["burned-letter"] } };
  it("the reveal directive says she will not say when", () => {
    expect(ch("victoria").secrets.find((s) => s.id === "s-victoria-new-will")!.description).toMatch(/When she burned it[^.]*she will not say/);
    expect(ch("victoria").secrets.find((s) => s.id === "s-victoria-murder")!.relatedFactIds).toContain("ev-letter-burned");
  });
  it("the bare act passes on the reveal turn", () => {
    const v = r7Verdict(c, "victoria", "Very well. I knew about the new will, and I burned that wretched letter.", G, "This letter was in your fire.", { allowReveal: true, presentedEvidenceId: "burned-letter" });
    expect(v).toBeNull();
  });
  it.each([
    "I burned the letter while Archibald was away on his errand.",
    "I burned it during the blackout, if you must know.",
    "When I came back I put the letter in the fire.",
    "I burned it after dinner broke up.",
    "While the lights were out I fed the letter to the flames.",
    "I burned it at twenty past nine, if you must have a time.",
    "I took the letter from Edmund's desk and burned it.",
  ])("blocked after the new-will reveal: %s", (line) => {
    expect(r7Verdict(c, "victoria", line, after, "When did you burn it?")).not.toBeNull();
  });
});
