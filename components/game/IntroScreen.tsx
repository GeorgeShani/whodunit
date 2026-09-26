"use client";

import { motion } from "framer-motion";
import type { PublicCaseView } from "@/engine/public-view";
import { CartoonButton } from "./CartoonButton";

export function IntroScreen({ view, onContinue }: { view: PublicCaseView; onContinue: () => void }) {
  const foundIn = view.locations.find((l) => l.id === view.victim.foundAtLocationId)?.name;
  return (
    <main className="screen-scroll flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-6 bg-[repeating-linear-gradient(45deg,#2a1650_0_24px,#1b1035_24px_48px)] px-6 py-10">
      <motion.h1
        data-autofocus
        tabIndex={-1}
        className="font-display text-5xl tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:text-6xl"
        initial={{ y: -60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        {view.meta.title}
      </motion.h1>
      <motion.div
        className="max-w-2xl space-y-4 rounded-3xl border-4 border-black bg-[#fff8e7] p-6 text-lg text-black shadow-[8px_8px_0_#000]"
        initial={{ scale: 0.8, opacity: 0, rotate: 2 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ delay: 0.2, type: "spring" }}
      >
        {view.meta.intro.split(/\n\s*\n/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <div className="rounded-xl border-[3px] border-dashed border-black bg-red-100 p-4">
          <h2 className="font-display text-2xl tracking-wide text-red-600">THE VICTIM: {view.victim.name}</h2>
          <p className="text-base">{view.victim.description}</p>
          <p className="mt-1 text-sm font-bold">
            Found in {foundIn ?? "an undisclosed location"} at {view.victim.foundAt}. Cause of death: {view.victim.causeOfDeath}
          </p>
        </div>
      </motion.div>
      <CartoonButton tone="red" className="font-display text-2xl tracking-widest" onClick={onContinue}>
        MEET THE SUSPECTS →
      </CartoonButton>
    </main>
  );
}
