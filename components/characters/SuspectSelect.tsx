"use client";

import { CartoonButton } from "@/components/game/CartoonButton";
import { motion } from "framer-motion";
import type { PublicSuspect } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { EmotionBadge } from "./EmotionBadge";
import { Portrait } from "./Portrait";

export function SuspectSelect({
  suspects,
  emotions,
  onSelect,
  onBack,
  onInvestigate,
  cluesFound,
}: {
  suspects: PublicSuspect[];
  emotions: Record<string, Emotion>;
  onSelect: (id: string) => void;
  onBack: () => void;
  /** Open the Investigate screen (location search). */
  onInvestigate?: () => void;
  /** Number of clues in the notebook. */
  cluesFound?: number;
}) {
  return (
    <main className="screen-scroll flex min-h-0 flex-1 flex-col items-center gap-8 bg-[radial-gradient(circle_at_top,#7b1fa2_0%,#1b1035_70%)] px-4 py-10">
      <div className="flex w-full max-w-6xl items-center justify-between">
        <button type="button" onClick={onBack} className="cursor-pointer font-bold text-yellow-200 underline-offset-4 hover:underline">
          ← Case file
        </button>
        <h1 className="font-display text-4xl tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:text-6xl">
          PICK A SUSPECT!
        </h1>
        {onInvestigate ? (
          <CartoonButton tone="red" onClick={onInvestigate}>
            🔍 Investigate{cluesFound !== undefined ? ` (${cluesFound} clue${cluesFound === 1 ? "" : "s"})` : ""}
          </CartoonButton>
        ) : (
          <span className="w-20" />
        )}
      </div>
      <ul className="grid w-full max-w-6xl grid-cols-2 gap-6 lg:grid-cols-4">
        {suspects.map((s, i) => {
          const emotion = emotions[s.id] ?? s.emotion.emotion;
          return (
            <motion.li
              key={s.id}
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 * i, type: "spring", stiffness: 220, damping: 16 }}
            >
              <motion.button
                type="button"
                onClick={() => onSelect(s.id)}
                whileHover={{ y: -8, rotate: i % 2 ? 1.5 : -1.5 }}
                whileTap={{ scale: 0.96 }}
                className="flex w-full cursor-pointer flex-col items-center rounded-3xl border-4 border-black bg-[#fff8e7] p-4 text-black shadow-[6px_6px_0_#000]"
              >
                <div className="flex h-64 w-full items-end justify-center overflow-hidden rounded-2xl border-[3px] border-black bg-gradient-to-b from-sky-200 to-yellow-100">
                  <Portrait suspect={s} emotion={emotion} className="h-60" />
                </div>
                <span className="mt-3 font-display text-3xl tracking-wide">{s.name}</span>
                <span className="text-sm font-semibold italic text-neutral-700">{s.role}</span>
                <span className="mt-2">
                  <EmotionBadge emotion={emotion} />
                </span>
              </motion.button>
            </motion.li>
          );
        })}
      </ul>
    </main>
  );
}
