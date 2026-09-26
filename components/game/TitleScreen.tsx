"use client";

import { motion } from "framer-motion";

export function TitleScreen() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,#ffcf33_0%,#ff7a18_35%,#7b1fa2_70%,#1b1035_100%)] px-6 text-center">
      {/* Cartoon iris rings */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute h-[140vmax] w-[140vmax] rounded-full border-[3vmax] border-black/20"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.h1
        className="relative font-display text-7xl tracking-wider text-yellow-300 drop-shadow-[6px_6px_0_#000] [-webkit-text-stroke:3px_#000] sm:text-9xl"
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: -4 }}
        transition={{ type: "spring", stiffness: 260, damping: 12 }}
      >
        WHODUNIT?!
      </motion.h1>

      <motion.p
        className="relative mt-6 max-w-xl rounded-2xl border-4 border-black bg-white px-6 py-3 text-lg font-bold text-black shadow-[6px_6px_0_#000] sm:text-xl"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
      >
        A perfectly normal dinner party. Until somebody got murdered.
      </motion.p>

      <motion.button
        type="button"
        disabled
        title="Coming soon!"
        className="relative mt-12 cursor-not-allowed rounded-full border-4 border-black bg-red-500 px-10 py-4 font-display text-3xl tracking-widest text-white shadow-[6px_6px_0_#000]"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: [1, 1.08, 1] }}
        transition={{
          opacity: { delay: 1 },
          scale: { delay: 1, duration: 1.2, repeat: Infinity, ease: "easeInOut" },
        }}
      >
        [START CASE]
      </motion.button>
    </main>
  );
}
