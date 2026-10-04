"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { getAudio } from "@/components/effects/audio";
import { CartoonButton } from "@/components/game/CartoonButton";
import { useModal } from "@/components/ui/use-modal";
import { effectSrc, overlayVariants } from "@/docs/toonMotion";
import type { FoundEvidence } from "@/engine/investigate-schema";

const KIND_ICON: Record<string, string> = { physical: "🔧", document: "📜", testimony: "🗣️", observation: "👣" };

/**
 * ART_BIBLE "Clue discovered" beat: the clue card pops in with the discovery
 * overlay (popIn then throb) and the "clue found" stinger and a typewriter tap, plus the discoveryLine.
 */
export function DiscoverySting({ clue, remaining, onDone }: { clue: FoundEvidence | null; remaining: number; onDone: () => void }) {
  useEffect(() => {
    if (!clue) return;
    // The noir "dun-dun", then the typewriter logs it in the notebook.
    const audio = getAudio();
    audio.play("clue_stinger");
    const t = setTimeout(() => audio.play("typewriter_tap"), 700);
    return () => clearTimeout(t);
  }, [clue]);

  return (
    <AnimatePresence>
      {clue && <StingDialog key={clue.id} clue={clue} remaining={remaining} onDone={onDone} />}
    </AnimatePresence>
  );
}

/** One clue card. Modal like the notebook: focus trapped, Escape dismisses it (#25); the owner puts focus back when the queue empties. */
function StingDialog({ clue, remaining, onDone }: { clue: FoundEvidence; remaining: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, { onClose: onDone, restoreFocus: false });
  return (
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={`Clue found: ${clue.name}`}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 pt-24"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative flex w-full max-w-md flex-col items-center gap-3 rounded-3xl border-4 border-black bg-[#fff8e7] p-6 pt-16 text-center text-black shadow-[10px_10px_0_#000]"
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: [0, 1.15, 1], rotate: [-12, 4, 0] }}
            transition={{ duration: 0.45, times: [0, 0.6, 1], ease: "easeOut" }}
          >
            <motion.img
              src={effectSrc("discovery")}
              alt=""
              aria-hidden
              className="pointer-events-none absolute -top-20 left-1/2 w-40 -translate-x-1/2"
              variants={overlayVariants}
              initial="hidden"
              animate={["popIn", "throb"]}
            />
            <div className="scroll-area flex max-h-[calc(100dvh-10rem)] w-full flex-col items-center gap-3">
            <p className="font-display text-4xl tracking-widest text-red-600 [-webkit-text-stroke:1px_#000]">CLUE FOUND!</p>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-black bg-amber-200 text-5xl shadow-[4px_4px_0_#000]">
              {KIND_ICON[clue.kind] ?? "🔍"}
            </div>
            <h2 className="font-display text-3xl tracking-wide">{clue.name}</h2>
            {clue.discoveryLine && <p className="text-lg font-bold italic">&ldquo;{clue.discoveryLine}&rdquo;</p>}
            <p className="text-sm text-neutral-700">{clue.description}</p>
            </div>
            <CartoonButton tone="red" onClick={onDone} autoFocus>
              {remaining > 0 ? "Next clue! →" : "Into the notebook!"}
            </CartoonButton>
          </motion.div>
        </motion.div>
  );
}
