"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { PublicProgress } from "@/engine/progress";

/** How long the toast stays (#37: it used to hold for 3.6 s). */
export const NEW_LEAD_TOAST_MS = 2200;

/**
 * "NEW LEAD!" sting (driven by progress.newLeadIds). Purely informational (#37): it never takes a tap
 * (pointer-events-none on the whole thing, not a button) and sits low, above the safe area and clear of the
 * header (Back, title, stress meter) and the input row, so the player can keep playing underneath it.
 * Reduced motion comes from the global <MotionConfig reducedMotion="user">.
 */
export function NewLeadToast({ lead, onDone, holdMs = NEW_LEAD_TOAST_MS }: { lead: PublicProgress["leads"][number] | null; onDone: () => void; holdMs?: number }) {
  useEffect(() => {
    if (!lead) return;
    const t = setTimeout(onDone, holdMs);
    return () => clearTimeout(t);
  }, [lead, onDone, holdMs]);
  return (
    <div
      data-new-lead-layer
      className="pointer-events-none absolute inset-x-0 bottom-[calc(6.75rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-3 short:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
      aria-live="polite"
      role="status"
    >
      <AnimatePresence>
        {lead && (
          <motion.div
            key={lead.id + lead.state}
            data-new-lead
            initial={{ y: 40, rotate: -3, opacity: 0 }}
            animate={{ y: 0, rotate: -1.5, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="pointer-events-none max-w-sm rounded-2xl border-4 border-black bg-yellow-300 px-4 py-1.5 text-black shadow-[4px_4px_0_#000]"
          >
            <span className="block font-display text-xl leading-tight tracking-wider">{lead.state === "closed" ? "LEAD SOLVED!" : "NEW LEAD!"}</span>
            <span className="block text-sm font-bold leading-snug">{lead.title}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
