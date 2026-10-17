"use client";

/**
 * Phase 6 (case-two plan 3.4): the ship-list notebook panel for a found clue: two labelled frames (before / after the
 * list changed) behind a toggle BUTTON (not hover). Both frames carry text labels, so it reads with images off; the
 * swap is instant (no animation), which also honours prefers-reduced-motion. Data: PublicEvidence.features["ship-list"].
 */
import { useState } from "react";
import type { ShipListClue } from "@/engine/features/ship-list";

export function ShipListFrames({ clue, name }: { clue: ShipListClue; name: string }) {
  const [i, setI] = useState(0);
  const frame = clue.frames[i];
  if (!frame) return null;
  return (
    <figure className="mt-2 rounded-xl border-[3px] border-black bg-amber-50 p-2" data-feature="ship-list">
      {/* eslint-disable-next-line @next/next/no-img-element -- case art paths from data, like the clue art */}
      <img src={frame.image} alt={`${name}: ${frame.label}`} className="w-full rounded-lg border-2 border-black object-cover" />
      <figcaption className="mt-1 text-sm font-bold" aria-live="polite">
        {frame.label}
      </figcaption>
      {clue.frames.length > 1 && (
        <button
          type="button"
          onClick={() => setI((i + 1) % clue.frames.length)}
          className="mt-2 min-h-11 w-full rounded-full border-[3px] border-black bg-white px-3 py-1 text-sm font-black uppercase shadow-[2px_2px_0_#000]"
        >
          Show: {clue.frames[(i + 1) % clue.frames.length].label}
        </button>
      )}
    </figure>
  );
}
