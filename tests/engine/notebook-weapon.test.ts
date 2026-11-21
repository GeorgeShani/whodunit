/**
 * Live Blackwood bug: the Silver Candlestick (found by searching the library) was in the notebook, but Accuse > "With
 * what?" said "No possible weapon". Root cause: /api/investigate's `found` shape (pinned by the Blackwood goldens) has
 * no `weapon` flag, and the client put those objects straight into the notebook, stored them and restored them. The
 * client now rebuilds the notebook by id from POST /api/notebook (toPublicEvidence for the verified token), which
 * carries the public weapon-candidate flag and nothing undiscovered or solution-side.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { handleInvestigate } from "@/engine/investigate-handler";
import { handleNotebook } from "@/engine/notebook-handler";
import { getPublicCaseView } from "@/engine/public-view";
import { ungated } from "../helpers/ungated";
import { TEST_ENV } from "../helpers/grok-mock";
import { SOLUTION_KEYS, deepScan } from "../helpers/leak-scan";

let c: LoadedCase;
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
});

const search = (locationId: string, stateToken?: string) =>
  handleInvestigate({ locationId, ...(stateToken ? { stateToken } : {}) }, { caseData: c, env: TEST_ENV });

describe("root cause: a search reply alone never marks the weapon", () => {
  it("the library search's found candlestick has no weapon flag (golden-pinned shape), so the picker was empty", () => {
    const r = search("library");
    const candle = r.body.found.find((e) => e.id === "silver-candlestick");
    expect(candle).toBeDefined();
    expect((candle as { weapon?: boolean }).weapon).toBeUndefined();
    const view = getPublicCaseView(c);
    expect(view.weaponsMarked).toBe(true);
    expect(weaponChoices([candle as never], view.weaponsMarked)).toEqual([]);
  });
});

describe("POST /api/notebook (restore refresh)", () => {
  const notebook = (json: unknown) => handleNotebook(json, { caseData: c, env: TEST_ENV });

  it("rebuilds the token's found clues from the case, weapon flag included, nothing undiscovered", () => {
    const t = search("library").body.stateToken!;
    const r = notebook({ caseId: c.id, stateToken: t });
    expect(r.status).toBe(200);
    expect(r.body.evidence.find((e) => e.id === "silver-candlestick")?.weapon).toBe(true);
    expect(r.body.evidence.find((e) => e.id === "silver-candlestick")?.locationId).toBe("library");
    expect(weaponChoices(r.body.evidence, true).map((e) => e.id)).toEqual(["silver-candlestick"]);
    expect(r.body.evidence.map((e) => e.id)).not.toContain("burned-letter"); // dining room never searched
    const { keys } = deepScan(r.body);
    for (const k of SOLUTION_KEYS) expect(keys.has(k), k).toBe(false);
  });

  it("the notebook follows the token: starting clues plus every find, in case order", () => {
    const a = search("hall");
    const b = search("library", a.body.stateToken);
    const ids = notebook({ stateToken: b.body.stateToken }).body.evidence.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([...getPublicCaseView(c).evidence.map((e) => e.id), "muddy-footprint", "silver-candlestick"]));
    expect(ids).toHaveLength(getPublicCaseView(c).evidence.length + 2);
  });

  it("refuses a tampered token, another case, and a malformed body without sending clues", () => {
    const t = search("library").body.stateToken!;
    expect(notebook({ stateToken: t.slice(0, -4) + "AAAA" })).toEqual({ status: 409, body: { evidence: [], error: "stale_token" } });
    expect(notebook({ caseId: "tallyho", stateToken: t }).status).toBe(404);
    expect(notebook({}).status).toBe(400);
    expect(notebook({ stateToken: t, extra: 1 }).status).toBe(400);
  });
});
