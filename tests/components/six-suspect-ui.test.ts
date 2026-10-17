/**
 * Phase 7 (case-two plan 3.5, 3.6): the 6-suspect UI. suspectLayout(n) (n <= 4 unchanged), the accuse grid, the
 * notebook's Clues / Testimony / Leads tabs and location groups, and the confrontation chips and game-wide counter.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import { accuseSuspectGrid, suspectLayout } from "@/components/characters/suspect-layout";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import { Notebook } from "@/components/evidence/Notebook";
import { groupByLocation } from "@/components/evidence/notebook-model";
import { confrontMenu, type PublicConfrontProgress } from "@/engine/confront-caps";

const suspect = (id: string) => ({
  id,
  name: `${id} Doe`,
  role: "Guest",
  bio: "b",
  portrait: id,
  poses: [],
  emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 },
});
const cast = (n: number) => Array.from({ length: n }, (_, i) => suspect(`s${i + 1}`)) as never[];
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("suspectLayout (3.5)", () => {
  it("n <= 4 keeps today's classes exactly (Blackwood unchanged); n >= 5 is 3 across at lg, 2 compact on phones", () => {
    for (const n of [1, 2, 3, 4]) {
      const l = suspectLayout(n);
      expect(l.compact).toBe(false);
      expect(l.list).toBe("grid w-full max-w-6xl grid-cols-1 gap-5 min-[560px]:grid-cols-2 sm:gap-6 lg:grid-cols-4");
      expect(`${l.card} ${l.frame} ${l.name}`).not.toContain("max-[559px]");
    }
    const six = suspectLayout(6);
    expect(six.compact).toBe(true);
    expect(six.list).toContain("grid-cols-2");
    expect(six.list).toContain("lg:grid-cols-3");
    expect(six.list).not.toContain("lg:grid-cols-4");
    expect(six.frame).toContain("max-[559px]:h-28"); // ~112px head-and-shoulders crop
    expect(six.card).toContain("max-[559px]:flex-col");
  });
  it("SuspectSelect renders the compact grid only for big casts", () => {
    const props = { emotions: {}, onSelect: () => {}, onBack: () => {} };
    expect(html(h(SuspectSelect, { ...props, suspects: cast(4) }))).not.toContain("data-suspects-compact");
    const six = html(h(SuspectSelect, { ...props, suspects: cast(6) }));
    expect(six).toContain("data-suspects-compact");
    expect(six.match(/data-suspect-id=/g)).toHaveLength(6);
  });
  it("the accuse grid is 3 across from sm for 6 (no orphan), 4 across up to 4", () => {
    expect(accuseSuspectGrid(4)).toContain("sm:grid-cols-4");
    expect(accuseSuspectGrid(6)).toContain("sm:grid-cols-3");
    const out = html(h(AccuseScreen, { suspects: cast(6), evidence: [], motives: [], busy: false, onSubmit: () => {}, onBack: () => {} }));
    expect(out).toContain("sm:grid-cols-3");
  });
});

describe("notebook tabs and groups (3.5)", () => {
  const locations = [
    { id: "deck", name: "the Deck" },
    { id: "galley", name: "the Galley" },
  ];
  const ev = (id: string, locationId?: string) => ({ id, name: id, description: "d", ...(locationId ? { locationId } : {}) }) as never;
  it("groups clues by room in the case's room order, the case file last, keeping found order", () => {
    const g = groupByLocation([ev("a", "galley"), ev("b"), ev("c", "deck"), ev("d", "galley")] as { id: string; locationId?: string }[], locations);
    expect(g.map((x) => [x.locationId, x.label, x.items.map((i) => i.id)])).toEqual([
      ["deck", "Found in the Deck", ["c"]],
      ["galley", "Found in the Galley", ["a", "d"]],
      [null, "In the case file", ["b"]],
    ]);
  });
  it("Clues and Testimony are separate tabs (with counts); Leads only when the case has leads", () => {
    const base = {
      evidence: [ev("a", "galley")],
      testimonies: [{ id: "t1", characterId: "s1", characterName: "s1 Doe", summary: "I saw nothing." }],
      locations,
      notes: {},
      suspects: cast(6),
      onPresent: () => {},
      onClose: () => {},
    };
    const out = html(h(Notebook, base));
    expect(out).toContain('data-notebook-tab="evidence"');
    expect(out).toContain('data-notebook-tab="testimony"');
    expect(out).not.toContain('data-notebook-tab="leads"');
    expect(out).toContain('data-clue-group="galley"');
    // Testimony starts on its (hidden) tab, so the first view is the clues.
    expect(out).toMatch(/<section aria-label="Testimony" class="hidden"/);
    expect(html(h(Notebook, { ...base, leads: [{ id: "l1", title: "t", state: "open", hint: "h" }] }))).toContain('data-notebook-tab="leads"');
  });
});

describe("confrontation chips and counter (3.6)", () => {
  const p: PublicConfrontProgress = { perPair: 4, total: 16, totalUsed: 7, pairUsed: { "s1|s2": 2, "s1|s3": 4 }, finished: ["s1|s3"] };
  const key = (o: string) => ["s1", o].sort().join("|");
  it("per-pair chips: n/max used, finished when the pair (or the game) is spent; a server refusal wins", () => {
    const m = confrontMenu(p, key, ["s2", "s3", "s4"]);
    expect(m.totalLeft).toBe(9);
    expect(m.total).toBe(16);
    expect(m.pairs.s2).toEqual({ used: 2, max: 4, left: 2, finished: false });
    expect(m.pairs.s3.finished).toBe(true);
    expect(m.pairs.s4).toEqual({ used: 0, max: 4, left: 4, finished: false });
    expect(confrontMenu(p, key, ["s4"], { "s1|s4": { turnsUsed: 1, over: true } }).pairs.s4.finished).toBe(true);
    const spent = confrontMenu({ ...p, totalUsed: 16 }, key, ["s4"]);
    expect(spent.totalLeft).toBe(0);
    expect(spent.pairs.s4.finished).toBe(true);
  });
  it("ConfrontScreen shows the game-wide counter next to the pair's", () => {
    const s = cast(2);
    const props = {
      pair: s as never,
      emotions: {},
      stress: {},
      messages: [],
      pending: false,
      speakingId: null,
      left: 2,
      max: 4,
      over: false,
      onAsk: () => true,
      target: "s1",
      onTarget: () => {},
      onBack: () => {},
    };
    const out = html(h(ConfrontScreen, { ...props, game: { totalLeft: 9, total: 16 } }));
    expect(out).toContain('data-confront-total="9"');
    expect(out).toContain("9 of 16 in the game");
    expect(html(h(ConfrontScreen, props))).not.toContain("data-confront-total");
  });
});
