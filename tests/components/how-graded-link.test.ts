// @vitest-environment happy-dom
/** The accuse form's "How am I graded?" link: opens How to Play at the grading section, keyboard-friendly, focus returns. */
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { HowToPlayDialog } from "@/components/help/HowToPlay";
import { ManualContent } from "@/components/help/ManualContent";
import { loadCase } from "@/engine/case-loader";
import { getPublicCaseView, type PublicCaseView } from "@/engine/public-view";
import { GRADING_HREF, GRADING_SECTION_ID, type Manual } from "@/lib/how-to-play";
import { getManual } from "@/lib/how-to-play.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let manual: Manual;
let view: PublicCaseView;
beforeAll(async () => {
  manual = getManual();
  view = getPublicCaseView(await loadCase("blackwood"));
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

/** Like Game: the accuse form plus the manual overlay, deep-linked to the grading section. */
function Harness() {
  const [section, setSection] = useState<string | null>(null);
  return h(
    "div",
    null,
    h(AccuseScreen, { suspects: view.suspects, evidence: view.evidence, motives: view.motives, busy: false, onSubmit: () => {}, onBack: () => {}, onHowGraded: () => setSection(GRADING_SECTION_ID) }),
    section && h(HowToPlayDialog, { manual, section, onClose: () => setSection(null) }),
  );
}

describe("How am I graded?", () => {
  it("the manual has the grading section the link points at, and the static page has its anchor", () => {
    expect(manual.sections.map((s) => s.id)).toContain(GRADING_SECTION_ID);
    expect(GRADING_HREF).toBe(`/how-to-play#htp-${GRADING_SECTION_ID}`);
    expect(renderToStaticMarkup(h(ManualContent, { manual, level: 2 }))).toContain(`id="htp-${GRADING_SECTION_ID}"`);
  });

  it("is a real link on the form (href to the page anchor); absent without a handler", () => {
    const base = { suspects: view.suspects, evidence: view.evidence, motives: view.motives, busy: false, onSubmit: () => {}, onBack: () => {} };
    const html = renderToStaticMarkup(h(AccuseScreen, { ...base, onHowGraded: () => {} }));
    expect(html).toContain(`href="${GRADING_HREF}"`);
    expect(html).toContain("How am I graded?");
    expect(renderToStaticMarkup(h(AccuseScreen, base))).not.toContain("data-how-graded");
  });

  it("click (or Enter, which activates a link as a click) opens the manual at the grading section, focused; Esc returns focus to the link", () => {
    act(() => root.render(h(Harness)));
    const link = q("[data-how-graded]")!;
    expect(link.tagName).toBe("A");
    act(() => link.focus());
    let ev!: MouseEvent;
    act(() => {
      ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true); // stays on the form: no navigation
    const dlg = q("[role=dialog]")!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const grading = q(`[data-htp-section="${GRADING_SECTION_ID}"]`) as HTMLDetailsElement;
    expect(grading.open).toBe(true);
    expect((q("[data-htp-section=quick-start]") as HTMLDetailsElement).open).toBe(false);
    expect(document.activeElement).toBe(grading.querySelector("summary"));
    expect(grading.querySelector("h3")!.textContent).toBe("How accusations are graded");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(q("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(q("[data-how-graded]"));
  });

  it("modifier clicks are left to the browser (new tab / window opens the page anchor)", () => {
    act(() => root.render(h(Harness)));
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
      // happy-dom would follow the href: stop it after React's handler has run.
      document.addEventListener("click", (e) => e.preventDefault(), { once: true });
      act(() => void q("[data-how-graded]")!.dispatchEvent(ev));
      expect(q("[role=dialog]")).toBeNull();
    }
  });

  it("an unknown section falls back to the top of the manual (Quick start open, focus on Close)", () => {
    act(() => root.render(h(HowToPlayDialog, { manual, section: "no-such-section", onClose: () => {} })));
    expect((q("[data-htp-section=quick-start]") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement?.hasAttribute("data-htp-close")).toBe(true);
  });
});
