"use client";

import { motion } from "framer-motion";
import { CartoonButton } from "@/components/game/CartoonButton";
import type { Location } from "@/engine/types";

const ICONS = ["🕯️", "🍽️", "🚪", "🌧️", "🫖", "📚", "🛏️", "🗝️"];

/** Location cards. Searching is server-authoritative (POST /api/investigate). */
export function InvestigateScreen({
  locations,
  searched,
  lines,
  backgrounds,
  pendingId,
  otherBusy = false,
  onSearch,
  onBack,
}: {
  locations: Location[];
  searched: string[];
  /** Last flavour lines per location. */
  lines: Record<string, string[]>;
  backgrounds: Record<string, string>;
  pendingId: string | null;
  /** Another request (an interrogation reply) is in flight: searching waits for it. */
  otherBusy?: boolean;
  onSearch: (locationId: string) => void;
  onBack: () => void;
}) {
  return (
    <main className="screen-scroll flex min-h-0 flex-1 flex-col items-center gap-6 bg-[radial-gradient(circle_at_top,#3b1d6e_0%,#1b1035_70%)] px-4 py-8">
      <div className="flex w-full max-w-6xl items-center justify-between gap-2">
        <CartoonButton tone="white" onClick={onBack}>
          ← Back to suspects
        </CartoonButton>
        <h1 className="font-display text-4xl tracking-wider text-yellow-300 [-webkit-text-stroke:2px_#000] drop-shadow-[4px_4px_0_#000] sm:text-6xl">
          INVESTIGATE!
        </h1>
        <span className="hidden w-40 sm:block" />
      </div>
      <p className="max-w-2xl text-center font-semibold text-yellow-100">
        Pick a room and search it from top to bottom. Anything you find can be shoved under a suspect&apos;s nose.
      </p>
      <ul className="grid w-full max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((l, i) => {
          const done = searched.includes(l.id);
          const busy = pendingId === l.id;
          const bg = backgrounds[l.id];
          return (
            <motion.li
              key={l.id}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.08 * i, type: "spring", stiffness: 220, damping: 16 }}
              className="flex flex-col overflow-hidden rounded-3xl border-4 border-black bg-[#fff8e7] text-black shadow-[6px_6px_0_#000]"
            >
              <div
                className="relative flex h-36 items-center justify-center border-b-4 border-black bg-gradient-to-br from-violet-300 via-amber-200 to-orange-300 bg-cover bg-center"
                style={bg ? { backgroundImage: `url(${bg})` } : undefined}
              >
                {!bg && (
                  <span className="text-6xl drop-shadow-[3px_3px_0_#000]" aria-hidden>
                    {ICONS[i % ICONS.length]}
                  </span>
                )}
                <span
                  className={`absolute right-2 top-2 rounded-full border-[3px] border-black px-3 py-0.5 text-xs font-black uppercase shadow-[2px_2px_0_#000] ${
                    done ? "bg-lime-300" : "bg-white"
                  }`}
                >
                  {done ? "✔ Searched" : "Unsearched"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h2 className="font-display text-2xl tracking-wide">{l.name}</h2>
                <p className="text-sm text-neutral-700">{l.description}</p>
                {(lines[l.id] ?? []).map((t, k) => (
                  <p key={k} className="rounded-lg border-2 border-dashed border-black bg-yellow-100 px-3 py-1 text-sm font-semibold italic">
                    {t}
                  </p>
                ))}
                <CartoonButton
                  tone={done ? "white" : "red"}
                  className="mt-auto"
                  disabled={pendingId !== null || otherBusy}
                  onClick={() => onSearch(l.id)}
                  aria-label={`Search ${l.name}`}
                >
                  {busy ? "🔎 Searching…" : done ? "🔎 Search again" : "🔎 Search"}
                </CartoonButton>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </main>
  );
}
