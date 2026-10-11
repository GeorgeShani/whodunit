/** E14 (CA-46): a time in a clause that names an event must fit THAT event; no speaker fallback, no unrelated story time. */
import { beforeAll, describe, expect, it } from "vitest";
import { checkEventTimes } from "@/ai/event-time-check";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { buildCharacterContext } from "@/engine/context-builder";
import { createInitialGameState } from "@/engine/game-state";

let c: LoadedCase;
beforeAll(async () => {
  const base = await loadCase("blackwood");
  c = structuredClone(base);
  // The canon from PR #57: Reginald rang the police at 21:38 (added here so the test does not depend on that branch).
  if (!c.timeline.some((e) => e.id === "ev-reginald-telephones-police"))
    c.timeline.push({
      id: "ev-reginald-telephones-police",
      statement: "Reginald telephones the police from the servants' hall; nobody can get through the flood before morning.",
      category: "alibi",
      time: "21:38",
      locationId: "kitchen",
      involvesCharacterIds: ["reginald"],
    } as (typeof c.timeline)[number]);
});
const reginald = () => buildCharacterContext({ caseData: c, game: createInitialGameState(c) }, "reginald");
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe("E14 event-bound times", () => {
  it("the speaker's own story time for ANOTHER event (the coal at half past nine) is in his context", () => {
    expect(reginald().beliefs.some((b) => /half past nine/.test(b.statement))).toBe(true);
  });
  it('"I rang the police at half past nine" is rejected when the call is canon at 21:38', () => {
    expect(texts(checkEventTimes("I rang the police at half past nine, sir.", c, reginald()))).toEqual(["half past nine"]);
  });
  it("a loose time in a cueless clause is claimed by the event-naming clause (no speaker fallback)", () => {
    expect(texts(checkEventTimes("I rang the police, sir, at half past nine.", c, reginald()))).toEqual(["half past nine"]);
  });
  it("the right time, and the story time for its own event, still pass", () => {
    expect(checkEventTimes("I rang the police at 21:38, sir.", c, reginald())).toEqual([]);
    expect(checkEventTimes("I rang the police at about twenty to ten, sir.", c, reginald())).toEqual([]);
    expect(checkEventTimes("I took up the coal at half past nine, sir.", c, reginald())).toEqual([]);
    expect(checkEventTimes("I took the coal up at half past nine, and rang the police at 21:38.", c, reginald())).toEqual([]);
  });
  it("a time that fits an event its own clause touches is not claimed by a later event-naming clause", () => {
    // Gremlin r7b TRUE line: the coffee clause has its own time; "he locked the door after me" has none.
    expect(checkEventTimes("I took his lordship his coffee at 20:58, sir, and he locked the door after me.", c, reginald())).toEqual([]);
  });
});
