// @vitest-environment happy-dom
/**
 * How to Play overlay (components/help): open, close, Esc, focus trap and focus return, tips present vs absent,
 * the title-screen button and the first-time prompt (shown once, localStorage, SSR- and blocked-storage-safe).
 */
import { createElement as h, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAudio } from "@/components/effects/audio";
import { FirstTimePrompt, HelpButton, HowToPlayDialog } from "@/components/help/HowToPlay";
import { TitleScreen } from "@/components/game/TitleScreen";
import { getManual } from "@/lib/how-to-play.server";
import { HOW_TO_PLAY_SEEN_KEY, markFirstTimePromptSeen, shouldShowFirstTimePrompt } from "@/lib/first-visit";
import type { Manual } from "@/lib/how-to-play";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let manual: Manual;
beforeAll(() => {
  manual = getManual();
  // happy-dom has no layout: give every element a box so useModal's "visible focusables" filter sees them.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList);
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: Parameters<Root["render"]>[0]) => act(() => root.render(el));
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel);
const key = (k: string, opts: KeyboardEventInit = {}) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts })));
const click = (el: HTMLElement | null) => act(() => el!.click());

/** A screen with a HUD "?" and the overlay, like Game: the "game" state (a counter) must survive open/close. */
function Harness({ tips }: { tips?: string[] }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return h(
    "div",
    null,
    h("button", { type: "button", "data-game-action": true, onClick: () => setN(n + 1) }, `asked ${n}`),
    // Like Game: the ? stays mounted under the overlay, so focus can return to it.
    h(HelpButton, { onOpen: () => setOpen(true) }),
    open && h(HowToPlayDialog, { manual, ...(tips ? { tips } : {}), onClose: () => setOpen(false) }),
  );
}

describe("HowToPlayDialog", () => {
  it("opens from the HUD ?, is a labelled modal dialog with headings, and focus moves inside", () => {
    render(h(Harness));
    const btn = q("[data-help-button]")!;
    expect(btn.getAttribute("aria-label")).toBe("How to Play");
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    btn.focus();
    click(btn);
    const dlg = q("[role=dialog]")!;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dlg.getAttribute("aria-labelledby")!)!;
    expect(title.tagName).toBe("H2");
    expect(title.textContent).toContain("HOW TO PLAY");
    // One h3 per manual section (no "Tips for this case" without tips), sub-headings one level deeper.
    const h3 = [...dlg.querySelectorAll("h3")].map((x) => x.textContent);
    expect(h3).toEqual(manual.sections.map((s) => s.title));
    expect(dlg.querySelectorAll("h4").length).toBeGreaterThan(0);
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.hasAttribute("data-htp-close")).toBe(true);
    // Quick start is expanded, the rest collapsed.
    expect(q<HTMLDetailsElement>("[data-htp-section=quick-start]")!.open).toBe(true);
    expect(q<HTMLDetailsElement>("[data-htp-section=the-goal]")!.open).toBe(false);
  });

  it("Esc closes it and focus returns to the ? that opened it; game state is untouched", () => {
    render(h(Harness));
    click(q("[data-game-action]"));
    click(q("[data-game-action]"));
    const btn = q("[data-help-button]")!;
    btn.focus();
    click(btn);
    expect(q("[role=dialog]")).not.toBeNull();
    key("Escape");
    expect(q("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(q("[data-game-action]")!.textContent).toBe("asked 2");
  });

  it("the close button, Got it! and a backdrop tap all close it", () => {
    render(h(Harness));
    for (const close of [() => q("[data-htp-close]"), () => [...document.querySelectorAll<HTMLElement>("[role=dialog] button")].find((b) => b.textContent === "Got it!")!, () => q("[data-how-to-play-backdrop]")]) {
      const btn = q("[data-help-button]")!;
      btn.focus();
      click(btn);
      expect(q("[role=dialog]")).not.toBeNull();
      click(close());
      expect(q("[role=dialog]")).toBeNull();
      expect(document.activeElement).toBe(q("[data-help-button]"));
    }
  });

  it("traps focus: Tab from the last control wraps to the first, Shift+Tab from the first to the last", () => {
    render(h(Harness));
    click(q("[data-help-button]"));
    const dlg = q("[role=dialog]")!;
    const items = [...dlg.querySelectorAll<HTMLElement>("button, summary")].filter((x) => x.tagName === "BUTTON");
    const first = dlg.querySelector<HTMLElement>("[data-htp-close]")!;
    const last = items[items.length - 1]!;
    act(() => last.focus());
    key("Tab");
    expect(document.activeElement).toBe(first);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Focus never leaves for the page behind.
    act(() => q("[data-game-action]")!.focus());
    key("Tab");
    expect(dlg.contains(document.activeElement)).toBe(true);
  });

  it("tips present: a 'Tips for this case' section (expanded) right after Quick start; absent or empty: no section", () => {
    const tips = ["Clocks in this house run five minutes fast.", "The gardener only talks about roses."];
    render(h(Harness, { tips }));
    click(q("[data-help-button]"));
    const sec = q<HTMLDetailsElement>("[data-htp-section=tips-for-this-case]")!;
    expect(sec).not.toBeNull();
    expect(sec.open).toBe(true);
    expect(sec.querySelector("h3")!.textContent).toBe("Tips for this case");
    expect([...sec.querySelectorAll("li")].map((li) => li.textContent)).toEqual(tips);
    const order = [...document.querySelectorAll("[data-htp-section]")].map((x) => x.getAttribute("data-htp-section"));
    expect(order.slice(0, 2)).toEqual(["quick-start", "tips-for-this-case"]);
    expect(renderToStaticMarkup(h(HowToPlayDialog, { manual, onClose: () => {} }))).not.toContain("Tips for this case");
    expect(renderToStaticMarkup(h(HowToPlayDialog, { manual, tips: [], onClose: () => {} }))).not.toContain("Tips for this case");
  });
});

describe("sound", () => {
  it("open and close go through the shared audio manager (the mute toggle silences it centrally)", () => {
    const play = vi.spyOn(getAudio(), "play");
    render(h(Harness));
    click(q("[data-help-button]"));
    key("Escape");
    expect(play.mock.calls.map((c) => c[0])).toEqual(["ui_paper", "ui_paper"]);
    play.mockRestore();
    const audio = getAudio();
    const was = audio.isMuted();
    if (!was) audio.toggleMuted();
    expect(audio.play("ui_paper")).toBe(false);
    if (!was) audio.toggleMuted();
  });
});

describe("title screen", () => {
  it("has a How to Play button (server-rendered) that opens the manual; no button without a handler", () => {
    const html = renderToStaticMarkup(h(TitleScreen, { tagline: "t", onStart: () => {}, onHowToPlay: () => {} }));
    expect(html).toContain("data-how-to-play-button");
    expect(html).toContain("HOW TO PLAY");
    // The first-time prompt is client-only (localStorage): never in the server markup.
    expect(html).not.toContain("data-first-time-prompt");
    expect(renderToStaticMarkup(h(TitleScreen, { tagline: "t", onStart: () => {} }))).not.toContain("data-how-to-play-button");
    const open = vi.fn();
    render(h(TitleScreen, { tagline: "t", onStart: () => {}, onHowToPlay: open }));
    click(q("[data-how-to-play-button]"));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("first-time prompt", () => {
  it("first visit: shown once and the flag is stored; dismissible; never modal, never takes focus", () => {
    expect(shouldShowFirstTimePrompt()).toBe(true);
    const before = document.activeElement;
    render(h(FirstTimePrompt));
    const p = q("[data-first-time-prompt]")!;
    expect(p).not.toBeNull();
    expect(p.getAttribute("role")).toBeNull();
    expect(p.getAttribute("aria-modal")).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(localStorage.getItem(HOW_TO_PLAY_SEEN_KEY)).toBe("1");
    click(q("[data-first-time-dismiss]"));
    expect(q("[data-first-time-prompt]")).toBeNull();
    // Next visit: not shown again.
    act(() => root.unmount());
    root = createRoot(host);
    render(h(FirstTimePrompt));
    expect(q("[data-first-time-prompt]")).toBeNull();
  });

  it("sits in the title screen's flow under HOW TO PLAY (never an overlay over START)", () => {
    render(h(TitleScreen, { tagline: "t", onStart: () => {}, onHowToPlay: () => {} }));
    const p = q("[data-first-time-prompt]")!;
    expect(p).not.toBeNull();
    expect(p.className).not.toMatch(/\b(absolute|fixed)\b/);
    expect(p.previousElementSibling?.querySelector("[data-how-to-play-button]")).not.toBeNull();
  });

  it("not shown when the flag is already set", () => {
    markFirstTimePromptSeen();
    render(h(FirstTimePrompt));
    expect(q("[data-first-time-prompt]")).toBeNull();
  });

  it("blocked storage (getItem/setItem throw, or localStorage itself throws): no prompt, no crash", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "localStorage") ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "localStorage")!;
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => throwing });
    try {
      expect(shouldShowFirstTimePrompt()).toBe(false);
      expect(() => markFirstTimePromptSeen()).not.toThrow();
      render(h(FirstTimePrompt));
      expect(q("[data-first-time-prompt]")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", desc);
    }
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(shouldShowFirstTimePrompt()).toBe(false);
      expect(() => markFirstTimePromptSeen()).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", desc);
    }
  });

  it("server-side (no window): never shown, never throws", async () => {
    const mod = await import("@/lib/first-visit");
    const w = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      expect(mod.shouldShowFirstTimePrompt()).toBe(false);
      expect(() => mod.markFirstTimePromptSeen()).not.toThrow();
    } finally {
      vi.stubGlobal("window", w);
    }
  });
});
