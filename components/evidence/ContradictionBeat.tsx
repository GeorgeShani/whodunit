"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { getAudio } from "@/components/effects/audio";
import { effectSrc } from "@/docs/toonMotion";

export interface ContradictionBeatData {
  key: string;
  title: string;
  line: string;
  /** "breakdown": the stress breakdown beat (shock burst, thunder + surprise sting). Default: contradiction (impact). */
  kind?: "contradiction" | "breakdown";
}

/**
 * OBJECTION-style beat for an engine-confirmed broken lie: impact burst,
 * camera shake, "CONTRADICTION!" and one sting (contradiction_stab / breakdown_crack). Shown only
 * when the server says the presented item newly broke a lie. Under reduced
 * motion it simply fades in and out.
 */
export function ContradictionBeat({ beat, onDone }: { beat: ContradictionBeatData | null; onDone: () => void }) {
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    if (!beat) return;
    const audio = getAudio();
    // One cue per beat: the stab for a broken lie, the crack for a breakdown (which also stops the heartbeat).
    audio.play(beat.kind === "breakdown" ? "breakdown_crack" : "contradiction_stab");
    const t2 = setTimeout(onDone, 2200);
    return () => clearTimeout(t2);
  }, [beat, onDone]);

  return (
    <AnimatePresence>
      {beat && (
        <motion.div
          key={beat.key}
          role="alert"
          data-contradiction-beat={beat.kind ?? "contradiction"}
          className="absolute inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/35 p-4"
          onClick={onDone}
          initial={{ opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="relative flex w-[min(92vw,44rem)] flex-col items-center">
            <motion.img
              src={effectSrc(beat.kind === "breakdown" ? "shock" : "impact")}
              alt=""
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 w-[120%] -translate-x-1/2 -translate-y-1/2"
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: [0, 1.3, 1], rotate: [-10, 6, 0] }}
              transition={{ duration: 0.45, times: [0, 0.6, 1] }}
            />
            <motion.p
              className={`relative font-display text-[clamp(2.75rem,11vw,6.5rem)] leading-none tracking-wider ${beat.kind === "breakdown" ? "text-fuchsia-500" : "text-red-600"} [-webkit-text-stroke:3px_#000] drop-shadow-[6px_6px_0_#000]`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: [0.4, 1.2, 1], opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.08 }}
            >
              {beat.title}
            </motion.p>
            <p className="relative mt-3 rounded-2xl border-4 border-black bg-white px-4 py-2 text-center text-lg font-black text-black shadow-[5px_5px_0_#000]">
              {beat.line}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
