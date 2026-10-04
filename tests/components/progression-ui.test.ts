import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import { Notebook } from "@/components/evidence/Notebook";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import { LeadsPanel } from "@/components/progress/LeadsPanel";
import { CaseNotReady } from "@/components/progress/CaseNotReady";
import { NewLeadToast, NEW_LEAD_TOAST_MS } from "@/components/progress/NewLeadToast";
import { publicProgress, type PublicProgress } from "@/engine/progress";
import { GameStateSchema } from "@/engine/types";
import { isPublicProgress, parseSavedGame, SESSION_VERSION } from "@/lib/game-session";

const leads: PublicProgress["leads"] = [
  { id: "l1", title: "Who burned the letter?", state: "open", hint: "Ash in the grate." },
  { id: "l2", title: "The locked study", state: "closed", closedLine: "Key found." },
];
const accuse: PublicProgress["accuse"] = {
  unlocked: false,
  citeTestimony: true,
  line: "You need more than a hunch.",
  checklist: { clues: { have: 1, need: 3 }, suspects: { have: 1, need: 2 }, secrets: { have: 0, need: 0 } },
};
const suspects = [
  { id: "ann", name: "Ann Lee", role: "Cook", bio: "b", portrait: "ann", poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } },
  { id: "bob", name: "Bob Ray", role: "Butler", bio: "b", portrait: "bob", poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } },
] as never;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("progression UI", () => {
  it("LeadsPanel: open leads show hints, closed ones are struck through with their closing line", () => {
    const out = html(h(LeadsPanel, { leads, newLeadIds: ["l1"] }));
    expect(out).toContain("Ash in the grate.");
    expect(out).toContain('data-lead-state="closed"');
    expect(out).toContain("line-through");
    expect(out).toContain("Key found.");
    expect(out).toContain(">New<");
    expect(html(h(LeadsPanel, { leads: [] }))).toContain("No leads yet");
  });

  it("Notebook: the Leads tab exists only when the case has leads", () => {
    const base = { evidence: [], testimonies: [], locations: [], notes: {}, suspects, onPresent: () => {}, onClose: () => {} };
    expect(html(h(Notebook, base))).not.toContain("data-notebook-tab");
    const withLeads = html(h(Notebook, { ...base, leads }));
    expect(withLeads).toContain('data-notebook-tab="leads"');
    expect(withLeads).toContain('aria-label="1 open"');
  });

  it("InvestigateScreen: a locked room shows a padlock and its lockedLine, and cannot be searched", () => {
    const locations = [
      { id: "hall", name: "Hall", description: "d" },
      { id: "study", name: "Study", description: "d", lockedLine: "The door is locked." },
    ];
    const props = { locations, searched: [], lines: {}, pendingId: null, onSearch: () => {}, onBack: () => {} };
    const out = html(h(InvestigateScreen, { ...props, lockedLocationIds: ["study"] }));
    expect(out).toContain("The door is locked.");
    expect(out).toContain("🔒 Locked");
    expect(out.match(/disabled=""/g)?.length).toBe(1);
    expect(html(h(InvestigateScreen, props))).not.toContain("🔒");
  });

  it("SuspectSelect: ACCUSE is stamped CASE NOT READY and cards carry questioned n/need", () => {
    const base = { suspects, emotions: {}, onSelect: () => {}, onBack: () => {}, onAccuse: () => {} };
    const locked = html(h(SuspectSelect, { ...base, accuseReady: false, questioned: { need: 2, counts: { ann: 1, bob: 2 } } }));
    expect(locked).toContain("data-accuse-locked");
    expect(locked).toContain("Case not ready");
    expect(locked).toContain("questioned 1/2");
    expect(locked).toContain("data-questioned=\"bob\"");
    expect(locked).toContain("✔");
    const open = html(h(SuspectSelect, base));
    expect(open).not.toContain("data-accuse-locked");
    expect(open).not.toContain("questioned");
  });

  it("AccuseScreen: the testimony picker shows only when the case asks for a confession", () => {
    const base = { suspects, evidence: [], motives: [], busy: false, onSubmit: () => {}, onBack: () => {} };
    expect(html(h(AccuseScreen, base))).not.toContain("A confession");
    const none = html(h(AccuseScreen, { ...base, citeTestimony: true }));
    expect(none).toContain("data-accuse-no-testimony");
    const some = html(h(AccuseScreen, { ...base, citeTestimony: true, testimonies: [{ id: "s1", characterId: "ann", characterName: "Ann Lee", summary: "I burned it." }] }));
    expect(some).toContain('data-accuse-testimony="s1"');
  });

  it("CaseNotReady: shows the line and the counts, never what is missing", () => {
    const out = html(h(CaseNotReady, { accuse, onClose: () => {} }));
    expect(out).toContain("CASE NOT READY");
    expect(out).toContain("You need more than a hunch.");
    expect(out).toContain("1/3");
    expect(out).toContain("1/2");
    expect(out).not.toContain("0/0");
  });
});

describe("NewLeadToast (#37)", () => {
  it("never intercepts taps, holds for about 2.2 s and sits clear of the header and the top of the screen", () => {
    const out = html(h(NewLeadToast, { lead: leads[0]!, onDone: () => {} }));
    expect(out).toContain("NEW LEAD!");
    expect(out).toContain("Who burned the letter?");
    expect(out).not.toContain("pointer-events-auto");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("tabindex");
    expect(out.match(/pointer-events-none/g)?.length).toBeGreaterThanOrEqual(2); // the layer and the card
    expect(out).not.toMatch(/top-\[|top-\d/); // bottom-anchored
    expect(out).toContain("safe-area-inset-bottom");
    expect(NEW_LEAD_TOAST_MS).toBeLessThanOrEqual(2200);
  });
  it("says LEAD SOLVED for a closed lead and renders an empty layer (still pointer-events-none) with no lead", () => {
    expect(html(h(NewLeadToast, { lead: leads[1]!, onDone: () => {} }))).toContain("LEAD SOLVED!");
    expect(html(h(NewLeadToast, { lead: null, onDone: () => {} }))).toContain("pointer-events-none");
  });
});

describe("progress persistence and the questioned badges", () => {
  const prog = (over: Partial<PublicProgress> = {}): PublicProgress => ({ leads, newLeadIds: [], lockedLocationIds: ["study"], accuse, ...over });

  it("isPublicProgress rejects malformed blocks", () => {
    expect(isPublicProgress(prog())).toBe(true);
    expect(isPublicProgress({ ...prog(), leads: "x" })).toBe(false);
    expect(isPublicProgress(null)).toBe(false);
    expect(isPublicProgress({ ...prog(), accuse: { unlocked: "yes" } })).toBe(false);
  });

  it("saved games keep progress and ignore a malformed one", () => {
    const base = { v: SESSION_VERSION, caseId: "c", screen: "suspects", activeId: null, conversations: {}, emotions: {}, evidence: [], searched: [], searchLines: {}, nextId: 0 };
    expect(parseSavedGame(JSON.stringify({ ...base, progress: prog() }), "c")?.progress).toEqual(prog());
    expect(parseSavedGame(JSON.stringify({ ...base, progress: { leads: 3 } }), "c")?.progress).toBeUndefined();
  });

  it("publicProgress reports questioned counts only when the gate asks for them, capped at the need", () => {
    const g = GameStateSchema.parse({
      caseId: "demo",
      phase: "investigating",
      turn: 0,
      characters: Object.fromEntries(["ann", "bob"].map((id, i) => [id, { characterId: id, emotion: { emotion: "calm", intensity: 0.3, composure: 0.9 }, interrogationCount: i === 0 ? 5 : 1 }])),
    });
    const chars = [{ id: "ann" }, { id: "bob" }];
    const withGate = publicProgress({ leads: [], locations: [], characters: chars, solution: {}, accuseGate: { minEvidence: 0, minSuspectsQuestioned: { count: 1, minExchanges: 2 } } } as never, g);
    expect(withGate.questioned).toEqual({ need: 2, counts: { ann: 2, bob: 1 } });
    const none = publicProgress({ leads: [], locations: [], characters: chars, solution: {} } as never, g);
    expect(none.questioned).toBeUndefined();
  });
});
