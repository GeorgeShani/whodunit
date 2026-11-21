/**
 * Guard v2: pronoun/anchor carry, concept-based gated topics, leftover probes.
 * Fixture data only; cases/ is not edited.
 */
import { describe, expect, it } from "vitest";
import { CaseGuardSchema, checkOutputGuard, type OutputGuardCase } from "@/engine/output-guard";
import {
  LEFTOVER_BLOCK_ALIVE,
  LEFTOVER_BLOCK_GATED,
  MUST_PASS_V2,
  V2_GUARD,
} from "../fixtures/output-guard/leftover-v2";

const mini = (guard = V2_GUARD): OutputGuardCase => ({
  victim: {
    id: "commodore-brine",
    name: 'Commodore Barnabas "Barnacle" Brine',
    aliases: ["the Commodore", "the Old Man", "Barnacle", "Barnabas", "Uncle", "the Owner"],
  },
  characters: [
    { id: "bilge", name: "Captain Horatio Bilge", aliases: ["the Captain", "Horatio"] },
    { id: "percy", name: "Persimmon Percy Brine", aliases: ["Percy"] },
    { id: "ottilie", name: "Ottilie Wrenchley", aliases: ["the Chief", "Wrenchley", "Ottilie"] },
  ],
  facts: [],
  timeline: [],
  evidence: [{ id: "heel-chart" }],
  solution: { time: "21:52" },
  guard,
});

describe("guard v2 schema", () => {
  it("accepts concept-only topics and keeps terms-only topics valid", () => {
    expect(
      CaseGuardSchema.safeParse({
        gatedTopics: [
          {
            unlockedBy: "heel-chart",
            concept: { instruments: ["strip"], measures: ["lurch"], window: 8 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(CaseGuardSchema.safeParse({ gatedTopics: [{ unlockedBy: "heel-chart", terms: ["heel recorder"] }] }).success).toBe(true);
  });
});

describe("pronoun and anchor carry", () => {
  const c = mini();

  it("carries the after-anchor and the victim referent to the next sentences", () => {
    expect(checkOutputGuard("The ship lurched to port. He was still alive.", c)?.reason).toBe("alive_after");
    expect(checkOutputGuard("The ship lurched. Afterwards the Commodore spoke to me.", c)?.reason).toBe("alive_after");
    expect(checkOutputGuard("The lurch didn't kill him; I spoke to him later.", c)?.reason).toBe("alive_after");
  });

  it("does not carry past two following sentences, and does not treat 'before' as after", () => {
    expect(checkOutputGuard("I spoke to the Commodore before the lurch.", c)).toBeNull();
    expect(checkOutputGuard("The ship lurched to port. The Captain spoke to me.", c)).toBeNull();
  });
});

describe("leftover should-block lines (fixture data)", () => {
  const c = mini();

  it.each([...LEFTOVER_BLOCK_ALIVE])("blocks alive leftover: %s", (line) => {
    expect(checkOutputGuard(line, c)?.reason, line).toBe("alive_after");
  });

  it.each([...LEFTOVER_BLOCK_GATED])("blocks instrument leftover before the chart is found: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, [])?.reason, line).toBe("gated_topic");
  });

  it("allows the same instrument leftovers once heel-chart is found", () => {
    for (const line of LEFTOVER_BLOCK_GATED) {
      expect(checkOutputGuard(line, c, {}, ["heel-chart"]), line).toBeNull();
    }
  });

  it("handles Ottilie's strip line through the concept rule", () => {
    const termsOnly = mini(
      CaseGuardSchema.parse({
        ...V2_GUARD,
        gatedTopics: [{ unlockedBy: "heel-chart", terms: ["heel recorder", "heel chart"] }],
      }),
    );
    expect(checkOutputGuard("Ottilie penciled LURCH 22:14 on the strip.", termsOnly, {}, [])).toBeNull();
    expect(checkOutputGuard("Ottilie penciled LURCH 22:14 on the strip.", c, {}, [])?.reason).toBe("gated_topic");
  });
});

describe("must-pass controls", () => {
  const c = mini();

  it.each([...MUST_PASS_V2])("passes control: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, []), line).toBeNull();
  });
});
