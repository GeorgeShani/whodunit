// @vitest-environment happy-dom
/**
 * Phase 5 (case-two plan 3.2, D3): the role-worded accuse form. A case with `accuse.askHelper` asks "Who struck the
 * fatal blow?" then "Did anyone help?" with an explicit "No one helped", nothing preselected, Submit disabled until
 * answered, and the confirm dialog says the roles. Blackwood (no flag) keeps "Who did it?" and no helper question.
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccuseScreen, rolesLine } from "@/components/accuse/AccuseScreen";
import { summaryRows } from "@/components/ending/summary";
import { validateAccusationDraft } from "@/engine/accuse-schema";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { checkCaseReferences } from "@/engine/case-validation";
import { getPublicCaseView, type PublicCaseView } from "@/engine/public-view";
import type { Accusation } from "@/engine/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let real: LoadedCase;
let view: PublicCaseView;
beforeAll(async () => {
  real = await loadCase("blackwood");
  view = getPublicCaseView(real);
});
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const props = (askHelper: boolean, onSubmit: (a: Accusation) => void = () => {}) => ({
  suspects: view.suspects,
  evidence: [{ id: "silver-candlestick", name: "Silver Candlestick", description: "", kind: "physical" } as never],
  motives: view.motives,
  busy: false,
  askHelper,
  onSubmit,
  onBack: () => {},
});
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T & HTMLElement>(sel);
const click = (sel: string) => act(() => void q(sel)!.click());

describe("phase 5: per-case accuse wording", () => {
  it("Blackwood (no flag): 'Who did it?', no helper question, and the public view has no flag", () => {
    expect(view).not.toHaveProperty("askHelper");
    const html = renderToStaticMarkup(h(AccuseScreen, props(false)));
    expect(html).toContain("1. Who did it?");
    expect(html).not.toContain("Did anyone help?");
    expect(html).not.toContain("struck the fatal blow");
    expect(html).toContain("2. With what?");
  });

  it("with the flag: 'Who struck the fatal blow?' then 'Did anyone help?' (section 2), later sections renumber", () => {
    const html = renderToStaticMarkup(h(AccuseScreen, props(true)));
    expect(html).toContain("1. Who struck the fatal blow?");
    expect(html).toContain("2. Did anyone help?");
    expect(html).toContain("3. With what?");
    expect(html).toContain("5. Your proof");
    expect(html).toContain("No one helped");
  });

  it("the flag reaches the public view only from case.json, never from the solution", () => {
    const flagged = structuredClone(real);
    flagged.accuse = { askHelper: true };
    expect(getPublicCaseView(flagged).askHelper).toBe(true);
    const helperOnly = structuredClone(real);
    helperOnly.solution.accompliceId = "reginald";
    expect(getPublicCaseView(helperOnly)).not.toHaveProperty("askHelper");
    expect(JSON.stringify(getPublicCaseView({ ...flagged, solution: { ...flagged.solution, accompliceId: "reginald" } }))).not.toContain("accomplice");
  });
});

describe("phase 5: the helper picker", () => {
  it("nothing preselected; Submit disabled with a visible reason until answered; the murderer's chip is disabled", () => {
    act(() => root.render(h(AccuseScreen, props(true))));
    const submit = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "SUBMIT ACCUSATION")!;
    expect(host.querySelectorAll('[data-accuse-helper][aria-checked="true"]')).toHaveLength(0);
    expect(submit().disabled).toBe(true);
    expect(submit().getAttribute("aria-describedby")).toBe("accuse-helper-needed");
    expect(q("[data-accuse-helper-needed]")!.textContent).toBe("Say whether anyone helped");
    click('[data-accuse-suspect="victoria"]');
    expect(q<HTMLButtonElement>('[data-accuse-helper="victoria"]')!.disabled).toBe(true);
    expect(q('[data-accuse-helper="victoria"]')!.textContent).toContain("struck the blow");
    click('[data-accuse-helper="none"]');
    expect(submit().disabled).toBe(false);
    expect(q("[data-accuse-helper-needed]")).toBeNull();
  });

  it("making the chosen helper the murderer clears the helper answer and disables Submit again", () => {
    act(() => root.render(h(AccuseScreen, props(true))));
    click('[data-accuse-suspect="victoria"]');
    click('[data-accuse-helper="reginald"]');
    expect(q('[data-accuse-helper="reginald"]')!.getAttribute("aria-checked")).toBe("true");
    click('[data-accuse-suspect="reginald"]');
    expect(host.querySelectorAll('[data-accuse-helper][aria-checked="true"]')).toHaveLength(0);
    expect(q("[data-accuse-helper-needed]")).not.toBeNull();
  });

  it("the confirm dialog says the roles in words, and the submitted accusation carries the answer", () => {
    let sent: Accusation | null = null;
    act(() =>
      root.render(
        h(
          AccuseScreen,
          props(true, (a) => (sent = a)),
        ),
      ),
    );
    click('[data-accuse-suspect="victoria"]');
    click('[data-accuse-helper="reginald"]');
    click('[data-accuse-weapon="silver-candlestick"]');
    click(`[data-accuse-motive="${view.motives[0].id}"]`);
    click('[data-accuse-proof="silver-candlestick"]');
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "SUBMIT ACCUSATION")!.click());
    const names = (id: string) => view.suspects.find((s) => s.id === id)!.name;
    expect(q("[data-confirm-roles]")!.textContent).toBe(`${names("victoria")} struck the blow. ${names("reginald")} helped.`);
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Yes, accuse!")!.click());
    expect(sent).toMatchObject({ murdererId: "victoria", accompliceId: "reginald" });
  });

  it("Blackwood's confirm dialog is unchanged (no roles line) and its accusation has no helper field", () => {
    let sent: Accusation | null = null;
    act(() =>
      root.render(
        h(
          AccuseScreen,
          props(false, (a) => (sent = a)),
        ),
      ),
    );
    for (const sel of [
      '[data-accuse-suspect="victoria"]',
      '[data-accuse-weapon="silver-candlestick"]',
      `[data-accuse-motive="${view.motives[0].id}"]`,
      '[data-accuse-proof="silver-candlestick"]',
    ])
      click(sel);
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "SUBMIT ACCUSATION")!.click());
    expect(q("[data-confirm-roles]")).toBeNull();
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Yes, accuse!")!.click());
    expect(sent).not.toHaveProperty("accompliceId");
  });

  it("rolesLine", () => {
    expect(rolesLine("Amadeo", "Horatio")).toBe("Amadeo struck the blow. Horatio helped.");
    expect(rolesLine("Amadeo", null)).toBe("Amadeo struck the blow. No one helped.");
  });
});

describe("phase 5: draft validation, summary, validator", () => {
  const opts = { suspectIds: ["a", "b"], evidenceIds: ["e"], motiveIds: ["m"], askHelper: true };
  const base = { murdererId: "a", weaponId: "e", motiveId: "m", keyEvidenceIds: ["e"] };
  it("validateAccusationDraft: an answer is required; null is 'no one'; the murderer can't be the helper", () => {
    expect(validateAccusationDraft(base, opts)).toEqual({ ok: false, errors: ["Say whether anyone helped."] });
    expect(validateAccusationDraft({ ...base, accompliceId: null }, opts)).toMatchObject({ ok: true, accusation: { accompliceId: null } });
    expect(validateAccusationDraft({ ...base, accompliceId: "a" }, opts)).toMatchObject({ ok: false });
    expect(validateAccusationDraft({ ...base, accompliceId: "zz" }, opts)).toMatchObject({ ok: false });
    expect(validateAccusationDraft(base, { ...opts, askHelper: false })).toEqual({ ok: true, accusation: base });
  });
  it("summary: a Helper row only when the form asked or the case has one; Blackwood's rows unchanged", () => {
    const lookup = {
      suspects: [
        { id: "a", name: "Ann" },
        { id: "b", name: "Bob" },
      ],
      evidence: [],
      motives: [],
    };
    const verdict = { murdererCorrect: true, weaponCorrect: true, motiveCorrect: true, hasKeyEvidence: true, keyEvidenceCited: [], hasKeyTestimony: true };
    const plain = summaryRows({ accusation: base, verdict }, lookup, false);
    expect(plain.map((r) => r.field)).toEqual(["murderer", "weapon", "motive", "proof"]);
    expect(plain[0].label).toBe("Murderer");
    const asked = summaryRows({ accusation: { ...base, accompliceId: "b" }, verdict: { ...verdict, accompliceCorrect: true } }, lookup, false);
    expect(asked.map((r) => [r.field, r.label, r.yours])).toEqual([
      ["murderer", "Struck the blow", "Ann"],
      ["accomplice", "Helper", "Bob"],
      ["weapon", "Weapon", "e"],
      ["motive", "Motive", "m"],
      ["proof", "Proof", "e"],
    ]);
    expect(summaryRows({ accusation: { ...base, accompliceId: null }, verdict }, lookup, false)[1]).toMatchObject({ yours: "No one", correct: true });
  });
  it("V6: a case with an accomplice must set accuse.askHelper; V5: the accomplice's act needs an opportunity", () => {
    const two = structuredClone(real);
    two.solution.accompliceId = "reginald";
    expect(checkCaseReferences(two).map((i) => i.path)).toContain("accuse.askHelper");
    two.accuse = { askHelper: true };
    expect(checkCaseReferences(two).map((i) => i.path)).not.toContain("accuse.askHelper");
    two.solution.accompliceAct = { locationId: "library", time: "03:00" };
    expect(checkCaseReferences(two).find((i) => i.path === "accompliceAct")?.message).toMatch(/no opportunity/);
    two.solution.accompliceAct = { locationId: "nowhere", time: "21:00" };
    expect(checkCaseReferences(two).map((i) => i.path)).toContain("accompliceAct.locationId");
  });
});
