// @vitest-environment happy-dom
/**
 * Phase 10 (case-two plan 3.8, George D10): case two opens after the first is solved, with no case chooser. The
 * solved store, the unlock graph (V31), the registry's unlock links on fixtures (a second case stays non-public while
 * it is "_"-prefixed), the gate (splash, then locked teaser or game), and "NEXT CASE" on a win only.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EndScreen } from "@/components/ending/EndScreen";
import { CaseGate } from "@/components/game/CaseGate";
import { LockedScreen } from "@/components/game/LockedScreen";
import { TitleScreen } from "@/components/game/TitleScreen";
import { loadCase } from "@/engine/case-loader";
import { caseUnlocks, listPublicCaseIds } from "@/engine/case-registry";
import { checkCaseReferences, checkUnlockGraph } from "@/engine/case-validation";
import { isUnlocked, markSolved, readSolved, resetSolvedMemory, SOLVED_KEY } from "@/lib/solved-store";
import { FIXTURES_DIR } from "../helpers/fixture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

beforeEach(() => {
  resetSolvedMemory();
  localStorage.clear();
});

describe("solved store", () => {
  it("reads nothing at first, marks a win once (first time kept), and round-trips through storage", () => {
    const s = mem();
    expect(readSolved(s)).toEqual({ v: 1, cases: {} });
    markSolved("first", s, () => new Date("2026-10-18T00:00:00Z"));
    markSolved("first", s, () => new Date("2026-10-19T00:00:00Z"));
    expect(JSON.parse(s.m.get(SOLVED_KEY)!)).toEqual({ v: 1, cases: { first: { at: "2026-10-18T00:00:00.000Z" } } });
    resetSolvedMemory();
    expect(readSolved(s).cases.first).toEqual({ at: "2026-10-18T00:00:00.000Z" });
  });
  it("a corrupt or foreign value reads as nothing solved; bad ids and records are dropped", () => {
    for (const raw of ["{", "null", "[]", '{"v":2,"cases":{"a":{"at":"x"}}}', '{"v":1,"cases":[]}']) {
      const s = mem();
      s.setItem(SOLVED_KEY, raw);
      expect(readSolved(s)).toEqual({ v: 1, cases: {} });
    }
    const s = mem();
    s.setItem(SOLVED_KEY, JSON.stringify({ v: 1, cases: { ok: { at: "t" }, "../x": { at: "t" }, bad: { at: 1 } } }));
    expect(Object.keys(readSolved(s).cases)).toEqual(["ok"]);
  });
  it("missing or throwing storage: the win holds in memory for this page only", () => {
    const boom = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => markSolved("first", boom)).not.toThrow();
    expect(readSolved(boom).cases.first).toBeDefined();
    expect(readSolved(null).cases.first).toBeDefined();
    resetSolvedMemory(); // a new page
    expect(readSolved(null).cases).toEqual({});
  });
  it("isUnlocked: all of unlockedBy must be solved; absent or empty is open", () => {
    const solved = { v: 1 as const, cases: { a: { at: "t" } } };
    expect(isUnlocked(undefined, solved)).toBe(true);
    expect(isUnlocked([], solved)).toBe(true);
    expect(isUnlocked(["a"], solved)).toBe(true);
    expect(isUnlocked(["a", "b"], solved)).toBe(false);
    expect(isUnlocked(["b"], { v: 1, cases: {} })).toBe(false);
  });
});

describe("unlock graph (V31)", () => {
  it("accepts a chain with a first case; rejects unknown ids, self-unlock, cycles and no first case", () => {
    expect(checkUnlockGraph([{ id: "a" }, { id: "b", unlockedBy: ["a"] }, { id: "c", unlockedBy: ["a", "b"] }])).toEqual([]);
    const msgs = (cs: Parameters<typeof checkUnlockGraph>[0]) => checkUnlockGraph(cs).map((i) => i.message);
    expect(msgs([{ id: "a" }, { id: "b", unlockedBy: ["zz"] }])).toEqual([expect.stringMatching(/unknown case "zz"/)]);
    expect(msgs([{ id: "a" }, { id: "b", unlockedBy: ["b"] }])).toEqual([expect.stringMatching(/by itself/)]);
    expect(msgs([{ id: "a" }, { id: "b", unlockedBy: ["c"] }, { id: "c", unlockedBy: ["b"] }])).toEqual([expect.stringMatching(/cycle: b -> c -> b/)]);
    expect(
      msgs([
        { id: "b", unlockedBy: ["c"] },
        { id: "c", unlockedBy: ["b"] },
      ]),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/none can be played first/), expect.stringMatching(/cycle/)]));
  });
  it("the case loader rejects a case that unlocks itself", async () => {
    const c = await loadCase("fixture-manor", FIXTURES_DIR);
    expect(checkCaseReferences({ ...c, unlockedBy: ["fixture-manor"] }).map((i) => i.path)).toContain("unlockedBy.0");
  });
  it("the repo's own cases form a valid graph and the first case is open to everyone", async () => {
    const ids = listPublicCaseIds();
    const cases = await Promise.all(ids.map((id) => loadCase(id)));
    expect(checkUnlockGraph(cases)).toEqual([]);
    expect(cases.find((c) => c.id === "blackwood")?.unlockedBy).toBeUndefined();
  });
});

describe("unlock links (registry, on fixtures)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "whodunit-unlock-"));
    for (const id of ["fixture-manor", "harbor-light"]) await cp(path.join(FIXTURES_DIR, id), path.join(dir, id), { recursive: true });
    const p = path.join(dir, "harbor-light", "case.json");
    await writeFile(p, JSON.stringify({ ...JSON.parse(await readFile(p, "utf8")), unlockedBy: ["fixture-manor"] }));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));
  it("the second case requires the first; the first lists it as next", async () => {
    const second = await caseUnlocks("harbor-light", dir);
    expect(second.unlockedBy).toEqual(["fixture-manor"]);
    expect(second.requires.map((r) => r.id)).toEqual(["fixture-manor"]);
    expect(second.next).toEqual([]);
    const first = await caseUnlocks("fixture-manor", dir);
    expect(first.requires).toEqual([]);
    expect(first.next.map((n) => [n.id, n.unlockedBy])).toEqual([["harbor-light", ["fixture-manor"]]]);
    expect(checkUnlockGraph(await Promise.all(["fixture-manor", "harbor-light"].map((id) => loadCase(id, dir))))).toEqual([]);
  });
});

describe("gate, locked screen and next-case buttons", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const requires = [{ id: "first", title: "The First Case", href: "/" }];
  const gate = (unlockedBy: string[]) => h(CaseGate, { unlockedBy, requires, title: "Second", tagline: "A tagline.", children: h("div", { "data-the-game": true }) });

  it("server render: an ungated case is the game at once; a gated one is a neutral splash (no flash of the game)", () => {
    expect(renderToStaticMarkup(gate([]))).toContain("data-the-game");
    const splash = renderToStaticMarkup(gate(["first"]));
    expect(splash).toContain("data-case-gate-checking");
    expect(splash).not.toContain("data-the-game");
  });
  it("after hydration: locked without the flag, the game with it", () => {
    act(() => root.render(gate(["first"])));
    expect(host.querySelector("[data-case-locked]")).not.toBeNull();
    expect(host.querySelector("[data-the-game]")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>('[data-locked-play="first"]')?.getAttribute("href")).toBe("/");
    expect(host.textContent).toContain("The First Case");
    act(() => root.unmount());
    markSolved("first");
    root = createRoot(host);
    act(() => root.render(gate(["first"])));
    expect(host.querySelector("[data-the-game]")).not.toBeNull();
    expect(host.querySelector("[data-case-locked]")).toBeNull();
  });
  it("the locked screen names every required case and offers no skip link", () => {
    const out = renderToStaticMarkup(
      h(LockedScreen, { title: "Second", tagline: "T", requires: [...requires, { id: "b", title: "Case B", href: "/case/b" }] }),
    );
    expect(out).toContain("The First Case and Case B");
    expect(out.match(/<a /g)).toHaveLength(2);
  });
  it("EndScreen: NEXT CASE only on a win and only with a next case; the title's Next case only when passed", () => {
    const next = [{ id: "second", title: "Second", href: "/case/second" }];
    const base = {
      accusation: { murdererId: "m", weaponId: "w", motiveId: "mo", evidenceIds: [] },
      ending: { beats: [] },
    };
    const props = { suspects: [], evidence: [], motives: [], onPlayAgain: () => {} };
    const won = renderToStaticMarkup(h(EndScreen, { ...props, nextCases: next, result: { ...base, outcome: "won" } as never }));
    expect(won).toContain('data-next-case="second"');
    expect(won).toContain("NEXT CASE: SECOND");
    expect(renderToStaticMarkup(h(EndScreen, { ...props, nextCases: next, result: { ...base, outcome: "lost" } as never }))).not.toContain("data-next-case");
    expect(renderToStaticMarkup(h(EndScreen, { ...props, result: { ...base, outcome: "won" } as never }))).not.toContain("data-next-case");
    expect(renderToStaticMarkup(h(TitleScreen, { tagline: "t", onStart: () => {}, nextCases: next }))).toContain("Next case: Second");
    expect(renderToStaticMarkup(h(TitleScreen, { tagline: "t", onStart: () => {} }))).not.toContain("data-next-case");
  });
});
