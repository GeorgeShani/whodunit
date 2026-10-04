"use client";

import { StressMeter } from "@/components/stress/StressMeter";
import { CartoonButton } from "@/components/game/CartoonButton";
import { backdropStyle } from "@/components/game/backdrop";
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
  onOpenNotebook,
  onAccuse,
  cluesFound,
  stress = {},
  backdrop,
}: {
  suspects: PublicSuspect[];
  emotions: Record<string, Emotion>;
  onSelect: (id: string) => void;
  onBack: () => void;
  /** Open the Investigate screen (location search). */
  onInvestigate?: () => void;
  /** Open the detective's notebook (evidence + testimony, present to anyone). */
  onOpenNotebook?: () => void;
  /** Open the accusation form; offered once at least one clue is found (Phase 8). */
  onAccuse?: () => void;
  /** Engine stress per suspect (Phase 7); a meter shows once someone has been rattled. */
  stress?: Record<string, number>;
  /** Number of clues in the notebook. */
  cluesFound?: number;
  /** Case backdrop (e.g. the manor hall, ART_BIBLE §7.2); falls back to the purple radial. */
  backdrop?: string;
}) {
  return (
    <main
      className={`screen-scroll flex min-h-0 flex-1 flex-col items-center gap-5 px-4 pb-8 pt-3 sm:gap-8 sm:px-6 sm:py-10 ${
        backdrop ? "bg-[#1b1035] bg-cover bg-center" : "bg-[radial-gradient(circle_at_top,#7b1fa2_0%,#1b1035_70%)]"
      }`}
      style={backdropStyle(backdrop)}
    >
      {/* Phones: back link (mute toggle owns the top-right corner), then the title, then a two-button action bar. */}
      <div className="flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-3 sm:flex-nowrap sm:gap-2 sm:max-xl:pe-12">
        <CartoonButton tone="white" onClick={onBack} aria-label="Back to the case file" className="order-1 min-h-12 shrink-0 text-base">
          <span aria-hidden>←</span> Case file
        </CartoonButton>
        <h1
          data-autofocus
          tabIndex={-1}
          className="order-2 basis-full text-center font-display text-[clamp(2.25rem,11vw,3rem)] leading-none tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:basis-auto sm:text-6xl"
        >
          PICK A SUSPECT!
        </h1>
        {onInvestigate ? (
          <div className="order-3 grid basis-full grid-cols-2 gap-3 sm:flex sm:basis-auto sm:items-center sm:gap-2">
            {onOpenNotebook && (
              <CartoonButton tone="white" onClick={onOpenNotebook} aria-haspopup="dialog" className="min-h-12 px-3 text-base">
                <span aria-hidden>📓</span> Notebook
              </CartoonButton>
            )}
            <CartoonButton tone="red" onClick={onInvestigate} className="min-h-12 px-3 text-base">
              <span aria-hidden>🔍</span> Investigate
              {cluesFound !== undefined && (
                <span className="ms-1 rounded-full border-2 border-black bg-yellow-300 px-2 py-0.5 text-sm font-black text-black" aria-label={`${cluesFound} clue${cluesFound === 1 ? "" : "s"}`}>
                  {cluesFound}
                </span>
              )}
            </CartoonButton>
          </div>
        ) : (
          <span className="hidden w-20 sm:block" />
        )}
      </div>
      {onAccuse && (
        <CartoonButton
          tone="red"
          onClick={onAccuse}
          data-accuse-open
          className="min-h-14 w-full max-w-sm font-display text-3xl tracking-widest ring-4 ring-yellow-300 sm:-my-4 sm:w-auto"
        >
          ⚖️ ACCUSE!
        </CartoonButton>
      )}
      <ul className="grid w-full max-w-6xl grid-cols-1 gap-5 min-[560px]:grid-cols-2 sm:gap-6 lg:grid-cols-4">
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
                data-suspect-id={s.id}
                whileHover={{ y: -8, rotate: i % 2 ? 1.5 : -1.5 }}
                whileTap={{ scale: 0.97 }}
                className="flex w-full cursor-pointer flex-row items-center gap-4 rounded-3xl border-4 border-black bg-[#fff8e7] p-4 text-start text-black shadow-[6px_6px_0_#000] md:flex-col md:text-center"
              >
                <div className="flex h-40 w-[36%] max-w-44 shrink-0 items-end justify-center overflow-hidden rounded-2xl border-[3px] border-black bg-gradient-to-b from-sky-200 to-yellow-100 md:h-64 md:w-full md:max-w-none">
                  <Portrait suspect={s} emotion={emotion} className="h-36 md:h-60" decorative />
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1 md:w-full md:flex-none md:items-center">
                  <span className="text-balance font-display text-[1.7rem] leading-[1.05] tracking-wide md:mt-3 md:text-3xl">{s.name}</span>
                  <span className="text-base font-semibold italic text-neutral-700">{s.role}</span>
                  <span className="mt-1.5">
                    <EmotionBadge emotion={emotion} />
                  </span>
                  {(stress[s.id] ?? 0) > 0 && <StressMeter value={stress[s.id]} name={s.name} compact className="mt-2 w-full max-w-56" />}
                </div>
              </motion.button>
            </motion.li>
          );
        })}
      </ul>
    </main>
  );
}
