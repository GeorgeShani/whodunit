// @vitest-environment happy-dom
/**
 * A stale or swapped accusation graded straight away: the ending screen shows the in-character notice the accuse
 * response carried, announced to screen readers.
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EndScreen } from "@/components/ending/EndScreen";
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import { STALE_TOKEN_NOTICE } from "@/engine/session";

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

const lost = (extra: Partial<AccuseResponseBody> = {}): AccuseResponseBody =>
  ({
    outcome: "lost",
    accusation: { murdererId: "gregory", weaponId: "silver-candlestick", motiveId: "revenge", keyEvidenceIds: ["burned-letter"] },
    ending: { outcome: "lost", headline: "CASE UNSOLVED", beats: [] },
    ...extra,
  }) as unknown as AccuseResponseBody;

const render = (result: AccuseResponseBody) =>
  act(() =>
    root.render(
      h(EndScreen, {
        result,
        suspects: [{ id: "gregory", name: "Gregory" }] as never,
        evidence: [],
        motives: [{ id: "revenge", label: "Revenge" }] as never,
        onPlayAgain: () => {},
      }),
    ),
  );

describe("ending screen notice", () => {
  it("shows the stale notice in character as a polite status line", () => {
    render(lost({ notice: STALE_TOKEN_NOTICE }));
    const n = document.querySelector<HTMLElement>("[data-end-notice]");
    expect(n?.textContent).toBe(STALE_TOKEN_NOTICE);
    expect(n?.getAttribute("role")).toBe("status");
    expect(n?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector("[data-end-screen]")).not.toBeNull();
  });
  it("shows nothing extra on an ordinary ending", () => {
    render(lost());
    expect(document.querySelector("[data-end-notice]")).toBeNull();
  });
});
