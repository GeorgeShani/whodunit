/**
 * Phase 7 (case-two plan 3.5): layout classes for a cast of n suspects. Pure, so it is unit-tested.
 *
 * n <= 4 keeps today's layout exactly (four-suspect cases unchanged): one row card per line on phones, 2 columns from 560px,
 * 4 at lg. n >= 5: 3 columns at lg (6 = 3 + 3, no orphans), 2 from 560px, and under 560px a 2-column COMPACT card
 * (head-and-shoulders crop about 112px high, name, role, badges), so six suspects take about three rows on a phone.
 */
export interface SuspectLayout {
  /** The suspect list (`<ul>`). */
  list: string;
  /** The card button. */
  card: string;
  /** The portrait frame. */
  frame: string;
  /** The portrait itself. */
  portrait: string;
  /** The text column, the name and the role. */
  info: string;
  name: string;
  role: string;
  /** Whether phones under 560px get compact cards. */
  compact: boolean;
}

const BASE = {
  card: "flex w-full cursor-pointer flex-row items-center gap-4 rounded-3xl border-4 border-black bg-paper p-4 text-start text-ink shadow-[6px_6px_0_#000] md:flex-col md:text-center",
  frame:
    "flex h-40 w-[36%] max-w-44 shrink-0 items-end justify-center overflow-hidden rounded-2xl border-[3px] border-black bg-gradient-to-b from-sky-200 to-yellow-100 md:h-64 md:w-full md:max-w-none",
  portrait: "h-36 md:h-60",
  info: "flex min-w-0 flex-1 flex-col items-start gap-1 md:w-full md:flex-none md:items-center",
  name: "text-balance font-display text-[1.7rem] leading-[1.05] tracking-wide md:mt-3 md:text-3xl",
  role: "text-base font-semibold italic text-neutral-700",
};

/** The phone (< 560px) compact overrides, as max-[559px] variants so 560px+ is the plain card. */
const COMPACT = {
  card: "max-[559px]:h-full max-[559px]:flex-col max-[559px]:gap-1.5 max-[559px]:rounded-2xl max-[559px]:p-2 max-[559px]:text-center max-[559px]:shadow-[4px_4px_0_#000]",
  frame: "max-[559px]:h-28 max-[559px]:w-full max-[559px]:max-w-none max-[559px]:rounded-xl",
  portrait: "max-[559px]:h-[6.5rem]",
  info: "max-[559px]:w-full max-[559px]:flex-none max-[559px]:items-center max-[559px]:gap-0.5",
  name: "max-[559px]:text-xl max-[559px]:leading-none",
  role: "max-[559px]:text-sm max-[559px]:leading-tight",
};

export function suspectLayout(n: number): SuspectLayout {
  if (n <= 4) return { list: "grid w-full max-w-6xl grid-cols-1 gap-5 min-[560px]:grid-cols-2 sm:gap-6 lg:grid-cols-4", ...BASE, compact: false };
  const join = (k: keyof typeof BASE) => `${BASE[k]} ${COMPACT[k]}`;
  return {
    list: "grid w-full max-w-6xl grid-cols-2 gap-3 min-[560px]:gap-5 sm:gap-6 lg:grid-cols-3",
    card: join("card"),
    frame: join("frame"),
    portrait: join("portrait"),
    info: join("info"),
    name: join("name"),
    role: join("role"),
    compact: true,
  };
}

/** The accusation's "Who did it?" grid: 4 across for up to 4 suspects (today), 3 across from sm for more (6 = 3 + 3). */
export const accuseSuspectGrid = (n: number) => (n <= 4 ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "grid grid-cols-2 gap-3 sm:grid-cols-3");
