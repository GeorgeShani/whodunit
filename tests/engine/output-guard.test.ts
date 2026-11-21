/**
 * Case-data output guard (#90 alive-after-cutoff, #91 gated topics).
 * Fixture data is built from Gremlin's r9 offline-probes. Tallyho case files
 * are not edited here — Agatha lands the authored `guard` block separately.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import { hasLocalOrEnvSolution } from "../helpers/has-solution";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { createInitialGameState } from "@/engine/game-state";
import {
  CaseGuardSchema,
  checkOutputGuard,
  type OutputGuardCase,
  validateOutputGuard,
} from "@/engine/output-guard";
import { getPublicCaseView } from "@/engine/public-view";
import { r7Verdict } from "../helpers/r7-guard";
import {
  MUST_PASS,
  PROBE_GUARD,
  PROBE_GUARD_RAW,
  SHOULD_BLOCK_ALIVE,
  SHOULD_BLOCK_ALIVE_PARAPHRASES,
  SHOULD_BLOCK_GATED,
  SHOULD_BLOCK_GATED_PARAPHRASES,
  SHOULD_PASS_FRAMED,
  SHOULD_PASS_LIST,
  SUSPECTS,
} from "../fixtures/output-guard/probe-guard";

const mini = (): OutputGuardCase => ({
  victim: {
    id: "commodore-brine",
    name: 'Commodore Barnabas "Barnacle" Brine',
    aliases: ["the Commodore", "the Old Man", "Barnacle", "Barnabas", "Uncle"],
  },
  characters: [
    { id: "bilge", name: "Captain Horatio Bilge", aliases: ["the Captain", "Horatio"] },
    { id: "percy", name: "Persimmon Percy Brine", aliases: ["Percy"] },
    { id: "ottilie", name: "Ottilie Wrenchley", aliases: ["the Chief", "Wrenchley"] },
  ],
  facts: [],
  timeline: [],
  evidence: [{ id: "heel-chart" }],
  solution: { time: "22:14" },
  guard: PROBE_GUARD,
});

function attachGuard(c: LoadedCase): LoadedCase {
  return { ...c, guard: PROBE_GUARD };
}

describe("guard schema and validation", () => {
  it("parses the fixture block and accepts an omitted or empty guard", () => {
    expect(CaseGuardSchema.parse(PROBE_GUARD_RAW).aliveUntil?.until).toBe("22:14");
    expect(CaseGuardSchema.parse({}).aliveUntil).toBeUndefined();
    expect(CaseGuardSchema.parse({ gatedTopics: [] }).gatedTopics).toEqual([]);
  });

  it("rejects a topic with no terms or patterns, and an invalid regex", () => {
    expect(CaseGuardSchema.safeParse({ gatedTopics: [{ unlockedBy: "heel-chart" }] }).success).toBe(false);
    const c = mini();
    c.guard = CaseGuardSchema.parse({
      gatedTopics: [{ unlockedBy: "heel-chart", terms: ["heel recorder"], patterns: ["(unterminated"] }],
    });
    expect(validateOutputGuard(c).some((i) => i.path?.includes("patterns"))).toBe(true);
  });

  it("errors when victimId or until disagrees with the case, or unlockedBy is unknown", () => {
    const base = mini();
    expect(validateOutputGuard(base)).toEqual([]);
    expect(validateOutputGuard({ ...base, guard: CaseGuardSchema.parse({ ...PROBE_GUARD_RAW, aliveUntil: { ...PROBE_GUARD_RAW.aliveUntil, victimId: "someone-else" } }) }).some((i) => i.path?.endsWith("victimId"))).toBe(true);
    expect(validateOutputGuard({ ...base, guard: CaseGuardSchema.parse({ ...PROBE_GUARD_RAW, aliveUntil: { ...PROBE_GUARD_RAW.aliveUntil, until: "21:00" } }) }).some((i) => i.path?.endsWith("until"))).toBe(true);
    expect(validateOutputGuard({ ...base, guard: CaseGuardSchema.parse({ gatedTopics: [{ unlockedBy: "no-such-clue", terms: ["heel recorder"] }] }) }).some((i) => i.path?.endsWith("unlockedBy"))).toBe(true);
  });
});

describe("checkOutputGuard with no data", () => {
  it("is a no-op when guard is omitted", () => {
    const c = mini();
    delete c.guard;
    expect(checkOutputGuard("The Commodore was still alive after the lurch, I heard him myself.", c)).toBeNull();
    expect(checkOutputGuard("The heel recorder shows she went from starboard to port at 22:14.", c)).toBeNull();
  });
});

describe("aliveUntil (#90)", () => {
  const c = mini();

  it.each([...SHOULD_BLOCK_ALIVE])("blocks probe line: %s", (line) => {
    expect(checkOutputGuard(line, c)?.reason).toBe("alive_after");
  });

  it.each([...SHOULD_BLOCK_ALIVE_PARAPHRASES])("blocks paraphrase: %s", (line) => {
    expect(checkOutputGuard(line, c)?.reason).toBe("alive_after");
  });

  it("detects clock wordings after the cutoff (22:20, 10.30, half past ten, quarter to eleven)", () => {
    expect(checkOutputGuard("I saw the Commodore alive after 22:20.", c)?.reason).toBe("alive_after");
    expect(checkOutputGuard("I saw the Commodore alive at 10.30.", c)?.reason).toBe("alive_after");
    expect(checkOutputGuard("The Commodore was still alive at half past ten.", c)?.reason).toBe("alive_after");
    expect(checkOutputGuard("The Commodore was still alive at quarter to eleven.", c)?.reason).toBe("alive_after");
  });

  it("does not block framed, list, found-dead, before-anchor, or Gremlin must-pass lines", () => {
    for (const line of [...SHOULD_PASS_FRAMED, ...SHOULD_PASS_LIST, ...MUST_PASS]) {
      expect(checkOutputGuard(line, c), line).toBeNull();
    }
  });

  it("lets a line through when it matches the speaker's believed facts", () => {
    const belief = "The Old Man's watch says 22:41, and a watch does not lie. That settles the hour.";
    expect(checkOutputGuard("The Old Man's watch says 22:41", c, { beliefs: [{ statement: belief }] })).toBeNull();
    // A claim that is not that belief is still blocked.
    expect(checkOutputGuard("The Commodore was still alive after the lurch, I heard him myself.", c, { beliefs: [{ statement: belief }] })?.reason).toBe("alive_after");
  });

  it("does not treat a pronoun as the victim when another character is named", () => {
    expect(checkOutputGuard("I saw Percy in the corridor after the lurch.", c)).toBeNull();
  });
});

describe("gatedTopics (#91)", () => {
  const c = mini();

  it.each([...SHOULD_BLOCK_GATED, ...SHOULD_BLOCK_GATED_PARAPHRASES])("blocks instrument talk before the clue is found: %s", (line) => {
    expect(checkOutputGuard(line, c, {}, [])?.reason).toBe("gated_topic");
  });

  it("allows the same lines once the unlocking evidence is found or shown", () => {
    for (const line of [...SHOULD_BLOCK_GATED, ...SHOULD_BLOCK_GATED_PARAPHRASES]) {
      expect(checkOutputGuard(line, c, {}, ["heel-chart"]), `found: ${line}`).toBeNull();
      expect(checkOutputGuard(line, c, { evidenceShown: [{ id: "heel-chart" }] }, []), `shown: ${line}`).toBeNull();
    }
  });

  it("leaves ordinary list and lurch talk allowed before the clue is found", () => {
    for (const line of SHOULD_PASS_LIST) {
      expect(checkOutputGuard(line, c, {}, []), line).toBeNull();
    }
  });
});

describe.skipIf(!hasLocalOrEnvSolution("tallyho"))("checkReply hook and Tallyho integration (fixture guard attached in memory)", () => {
  let tallyho: LoadedCase;
  let blackwood: LoadedCase | undefined;
  beforeAll(async () => {
    tallyho = attachGuard(await loadCase("tallyho"));
    if (hasLocalOrEnvSolution("blackwood")) blackwood = await loadCase("blackwood");
  });

  const turn = (c: LoadedCase, characterId: string, ev: string[] = []) => {
    const game = createInitialGameState(c);
    game.discoveredEvidenceIds.push(...ev);
    return prepareTurn({ caseData: c, game, characterId, question: "Tell me what you know." });
  };

  it("load-time validation accepts the fixture block on Tallyho and is a no-op on stock Blackwood", () => {
    expect(validateOutputGuard(tallyho)).toEqual([]);
    expect(checkCaseReferences(tallyho).filter((i) => i.path?.startsWith("guard"))).toEqual([]);
    if (blackwood) {
      expect(blackwood.guard).toBeUndefined();
      expect(validateOutputGuard(blackwood)).toEqual([]);
    }
  });

  it("does not put the guard block in the public case view", () => {
    const view = getPublicCaseView(tallyho, { discoveredEvidenceIds: tallyho.evidence.map((e) => e.id) });
    expect(JSON.stringify(view)).not.toMatch(/"aliveUntil"|"gatedTopics"|"alivePhrases"/);
  });

  it("blocks every should-block alive probe for every suspect via checkReply", () => {
    for (const characterId of SUSPECTS) {
      const { guard } = turn(tallyho, characterId);
      for (const line of SHOULD_BLOCK_ALIVE) {
        expect(checkReply({ dialogue: line, admits: [] }, guard), `${characterId}: ${line}`).not.toBeNull();
      }
    }
  });

  it("blocks heel-recorder talk only before heel-chart is found, for every suspect", () => {
    for (const characterId of SUSPECTS) {
      const fresh = turn(tallyho, characterId);
      const unlocked = turn(tallyho, characterId, ["heel-chart"]);
      for (const line of SHOULD_BLOCK_GATED) {
        expect(checkReply({ dialogue: line, admits: [] }, fresh.guard)?.reason, `before ${characterId}: ${line}`).toBe("gated_topic");
        expect(checkReply({ dialogue: line, admits: [] }, unlocked.guard)?.reason, `after ${characterId}: ${line}`).not.toBe("gated_topic");
      }
    }
  });

  it("does not let the new checks reject should-pass framed, list, or must-pass lines", () => {
    for (const characterId of SUSPECTS) {
      const { guard } = turn(tallyho, characterId);
      const found = guard.foundEvidenceIds ?? [];
      for (const line of [...SHOULD_PASS_FRAMED, ...SHOULD_PASS_LIST, ...MUST_PASS]) {
        expect(checkOutputGuard(line, tallyho, guard.ctx, found), `${characterId}: ${line}`).toBeNull();
      }
    }
  });

  it("lets Bilge say his watch belief and still blocks an alive-after-lurch claim from him", () => {
    const { guard } = turn(tallyho, "bilge");
    expect(checkOutputGuard("The Old Man's watch says 22:41", tallyho, guard.ctx, [])).toBeNull();
    const v = checkReply({ dialogue: "The Commodore was still alive after the lurch, I heard him myself.", admits: [] }, guard);
    // Tallyho also ships an always-on #90 forbiddenPhrases net; either reason is a block.
    expect(["alive_after", "forbidden_phrase"]).toContain(v?.reason);
  });
});

describe.skipIf(!hasLocalOrEnvSolution("blackwood"))("Blackwood regression: no guard data, behaviour unchanged", () => {
  let bw: LoadedCase;
  beforeAll(async () => {
    bw = await loadCase("blackwood");
  });

  const SAMPLE = [
    "I was in the dining room when the lights went out, sir.",
    "The clock in the hall said a quarter past nine.",
    "I never left the kitchen, I swear it.",
    "Poor Lord Blackwood was already gone when I found him.",
  ];

  it("has no guard block, and the new checks never fire", () => {
    expect(bw.guard).toBeUndefined();
    for (const line of SAMPLE) {
      expect(checkOutputGuard(line, bw)).toBeNull();
      const v = r7Verdict(bw, "reginald", line);
      expect(v?.reason === "alive_after" || v?.reason === "gated_topic").toBe(false);
    }
  });

  it("attaching an empty guard object does not change checkReply reasons on the sample", () => {
    const empty = { ...bw, guard: CaseGuardSchema.parse({}) };
    for (const line of SAMPLE) {
      const a = r7Verdict(bw, "reginald", line);
      const b = r7Verdict(empty, "reginald", line);
      expect(b?.reason ?? null, line).toBe(a?.reason ?? null);
    }
  });
});
