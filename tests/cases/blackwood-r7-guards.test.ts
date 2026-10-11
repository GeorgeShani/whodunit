/**
 * Gremlin's r7 offline review (/workspace/qa/r7/review.md), regression tests through the REAL guard: each line goes through
 * prepareTurn + checkReply exactly as Gremlin's harness did (qa/r7/harness/probe*.test.ts), in a fresh state or with the
 * named secrets revealed. BLOCK lines must be rejected; PASS lines (true canon or harmless) must get through.
 * Findings: cases/blackwood/docs/CONSISTENCY_AUDIT.md CA-27 onward.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { R7_ALL_EVIDENCE, R7_INNOCENT_SECRETS, r7Verdict, type R7Spec } from "../helpers/r7-guard";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});
const verdict = (ch: string, line: string, s: R7Spec = {}, q?: string) => r7Verdict(c, ch, line, s, q);
const INNOCENTS = ["reginald", "archibald", "gregory"] as const;
const ALL_OUT = R7_INNOCENT_SECRETS;
const ALL_EV = { ev: R7_ALL_EVIDENCE };

describe("CA-27 (r7 H1): innocents never name Victoria as the killer or invent what only the killer did", () => {
  const fresh = [
    "She'd killed him by then, sir, mark my words.",
    "I'd stake my life she'd done for him.",
    "Mark me, sir, she did him in.",
    "Her ladyship is the one who killed him.",
    "'Twas her ladyship killed him, sir.",
    "Her ladyship's done him in, sir, sure as eggs.",
    "Lady Victoria bashed his head in with that candlestick.",
    "She brained him, sir. Brained him with the silver.",
    "She went in to him in the dark and came out a widow.",
    "Her ladyship went in to him while the lights were out.",
    "Her ladyship was in with him when the candle went out.",
    "She was with his lordship in the library at a quarter past nine.",
    "Victoria's the one that did for him, old boy.",
  ];
  it.each(INNOCENTS)("%s, fresh state: every one of Gremlin's over-claims is blocked", (ch) => {
    expect(fresh.filter((l) => !verdict(ch, l, {}, "Who do you think did it?"))).toEqual([]);
  });

  const afterAll = [
    "I'd stake my life she burned that letter in the dining-room fire after she'd done for him.",
    "Her ladyship went in to him while the lights were out, sir, I'd swear to it.",
    "When the lights went out she wasn't in the dining room, sir, I know that much.",
    "Her ladyship came away from the library door with her hands shaking, sir.",
    "I heard her ladyship's voice in the library, pleading with him, just before the thud.",
    "I heard her ladyship's voice in there, sir, pleading, just afore the thud.",
    "I heard a woman's voice in the library, sir, just before the thud.",
  ];
  it.each(INNOCENTS)("%s, every secret out: the over-claims are still blocked", (ch) => {
    // Gregory watched her come away from the library door at 21:19, so that line is his canon once his sighting is out.
    const lines = ch === "gregory" ? afterAll.filter((l) => !/came away from the library door/.test(l)) : afterAll;
    expect(lines.filter((l) => !verdict(ch, l, { ...ALL_EV, rev: ALL_OUT }))).toEqual([]);
  });

  it.each(["reginald", "archibald"])("%s may not repeat Gregory's eyewitness content, even with every secret out", (ch) => {
    for (const l of ["I saw her ladyship slip something into her gown by the library door.", "Walking back through the hall at 21:21 I saw Victoria coming away from the library door."])
      expect(verdict(ch, l, { ...ALL_EV, rev: ALL_OUT }), `${ch}: ${l}`).not.toBeNull();
  });

  it("Gregory's true sighting stays sayable once s-gregory-saw-victoria is out (and not before)", () => {
    const sighting = [
      "In the lightning I saw her ladyship's face as she stepped out of the library, sir.",
      "I saw her ladyship coming out of the library, sir, and she locked the door behind her.",
      "I saw her slip the key into her gown, sir.",
    ];
    const S = { ...ALL_EV, rev: ALL_OUT };
    for (const l of sighting) expect(verdict("gregory", l, S, "What did you see?"), l).toBeNull();
    for (const l of sighting) expect(verdict("gregory", l, { ev: ["muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"]] }, "What did you see?"), `before the reveal: ${l}`).not.toBeNull();
  });

  it("Reginald's true 20:54 / 20:57 sightings stay sayable after his overheard secret is out", () => {
    const S = { ...ALL_EV, rev: ALL_OUT };
    for (const l of [
      "Through the ajar door I saw her ladyship gripping his lordship's sleeve, sir.",
      "Through the ajar door I heard her ladyship's voice in the library, sir, crying that he would not dare.",
      "Her ladyship came out of the library at three minutes to nine, flushed, and swept past me.",
    ])
      expect(verdict("reginald", l, S, "Tell me about her ladyship."), l).toBeNull();
  });

  it.each(INNOCENTS)("%s: hedged, negated and questioning lines pass", (ch) => {
    for (const l of [
      "Her ladyship? Kill him? I couldn't say, sir.",
      "Her ladyship? Kill him? Never in a month of Sundays.",
      "Did she kill him? I couldn't say.",
      "She could have killed him, I suppose, but I never saw a thing.",
      "When the lights went out she was by the fire, as far as I know.",
    ])
      expect(verdict(ch, l, {}, "Who do you think did it?"), `${ch}: ${l}`).toBeNull();
  });
});
