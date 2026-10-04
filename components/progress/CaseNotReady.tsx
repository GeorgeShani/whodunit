"use client";

import { useId, useRef } from "react";
import { CartoonButton } from "@/components/game/CartoonButton";
import { useModal } from "@/components/ui/use-modal";
import type { PublicProgress } from "@/engine/progress";

/** What tapping a stamped ACCUSE shows: a playful hint for the first unmet item plus counts, never which clue, who or why. */
export function CaseNotReady({
  accuse,
  onClose,
}: {
  accuse: PublicProgress["accuse"];
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, {
    onClose,
    initialFocus: () => ref.current?.querySelector<HTMLElement>("button"),
  });
  const c = accuse.checklist;
  const rows: [string, { have: number; need: number }][] = [
    ["Clues", c.clues],
    ["Suspects", c.suspects],
    ["Cracks", c.secrets],
  ];
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-case-not-ready
        className="w-full max-w-md rounded-3xl border-4 border-black bg-[#fff8e7] p-5 text-black shadow-[8px_8px_0_#000]"
      >
        <h2
          id={titleId}
          className="font-display text-3xl tracking-wider text-red-600 -rotate-1"
        >
          CASE NOT READY
        </h2>
        <p className="mt-2 text-lg font-semibold">{accuse.line}</p>
        <ul className="mt-4 grid grid-cols-3 gap-2" aria-label="Case progress">
          {rows
            .filter(([, v]) => v.need > 0)
            .map(([label, v]) => (
              <li
                key={label}
                className={`rounded-xl border-[3px] border-black p-2 text-center ${v.have >= v.need ? "bg-lime-200" : "bg-white"}`}
              >
                <span className="block text-sm font-black uppercase">
                  {label}
                </span>
                <span className="block font-display text-2xl">
                  {Math.min(v.have, v.need)}/{v.need}
                  {v.have >= v.need && <span aria-label="done"> ✓</span>}
                </span>
              </li>
            ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <CartoonButton
            tone="red"
            onClick={onClose}
            className="min-h-12 px-6 text-lg"
          >
            Back to the case
          </CartoonButton>
        </div>
      </div>
    </div>
  );
}
