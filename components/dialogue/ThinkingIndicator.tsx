"use client";

import { motion } from "framer-motion";

const VERBS = ["thinks", "ponders", "considers", "mulls it over"] as const;

/** In-character loading state: never technical. */
export function ThinkingIndicator({ name, seed = 0 }: { name: string; seed?: number }) {
  return (
    <motion.div
      className="inline-flex items-center gap-2 rounded-2xl border-[3px] border-black bg-white px-4 py-2 font-bold text-black shadow-[3px_3px_0_#000]"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      aria-live="polite"
    >
      <span>
        {name} {VERBS[seed % VERBS.length]}
      </span>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-black"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
    </motion.div>
  );
}
