// @vitest-environment happy-dom
/**
 * The NEW LEAD sting is rendered once by the global LeadToastHost (portaled to document.body),
 * not inside the investigate grid or a screen-transition layer. Searching a room pushes
 * leadsToAnnounce(progress) into that host — the same path Game.applyProgress uses.
 */
import { createElement as h } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import { LeadToastHost, leadsToAnnounce, useLeadToasts } from "@/components/progress/LeadToastHost";
import { NEW_LEAD_TOAST_MS } from "@/components/progress/NewLeadToast";
import type { PublicProgress } from "@/engine/progress";

vi.mock("@/components/effects/audio", () => ({
  getAudio: () => ({ unlock: () => {}, play: () => {}, isUnlocked: () => true }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  document.querySelectorAll("[data-lead-toast-host]").forEach((n) => n.remove());
});
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const all = (sel: string) => document.querySelectorAll(sel);

const leads: PublicProgress["leads"] = [
  { id: "lead-lantern", title: "A snuffed lantern by the garden door", state: "open", hint: "Look by the garden." },
  { id: "lead-boots", title: "Muddy boots in the hall", state: "open", hint: "The hall runner." },
];
const accuse: PublicProgress["accuse"] = {
  unlocked: false,
  citeTestimony: false,
  checklist: { clues: { have: 0, need: 1 }, suspects: { have: 0, need: 1 }, secrets: { have: 0, need: 0 } },
};
const progressAfterSearch: PublicProgress = {
  leads,
  newLeadIds: ["lead-lantern"],
  lockedLocationIds: [],
  accuse,
};

function InvestigationFlow({ progress }: { progress: PublicProgress }) {
  const { pushLeads } = useLeadToasts();
  return h(InvestigateScreen, {
    locations: [{ id: "garden", name: "Garden", description: "The garden door." }],
    searched: [],
    lines: {},
    pendingId: null,
    onSearch: () => pushLeads(leadsToAnnounce(progress)),
    onBack: () => {},
  });
}

describe("LeadToastHost", () => {
  it("renders the toast once, via the global host, when investigation search announces a lead", () => {
    act(() => root.render(h(LeadToastHost, null, h(InvestigationFlow, { progress: progressAfterSearch }))));
    expect(all("[data-lead-toast-host]")).toHaveLength(1);
    expect(all("[data-new-lead]")).toHaveLength(0);

    act(() => q("[data-location-id=garden]")!.click());

    expect(all("[data-lead-toast-host]")).toHaveLength(1);
    expect(all("[data-new-lead]")).toHaveLength(1);
    const toast = q("[data-new-lead]");
    expect(toast?.textContent).toContain("NEW LEAD!");
    expect(toast?.textContent).toContain("A snuffed lantern by the garden door");
    const layer = q("[data-lead-toast-host]");
    expect(layer?.contains(toast)).toBe(true);
    expect(layer?.parentElement).toBe(document.body);
    expect(q("main")?.contains(toast)).toBe(false);
    expect(host.contains(toast)).toBe(false);
  });

  it("queues a second lead and shows it after the first toast finishes", () => {
    vi.useFakeTimers();
    const two: PublicProgress = { ...progressAfterSearch, newLeadIds: ["lead-lantern", "lead-boots"] };
    act(() => root.render(h(LeadToastHost, null, h(InvestigationFlow, { progress: two }))));
    act(() => q("[data-location-id=garden]")!.click());
    expect(all("[data-new-lead]")).toHaveLength(1);
    expect(q("[data-new-lead]")?.textContent).toContain("A snuffed lantern by the garden door");
    act(() => {
      vi.advanceTimersByTime(NEW_LEAD_TOAST_MS);
    });
    // The first card may still be exiting (AnimatePresence), but the queued lead is now on screen
    // and there is still only one host.
    const titles = [...all("[data-new-lead]")].map((n) => n.textContent ?? "");
    expect(titles.some((t) => t.includes("Muddy boots in the hall"))).toBe(true);
    expect(all("[data-lead-toast-host]")).toHaveLength(1);
  });
});
