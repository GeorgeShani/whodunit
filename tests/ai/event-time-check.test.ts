/** #44 a spoken time must be the canon time of the event it is attached to (event-time map from facts + timeline). */
import { beforeAll, describe, expect, it } from "vitest";
import { checkEventTimes, eventTimeMap, normalizeSpokenTimes } from "@/ai/event-time-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let hl: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

describe("normalizeSpokenTimes", () => {
  it.each([
    ["twenty to nine", "20:40"],
    ["a quarter past nine", "21:15"],
    ["half past eight", "20:30"],
    ["nine-seventeen", "21:17"],
    ["9.17", "21:17"],
    ["seventeen minutes past nine", "21:17"],
  ])("%s -> %s", (said, hhmm) => {
    expect(normalizeSpokenTimes(said)[0]).toContain(hhmm);
  });

  it("two hour-minute times joined by 'to' are two times, not 'fifteen minutes to twenty-one'", () => {
    expect(normalizeSpokenTimes("from twenty-one fifteen to twenty-one twenty")).toEqual([["21:15"], ["21:20"]]);
    expect(normalizeSpokenTimes("at twenty to nine")[0]).toContain("20:40"); // the minutes-to-hour reading is kept
    expect(normalizeSpokenTimes("a quarter to ten")[0]).toContain("21:45");
  });
});

describe("checkEventTimes", () => {
  it.each([
    ["Reginald re-dates the 20:54 argument", "I overheard part of her ladyship's argument with his lordship at twenty minutes to nine concerning the new will."],
    ["Reginald, the sleeve at 20:40", "I saw her ladyship gripping his lordship's sleeve at twenty minutes to nine, nothing more."],
    ["Victoria, the letter at 20:30", "I burned that wretched solicitor's letter in the dining-room fire at half past eight."],
    ["Victoria, the blackout at nine o'clock (hour-only is no longer free)", "I was right here in the dining room when the lights went out at nine o'clock."],
    ["the blackout at a quarter to nine", "The lights went out at a quarter to nine."],
  ])("rejects: %s", (_n, line) => {
    expect(checkEventTimes(line, c).length).toBeGreaterThan(0);
  });

  it.each([
    "I overheard them quarrelling at six minutes to nine, sir.",
    "The lights went out at ten past nine.",
    "The lights went out at about nine o'clock.", // hedged: +-10
    "The lights went out at around five past nine.",
    "Dinner ended at half past eight, and I sat by the fire.",
    "I burned the letter at twenty past nine.",
    "The lights came back on at 21:38.",
    "I heard the scream at half past nine.",
    "I lit the candlesticks at 21:11, a minute after the lights failed.",
    "Gregory came in through the garden door at sixteen minutes past nine.",
    "Between thirteen minutes past nine, when Archibald stepped away, and twenty-two minutes past nine, when he returned, I did leave the dining room.",
    "At seventeen minutes past nine I was in the kitchen polishing the silver and heard nothing at all.",
    "I went to bed at eleven o'clock.", // bound to no event
  ])("accepts: %s", (line) => {
    expect(checkEventTimes(line, c)).toEqual([]);
  });

  it("directional hedges: 'just after' means the event lies in [T, T+15]", () => {
    expect(checkEventTimes("The lights went out just after nine o'clock.", c)).toEqual([]);
    expect(checkEventTimes("The lights went out just before nine o'clock.", c).length).toBeGreaterThan(0);
  });

  it("a time in the speaker's own story or belief is exempt", () => {
    const line = "The lights went out at nine o'clock.";
    expect(checkEventTimes(line, c, { intendedLies: [{ claim: "It was nine o'clock when the lights went out." }], beliefs: [] } as never)).toEqual([]);
  });

  it("is data-driven and case-agnostic: the fixture case builds its own map", () => {
    const m = eventTimeMap(hl);
    expect(m.length).toBeGreaterThan(0);
    for (const e of m) expect(e.range[0]).toBeLessThanOrEqual(e.range[1] + 1440);
  });
});

describe("multi-event replies: each time is attributed in its own clause", () => {
  /** Archibald after his false alibi is out (what he knows and is in: the speaker fallback). */
  const archibald = () => {
    const g = createInitialGameState(c);
    g.characters.archibald.revealedSecretIds = ["s-archibald-false-alibi"];
    g.revealedSecretIds = ["s-archibald-false-alibi"];
    return buildCharacterContext({ caseData: c, game: g }, "archibald");
  };
  const texts = (misses: { text: string }[]) => misses.map((m) => m.text);

  it.each([
    // The recorded conf-13 second reply: four events, four right times, one sentence.
    "As for you, Victoria, I left the dining room at 21:13 after the candles were lit, returned at 21:22, used the servants' telephone from 21:15 to 21:20 while Reginald called through the pantry door at 21:18, and at 21:40 I backed your story.",
    // The recorded breakdown: left / telephone until / then returned.
    "I wasn't with Victoria the whole time—I left at thirteen minutes past nine to use the servants' telephone until twenty minutes past nine, then returned at twenty-two minutes past nine.",
    "I left at thirteen minutes past nine, made a quick telephone call from the servants' quarters between a quarter past nine and twenty minutes past nine, and returned at twenty-two minutes past nine.",
    "I left the dining room at thirteen minutes past nine and was back by twenty-two minutes past nine.",
  ])("accepts (with and without the speaker's context): %s", (line) => {
    expect(checkEventTimes(line, c)).toEqual([]);
    expect(checkEventTimes(line, c, archibald())).toEqual([]);
  });

  it("the conf-13 first reply: 'twenty forty' for the 21:40 pact is still rejected, and only that time", () => {
    const line =
      "Very well: I left the dining room at twenty-one thirteen after the candles were lit, used the servants' telephone from quarter past nine to twenty past, and was back by twenty-two minutes past nine. Reginald called through the pantry door at eighteen minutes past nine, and at twenty forty I backed your story that we were together the whole time.";
    expect(texts(checkEventTimes(line, c))).toEqual(["twenty forty"]);
    expect(texts(checkEventTimes(line, c, archibald()))).toEqual(["twenty forty"]);
  });

  it.each([
    ["the return at 21:35", "I left the dining room at thirteen minutes past nine, used the servants' telephone from a quarter past nine until twenty past, and returned at twenty-five to ten.", "twenty-five to ten"],
    ["leaving at 21:05", "I left the dining room at five past nine, used the servants' telephone from a quarter past nine until twenty past, and returned at twenty-two minutes past nine.", "five past nine"],
    ["the call at 21:30", "I left at thirteen minutes past nine, was on the telephone at half past nine, and returned at twenty-two minutes past nine.", "half past nine"],
  ])("a multi-event sentence with one wrong time is rejected for that time only: %s", (_n, line, wrong) => {
    expect(texts(checkEventTimes(line, c))).toEqual([wrong]);
    expect(texts(checkEventTimes(line, c, archibald()))).toEqual([wrong]);
  });

  it("a time no clause can attribute is accepted when it fits an event the speaker knows or is in; one that fits nothing is not", () => {
    const fits = "The lights went out at ten past nine, and by twenty-two minutes past nine I was sitting quietly again.";
    expect(checkEventTimes(fits, c, archibald())).toEqual([]); // 21:22: he is back in the dining room
    expect(texts(checkEventTimes(fits, c))).toEqual(["twenty-two minutes past nine"]); // no speaker: the old, strict reading
    const none = "The lights went out at ten past nine, and at nine minutes past ten I was sitting quietly again.";
    expect(texts(checkEventTimes(none, c, archibald()))).toEqual(["nine minutes past ten"]);
  });

  it("a confidently attributed wrong time is never rescued by the speaker fallback", () => {
    // 20:40 is a canon time elsewhere in the evening, but this clause is about the argument (20:54).
    const line = "I overheard part of her ladyship's argument with his lordship at twenty minutes to nine, and I returned at twenty-two minutes past nine.";
    expect(texts(checkEventTimes(line, c, archibald()))).toEqual(["twenty minutes to nine"]);
  });
});

