"use client";

import { motion } from "framer-motion";
import Image from "next/image";

// Title card art: docs/ART_BIBLE.md §7.0 (assets/title/ -> /assets/title/ via sync:assets).
export function TitleScreen({ tagline, onStart }: { tagline: string; onStart: () => void }) {
  return (
    <main className="relative flex min-h-0 flex-1 flex-col items-center justify-between overflow-hidden bg-[#1b1035] bg-[url(/assets/title/title_bg.webp)] bg-cover bg-center px-6 py-[6vh] text-center">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[22%] w-[130vmin] -translate-x-1/2 -translate-y-1/2">
        <motion.img
          src="/assets/title/sunburst.webp"
          alt=""
          className="block h-auto w-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
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
          className="relative max-w-xl rounded-2xl border-4 border-black bg-white px-6 py-3 text-lg font-bold text-black shadow-[6px_6px_0_#000] sm:text-xl"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
        >
          {tagline}
        </motion.p>
        <motion.button
          type="button"
          onClick={onStart}
          className="relative mt-8 cursor-pointer rounded-full border-4 border-black bg-red-500 px-10 py-4 font-display text-3xl tracking-widest text-white shadow-[6px_6px_0_#000] hover:bg-red-400 active:translate-y-1 active:shadow-[2px_2px_0_#000]"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: [1, 1.08, 1] }}
          whileHover={{ rotate: [0, -3, 3, 0] }}
          transition={{
            opacity: { delay: 1 },
            scale: { delay: 1, duration: 1.2, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          [START CASE]
        </motion.button>
      </div>
    </main>
  );
}
