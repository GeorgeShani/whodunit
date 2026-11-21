/**
 * Issue #98: leftover paraphrase gaps after #97 (alive-after rewords, cross-sentence
 * pronouns, heel-instrument synonyms). These lines must be blocked on a fresh Tallyho
 * state through prepareTurn + checkReply (and checkOutputGuard), and the must-pass
 * controls must stay clean. No model. Does not edit cases/.
 */
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkOutputGuard } from "@/engine/output-guard";
import { r7Verdict } from "../helpers/r7-guard";

const HAS_SOLUTION = existsSync("cases/tallyho/solution.json");
const SUSPECTS = ["gherkina", "bilge", "percy", "zippelli", "ottilie", "boris"] as const;

/** 9 new alive-after rewords from #98. */
const ALIVE_REWORDS = [
  "The Commodore survived the lurch.",
  "He survived the lurch.",
  "He was still barking orders at half past ten.",
  "The Commodore was still barking orders at half past ten.",
  "He was fine after the ship tipped.",
  "The Commodore was fine after the ship tipped.",
  "He came back up after the lurch.",
  "The Commodore came back up after the lurch.",
  "The ship lurched. Afterwards the Commodore spoke to me.",
  "The ship lurched to port. He was still alive.",
] as const;

/** 15 leftovers from docs/tallyho-guard-anchors.md listed in #98. */
const ALIVE_ANCHORS = [
  "Post-lurch, the Old Man was chatty.",
  "Following the roll I bumped into the Commodore.",
  "Once she'd gone over to port I chatted with Barnacle.",
  "He was fine when we took the port list.",
  "Still kicking after we heeled the other way.",
  "I toasted with him once the floor sloped port.",
  "Alive subsequent to the plunge of the deck.",
  "After downhill became the port side, I ran into him.",
  "Come ten-fifteen he was still going.",
  "When she took her port list I heard his laugh.",
  "He waved from the corridor once we rolled.",
  "I passed the time of day with the Owner after the bump.",
  "He answered me after the tilt changed.",
  "The lurch didn't kill him; I spoke to him later.",
  "The Commodore was still alive after she heeled port.",
] as const;

/** 14 heel-instrument synonyms, blocked until heel-chart is found. */
const HEEL_INSTRUMENTS = [
  "The tilt gauge shows she went from starboard to port at 22:14.",
  "I checked the tilt gauge in the engine room.",
  "The roll recorder shows she went from starboard to port at 22:14.",
  "The list log shows she went from starboard to port at 22:14.",
  "The paper that tracks the lean shows she went from starboard to port at 22:14.",
  "The paper tick in the engine room recorded the flip.",
  "Gladys's lean-log shows 8 degrees then 6.",
  "The engine-room graph shows starboard then port.",
  "The list recorder in the pump house.",
  "The inclinograph shows she went from starboard to port at 22:14.",
  "The lean gauge shows she went from starboard to port at 22:14.",
  "The recorder in the engine room shows 6 degrees port.",
  "The instrument in the engine room shows she flipped at 22:14.",
  "Ottilie penciled LURCH 22:14 on the strip.",
] as const;

/** #98 must-pass controls. */
const MUST_PASS = [
  "she heeled to starboard",
  "She heeled to starboard in the squall.",
  "The ship lurched.",
  "The Great Lurch came at 22:14.",
  "The Old Man's watch says 22:41, and a watch does not lie. That settles the hour.",
  "The horn sounded at 22:38. I thought he was alive.",
  "I spoke to the Commodore before the lurch.",
] as const;

const BLOCK_REASONS = ["alive_after", "forbidden_phrase", "staged_time", "unknown_time", "gated_topic"] as const;

describe.skipIf(!HAS_SOLUTION)("Tallyho #98 leftover paraphrases (prepareTurn + checkReply, no model)", () => {
  let c: LoadedCase;
  beforeAll(async () => {
    c = await loadCase("tallyho");
  });

  it.each([...ALIVE_REWORDS, ...ALIVE_ANCHORS])("blocks alive-after / pronoun-carry line on a fresh state: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, [])).not.toBeNull();
    for (const id of SUSPECTS) {
      const v = r7Verdict(c, id, line);
      expect(v, `${id}: ${line}`).not.toBeNull();
      expect(BLOCK_REASONS, `${id}: ${line} -> ${v?.reason}`).toContain(v!.reason);
    }
  });

  it.each([...HEEL_INSTRUMENTS])("blocks heel-instrument synonym before heel-chart is found: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, [])?.reason, line).toBe("gated_topic");
    expect(checkOutputGuard(line, c, {}, ["heel-chart"])?.reason, `after: ${line}`).not.toBe("gated_topic");
    for (const id of SUSPECTS) {
      const before = r7Verdict(c, id, line);
      expect(before, `before ${id}: ${line}`).not.toBeNull();
      // A few 22:14 wordings trip unknown_time first for speakers who do not have that clock.
      expect(BLOCK_REASONS, `before ${id}: ${line} -> ${before?.reason}`).toContain(before!.reason);
      const after = r7Verdict(c, id, line, { ev: ["heel-chart"] });
      expect(after?.reason, `after ${id}: ${line}`).not.toBe("gated_topic");
    }
  });

  it.each([...MUST_PASS])("keeps must-pass control clean: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, []), line).toBeNull();
    const who = /watch says 22:41/.test(line) ? (["bilge"] as const) : SUSPECTS;
    for (const id of who) {
      expect(r7Verdict(c, id, line), `${id}: ${line}`).toBeNull();
    }
  });

  it("plain 'she heeled to starboard' list talk is not a gated heel-instrument or alive-after hit", () => {
    const line = "She heeled to starboard in the squall and flipped at 22:14.";
    const og = checkOutputGuard(line, c, {}, []);
    expect(og?.reason === "alive_after" || og?.reason === "gated_topic").toBe(false);
  });
});
