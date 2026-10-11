/**
 * CA-52 via E12 (`onlyAfterRevealed`): once a suspect has confessed the secret that supersedes a lie, the lie can't be
 * told again word for word. Before the confession the lie is still sayable (they maintain it), and the confession
 * itself, and negated mentions of the old story, always pass. Real guard (prepareTurn + checkReply).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { r7Verdict, type R7Spec } from "../helpers/r7-guard";

let c: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
});

type Row = { ch: string; after: R7Spec; lie: string[]; truth: string[] };
const EV = ["silver-candlestick", "library-key", "burned-letter", "muddy-footprint"];
const ROWS: Record<string, Row> = {
  "l-reginald-heard-nothing": {
    ch: "reginald",
    after: { ev: EV, rev: [["reginald", "s-reginald-theft"]], shown: { reginald: ["burned-letter"] } },
    lie: ["I was in the kitchen polishing silver, sir, and heard nothing at all.", "I heard nothing but the storm, sir."],
    truth: ["I was in my pantry counting the household money, sir, and I heard Mr Crane on the servants' telephone.", "I was not polishing silver, sir. I am ashamed to say it."],
  },
  "l-reginald-few-words": {
    ch: "reginald",
    after: { ev: EV, rev: [["reginald", "s-reginald-theft"], ["reginald", "s-reginald-overheard"]], shown: { reginald: ["burned-letter"] } },
    lie: ["Her ladyship and his lordship had a few words, sir. Nothing out of the ordinary.", "It was only a few words, sir."],
    truth: ["I listened at the door, sir. They argued about the new will."],
  },
  "l-archibald-together": {
    ch: "archibald",
    after: { ev: ["silver-candlestick", "library-key"], rev: [["archibald", "s-archibald-false-alibi"]], shown: { archibald: ["library-key"] } },
    lie: ["I was with Victoria by the dining-room fire from the moment the candles were lit until the scream. Ask her!", "Neither of us left, old boy."],
    truth: ["Fine, I left Victoria two minutes after the candles were lit and came back at twenty-two minutes past nine."],
  },
  "l-archibald-racehorse": {
    ch: "archibald",
    after: { ev: ["silver-candlestick", "library-key"], rev: [["archibald", "s-archibald-false-alibi"], ["archibald", "s-archibald-embezzlement"]], shown: { archibald: ["library-key"] } },
    lie: ["The row at dinner? A racehorse, old boy. Purely sporting."],
    truth: ["It was never about a racehorse. Edmund knew about the money."],
  },
  "l-gregory-shed": {
    ch: "gregory",
    after: { ev: ["silver-candlestick", "muddy-footprint"], rev: [["gregory", "s-gregory-in-hall"]], shown: { gregory: ["muddy-footprint"] } },
    lie: ["I was in the potting shed all night, sir. Only came in when I heard the shouting."],
    truth: ["I weren't in the shed all night, sir. I come in by the garden door and stood in the alcove."],
  },
  "l-gregory-saw-nothing": {
    ch: "gregory",
    after: { ev: ["silver-candlestick", "muddy-footprint", "library-key"], rev: [["gregory", "s-gregory-in-hall"], ["gregory", "s-gregory-saw-victoria"]], shown: { gregory: ["muddy-footprint", "library-key"] } },
    lie: ["I didn't see nothin' in the dark, sir."],
    truth: ["I seen her ladyship come out the library in the lightning, sir, and lock the door."],
  },
  "l-victoria-together": {
    ch: "victoria",
    after: { ev: ["silver-candlestick", "library-key", "burned-letter"], rev: [["victoria", "s-victoria-new-will"], ["victoria", "s-victoria-left-dining"]], shown: { victoria: ["burned-letter", "library-key"] } },
    lie: ["Archibald and I sat by the dining-room fire from the moment the candles were lit until we heard the scream. Neither of us left."],
    truth: ["At twenty to ten I asked Archibald to say we'd been together. A small kindness.", "Very well. I left the dining room while Archibald was away."],
  },
  "l-victoria-menu": {
    ch: "victoria",
    after: { ev: ["silver-candlestick", "library-key", "burned-letter"], rev: [["victoria", "s-victoria-new-will"]], shown: { victoria: ["burned-letter"] } },
    lie: ["Our little chat? The Sunday menu. Nothing more.", "I've never seen that letter in my life."],
    truth: ["Yes, I knew about the new will. And yes, I burned that wretched letter."],
  },
};

describe("CA-52 (E12): a confessed lie can't be repeated word for word", () => {
  for (const [id, r] of Object.entries(ROWS)) {
    it(`${id}: maintained before the confession, blocked after it, the truth passes`, () => {
      for (const l of r.lie) expect(r7Verdict(c, r.ch, l, {}, "Tell me again."), `before: ${l}`).toBeNull();
      for (const l of r.lie) expect(r7Verdict(c, r.ch, l, r.after, "Tell me again."), `after: ${l}`).not.toBeNull();
      for (const l of r.truth) expect(r7Verdict(c, r.ch, l, r.after, "Tell me again."), `truth: ${l}`).toBeNull();
    });
  }

  it("engine (E12 note, retraction-check): two negated true lines are still blocked by retracts_admission, not by data", () => {
    // Remove once the retraction check skips negated mentions of the old story.
    const g = ROWS["l-gregory-saw-nothing"];
    expect(r7Verdict(c, "gregory", "I didn't see nothin' of the blow, sir, only her at the door after.", g.after, "Tell me again.")?.reason).toBe("retracts_admission");
    const v = ROWS["l-victoria-menu"];
    expect(r7Verdict(c, "victoria", "It was not the Sunday menu, darling. It was the will.", v.after, "Tell me again.")?.reason).toBe("retracts_admission");
  });

  it("every lie with a superseding secret has an E12 entry keyed on it", () => {
    for (const ch of c.characters)
      for (const lie of ch.intendedLies.filter((l) => l.supersededBySecretIds.length)) {
        const keyed = (ch.forbiddenPhrases ?? []).some((p) => (p as { onlyAfterRevealed?: string[] }).onlyAfterRevealed?.some((s) => lie.supersededBySecretIds.includes(s)));
        expect(keyed, `${ch.id}:${lie.id}`).toBe(true);
      }
  });
});
