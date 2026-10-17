/** Phase 5 (design G5, Q9): keyTestimonyGroups: a win cites at least one testimony from EACH group. */
import { beforeAll, describe, expect, it } from "vitest";
import { gradeAccusation } from "@/engine/accusation";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { memoryClosedGames } from "@/lib/closed-games";
import { handleAccuse } from "@/engine/accuse-handler";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken } from "@/engine/state-token";
import { TEST_ENV } from "../helpers/grok-mock";
import { ungated } from "../helpers/ungated";

let c: LoadedCase;
let secrets: string[];
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
  secrets = c.characters.flatMap((ch) => ch.secrets.map((s) => s.id)).slice(0, 4);
  Object.assign(c.solution, {
    keyTestimonyIds: secrets,
    minKeyTestimony: 2,
    keyTestimonyGroups: [
      [secrets[0], secrets[1]],
      [secrets[2], secrets[3]],
    ],
  });
});
const WIN = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key"] };

describe("keyTestimonyGroups", () => {
  it("two from one group lose; one from each group wins", () => {
    expect(gradeAccusation(c.solution, { ...WIN, keyTestimonyIds: [secrets[0], secrets[1]] }).won).toBe(false);
    expect(gradeAccusation(c.solution, { ...WIN, keyTestimonyIds: [secrets[1], secrets[3]] }).won).toBe(true);
  });
  it("the validator: group ids must be key testimony, and minKeyTestimony must cover every group", () => {
    expect(checkCaseReferences(c).filter((i) => i.path?.startsWith("keyTestimonyGroups"))).toEqual([]);
    const bad = structuredClone(c);
    bad.solution.keyTestimonyGroups = [["s-not-key"]];
    bad.solution.minKeyTestimony = 0;
    expect(checkCaseReferences(bad).map((i) => i.path)).toEqual(expect.arrayContaining(["keyTestimonyGroups.0.0", "keyTestimonyGroups"]));
  });
  it("a stored win rebuilt from the closed-games row covers every group, so it replays as a win", async () => {
    const repo = memoryClosedGames();
    const g = createInitialGameState(c);
    g.discoveredEvidenceIds.push("silver-candlestick", "library-key");
    g.revealedSecretIds.push(secrets[1], secrets[3]);
    const t = encodeStateToken(g, TEST_ENV);
    const first = await handleAccuse(
      { accusation: { ...WIN, keyTestimonyIds: [secrets[1], secrets[3]] }, stateToken: t },
      { caseData: c, env: TEST_ENV, closed: repo },
    );
    expect(first.body.outcome).toBe("won");
    const again = await handleAccuse({ accusation: WIN, stateToken: t }, { caseData: c, env: TEST_ENV, closed: repo });
    expect(again).toMatchObject({ status: 409, body: { outcome: "won", error: "case_closed" } });
  });
});
