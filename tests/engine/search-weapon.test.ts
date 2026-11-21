/**
 * Live Blackwood bug: the Silver Candlestick (found by searching the library) was in the notebook, but Accuse > "With
 * what?" said "No possible weapon". /api/investigate built found clues in its own shape without the public `weapon`
 * flag. Found clues now come from toPublicEvidence, the shape the public view, ending and resume snapshot use.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { clueFeatures } from "@/engine/features/registry";
import { handleInvestigate } from "@/engine/investigate-handler";
import { getPublicCaseView, toPublicEvidence } from "@/engine/public-view";
import { parseSavedGame, SESSION_VERSION } from "@/lib/game-session";
import { ungated } from "../helpers/ungated";
import { TEST_ENV } from "../helpers/grok-mock";
import { SOLUTION_KEYS, deepScan } from "../helpers/leak-scan";

let c: LoadedCase;
beforeAll(async () => {
  c = ungated(await loadCase("blackwood"));
});

const search = (locationId: string, stateToken?: string) =>
  handleInvestigate({ locationId, ...(stateToken ? { stateToken } : {}) }, { caseData: c, env: TEST_ENV });

describe("search reply carries the public weapon flag (Blackwood candlestick)", () => {
  it("the library search returns the candlestick with weapon: true, exactly the public-view shape", () => {
    const r = search("library");
    expect(r.status).toBe(200);
    const candle = r.body.found.find((e) => e.id === "silver-candlestick");
    expect(candle?.weapon).toBe(true);
    const e = c.evidence.find((x) => x.id === "silver-candlestick")!;
    expect(candle).toEqual(toPublicEvidence(e, clueFeatures(c, e.id)));
  });

  it("after finding it, the accuse weapon list is non-empty and offers the candlestick", () => {
    const view = getPublicCaseView(c);
    const notebook = [...view.evidence, ...search("library").body.found];
    expect(weaponChoices(notebook, view.weaponsMarked).map((e) => e.id)).toEqual(["silver-candlestick"]);
    const html = renderToStaticMarkup(
      h(AccuseScreen, { suspects: [], motives: [], busy: false, onSubmit: () => {}, onBack: () => {}, evidence: notebook, weaponsMarked: view.weaponsMarked } as never),
    );
    expect(html).toContain('data-accuse-weapon="silver-candlestick"');
    expect(html).not.toContain("No possible weapon in your notebook yet");
  });

  it("non-weapon finds carry no flag, and no search reply carries solution keys", () => {
    for (const l of c.locations) {
      const r = search(l.id);
      for (const f of r.body.found) expect(f.weapon === true).toBe(c.evidence.find((e) => e.id === f.id)?.weapon === true);
      const { keys } = deepScan(r.body.found);
      for (const k of SOLUTION_KEYS) expect(keys.has(k), k).toBe(false);
    }
  });

  it("old saved games still parse: object and id evidence kept, junk dropped", () => {
    const raw = JSON.stringify({
      v: SESSION_VERSION, caseId: c.id, screen: "accuse", activeId: null, stateToken: "t", conversations: {}, emotions: {},
      evidence: [{ id: "silver-candlestick", name: "Silver Candlestick", description: "d", kind: "physical" }, "muddy-footprint", 42, null, { id: 7 }, ""],
      searched: [], searchLines: {}, nextId: 0,
    });
    expect(parseSavedGame(raw, c.id)?.evidence).toEqual([{ id: "silver-candlestick", name: "Silver Candlestick", description: "d", kind: "physical" }, "muddy-footprint"]);
  });
});
