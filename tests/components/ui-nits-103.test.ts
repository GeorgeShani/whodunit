/**
 * #103 (rest): 390px UI nits — CASE NOT READY stamp clear of ACCUSE, ASK! contrast,
 * role text wrapping, and HUD padding so How to Play / mute don't cover card text.
 * Item 1 (toast overlap) is left to a follow-up after #107; item 6 is a separate PR.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import { suspectLayout } from "@/components/characters/suspect-layout";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import { InterrogationScreen } from "@/components/dialogue/InterrogationScreen";
import { CartoonButton } from "@/components/game/CartoonButton";
import { HUD_CLEAR_BOTTOM, HUD_CLEAR_CLASS } from "@/components/game/HudClear";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";

const suspect = (id: string, name: string, role: string) => ({
  id,
  name,
  role,
  bio: "b",
  portrait: id,
  poses: [],
  emotion: { emotion: "calm" as const, intensity: 0.2, composure: 0.9 },
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("#103 UI nits (390px)", () => {
  it("the CASE NOT READY stamp sits under the Accuse button, not over the label", () => {
    const out = html(
      h(SuspectSelect, {
        suspects: [suspect("ann", "Ann Lee", "The Host")],
        emotions: {},
        onSelect: () => {},
        onBack: () => {},
        onAccuse: () => {},
        accuseReady: false,
      }),
    );
    expect(out).toContain("data-case-not-ready-stamp");
    expect(out).toContain("Case not ready");
    expect(out).toContain("top-[calc(100%-0.2rem)]");
    expect(out).toContain("-translate-x-1/2");
    expect(out).not.toContain("-bottom-3");
    expect(out).not.toContain("-right-2");
  });

  it("ASK! uses the red tone that meets WCAG AA 4.5:1 (white on red-600 is 4.83:1)", () => {
    const btn = html(h(CartoonButton, { tone: "red" }, "ASK!"));
    expect(btn).toContain("bg-red-600");
    expect(btn).toContain("text-white");
    expect(btn).toContain("hover:bg-red-500");
    const s = (id: string) => suspect(id, `${id} Smith`, "r");
    const askBase = { suspect: s("ann"), emotion: "calm", otherSuspects: [s("bob")], evidence: [], testimonies: [], messages: [], pending: false, busyWith: null, speaking: false, stress: 0, onAsk: () => true, onBack: () => {}, onOpenNotebook: () => {} };
    const ask = html(h(InterrogationScreen, askBase as never));
    expect(ask).toContain(">ASK!<");
    expect(ask).toContain("bg-red-600");
    const cbase = { pair: [s("ann"), s("bob")], emotions: {}, stress: {}, messages: [], pending: false, speakingId: null, turnsUsed: 0, max: 6, over: false, onAsk: () => true, target: "ann", onTarget: () => {}, onBack: () => {} };
    const confront = html(h(ConfrontScreen, cbase as never));
    expect(confront).toContain(">ASK!<");
    expect(confront).toContain("bg-red-600");
  });

  it("the compact role wraps inside the card padding (Captain of the Tallyho is not clipped)", () => {
    const role = suspectLayout(6).role;
    expect(role).toContain("break-words");
    expect(role).toContain("min-w-0");
    expect(role).toContain("max-w-full");
    expect(role).toMatch(/px-1|px-0\.5/);
    const out = html(
      h(SuspectSelect, {
        suspects: [
          suspect("bilge", "Captain Horatio Bilge", "Captain of the Tallyho"),
          suspect("gherkina", "Dame Gherkina Piccalilli-Pratt", "The Pickle Queen, rival tycoon"),
          suspect("ottilie", "Chief Engineer Ottilie Wrenchley", "Chief Engineer"),
          suspect("percy", "Persimmon \"Percy\" Brine", "The Commodore's niece and heir"),
          suspect("boris", "Chef Boris Buttercrumb", "Ship's chef"),
          suspect("zippelli", "Amadeo \"The Great Zippelli\"", "Escape artist, Gala headliner"),
        ],
        emotions: {},
        onSelect: () => {},
        onBack: () => {},
      }),
    );
    expect(out).toContain("Captain of the Tallyho");
    expect(out).toContain("break-words");
  });

  it("Locations and Suspects reserve a sticky HUD pad and extra bottom padding", () => {
    const suspects = html(
      h(SuspectSelect, {
        suspects: [suspect("ann", "Ann Lee", "The Host")],
        emotions: {},
        onSelect: () => {},
        onBack: () => {},
      }),
    );
    const investigate = html(
      h(InvestigateScreen, {
        locations: [{ id: "deck", name: "The Boat Deck", description: "Wind and spray.", lockedLine: "Locked." }],
        searched: [],
        lines: {},
        lockedLocationIds: [],
        freshLocationIds: [],
        pendingId: null,
        onSearch: () => {},
        onBack: () => {},
      }),
    );
    for (const out of [suspects, investigate]) {
      expect(out).toContain("data-hud-scroll-pad");
      expect(out).toContain("pb-16");
    }
    expect(HUD_CLEAR_BOTTOM).toContain("pb-16");
    expect(HUD_CLEAR_CLASS).toContain("sticky");
    expect(HUD_CLEAR_CLASS).toContain("top-0");
  });
});
