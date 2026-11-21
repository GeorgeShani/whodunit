/**
 * #103: a sticky top strip plus extra bottom padding so the fixed How to Play / mute
 * controls never sit on top of scrolled card text. The strip takes a HUD-sized bite at
 * the start of the scroll (so the header starts clear of the buttons) and stays put,
 * so later cards slide under a solid bar rather than under the pills.
 */
export const HUD_CLEAR_CLASS =
  "pointer-events-none sticky top-0 z-40 -mx-4 mb-1 h-[calc(var(--hud-top)+var(--hud-btn)+0.5rem)] w-[calc(100%+2rem)] shrink-0 bg-black/55 backdrop-blur-md sm:-mx-6 sm:w-[calc(100%+3rem)]";

export const HUD_CLEAR_BOTTOM = "pb-16 sm:pb-20";

export function HudClear() {
  return <div aria-hidden data-hud-scroll-pad className={HUD_CLEAR_CLASS} />;
}
