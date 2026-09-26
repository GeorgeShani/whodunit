"use client";

import { motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { getAudio } from "@/components/effects/audio";
import { backdropStyle } from "./backdrop";

// Title card art: docs/ART_BIBLE.md §7.0 (assets/title/ -> /assets/title/ via sync:assets).
// Phones (max-sm): tighter tagline + button and less bottom padding so the stack clears the mansion base.
export function TitleScreen({ tagline, backdrop, onStart }: { tagline: string; backdrop?: string; onStart: () => void }) {
  // #9: no endless sunburst spin or button pulse under prefers-reduced-motion.
  const reduced = useReducedMotion() ?? false;
  return (
    <main className="relative flex min-h-0 flex-1 flex-col items-center justify-between overflow-hidden bg-[#1b1035] bg-[url(/assets/title/title_bg.webp)] bg-cover bg-center px-6 py-[6vh] text-center max-sm:pb-[3vh]" style={backdropStyle(backdrop)}>
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[22%] w-[130vmin] -translate-x-1/2 -translate-y-1/2">
        <motion.img
          src="/assets/title/sunburst.webp"
          alt=""
          className="block h-auto w-full"
          data-sunburst
          animate={reduced ? { rotate: 0 } : { rotate: 360 }}
          transition={reduced ? { duration: 0 } : { duration: 90, repeat: Infinity, ease: "linear" }}
        />
      </div>
      <motion.h1
        className="relative mt-[2vh] w-[min(90vw,1100px,105vh)]"
        initial={{ scale: 0, rotate: -16 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 12 }}
      >
        <Image src="/assets/title/title_logo.webp" alt="WHODUNIT?!" width={1478} height={380} priority className="h-auto w-full" />
      </motion.h1>
      <div className="relative flex flex-col items-center">
        <motion.p
          className="relative max-w-xl rounded-2xl border-4 border-black bg-white px-6 py-3 text-lg font-bold text-black shadow-[6px_6px_0_#000] max-sm:max-w-80 max-sm:px-4 max-sm:py-2 max-sm:text-sm max-sm:shadow-[4px_4px_0_#000] sm:text-xl"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
        >
          {tagline}
        </motion.p>
        <motion.button
          type="button"
          onClick={() => {
            // The START CASE click is the audio unlock gesture (autoplay rules): title-card fanfare.
            const audio = getAudio();
            audio.unlock();
            audio.play("fanfare", { gain: 0.8 });
            onStart();
          }}
          className="relative mt-8 cursor-pointer rounded-full border-4 border-black bg-red-500 px-10 py-4 font-display text-3xl tracking-widest text-white shadow-[6px_6px_0_#000] hover:bg-red-400 active:translate-y-1 active:shadow-[2px_2px_0_#000] max-sm:mt-5 max-sm:px-8 max-sm:py-3 max-sm:text-2xl"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={reduced ? { opacity: 1, scale: 1 } : { opacity: 1, scale: [1, 1.08, 1] }}
          whileHover={reduced ? undefined : { rotate: [0, -3, 3, 0] }}
          transition={{
            opacity: { delay: 1 },
            scale: reduced ? { duration: 0 } : { delay: 1, duration: 1.2, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          [START CASE]
        </motion.button>
      </div>
    </main>
  );
}
