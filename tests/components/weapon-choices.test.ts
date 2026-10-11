/** E3: the weapon picker offers only marked weapon candidates; a case with no markers falls back to every clue found. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { weaponChoices } from "@/components/accuse/weapon-choices";
import { validateCase } from "@/engine/case-loader";
import { getPublicCaseView, toPublicEvidence } from "@/engine/public-view";
import type { PublicEvidence } from "@/engine/public-view";
import { loadCase } from "@/engine/case-loader";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ev = (id: string, weapon?: boolean): PublicEvidence => ({ id, name: id, description: "d", kind: "physical", ...(weapon ? { weapon: true } : {}) }) as PublicEvidence;
const found = [ev("knife", true), ev("letter"), ev("rope", true), ev("footprint")];

describe("weapon picker (E3)", () => {
  it("marked case: only the found weapon candidates (real one and decoys); unmarked case: every clue found", () => {
    expect(weaponChoices(found, true).map((e) => e.id)).toEqual(["knife", "rope"]);
    expect(weaponChoices(found, false).map((e) => e.id)).toEqual(["knife", "letter", "rope", "footprint"]);
    expect(weaponChoices([ev("letter")], true)).toEqual([]);
  });

  it("the accuse form renders only the candidates, and says so when none is found yet", () => {
    const props = { suspects: [], motives: [], busy: false, onSubmit: () => {}, onBack: () => {} } as never as Parameters<typeof AccuseScreen>[0];
    const marked = renderToStaticMarkup(h(AccuseScreen, { ...props, evidence: found, weaponsMarked: true }));
    expect(marked).toContain('data-accuse-weapon="knife"');
    expect(marked).toContain('data-accuse-weapon="rope"');
    expect(marked).not.toContain('data-accuse-weapon="letter"');
    const all = renderToStaticMarkup(h(AccuseScreen, { ...props, evidence: found }));
    expect(all).toContain('data-accuse-weapon="letter"');
    const none = renderToStaticMarkup(h(AccuseScreen, { ...props, evidence: [ev("letter")], weaponsMarked: true }));
    expect(none).toContain("No possible weapon in your notebook yet");
  });

  it("the public view carries the marker (only when set) and the case-level flag", async () => {
    const c = await loadCase("blackwood");
    const view = getPublicCaseView(c, { discoveredEvidenceIds: c.evidence.map((e) => e.id) });
    expect(view.weaponsMarked).toBe(c.evidence.some((e) => e.weapon));
    expect("weapon" in toPublicEvidence({ ...c.evidence[0]!, weapon: undefined })).toBe(false);
    expect(toPublicEvidence({ ...c.evidence[0]!, weapon: true }).weapon).toBe(true);
  });

  it("validator: once any clue is marked, the solution's weapon must be marked too", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "weapon-"));
    await cp(path.join("cases", "blackwood"), path.join(dir, "blackwood"), { recursive: true });
    const file = path.join(dir, "blackwood", "evidence.json");
    const list = JSON.parse(await readFile(file, "utf8")) as { id: string; weapon?: boolean }[];
    const solution = JSON.parse(await readFile(path.join(dir, "blackwood", "solution.json"), "utf8")) as { weaponId: string };
    const decoy = list.find((e) => e.id !== solution.weaponId)!;
    for (const e of list) delete e.weapon;
    decoy.weapon = true;
    await writeFile(file, JSON.stringify(list));
    const bad = await validateCase("blackwood", dir);
    expect(bad.issues.map((i) => i.message).join("\n")).toMatch(/solution's weapon .* is not one/);
    list.find((e) => e.id === solution.weaponId)!.weapon = true;
    await writeFile(file, JSON.stringify(list));
    const ok = await validateCase("blackwood", dir);
    expect(ok.issues).toEqual([]);
  });
});
