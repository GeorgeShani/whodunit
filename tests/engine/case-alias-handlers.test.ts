/** #109: every gameplay handler accepts the draft alias `_tallyho` for the published `tallyho`, like save/resume do. */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handleConfront } from "@/ai/confront-handler";
import { handleInterrogate } from "@/ai/interrogate-handler";
import { handleAccuse } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { createInitialGameState } from "@/engine/game-state";
import { handleHint } from "@/engine/hint-handler";
import { handleInvestigate } from "@/engine/investigate-handler";
import { encodeStateToken } from "@/engine/state-token";
import { mockGrok, TEST_ENV } from "../helpers/grok-mock";
import { ungated } from "../helpers/ungated";

let c: LoadedCase;
beforeAll(async () => {
  c = ungated(await loadCase("tallyho"));
});
afterEach(() => vi.unstubAllGlobals());

const token = () => encodeStateToken(createInitialGameState(c), TEST_ENV);
const deps = () => ({ caseData: c, env: TEST_ENV });

describe("#109 draft alias on gameplay routes", () => {
  it("investigate accepts _tallyho", () => {
    const r = handleInvestigate({ caseId: "_tallyho", locationId: c.locations[0]!.id, stateToken: token() }, deps());
    expect(r.body.error).not.toBe("unknown_case");
    expect(r.status).not.toBe(404);
  });

  it("hint accepts _tallyho", () => {
    const r = handleHint({ caseId: "_tallyho", stateToken: token() }, deps());
    expect(r.body.error).not.toBe("unknown_case");
    expect(r.status).not.toBe(404);
  });

  it("accuse accepts _tallyho (it reaches the accusation checks, not unknown_case)", async () => {
    const r = await handleAccuse(
      { caseId: "_tallyho", accusation: { murdererId: c.characters[0]!.id, weaponId: "x", motiveId: "y", keyEvidenceIds: [] }, stateToken: token() },
      deps(),
    );
    expect(r.body.error).not.toBe("unknown_case");
    expect(r.status).not.toBe(404);
  });

  it("interrogate accepts _tallyho", async () => {
    mockGrok({});
    const r = await handleInterrogate({ caseId: "_tallyho", characterId: c.characters[0]!.id, question: "Hello?", stateToken: token() }, deps());
    expect(r.body.error).not.toBe("unknown_case");
    expect(r.status).not.toBe(404);
  });

  it("confront accepts _tallyho", async () => {
    mockGrok({});
    const r = await handleConfront(
      { caseId: "_tallyho", characterIds: [c.characters[0]!.id, c.characters[1]!.id], question: "Well?", stateToken: token() },
      deps(),
    );
    expect(r.body.error).not.toBe("unknown_case");
    expect(r.status).not.toBe(404);
  });

  it("a genuinely different case id is still refused", async () => {
    expect(handleInvestigate({ caseId: "blackwood", locationId: c.locations[0]!.id }, deps()).body.error).toBe("unknown_case");
    expect(handleHint({ caseId: "blackwood" }, deps()).body.error).toBe("unknown_case");
  });
});
