import type { Metadata } from "next";
import Link from "next/link";
import { ManualContent } from "@/components/help/ManualContent";
import { getManual } from "@/lib/how-to-play.server";

/** Standalone, case-agnostic How to Play (the same docs/HOW_TO_PLAY.md the in-game overlay renders). Static. */
export const metadata: Metadata = {
  title: "How to Play",
  description: "How to search rooms, question suspects, crack secrets and make an accusation that holds up.",
  alternates: { canonical: "/how-to-play" },
};

export default function HowToPlayPage() {
  const manual = getManual();
  return (
    <main className="screen-scroll h-dvh bg-[repeating-linear-gradient(45deg,#2a1650_0_24px,#1b1035_24px_48px)] px-3 py-6 sm:px-6 sm:py-10" data-how-to-play-page>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3 pe-14">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center rounded-xl border-[3px] border-black bg-white px-4 py-2 font-bold text-black shadow-[4px_4px_0_#000] hover:bg-yellow-50"
          >
            <span aria-hidden>←</span>&nbsp;Back to the game
          </Link>
        </div>
        <h1 className="text-center font-display text-[clamp(2.25rem,9vw,4rem)] leading-none tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000]">
          {manual.title}
        </h1>
        <div className="rounded-3xl border-4 border-black bg-[#fff8e7] p-3 shadow-[8px_8px_0_#000] sm:p-6">
          <ManualContent manual={manual} level={2} />
        </div>
      </div>
    </main>
  );
}
