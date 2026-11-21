/** unknown_case is one neutral line for every case; unknown_suspect may come from case data. */
import { beforeAll, describe, expect, it } from "vitest";
import { handleAccuse } from "@/engine/accuse-handler";
import { ungated } from "../helpers/ungated";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { DEFAULT_UNKNOWN_SUSPECT_LINE, UNKNOWN_CASE_LINE, unknownSuspectLine } from "@/engine/error-copy";
import { createInitialGameState } from "@/engine/game-state";
import { handleHint } from "@/engine/hint-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { encodeStateToken } from "@/engine/state-token";
import { TEST_ENV } from "../helpers/grok-mock";
import { winningAccusation } from "../helpers/winning";
import type { Accusation } from "@/engine/types";

const NEUTRAL =
  "The case file's gone missing. Wherever that mystery happened, Detective, we can't get there from here.";

let c: LoadedCase;
let WIN: Accusation;
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
  WIN = winningAccusation(c, { keyEvidenceIds: [c.solution.keyEvidenceIds[0], "muddy-footprint"] });
});

const token = () => {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds.push("silver-candlestick", "muddy-footprint", "burned-letter", "library-key");
  return encodeStateToken(g, TEST_ENV);
};

describe("unknown_case", () => {
  it("is the same neutral line on accuse, investigate and hint", async () => {
    expect(UNKNOWN_CASE_LINE).toBe(NEUTRAL);
    const accuse = await handleAccuse(
      { caseId: "no-such-voyage", accusation: WIN, stateToken: token() },
      { caseData: c, env: TEST_ENV },
    );
    expect(accuse).toMatchObject({ status: 404, body: { error: "unknown_case", line: NEUTRAL } });
    const investigate = handleInvestigate(
      { caseId: "no-such-voyage", locationId: "library" },
      { caseData: c, env: TEST_ENV },
    );
    expect(investigate.status).toBe(404);
    expect(investigate.body.error).toBe("unknown_case");
    expect(investigate.body.lines).toEqual([NEUTRAL]);
    const hint = handleHint({ caseId: "no-such-voyage" }, { caseData: c, env: TEST_ENV });
    expect(hint).toMatchObject({ status: 404, body: { error: "unknown_case", line: NEUTRAL } });
  });
});

describe("unknown_suspect", () => {
  it("uses Blackwood's hat-stand wording as the default when copy.unknownSuspect is omitted", async () => {
    expect(c.copy?.unknownSuspect).toBeUndefined();
    expect(unknownSuspectLine(c)).toBe(DEFAULT_UNKNOWN_SUSPECT_LINE);
    const r = await handleAccuse(
      { accusation: { ...WIN, murdererId: "no-such-person" }, stateToken: token() },
      { caseData: c, env: TEST_ENV },
    );
    expect(r).toMatchObject({ status: 400, body: { error: "unknown_suspect", line: DEFAULT_UNKNOWN_SUSPECT_LINE } });
  });

  it("uses copy.unknownSuspect as written, without rewriting it for the setting", async () => {
    const custom = structuredClone(c);
    const line =
      "Nobody by that name is on the passenger list. Perhaps they went overboard, or never came aboard at all.";
    custom.copy = { unknownSuspect: line };
    custom.setting = { site: "the ship", household: "the company" };
    expect(unknownSuspectLine(custom)).toBe(line);
    expect(unknownSuspectLine(custom)).not.toMatch(/hat stand/i);
    const r = await handleAccuse(
      { accusation: { ...WIN, murdererId: "no-such-person" }, stateToken: encodeStateToken(createInitialGameState(custom), TEST_ENV) },
      { caseData: custom, env: TEST_ENV },
    );
    expect(r.body.line).toBe(line);
  });
});
