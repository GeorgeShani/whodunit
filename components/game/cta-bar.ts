/**
 * The screen-bottom call to action (MEET THE SUSPECTS, SUBMIT ACCUSATION): a bar BELOW the screen's scroll area,
 * not a sticky overlay inside it. Nothing scrolls under it, so it can never cover text at any size; its fade is its
 * own background, drawn over the screen's backdrop only. Safe-area aware (home indicator).
 * scripts/check-overflow.ts checks [data-cta-bar] never overlaps text, at the first view and at the end of scroll.
 */
export const CTA_BAR =
  "relative z-10 flex shrink-0 justify-center bg-gradient-to-b from-backdrop/0 via-backdrop/80 to-backdrop px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 short:pb-2 short:pt-2 sm:px-6";
