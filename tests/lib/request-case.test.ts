import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "@/engine/case-loader";
import { createInitialGameState } from "@/engine/game-state";
import { encodeStateToken } from "@/engine/state-token";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { resolveRequestCase } from "@/lib/request-case";
import { FIXTURES_DIR } from "../helpers/fixture";
import { TEST_ENV } from "../helpers/grok-mock";

let foreignToken: string;
beforeAll(async () => {
  const hl = await loadCase("harbor-light", FIXTURES_DIR);
  foreignToken = encodeStateToken(createInitialGameState(hl), TEST_ENV);
});

describe("resolveRequestCase", () => {
  it("a new game with no caseId gets the default case", async () => {
    const r = await resolveRequestCase({ locationId: "hall" }, TEST_ENV);
    expect(r.ok && r.caseData.id).toBe(DEFAULT_CASE_ID);
  });

  it("an allowlisted caseId from the route is used", async () => {
    const r = await resolveRequestCase({ caseId: "blackwood" }, TEST_ENV);
    expect(r.ok && r.caseData.id).toBe("blackwood");
  });

  it.each(["_placeholder", "nonexistent", "../cases/blackwood", "fixture-manor"])("an unknown/hidden caseId %s is refused", async (caseId) => {
    expect(await resolveRequestCase({ caseId }, TEST_ENV)).toEqual({ ok: false, error: "unknown_case" });
  });

  it("a verified token for a non-public case falls back to the default (then the handler resets it)", async () => {
    const r = await resolveRequestCase({ stateToken: foreignToken }, TEST_ENV);
    expect(r.ok && r.caseData.id).toBe(DEFAULT_CASE_ID);
  });

  it("garbage tokens and bodies fall back to the default case", async () => {
    for (const body of [{ stateToken: "v1.bad.sig" }, null, "nope", 7]) {
      const r = await resolveRequestCase(body, TEST_ENV);
      expect(r.ok && r.caseData.id).toBe(DEFAULT_CASE_ID);
    }
  });
});
