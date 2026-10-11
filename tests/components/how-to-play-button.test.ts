// @vitest-environment happy-dom
/**
 * The labelled HOW TO PLAY pill (George via Marvin): visible text + icon, aria-label "How to Play", opens the manual
 * without touching game state, and closing brings focus AND the screen's scroll back exactly. Phone interrogation /
 * confrontation and the Notebook carry an inline one (layout is audited at all 8 sizes by scripts/check-overflow.ts).
 */
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import { InterrogationScreen } from "@/components/dialogue/InterrogationScreen";
import { Notebook } from "@/components/evidence/Notebook";
import { HowToPlayButton, HowToPlayDialog } from "@/components/help/HowToPlay";
import { GRADING_SECTION_ID, type Manual } from "@/lib/how-to-play";
import { getManual } from "@/lib/how-to-play.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let manual: Manual;
beforeAll(() => {
  manual = getManual();
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList);
});
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
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
const s = (id: string) => ({ id, name: `${id} Smith`, role: "r", bio: "b", portrait: id, poses: [], emotion: { emotion: "calm", intensity: 0.2, composure: 0.9 } });

describe("the pill", () => {
  it("is a real button with a visible label and an icon, aria-label 'How to Play', opening a dialog", () => {
    const out = renderToStaticMarkup(h(HowToPlayButton, { onOpen: () => {} }));
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain('aria-label="How to Play"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('data-help-button="fixed"');
    expect(out).toContain("<span>How to Play</span>"); // the label is text, not only an aria-label
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>📖<\/span>/);
    expect(out).toContain("min-h-11"); // 44px
    expect(out).toContain("font-display"); // the game's display font
    const inline = renderToStaticMarkup(h(HowToPlayButton, { onOpen: () => {}, variant: "inline", className: "sm:hidden" }));
    expect(inline).toContain('data-help-button="inline"');
    expect(inline).not.toContain("absolute");
    expect(inline).toContain("sm:hidden");
  });

  it("opens the manual without touching game state; Esc returns focus to the pill and the screen's scroll is exactly where it was", () => {
    function Screen() {
      const [open, setOpen] = useState(false);
      const [n, setN] = useState(0);
      return h(
        "div",
        null,
        h(
          "main",
          { className: "screen-scroll", style: { height: "200px", overflowY: "auto" } },
          h("div", { style: { height: "2000px" } }, h("button", { type: "button", "data-game-action": true, onClick: () => setN(n + 1) }, `asked ${n}`)),
        ),
        h(HowToPlayButton, { onOpen: () => setOpen(true) }),
        open && h(HowToPlayDialog, { manual, section: GRADING_SECTION_ID, onClose: () => setOpen(false) }),
      );
    }
    act(() => root.render(h(Screen)));
    act(() => q("[data-game-action]")!.click());
    const scroller = q(".screen-scroll")!;
    scroller.scrollTop = 437;
    const pill = q("[data-help-button]")!;
    act(() => pill.focus());
    act(() => pill.click());
    expect(q("[data-how-to-play]")).not.toBeNull();
    expect(scroller.scrollTop).toBe(437); // the deep-linked manual scrolls only its own body
    esc();
    expect(q("[data-how-to-play]")).toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(scroller.scrollTop).toBe(437);
    expect(q("[data-game-action]")!.textContent).toBe("asked 1");
  });
});

describe("where the header has no room (phones), the screens carry it inline", () => {
  const ibase = { suspect: s("ann"), emotion: "calm", otherSuspects: [s("bob")], evidence: [], testimonies: [], messages: [], pending: false, busyWith: null, speaking: false, stress: 0, onAsk: () => true, onBack: () => {}, onOpenNotebook: () => {} };
  const cbase = { pair: [s("ann"), s("bob")], emotions: {}, stress: {}, messages: [], pending: false, speakingId: null, left: 6, max: 6, over: false, onAsk: () => true, target: "ann", onTarget: () => {}, onOpenNotebook: () => {}, onBack: () => {} };
  const inlinePill = /<button[^>]*aria-label="How to Play"[^>]*data-help-button="inline"[^>]*class="[^"]*sm:hidden/;

  it("interrogation: beside Present evidence, phones only; nothing without a manual", () => {
    expect(renderToStaticMarkup(h(InterrogationScreen, { ...ibase, onHowToPlay: () => {} } as never))).toMatch(inlinePill);
    expect(renderToStaticMarkup(h(InterrogationScreen, ibase as never))).not.toContain("data-help-button");
  });

  it("confrontation: by the controls while it runs, and under the 'over' line once it ends", () => {
    expect(renderToStaticMarkup(h(ConfrontScreen, { ...cbase, onHowToPlay: () => {} } as never))).toMatch(inlinePill);
    expect(renderToStaticMarkup(h(ConfrontScreen, { ...cbase, over: true, left: 0, onHowToPlay: () => {} } as never))).toMatch(inlinePill);
    expect(renderToStaticMarkup(h(ConfrontScreen, cbase as never))).not.toContain("data-help-button");
  });
});

describe("inside the Notebook", () => {
  const nbase = { evidence: [], testimonies: [], locations: [], notes: {}, suspects: [s("ann")] as never, onPresent: () => {} };

  it("header pill on sm+ (beside Close, not over it), footer pill on phones; none without a manual", () => {
    const out = renderToStaticMarkup(h(Notebook, { ...nbase, onClose: () => {}, onHowToPlay: () => {} }));
    expect(out).toMatch(/<header[^>]*>[\s\S]*data-help-button="inline"[^>]*class="[^"]*max-sm:hidden[\s\S]*✕ Close[\s\S]*<\/header>/);
    expect(out).toMatch(/<footer[^>]*sm:hidden[^>]*>[\s\S]*data-help-button="inline"[\s\S]*<\/footer>/);
    expect(renderToStaticMarkup(h(Notebook, { ...nbase, onClose: () => {} }))).not.toContain("data-help-button");
  });

  it("opens the manual over the notebook; Esc closes only the manual (focus back on the pill), the next Esc closes the notebook", () => {
    const closed = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return h("div", null, h(Notebook, { ...nbase, onClose: closed, onHowToPlay: () => setOpen(true) }), open && h(HowToPlayDialog, { manual, onClose: () => setOpen(false) }));
    }
    act(() => root.render(h(Harness)));
    const pill = q("header [data-help-button]")!;
    act(() => pill.focus());
    act(() => pill.click());
    expect(q("[data-how-to-play]")).not.toBeNull();
    expect(q("[data-notebook]")).not.toBeNull();
    esc();
    expect(q("[data-how-to-play]")).toBeNull();
    expect(q("[data-notebook]")).not.toBeNull();
    expect(closed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pill);
    esc();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
