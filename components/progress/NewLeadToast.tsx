"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { PublicProgress } from "@/engine/progress";

/**
 * "NEW LEAD!" sting (driven by progress.newLeadIds): a banner that never blocks input. Open leads read
 * NEW LEAD!, leads that just closed read LEAD SOLVED!. Tap it (or wait) to dismiss.
 */
export function NewLeadToast({
  lead,
  onDone,
  holdMs = 3600,
}: {
  lead: PublicProgress["leads"][number] | null;
  onDone: () => void;
  holdMs?: number;
}) {
  useEffect(() => {
    if (!lead) return;
    const t = setTimeout(onDone, holdMs);
    return () => clearTimeout(t);
  }, [lead, onDone, holdMs]);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex justify-center px-3"
      aria-live="polite"
      role="status"
    >
      <AnimatePresence>
        {lead && (
          <motion.button
            key={lead.id + lead.state}
            type="button"
            data-new-lead
            onClick={onDone}
            initial={{ y: -80, rotate: -4, opacity: 0 }}
            animate={{ y: 0, rotate: -1.5, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="pointer-events-auto min-h-12 max-w-md cursor-pointer rounded-2xl border-4 border-black bg-yellow-300 px-4 py-2 text-start text-black shadow-[5px_5px_0_#000]"
          >
            <span className="block font-display text-2xl tracking-wider">
              {lead.state === "closed" ? "LEAD SOLVED!" : "NEW LEAD!"}
            </span>
            <span className="block text-base font-bold leading-snug">
              {lead.title}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
