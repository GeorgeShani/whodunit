/** #44 a spoken time must be the canon time of the event it is attached to (event-time map from facts + timeline). */
import { beforeAll, describe, expect, it } from "vitest";
import { checkEventTimes, eventTimeMap, normalizeSpokenTimes } from "@/ai/event-time-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
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
