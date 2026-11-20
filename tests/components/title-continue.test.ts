// @vitest-environment happy-dom
/**
 * Title screen: Continue case when a save exists, New game asks for confirmation, START CASE when there is none.
 */
import { createElement as h } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleScreen } from "@/components/game/TitleScreen";

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
});
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe("title Continue / New game", () => {
  it("shows START CASE when there is no save, and does not ask to confirm", () => {
    const onStart = vi.fn();
    act(() => root.render(h(TitleScreen, { tagline: "A dark and stormy night.", onStart })));
    expect(q("[data-continue]")).toBeNull();
    act(() => q("[data-new-game]")!.click());
    expect(onStart).toHaveBeenCalledOnce();
    expect(q("[data-new-game-confirm]")).toBeNull();
  });

  it("shows Continue case and asks before New game when a save is in progress", () => {
    const onContinue = vi.fn();
    const onNewGame = vi.fn();
    act(() => root.render(h(TitleScreen, { tagline: "A dark and stormy night.", onStart: () => {}, hasSave: true, onContinue, onNewGame })));
    act(() => q("[data-continue]")!.click());
    expect(onContinue).toHaveBeenCalledOnce();
    act(() => q("[data-new-game]")!.click());
    expect(onNewGame).not.toHaveBeenCalled();
    expect(q("[data-new-game-confirm]")?.textContent).toMatch(/fresh case file/i);
    act(() => q("[data-new-game-confirm-no]")!.click());
    expect(onNewGame).not.toHaveBeenCalled();
    expect(q("[data-new-game-confirm]")).toBeNull();
    act(() => q("[data-new-game]")!.click());
    act(() => q("[data-new-game-confirm-yes]")!.click());
    expect(onNewGame).toHaveBeenCalledOnce();
  });
});
