/**
 * The shared header row of the hub screens (suspects, investigate, accuse): a back button, the screen title, and on
 * the right either a spacer or the screen's actions. The fixed HUD (mute + HOW TO PLAY, components/help/HowToPlay.tsx)
 * owns the top-right corner at the height of the header's first line.
 *
 * Below `lg` the header is stacked, as on phones: the back button shares the first line with the HUD, and the title
 * (then any actions) get full-width lines of their own, centred. That's the width range where a title beside the
 * back button would have to run under the HUD: INVESTIGATE! at 667x375 was the case that showed it. From `lg` up the
 * header is one row, keeping `pe-56` clear for the HUD (until 1700px, where the row's max width leaves the corner
 * free). The row still wraps instead of overflowing, so a longer title can never slide under the HUD at any width.
 * scripts/check-overflow.ts checks the HUD overlaps no heading or control at every size.
 */
export const SCREEN_HEADER = "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:gap-2 lg:max-[1700px]:pe-56";

/** Title layout (colour and size stay with the screen): its own centred line below `lg`, grows beside the back button from `lg`. */
export const SCREEN_TITLE = "order-2 basis-full text-center lg:basis-auto lg:grow";

/**
 * Header actions (the suspects screen's Notebook / Investigate): a full-width, centred line below `lg`; inline from
 * `lg`, and centred on a line of their own if they wrap (the auto margins only get space the growing title leaves).
 */
export const SCREEN_ACTIONS = "order-3 basis-full sm:justify-center lg:mx-auto lg:basis-auto";

/** Balances the back button from `lg` so the title sits near the centre; zero basis, so it never forces a wrap. */
export const SCREEN_HEADER_SPACER = "order-3 hidden lg:block lg:max-w-40 lg:shrink lg:grow lg:basis-0";
